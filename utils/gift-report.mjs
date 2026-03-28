#!/usr/bin/env node
/**
 * gift-report.mjs
 *
 * Структурированный отчёт о каждом акте дара (gift-solve, gift-dev-loop).
 * Хранится в spec-vectors.db / таблица gift_acts.
 * Встраивается через nomic-embed-text (Ollama) — 768-мерный вектор.
 *
 * Использование (CLI):
 *   node utils/gift-report.mjs add --id ID --repo owner/repo --issue 42
 *     --title "Fix auth" --summary "..." --pr-url URL --actor tg_123
 *
 * Программный API:
 *   import { createReport, searchReports } from './gift-report.mjs'
 */

import Database    from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath }    from 'url';

const ROOT       = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH    = resolve(ROOT, 'data/spec-vectors.db');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

// ── Schema ─────────────────────────────────────────────────────────────────────
function getDb() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gift_acts (
      id            TEXT    PRIMARY KEY,
      issue_url     TEXT,
      repo          TEXT,
      issue_number  INTEGER,
      title         TEXT,
      problem       TEXT,
      context_      TEXT,
      approach      TEXT,
      result        TEXT,
      telos         TEXT,
      pr_url        TEXT,
      actor         TEXT,
      status        TEXT    DEFAULT 'completed',
      files_changed TEXT,
      embedding     BLOB,
      created_at    INTEGER DEFAULT (unixepoch())
    )
  `);
  return db;
}

// ── Embed ──────────────────────────────────────────────────────────────────────
async function embed(text) {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal:  AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const vec = d.embedding;
    if (!vec?.length) return null;
    const buf = Buffer.allocUnsafe(vec.length * 4);
    vec.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    return buf;
  } catch {
    return null;
  }
}

// ── Cosine similarity ──────────────────────────────────────────────────────────
function cosine(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function blobToVec(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const arr = new Array(buf.length / 4);
  for (let i = 0; i < arr.length; i++) arr[i] = buf.readFloatLE(i * 4);
  return arr;
}

// ── Create report ──────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string}  opts.id           — уникальный ID акта
 * @param {string}  opts.issueUrl     — ссылка на issue
 * @param {string}  opts.repo         — owner/repo
 * @param {number}  opts.issueNumber
 * @param {string}  opts.title        — заголовок задачи
 * @param {string}  opts.problem      — что было не так
 * @param {string}  opts.context_     — почему это важно
 * @param {string}  opts.approach     — как решалось
 * @param {string}  opts.result       — что получилось
 * @param {string}  [opts.telos]      — телос (оценка Различителя)
 * @param {string}  [opts.prUrl]      — ссылка на PR
 * @param {string}  [opts.actor]      — tg_userId или _executor
 * @param {string}  [opts.status]     — completed | kenosis
 * @param {string[]}[opts.filesChanged]
 */
export async function createReport(opts) {
  const {
    id, issueUrl = '', repo = '', issueNumber = 0,
    title = '', problem = '', context_ = '', approach = '', result = '',
    telos = '', prUrl = '', actor = '_executor',
    status = 'completed', filesChanged = [],
  } = opts;

  if (!id) throw new Error('id required');

  // Текст для эмбеддинга — семантически насыщенный
  const embedText = [
    title, problem, context_, approach, result, telos,
  ].filter(Boolean).join('\n');

  const emb = await embed(embedText);

  const db = getDb();
  try {
    db.prepare(`
      INSERT OR REPLACE INTO gift_acts
        (id, issue_url, repo, issue_number, title, problem, context_, approach,
         result, telos, pr_url, actor, status, files_changed, embedding)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, issueUrl, repo, issueNumber,
      title, problem, context_, approach, result, telos,
      prUrl, actor, status,
      JSON.stringify(filesChanged),
      emb,
    );
  } finally {
    db.close();
  }

  return { id, repo, issueNumber, title, prUrl, embedded: !!emb };
}

