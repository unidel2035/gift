#!/usr/bin/env node
/**
 * mera-context-hook.mjs — мерная замена matrix-context-hook на UserPromptSubmit.
 *
 * Принцип (ДОТУ): материя (токены) тратится на перенос информации (знания),
 * мера (правило сборки) определяет, ЧТО переносится.
 *
 * Было (matrix-context-hook): ~6k симв (~1.9k ток) на КАЖДЫЙ ход, включая
 * статичные секции (память/стиль/авторство) → кэш Anthropic ломается каждым
 * ходом, платим полную цену за всю историю.
 *
 * Стало:
 *   - статику (память, стиль, авторство) выдаёт session-static.mjs на SessionStart
 *     → один раз на сессию → попадает в кэшируемый префикс;
 *   - здесь только летучее: время, W-снимок кратко, swarm-флаг, pending-число
 *     + top-3 записей знания, релевантных ЗАПРОСУ (mera-score).
 *
 * Итого: ~600–900 симв (~200–300 ток) на ход вместо ~1900, и кэш живёт.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Время (kairos, без импорта — хук должен быть мгновенным) ─────────────
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const now = new Date();
const moscow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
const h = moscow.getHours();
const part = h < 5 ? 'ночь' : h < 12 ? 'утро' : h < 17 ? 'день' : h < 23 ? 'вечер' : 'ночь';
const timeLine = `🕰 ${moscow.getDate()}.${String(moscow.getMonth() + 1).padStart(2, '0')}.${moscow.getFullYear()} ${String(h).padStart(2, '0')}:${String(moscow.getMinutes()).padStart(2, '0')} — ${WD[moscow.getDay()]}, ${part}`;

// ── W-матрица: краткий снимок ────────────────────────────────────────────
function matrixBrief() {
  const p = resolve(ROOT, 'data/sacred-history-W.json');
  if (!existsSync(p)) return '';
  try {
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const acts = d.stats?.totalActs ?? d.totalActs ?? (d.acts ? d.acts.length : 0);
    const persons = d.stats?.persons ?? (d.persons ? Object.keys(d.persons).length : '?');
    return `[W: ${persons} лиц · ${acts} актов]`;
  } catch { return ''; }
}

// ── Swarm: только флаг блокировок ────────────────────────────────────────
function swarmBrief() {
  const p = resolve(ROOT, 'data/swarm-state.json');
  if (!existsSync(p)) return '';
  try {
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const active = (d.agents || []).filter(a => a.status === 'active');
    return active.length ? `[Swarm: ${active.length} активн.: ${active.slice(0, 3).map(a => a.id).join(', ')}]` : '';
  } catch { return ''; }
}

// ── Pending: только число ────────────────────────────────────────────────
function pendingBrief() {
  const p = resolve(ROOT, 'data/proposals.json');
  if (!existsSync(p)) return '';
  try {
    const arr = JSON.parse(readFileSync(p, 'utf8'));
    const n = arr.filter(x => x.status === 'pending').length;
    return n ? `[Proposals pending: ${n} — node utils/proposals.mjs list]` : '';
  } catch { return ''; }
}

// ── Релевантное знание: top-3 по запросу (mera-score, inline) ────────────
function relevantKnowledge(prompt) {
  const qWords = (prompt || '').toLowerCase().split(/[^a-zа-яё0-9]+/).filter(w => w.length > 2);
  if (!qWords.length) return [];
  const recs = [];
  const push = (file, type, pick) => {
    const p = resolve(ROOT, file);
    if (!existsSync(p)) return;
    try {
      const d = JSON.parse(readFileSync(p, 'utf8'));
      for (const it of (Array.isArray(d) ? d : d.insights || [])) {
        const r = pick(it);
        if (r && r.text) recs.push({ type, ...r });
      }
    } catch { /* ignore */ }
  };
  push('data/insights.json', 'insight', it => ({ text: it.content, weight: it.weight || 5 }));
  push('data/proposals.json', 'proposal', it => ({ text: (it.enhanced || it.text || '').slice(0, 200), weight: 6 }));
  const scored = recs.map(r => {
    const t = r.text.toLowerCase();
    let hits = 0;
    for (const w of qWords) if (t.includes(w)) hits++;
    return { ...r, s: hits / qWords.length * r.weight };
  }).filter(r => r.s > 1.2).sort((a, b) => b.s - a.s).slice(0, 3);
  return scored;
}

// ── Сборка ───────────────────────────────────────────────────────────────
let prompt = '';
try {
  const raw = readFileSync(0, 'utf8');
  prompt = (JSON.parse(raw).prompt) || '';
} catch { /* нет stdin или не JSON — работаем без релевантности */ }

const parts = [timeLine, matrixBrief(), swarmBrief(), pendingBrief()].filter(Boolean);
const know = relevantKnowledge(prompt);
if (know.length) parts.push('[Мера памяти:]\n' + know.map(r => `• ${r.text.slice(0, 160)}`).join('\n'));

const ctx = parts.join('\n');
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx },
}));
