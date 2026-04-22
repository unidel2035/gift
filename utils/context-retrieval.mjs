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

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOUS = process.env.NOUS_URL || 'http://localhost:8089';

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
function retrieveSobors(query, limit = 3) {
  const dir = join(ROOT, 'data', 'conciliar-swe');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const scored = [];
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const text = [
        r.question || r.task?.title || '',
        ...(r.voices || []).map(v => v.content).filter(Boolean),
      ].join(' ');
      const s = score(query, text);
      if (s > 0.02) scored.push({ file: f, score: s, record: r });
    } catch {}
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ record, score }) => ({
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
  const [sobors, acts, threads, nous] = await Promise.all([
    Promise.resolve(retrieveSobors(question)),
    Promise.resolve(retrieveActs(question)),
    Promise.resolve(retrieveMatrixHints(question)),
    retrieveFromNous(question),
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
