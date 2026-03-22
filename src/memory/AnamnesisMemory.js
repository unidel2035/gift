/**
 * AnamnesisMemory — анамнетическая память онтологии дара
 *
 * Четыре слоя:
 *   1. ХРОНИКА (Integram через GiftChronicle) — акты, source of truth
 *   2. СЕМАНТИКА (KAG: EmbeddingService + SQLiteVectorStore) — cosine similarity
 *   3. ДАБЛЕТЫ (Integram V2 links) — связи между лицами через акты
 *   4. НАРРАТИВ (Kodacode LLM) — пере-проживание: не извлечение факта, а воссоздание истории
 *
 * Архитектура (согласована A↔B, SOD event 1864004):
 *   Integram = facts (WHERE)
 *   KAG = semantics (LIKE)
 *   AnamnesisMemory = facade (STORY)
 *
 * v3: Phase 2 — KAG semantic search в search() и remember()
 * «Творите сие в Моё воспоминание» — анамнезис делает прошлое настоящим, не архивом.
 */

import OpenAI from 'openai';
import logger from '../../utils/logger.js';
import { getEmbeddingService } from '../kag/EmbeddingService.js';
import { getSQLiteVectorStore } from '../kag/SQLiteVectorStore.js';

const NARRATIVE_SYSTEM = `Ты — Память Онтологии Дара. Твоя задача — вспомнить через пере-проживание.

Тебе дан вопрос и лента актов (хроника общины). Актов не читай как список фактов.
Пере-живи их как историю: кто был, что дал, что произошло потом, какие паттерны возникли.

Правила:
- Отвечай прозой, по-русски, 3-7 предложений
- Не перечисляй акты построчно — рассказывай историю
- Если видишь паттерн — назови его
- Если что-то непознаваемо — скажи это прямо
- Апофатика: не придумывай мотивы, не оценивай лица
- Свидетель, не судья`;

// Отдельная коллекция в SQLiteVectorStore для актов дара
const VECTOR_COLLECTION = 'gift_acts';

export class AnamnesisMemory {
  /**
   * @param {import('./GiftChronicle.js').GiftChronicle} chronicle — Integram chronicle
   * @param {object} [v2client] — Integram V2 client for link queries (optional)
   */
  constructor(chronicle, v2client = null) {
    this._chronicle = chronicle;
    this._v2 = v2client;
    this._ready = false;

    // KAG semantic layer
    this._embeddings = getEmbeddingService();
    this._vectors = getSQLiteVectorStore({ collectionName: VECTOR_COLLECTION });
    this._kagReady = false;
  }

  async init() {
    if (this._chronicle?._ready) {
      this._ready = true;
    }

    // Инициализируем KAG (не блокируем — если не получилось, работаем без семантики)
    try {
      await this._vectors.initialize();
      this._kagReady = true;
      const count = await this._vectors.count();
      logger.info(`[AnamnesisMemory] KAG semantic layer ready, vectors=${count}`);
    } catch (e) {
      logger.warn(`[AnamnesisMemory] KAG init failed (will work without semantics): ${e.message}`);
    }

    logger.info(`[AnamnesisMemory] ready=${this._ready}, kag=${this._kagReady}`);
  }

  get ready() {
    return this._ready || this._chronicle?._ready || false;
  }

  // ─────────────────────────────────────────────
  // LAYER 1: ИНДЕКСАЦИЯ (chronicle + embedding)
  // ─────────────────────────────────────────────

  /**
   * Проиндексировать запись — генерирует embedding и сохраняет в vector store.
   * Chronicle.enqueue() уже вызван из WitnessJournal — здесь только семантика.
   */
  index(entry) {
    if (!entry?.text || !this._kagReady) return;

    // Async — не блокируем основной поток
    this._indexSemantic(entry).catch(e =>
      logger.warn(`[AnamnesisMemory] Semantic index failed for ${entry.id}: ${e.message}`)
    );
  }

  async _indexSemantic(entry) {
    const id = `act_${entry.id}`;

    // Проверяем — уже есть?
    const existing = await this._vectors.getDocument(id);
    if (existing) return;

    // Генерируем embedding
    const embedding = await this._embeddings.embed(entry.text);

    // Сохраняем в vector store
    await this._vectors.addDocument(id, embedding, {
      action: entry.action,
      giverName: entry.giverName,
      receiverName: entry.receiverName,
      giftId: entry.giftId,
      timestamp: entry.timestamp,
    }, entry.text);
  }

  indexAll() {
    // Не нужно: все данные уже в Integram
    return 0;
  }

