/**
 * context-retrieval — анамнезис перед собором.
 *
 * Перед тем как три голоса ответят, сеть общины вспоминает:
 *   — похожие прошлые соборы (data/conciliar-swe/*.json + nous /search)
 *   — релевантные акты из матрицы W (data/insights.json + nous /acts)
 *   — топ-нити матрицы, которые касаются вопроса
 *
 * Это тот самый retrieval, который у монолитов — через длинный контекст,
 * а у нас — через живую матрицу и журнал соборов.
 *
 * Не просто «контекст». Это **ἀνάμνησις** — прошлое со-присутствует в настоящем.
 * Собор перестаёт быть амнезическим: каждый новый разговор помнит
 * прошлые разговоры общины.
 *
 * @module context-retrieval
 */

'use strict';

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOUS = process.env.NOUS_URL || 'http://localhost:8089';
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const EMB_CACHE_DIR = join(ROOT, 'data', 'embeddings-cache');
if (!existsSync(EMB_CACHE_DIR)) mkdirSync(EMB_CACHE_DIR, { recursive: true });

// ── Semantic embedding через Ollama ──────────────────────────────
let _ollamaAvailable = null;
async function checkOllama() {
  if (_ollamaAvailable !== null) return _ollamaAvailable;
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) });
    _ollamaAvailable = r.ok;
  } catch { _ollamaAvailable = false; }
  return _ollamaAvailable;
}

