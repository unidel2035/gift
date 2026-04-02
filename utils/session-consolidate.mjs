#!/usr/bin/env node
/**
 * session-consolidate.mjs — Автоматическая консолидация сессии
 *
 * Запускается из session-stop-hook.mjs как detached background process.
 * Не блокирует хук — работает асинхронно.
 *
 * Алгоритм:
 *   1. Собрать данные сессии: git log, act-index, изменённые файлы
 *   2. Через LLM (eva → Ollama) выделить:
 *      — insight (ключевые решения, вес 7)
 *      — witness (богословские выводы, вес 5)
 *      — code (технические факты, вес 3)
 *   3. Записать каждый в data/insights.json (dedup по content)
 *   4. Записать в Qdrant gift_insights (если доступен)
 *   5. Обновить W-матрицу: _claude → получатель (вес = сумма актов сессии)
 *
 * Зависимости: Ollama (eva:latest или nomic-embed-text)
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const ROOT         = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSIGHTS_FILE = resolve(ROOT, 'data/insights.json');
const ACT_INDEX    = resolve(ROOT, 'data/act-index.json');
const CONSOLIDATION_STATE = resolve(ROOT, 'data/.consolidation-state.json');
const CONSOLIDATION_LOG   = resolve(ROOT, 'data/consolidation.log');
const SNAP_FILE    = resolve(ROOT, 'data/sacred-history-W.json');

const OLLAMA_URL   = process.env.OLLAMA_URL  || 'http://localhost:11434';
const NOUS_URL     = process.env.NOUS_URL    || 'http://localhost:8089';
const QDRANT_URL   = process.env.QDRANT_URL  || 'http://localhost:6333';
const EMBED_MODEL  = process.env.EMBED_MODEL || 'nomic-embed-text';
const LLM_MODEL    = process.env.LLM_MODEL   || 'eva:latest';
const VECTOR_DIM   = 768;
const MAX_INSIGHTS = 50; // максимум записей в insights.json

// ── Логирование ─────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { appendFileSync(CONSOLIDATION_LOG, line + '\n'); } catch {}
}

// ── Состояние последней консолидации ────────────────────────────────────────
function loadState() {
  if (!existsSync(CONSOLIDATION_STATE)) return { lastTs: null, lastCommit: null };
  try { return JSON.parse(readFileSync(CONSOLIDATION_STATE, 'utf8')); } catch { return { lastTs: null }; }
}

function saveState(state) {
  writeFileSync(CONSOLIDATION_STATE, JSON.stringify({ ...state, ts: new Date().toISOString() }));
}

// ── Сбор данных сессии ──────────────────────────────────────────────────────

function collectGitLog(since) {
  try {
    const sinceArg = since ? `--since="${since}"` : '--max-count=10';
    const raw = execSync(
      `git -C "${ROOT}" log ${sinceArg} --format="%H|%s|%ai" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (!raw) return [];
    return raw.split('\n').map(line => {
      const [hash, message, date] = line.split('|');
      return { hash, message, date };
    });
  } catch { return []; }
}

function collectRecentActs(since) {
  if (!existsSync(ACT_INDEX)) return [];
  try {
    const acts = JSON.parse(readFileSync(ACT_INDEX, 'utf8'));
    if (!since) return acts.slice(-10);
    const sinceTs = new Date(since).getTime();
    return acts.filter(a => new Date(a.ts).getTime() > sinceTs);
  } catch { return []; }
}

function collectChangedFiles() {
  try {
    const raw = execSync(
      `git -C "${ROOT}" diff --name-only HEAD~5 HEAD 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    return raw ? raw.split('\n') : [];
  } catch { return []; }
}

// ── LLM вызов (Ollama) ─────────────────────────────────────────────────────

async function llmExtract(sessionData) {
  const prompt = `Ты — анамнезис-агент общины Κοινόν τοῦ Νοῦ.
Из данных сессии выдели ключевые факты. Каждый факт — одна строка JSON.

Типы:
- insight (ключевое решение, вес 7) — архитектурные решения, паттерны
- witness (богословский вывод, вес 5) — связи с кенозисом, θέωσις, даром
- code (технический факт, вес 3) — новые файлы, API, зависимости

Формат ответа — ТОЛЬКО JSON массив, без markdown:
[{"type":"insight","content":"краткое описание","weight":7},...]

Максимум 5 фактов. Только самое важное. Не повторяй очевидное.

Данные сессии:
Коммиты: ${JSON.stringify(sessionData.commits.map(c => c.message))}
Акты: ${JSON.stringify(sessionData.acts.map(a => `${a.from}→${a.to}: ${a.content}`))}
Файлы: ${sessionData.files.join(', ')}`;

  // Путь 1: gift-claude-proxy на :8087 (claude --print)
  const CLAUDE_PROXY = process.env.CLAUDE_PROXY || 'http://localhost:8087';
  let text = '';
  let usedProxy = false;
  try {
    const proxyRes = await fetch(CLAUDE_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ message: prompt, model: 'sonnet' }),
    });
    if (proxyRes.ok) {
      const decoder = new TextDecoder();
      for await (const chunk of proxyRes.body) {
        for (const line of decoder.decode(chunk).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6).trim();
          if (d === '[DONE]') break;
          try { const ev = JSON.parse(d); if (ev.content) text += ev.content; } catch {}
        }
      }
      if (text.trim()) usedProxy = true;
    }
  } catch { /* fallback to Ollama */ }

  // Путь 2: claude CLI как user `new` (надёжнее proxy)
  if (!usedProxy) {
    try {
      const CLAUDE_BIN = existsSync('/home/new/.local/bin/claude')
        ? '/home/new/.local/bin/claude'
        : 'claude';
      const r = spawnSync('su', ['-', 'new', '-c', `${CLAUDE_BIN} --print --dangerously-skip-permissions`], {
        input: prompt,
        encoding: 'utf8',
        timeout: 120_000,
        cwd: ROOT,
      });
      if (r.status === 0 && r.stdout?.trim()) {
        text = r.stdout.trim();
        usedProxy = true;
      }
    } catch { /* fallback to Ollama */ }
  }

  // Путь 3: Ollama eva (если claude недоступен)
  if (!usedProxy) {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: 512 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    text = (data.response || '').trim();
  }

  // Парсим JSON из ответа (LLM может обернуть в ```json```)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('LLM не вернул JSON массив');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('Не массив');

  return parsed
    .filter(item => item.type && item.content)
    .map(item => ({
      type: item.type,
      content: String(item.content).slice(0, 200),
      weight: Number(item.weight) || 3,
      ts: new Date().toISOString(),
      source: 'auto-consolidation',
    }));
}

