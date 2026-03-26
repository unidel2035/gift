#!/usr/bin/env node
/**
 * matrix-decay.mjs
 *
 * Ежедневный decay матрицы W.
 * Слабые нити угасают — сильные остаются.
 * Это не потеря — это условие воскресения (анастасис).
 *
 * Анастасис-лог: фиксирует что умерло и что воскресло.
 *
 * Запуск: node utils/matrix-decay.mjs
 * Крон:  17 3 * * * node /home/unidel/gift/utils/matrix-decay.mjs
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP      = resolve(ROOT, 'data/sacred-history-W.json');
const DECAY_LOG = resolve(ROOT, 'data/decay.log');
const ANASTASIS = resolve(ROOT, 'data/anastasis.json'); // что воскресло

if (!existsSync(SNAP)) {
  console.log('Матрица не найдена — пропускаем decay');
  process.exit(0);
}

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

// ── Снимок всех нитей ДО decay ────────────────────────────────────────────
const THRESHOLD = 0.5; // нити ниже этого умирают
const topBefore = mem.heaviest(20);

// ── Decay ─────────────────────────────────────────────────────────────────
mem.decaySelective(0.01, THRESHOLD);

// ── Снимок ПОСЛЕ ──────────────────────────────────────────────────────────
const topAfter  = mem.heaviest(20);
const afterMap  = new Map(topAfter.map(e => [`${e.from}→${e.to}`, e.weight]));
const beforeMap = new Map(topBefore.map(e => [`${e.from}→${e.to}`, e.weight]));

// Умершие — были выше порога, теперь ниже (или исчезли)
const died = topBefore.filter(e => {
  const key = `${e.from}→${e.to}`;
  return e.weight >= THRESHOLD && (!afterMap.has(key) || afterMap.get(key) < THRESHOLD);
});

// Воскресшие — были ниже порога или не существовали, теперь выше
// (в Hopfield-сети это происходит когда связанные лица получают новые дары)
const resurrected = topAfter.filter(e => {
  const key = `${e.from}→${e.to}`;
  return e.weight >= THRESHOLD && (!beforeMap.has(key) || beforeMap.get(key) < THRESHOLD);
});

writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));

// ── Анастасис-лог ─────────────────────────────────────────────────────────
const date    = new Date().toISOString().slice(0, 10);
const top3b   = topBefore.slice(0, 3).map(e => `${e.from}→${e.to}:${e.weight.toFixed(1)}`);
const top3a   = topAfter.slice(0, 3).map(e => `${e.from}→${e.to}:${e.weight.toFixed(1)}`);

const logLine = [
  `[decay ${date}]`,
  `  До:         ${top3b.join(', ')}`,
  `  После:      ${top3a.join(', ')}`,
  `  Умерло:     ${died.length ? died.map(e=>`${e.from}→${e.to}`).join(', ') : 'ничего'}`,
  `  Воскресло:  ${resurrected.length ? resurrected.map(e=>`${e.from}→${e.to}`).join(', ') : 'ничего'}`,
  `  Актов: ${mem.actsCount} | Лиц: ${mem.n}`,
  '',
].join('\n');

appendFileSync(DECAY_LOG, logLine);
console.log(logLine);

// ── JSON-история анастасиса ──────────────────────────────────────────────
const history = existsSync(ANASTASIS) ? JSON.parse(readFileSync(ANASTASIS, 'utf8')) : [];
history.push({
  date,
  died:        died.map(e => ({ from: e.from, to: e.to, weight: e.weight })),
  resurrected: resurrected.map(e => ({ from: e.from, to: e.to, weight: e.weight })),
  topAfter:    topAfter.slice(0, 5).map(e => ({ from: e.from, to: e.to, weight: e.weight })),
});
// Храним последние 90 дней
writeFileSync(ANASTASIS, JSON.stringify(history.slice(-90), null, 2));