async function embed(text) {
  if (!(await checkOllama())) return null;
  try {
    const r = await fetch(`${OLLAMA}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.embedding || null;
  } catch { return null; }
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) + 1e-9);
}

// Embedding cache: {sha256(text): embedding}
// Простой hash-подход: sha256 первых 300 символов текста.
async function sha(text) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text.slice(0, 300)).digest('hex').slice(0, 16);
}
async function embedCached(text) {
  const key = await sha(text);
  const file = join(EMB_CACHE_DIR, `${key}.json`);
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch {}
  }
  const e = await embed(text);
  if (e) { try { writeFileSync(file, JSON.stringify(e)); } catch {} }
  return e;
}

// ── Токенизация для наивного relevance ────────────────────────────
function tokens(s) {
  return (s || '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);
}

function score(query, text) {
  const q = new Set(tokens(query));
  const t = tokens(text);
  if (!q.size || !t.length) return 0;
  let hits = 0;
  for (const tok of t) if (q.has(tok)) hits++;
  return hits / Math.sqrt(t.length + q.size);  // tf-idf-подобное
}

// ── Прошлые соборы из журнала ─────────────────────────────────────
async function retrieveSobors(query, limit = 3) {
  const dir = join(ROOT, 'data', 'conciliar-swe');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));

  const queryEmb = await embedCached(query);
  const useSemantic = !!queryEmb;

  const scored = [];
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const text = [
        r.question || r.task?.title || '',
        ...(r.voices || []).map(v => v.content).filter(Boolean),
      ].join(' ');

      let s;
      if (useSemantic) {
        const emb = await embedCached(text.slice(0, 2000));
        s = emb ? cosine(queryEmb, emb) : score(query, text);
      } else {
        s = score(query, text);
      }
      const threshold = useSemantic ? 0.55 : 0.02;
      if (s > threshold) scored.push({ file: f, score: s, record: r, _semantic: useSemantic });
    } catch {}
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ record, score, _semantic }) => ({
    id: record.id,
    at: record.at,
    question: record.question || record.task?.title,
    dominant: record.dominant?.persona || null,
    apophatic: !!record.apophatic,
    elapsedSec: record.elapsedSec,
    voicesSummary: (record.voices || []).slice(0, 3).map(v => ({
      persona: v.persona, logos: v.logos,
      hint: (v.content || '').slice(0, 200),
    })),
    _score: parseFloat(score.toFixed(3)),
    _method: _semantic ? 'semantic' : 'lexical',
  }));
}

// ── Релевантные акты матрицы из insights.json ─────────────────────
function retrieveActs(query, limit = 5) {
  const f = join(ROOT, 'data', 'insights.json');
  if (!existsSync(f)) return [];
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.acts || raw.insights || []);
    const scored = [];
    for (const a of list) {
      const text = [
        a.content || a.text || a.description || '',
        a.from || a.giverId || '',
        a.to || a.receiverId || '',
        a.type || '',
      ].join(' ');
      const s = score(query, text);
      if (s > 0.02) scored.push({ act: a, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ act, score }) => ({
      from: act.from || act.giverId,
      to:   act.to   || act.receiverId,
      type: act.type,
      weight: act.weight,
      hint: (act.content || act.text || '').slice(0, 200),
      _score: parseFloat(score.toFixed(3)),
    }));
  } catch { return []; }
}

// ── Топ-нити из матрицы, касающиеся упомянутых лиц ────────────────
function retrieveMatrixHints(query) {
  const f = join(ROOT, 'data', 'sacred-history-W.json');
  if (!existsSync(f)) return [];
  try {
    const snap = JSON.parse(readFileSync(f, 'utf8'));
    const q = new Set(tokens(query));
    const threads = snap.threads || snap.heaviest || [];
    const list = Array.isArray(threads) ? threads : Object.entries(threads).map(([k, v]) =>
      ({ from: k.split('→')[0], to: k.split('→')[1], weight: v }));
    const relevant = list.filter(t => {
      const names = [t.from, t.to].filter(Boolean).map(n => n.toLowerCase());
      return names.some(n => q.has(n) || [...q].some(token => n.includes(token) || token.includes(n)));
    }).slice(0, 5);
    return relevant;
  } catch { return []; }
}

// ── Запрос к nous-серверу (если доступен) ─────────────────────────
async function retrieveFromNous(query) {
  try {
    const r = await fetch(`${NOUS}/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.results || data;
  } catch { return null; }
}

// ── Главная функция ───────────────────────────────────────────────
export async function retrieveContext(question) {
  const [sobors, acts, threads, nous, ollamaOn] = await Promise.all([
    retrieveSobors(question),
    Promise.resolve(retrieveActs(question)),
    Promise.resolve(retrieveMatrixHints(question)),
    retrieveFromNous(question),
    checkOllama(),
  ]);

  return {
    sobors,
    acts,
    threads,
    nous: nous || null,
    summary: {
      priorSoborCount: sobors.length,
      relevantActCount: acts.length,
      relevantThreadCount: threads.length,
      nousAvailable: !!nous,
      semantic: ollamaOn,
      method: ollamaOn ? 'embedding-cosine' : 'lexical-tfidf',
    },
  };
}

/**
 * Построить текстовый pre-context для промптов голосов.
 * Короткий, чтобы не перегружать промпт. Задача — дать заземление.
 */
export function contextAsPrompt(ctx) {
  if (!ctx) return '';
  const parts = [];
  if (ctx.sobors?.length) {
    parts.push('## Похожие прошлые соборы:');
    for (const s of ctx.sobors) {
      const when = s.at ? new Date(s.at).toLocaleDateString('ru-RU') : '';
      parts.push(`- (${when}) «${(s.question || '').slice(0, 80)}» → dominant: ${s.dominant || (s.apophatic ? 'apophatic' : '⟨silent⟩')}`);
    }
  }
  if (ctx.threads?.length) {
    parts.push('\n## Релевантные нити матрицы W:');
    for (const t of ctx.threads) {
      parts.push(`- ${t.from} → ${t.to}: вес ${t.weight}`);
    }
  }
  if (ctx.acts?.length) {
    parts.push('\n## Прошлые акты, касающиеся темы:');
    for (const a of ctx.acts) {
      parts.push(`- ${a.from} → ${a.to} [${a.type}, вес ${a.weight}]: ${a.hint}`);
    }
  }
  return parts.join('\n');
}