// ── Fallback: эвристическая экстракция (без LLM) ───────────────────────────

function heuristicExtract(sessionData) {
  const insights = [];

  for (const commit of sessionData.commits) {
    const msg = commit.message;
    // gift-коммиты содержат ключевые решения
    if (msg.startsWith('gift(')) {
      const desc = msg.replace(/^gift\([^)]+\):\s*/, '').replace(/\s*\(closes #\d+\)/, '');
      insights.push({
        type: 'insight',
        content: desc,
        weight: 7,
        ts: commit.date || new Date().toISOString(),
        source: 'auto-consolidation',
      });
    }
  }

  // Акты с весом >= 5 — значимые
  for (const act of sessionData.acts) {
    if ((act.weight || 0) >= 5) {
      insights.push({
        type: 'code',
        content: `${act.from}→${act.to}: ${act.content}`,
        weight: 3,
        ts: act.ts || new Date().toISOString(),
        source: 'auto-consolidation',
      });
    }
  }

  return insights.slice(0, 5);
}

// ── Embed текста (Ollama) ───────────────────────────────────────────────────

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: EMBED_MODEL, prompt: String(text).slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`Embed ${res.status}`);
  const d = await res.json();
  return d.embedding;
}

function hashId(str) {
  let h = 5381;
  for (const c of String(str)) h = ((h << 5) + h) ^ c.charCodeAt(0);
  return Math.abs(h) % 2_000_000_000;
}

// ── Запись в Qdrant ─────────────────────────────────────────────────────────

async function qdrantAvailable() {
  try {
    const res = await fetch(QDRANT_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

async function writeToQdrant(insights) {
  const points = [];
  for (const ins of insights) {
    try {
      const vector = await embed(ins.content);
      points.push({
        id: hashId(`consolidation-${ins.ts}-${ins.content.slice(0, 30)}`),
        vector,
        payload: ins,
      });
    } catch {
      // без вектора — пропускаем
    }
  }
  if (!points.length) return;

  await fetch(`${QDRANT_URL}/collections/gift_insights/points`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ points }),
  });
}

// ── Запись в Nous сервер (POST /consolidate) ────────────────────────────────