// ── Search reports ─────────────────────────────────────────────────────────────
/**
 * @param {string} query
 * @param {number} [topK=5]
 * @returns {Promise<Array>}
 */
export async function searchReports(query, topK = 5) {
  const db = getDb();
  try {
    const rows = db.prepare('SELECT * FROM gift_acts ORDER BY created_at DESC LIMIT 200').all();
    if (!rows.length) return [];

    const qEmb = await embed(query);
    if (!qEmb) {
      // Text fallback: simple keyword match
      const q = query.toLowerCase();
      return rows
        .filter(r => [r.title, r.problem, r.context_, r.approach, r.result]
          .some(f => f?.toLowerCase().includes(q)))
        .slice(0, topK)
        .map(r => ({ ...r, score: 0.5 }));
    }

    const qVec = blobToVec(qEmb);
    return rows
      .filter(r => r.embedding)
      .map(r => ({ ...r, score: cosine(qVec, blobToVec(r.embedding)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  } finally {
    db.close();
  }
}

// ── List recent ────────────────────────────────────────────────────────────────
export function listRecentReports(limit = 10) {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT id, repo, issue_number, title, pr_url, actor, status, created_at
      FROM gift_acts ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  } finally {
    db.close();
  }
}

// ── Format for display ─────────────────────────────────────────────────────────
export function formatReport(r, { showScore = false } = {}) {
  const date = new Date(r.created_at * 1000).toISOString().slice(0, 10);
  const score = showScore && r.score != null ? ` [${r.score.toFixed(2)}]` : '';
  const status = r.status === 'kenosis' ? '✗' : '✦';
  return [
    `${status} [${date}] ${r.repo}#${r.issue_number}${score}`,
    `   ${r.title}`,
    r.problem  ? `   Проблема: ${r.problem.slice(0, 120)}` : '',
    r.approach ? `   Решение:  ${r.approach.slice(0, 120)}` : '',
    r.pr_url   ? `   PR: ${r.pr_url}` : '',
  ].filter(Boolean).join('\n');
}

// ── CLI ────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd  = process.argv[2];
  const args = process.argv.slice(3);

  function arg(name) {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : null;
  }

  if (cmd === 'add') {
    const r = await createReport({
      id:           arg('id') || `cli-${Date.now()}`,
      issueUrl:     arg('issue-url') || '',
      repo:         arg('repo') || '',
      issueNumber:  Number(arg('issue')) || 0,
      title:        arg('title') || '',
      problem:      arg('problem') || '',
      context_:     arg('context') || '',
      approach:     arg('approach') || '',
      result:       arg('result') || '',
      telos:        arg('telos') || '',
      prUrl:        arg('pr-url') || '',
      actor:        arg('actor') || '_executor',
      status:       arg('status') || 'completed',
    });
    console.log(`✦ Отчёт сохранён: ${r.id} (embedded: ${r.embedded})`);

  } else if (cmd === 'search') {
    const query = args.filter(a => !a.startsWith('--')).join(' ');
    const topK  = Number(arg('top')) || 5;
    if (!query) { console.error('Укажи запрос: gift-report.mjs search <текст>'); process.exit(1); }
    const results = await searchReports(query, topK);
    if (!results.length) { console.log('Ничего не найдено.'); process.exit(0); }
    console.log(`\nПо теме "${query}" (топ ${results.length}):\n`);
    for (const r of results) console.log(formatReport(r, { showScore: true }) + '\n');

  } else if (cmd === 'list') {
    const limit = Number(arg('limit')) || 10;
    const rows  = listRecentReports(limit);
    if (!rows.length) { console.log('Отчётов пока нет.'); process.exit(0); }
    console.log(`\nПоследние ${rows.length} акта:\n`);
    for (const r of rows) console.log(formatReport(r) + '\n');

  } else {
    console.log('Команды: add | search <запрос> | list [--limit N]');
  }
}