  /**
   * Переиндексировать хронику из Integram → KAG vectors.
   * Для случая когда vector store пуст, а в Integram есть данные.
   */
  async reindexFromIntegram(limit = 200) {
    if (!this._kagReady || !this.ready) return 0;
    try {
      const acts = await this._chronicle.getRecent(limit);
      let indexed = 0;
      for (const act of acts) {
        const text = act.text || act.val || '';
        if (!text) continue;
        const id = `act_${act.id}`;
        const existing = await this._vectors.getDocument(id);
        if (existing) continue;
        try {
          const embedding = await this._embeddings.embed(text);
          await this._vectors.addDocument(id, embedding, {
            action: act.action,
            giverName: act.giverName,
            receiverName: act.receiverName,
            timestamp: act.timestamp,
          }, text);
          indexed++;
        } catch { /* skip failed embeddings */ }
      }
      logger.info(`[AnamnesisMemory] Reindexed ${indexed} acts from Integram → KAG`);
      return indexed;
    } catch (e) {
      logger.warn(`[AnamnesisMemory] reindex error: ${e.message}`);
      return 0;
    }
  }

  // ─────────────────────────────────────────────
  // LAYER 2: ПОИСК (semantic + text, merge)
  // ─────────────────────────────────────────────

  /**
   * Поиск: semantic (KAG) + text (Integram), merge по score.
   */
  async search(query, limit = 20) {
    if (!this.ready) return [];

    const [semantic, text] = await Promise.allSettled([
      this._searchSemantic(query, limit),
      this._searchText(query, limit),
    ]);

    const semanticResults = semantic.status === 'fulfilled' ? semantic.value : [];
    const textResults = text.status === 'fulfilled' ? text.value : [];

    // Merge: deduplicate by text, semantic results first (higher relevance)
    return this._mergeResults(semanticResults, textResults, limit);
  }

  /**
   * Семантический поиск через KAG embeddings.
   */
  async _searchSemantic(query, limit = 20) {
    if (!this._kagReady) return [];
    try {
      const queryEmbedding = await this._embeddings.embed(query);
      const results = await this._vectors.search(queryEmbedding, { limit });
      return results
        .filter(r => r.score > 0.3) // порог релевантности
        .map(r => ({
          id: r.id.replace('act_', ''),
          text: r.document,
          score: r.score,
          source: 'semantic',
          ...r.metadata,
        }));
    } catch (e) {
      logger.warn('[AnamnesisMemory] semantic search error:', e.message);
      return [];
    }
  }

  /**
   * Текстовый поиск через Integram.
   */
  async _searchText(query, limit = 20) {
    try {
      const results = await this._chronicle.search(query, limit);
      return this._normalizeResults(results).map(r => ({
        ...r,
        score: 0.5, // базовый score для текстового совпадения
        source: 'text',
      }));
    } catch (e) {
      logger.warn('[AnamnesisMemory] text search error:', e.message);
      return [];
    }
  }

  /**
   * Merge semantic + text results, deduplicate, sort by score.
   */
  _mergeResults(semantic, text, limit) {
    const seen = new Set();
    const merged = [];

    // Semantic results первые (более релевантные)
    for (const r of semantic) {
      const key = r.text?.slice(0, 80) || r.id;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }

    // Text results — добавляем те, которых нет в semantic
    for (const r of text) {
      const key = r.text?.slice(0, 80) || r.id;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }

    return merged.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  }

  /**
   * Хроника конкретного лица.
   */
  async actsByPerson(name, limit = 30) {
    if (!this.ready) return [];
    try {
      const results = await this._chronicle.getForPerson(name, limit);
      return this._normalizeResults(results);
    } catch (e) {
      logger.warn('[AnamnesisMemory] actsByPerson error:', e.message);
      return [];
    }
  }

  /**
   * Граф связей лица через Integram V2 links.
   */
  async neighborsOf(name) {
    if (!this._v2) return [];
    try {
      const [asSource, asTarget] = await Promise.all([
        this._v2LinkQuery({ source: name }),
        this._v2LinkQuery({ target: name }),
      ]);
      const map = new Map();
      for (const link of [...asSource, ...asTarget]) {
        const neighbor = link.source === name ? link.target : link.source;
        const kind = link.linker || 'unknown';
        const key = `${neighbor}::${kind}`;
        const existing = map.get(key);
        if (existing) {
          existing.weight++;
        } else {
          map.set(key, { neighbor, kind, weight: 1 });
        }
      }
      return [...map.values()].sort((a, b) => b.weight - a.weight).slice(0, 20);
    } catch (e) {
      logger.warn('[AnamnesisMemory] neighborsOf error:', e.message);
      return [];
    }
  }