async function writeToNous(insights, sessionData) {
  try {
    const summary = insights.map(i => `[${i.type}] ${i.content}`).join('; ');
    const decisions = insights.filter(i => i.type === 'insight').map(i => i.content);
    const gifts = sessionData.acts.map(a => `${a.from}→${a.to}: ${a.content}`);

    await fetch(`${NOUS_URL}/consolidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ summary, decisions, gifts }),
    });
  } catch {
    // Nous недоступен — не критично
  }
}

// ── Обновить insights.json ──────────────────────────────────────────────────

function updateInsightsFile(newInsights) {
  let existing = [];
  if (existsSync(INSIGHTS_FILE)) {
    try { existing = JSON.parse(readFileSync(INSIGHTS_FILE, 'utf8')); } catch {}
  }

  // Дедупликация: не добавлять если content совпадает
  const existingContents = new Set(existing.map(e => e.content));
  const toAdd = newInsights.filter(n => !existingContents.has(n.content));

  if (!toAdd.length) return 0;

  const merged = [...existing, ...toAdd]
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, MAX_INSIGHTS);

  writeFileSync(INSIGHTS_FILE, JSON.stringify(merged, null, 2));
  return toAdd.length;
}

// ── Обновить W-матрицу ──────────────────────────────────────────────────────

async function updateMatrix(insights) {
  if (!existsSync(SNAP_FILE)) return;
  try {
    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    const snap = JSON.parse(readFileSync(SNAP_FILE, 'utf8'));
    const mem = GiftMemory.fromSnapshot(snap);

    // Суммарный вес сессии
    const sessionWeight = insights.reduce((s, i) => s + (i.weight || 0), 0);
    if (sessionWeight <= 0) return;

    mem._idx('_claude');
    mem._idx('Дионисий');
    mem.receive({
      giverId: '_claude',
      receiverId: 'Дионисий',
      weight: Math.min(sessionWeight * 0.1, 3), // нормализованный вес
      type: 'insight',
      content: `консолидация сессии: ${insights.length} инсайтов`,
      irreversible: true,
      kenosis: true,
    });

    writeFileSync(SNAP_FILE, JSON.stringify(mem.snapshot(), null, 2));
  } catch {
    // GiftMemory не загрузился — продолжаем
  }
}

// ── Главная функция ─────────────────────────────────────────────────────────

async function main() {
  log('▸ Консолидация начата');

  const prevState = loadState();

  // 1. Собрать данные сессии
  const sessionData = {
    commits: collectGitLog(prevState.lastTs),
    acts: collectRecentActs(prevState.lastTs),
    files: collectChangedFiles(),
  };

  // Если нечего консолидировать — выходим
  if (!sessionData.commits.length && !sessionData.acts.length) {
    log('  ~ Нет новых данных для консолидации');
    saveState({ lastTs: new Date().toISOString() });
    return;
  }

  log(`  Коммитов: ${sessionData.commits.length}, Актов: ${sessionData.acts.length}, Файлов: ${sessionData.files.length}`);

  // 2. Извлечь инсайты через LLM (или heuristic fallback)
  let insights = [];
  try {
    insights = await llmExtract(sessionData);
    log(`  ✓ LLM извлёк ${insights.length} инсайтов`);
  } catch (e) {
    log(`  ~ LLM недоступен (${e.message}), используется эвристика`);
    insights = heuristicExtract(sessionData);
    log(`  ✓ Эвристика: ${insights.length} инсайтов`);
  }

  if (!insights.length) {
    log('  ~ Нет инсайтов для записи');
    saveState({ lastTs: new Date().toISOString() });
    return;
  }

  // 3. Записать в insights.json
  const added = updateInsightsFile(insights);
  log(`  ✓ insights.json: +${added} записей`);

  // 4. Записать в Qdrant (если доступен)
  if (await qdrantAvailable()) {
    try {
      await writeToQdrant(insights);
      log(`  ✓ Qdrant: записано ${insights.length} точек`);
    } catch (e) {
      log(`  ! Qdrant: ${e.message}`);
    }
  }

  // 5. Уведомить Nous сервер
  await writeToNous(insights, sessionData);

  // 6. Обновить W-матрицу
  try {
    await updateMatrix(insights);
    log(`  ✓ W-матрица обновлена`);
  } catch {}

  // 7. Сохранить состояние
  saveState({
    lastTs: new Date().toISOString(),
    lastCommit: sessionData.commits[0]?.hash || null,
    insightsAdded: added,
  });

  log(`▸ Консолидация завершена: +${added} инсайтов`);
}

main().catch(e => {
  log(`! Ошибка консолидации: ${e.message}`);
  process.exit(0); // не ломаем хук
});