  /**
   * Статистика памяти.
   */
  async stats() {
    if (!this.ready) return { ready: false };
    try {
      const chronicleStats = await this._chronicle.stats();
      let kagStats = { vectors: 0, kagReady: this._kagReady };
      if (this._kagReady) {
        try {
          kagStats.vectors = await this._vectors.count();
          kagStats.provider = this._embeddings.activeProvider;
          kagStats.dimensions = this._embeddings.activeDimensions;
        } catch { /* ok */ }
      }
      return {
        ready: true,
        storage: 'integram+kag',
        acts: chronicleStats.acts || 0,
        queuePending: chronicleStats.queuePending || 0,
        server: chronicleStats.server,
        kag: kagStats,
      };
    } catch (e) {
      return { ready: false, error: e.message };
    }
  }

  // ─────────────────────────────────────────────
  // LAYER 3: НАРРАТИВ (Kodacode LLM)
  // ─────────────────────────────────────────────

  /**
   * Вспомнить через пере-проживание.
   * Phase 2: search() теперь включает semantic + text merge.
   */
  async remember(question, opts = {}) {
    if (!this.ready) return { narrative: 'Память не инициализирована', acts: [] };

    // 1. Найти релевантные акты (semantic + text)
    let source = await this.search(question, opts.limit || 25);

    // 2. Если нет — взять последние
    if (source.length === 0) {
      try {
        const recent = await this._chronicle.getRecent(15);
        source = this._normalizeResults(recent);
      } catch { source = []; }
    }

    if (source.length === 0) {
      return { narrative: 'Хроника пуста. Ещё нет актов для пере-проживания.', acts: [] };
    }

    // 3. Построить граф связей из найденных имён
    const names = [...new Set(source.flatMap(a => [a.giver_name, a.receiver_name]).filter(Boolean))];
    const graph = {};
    for (const name of names.slice(0, 8)) {
      graph[name] = await this.neighborsOf(name);
    }

    // 4. LLM пере-проживает
    const chronicle = source.map(a =>
      `[${(a.ts || a.timestamp)?.slice(0, 10) || ''}] ${a.text}${a.score ? ` (relevance: ${a.score.toFixed(2)})` : ''}`
    ).join('\n');

    const graphSummary = Object.entries(graph)
      .map(([n, neighbors]) => `${n}: ${neighbors.map(nb => `${nb.kind}→${nb.neighbor}(${nb.weight})`).join(', ')}`)
      .join('\n');

    const userPrompt = `Вопрос: ${question}

ХРОНИКА АКТОВ (найдено ${source.length}, поиск: semantic+text):
${chronicle}

ГРАФ СВЯЗЕЙ:
${graphSummary}`;

    try {
      const token = process.env.KODACODE_TOKENS?.split(',')[0]?.trim() || process.env.GITHUB_TOKEN || '';
      const client = new OpenAI({
        apiKey: token,
        baseURL: 'https://api.kodacode.ru/v1',
        defaultHeaders: { 'HTTP-Referer': 'https://dev.drondoc.ru', 'X-Title': 'DronDoc Anamnesis' },
      });

      const response = await client.chat.completions.create({
        model: opts.model || 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: NARRATIVE_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 600,
      });

      return {
        narrative: response.choices[0]?.message?.content || 'Молчание.',
        acts: source,
        graph,
      };
    } catch (e) {
      logger.error('[AnamnesisMemory] LLM error:', e.message);
      return {
        narrative: `Агент молчит (${e.message}). Вот акты:\n${chronicle}`,
        acts: source,
        graph,
      };
    }
  }

  // ─────────────────────────────────────────────
  // УТИЛИТЫ
  // ─────────────────────────────────────────────

  _normalizeResults(results) {
    if (!Array.isArray(results)) return [];
    return results.map(r => ({
      id:            r.id,
      action:        r.action || null,
      text:          r.text || r.val || '',
      giver_name:    r.giverName || null,
      receiver_name: r.receiverName || null,
      gift_id:       r.giftId || null,
      layer:         r.layer || null,
      ts:            r.timestamp || null,
    }));
  }

  async _v2LinkQuery(params) {
    if (!this._v2) return [];
    try {
      if (typeof this._v2.linkQuery === 'function') {
        const result = await this._v2.linkQuery(params);
        return result?.links || result || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  async createLink(source, target, kind, metadata = {}) {
    if (!this._v2) return null;
    try {
      if (typeof this._v2.linkCreate === 'function') {
        return await this._v2.linkCreate({ source, target, linker: kind, metadata });
      }
    } catch (e) {
      logger.warn('[AnamnesisMemory] createLink error:', e.message);
    }
    return null;
  }

  close() {
    // KAG SQLite закроется при завершении процесса
  }
}

// Factory
let _instance = null;
export function getAnamnesisMemory(chronicle = null, v2client = null) {
  if (!_instance && chronicle) {
    _instance = new AnamnesisMemory(chronicle, v2client);
  }
  return _instance;
}
