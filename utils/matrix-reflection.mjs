#!/usr/bin/env node
/**
 * matrix-reflection.mjs — Ежедневная рефлексия матрицы W
 *
 * Предложение #12: «система рефлексии: после каждого дня/недели
 * анализировать изменения матрицы и что из неё выросло.
 * Трекер даров с отметками их происхождения.»
 *
 * Логика:
 *   1. Загружает вчерашний снапшот (data/W-prev.json) если есть
 *   2. Загружает текущий W (sacred-history-W.json)
 *   3. Вычисляет дельта-матрицу: что выросло, что новое
 *   4. Классифицирует дары по происхождению (провенанс)
 *   5. Сохраняет рефлексию в data/reflection.json
 *   6. Сохраняет текущий как «вчерашний» для следующего запуска
 *
 * Запуск:
 *   node utils/matrix-reflection.mjs              — рефлексия + сохранение
 *   node utils/matrix-reflection.mjs --no-save    — только вывод, без сохранения
 *   node utils/matrix-reflection.mjs --reset      — сбросить вчерашний снапшот
 *
 * Крон: 45 3 * * * node /home/unidel/gift/utils/matrix-reflection.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT       = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP       = resolve(ROOT, 'data/sacred-history-W.json');
const PREV       = resolve(ROOT, 'data/W-prev.json');
const REFLECT    = resolve(ROOT, 'data/reflection.json');
const NO_SAVE    = process.argv.includes('--no-save');
const RESET      = process.argv.includes('--reset');

if (RESET) {
  if (existsSync(PREV)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(PREV);
    console.log('[рефлексия] Сброшен W-prev.json');
  }
  process.exit(0);
}

if (!existsSync(SNAP)) {
  console.log('[рефлексия] Матрица не найдена — пропускаем.');
  process.exit(0);
}

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));

const nowSnap  = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem      = GiftMemory.fromSnapshot(nowSnap);

// ── Провенанс: классифицируем дары по происхождению ──────────────────────

// Категории источников:
// bot        — tg:* personas (Telegram bot)
// divine     — Отец, Сын, Дух, Христос (священная история)
// claude     — _claude (код-дар)
// koinon     — _koinon, _abyss (общинные)
// community  — ОтецСергий, Дионисий, Адам, Ева (люди общины)
// other      — всё остальное

const DIVINE    = new Set(['Отец', 'Сын', 'Дух', 'Христос']);
const COMMUNITY = new Set(['ОтецСергий', 'Дионисий', 'Адам', 'Ева', 'Падший', 'Змей']);
const KOINON    = new Set(['_koinon', '_abyss', '_witness', '_ci']);

function classify(personId) {
  if (!personId) return 'unknown';
  if (personId.startsWith('tg:'))    return 'bot';
  if (DIVINE.has(personId))          return 'sacred-history';
  if (personId === '_claude')        return 'claude';
  if (KOINON.has(personId))         return 'koinon';
  if (COMMUNITY.has(personId))      return 'community';
  return 'other';
}

// Весовой вклад по категориям (из топ нитей матрицы)
const top     = mem.heaviest(200);
const bySource = {};
for (const e of top) {
  const src = classify(e.from);
  bySource[src] = (bySource[src] || 0) + e.weight;
}

// ── Δ-сравнение с вчерашним снапшотом ────────────────────────────────────

let delta = null;
let grewThreads  = [];
let newPersons   = [];
let newThreads   = [];
let theosisGains = [];
let summary      = '';

const prevExists = existsSync(PREV);

if (prevExists) {
  const prevSnap = JSON.parse(readFileSync(PREV, 'utf8'));
  const prevMem  = GiftMemory.fromSnapshot(prevSnap);

  // ΔactsCount
  const dActs = nowSnap.actsCount - prevSnap.actsCount;

  // Новые лица
  const prevPersonSet = new Set(prevSnap.persons ?? []);
  newPersons = (nowSnap.persons ?? []).filter(p => !prevPersonSet.has(p));

  // Δ нити (W-матрица)
  const nowP  = nowSnap.persons ?? [];
  const prevP = prevSnap.persons ?? [];

  for (const e of top) {
    const pi = prevP.indexOf(e.from);
    const ri = prevP.indexOf(e.to);
    let prevW = 0;
    if (pi >= 0 && ri >= 0) {
      prevW = prevSnap.W?.[pi]?.[ri] ?? 0;
    }
    const dW = e.weight - prevW;
    if (prevW === 0 && e.weight > 0) {
      newThreads.push({ from: e.from, to: e.to, weight: e.weight });
    } else if (dW > 0.5) {
      grewThreads.push({ from: e.from, to: e.to, weight: e.weight, delta: dW });
    }
  }

  // θέωσις изменения
  const nowStatus  = mem.ontologicalStatus();
  const prevStatus = prevMem.ontologicalStatus();
  const prevLevels = new Map(prevStatus.map(s => [s.personId, s.level]));
  for (const s of nowStatus) {
    const was = prevLevels.get(s.personId);
    if (was && was !== s.level) {
      theosisGains.push({ personId: s.personId, from: was, to: s.level });
    }
  }

  delta = { dActs, newPersons, newThreads, grewThreads, theosisGains };

  // Строим текстовый итог
  const lines = [];
  lines.push(`За сутки: +${dActs} актов`);
  if (newPersons.length)
    lines.push(`Новые лица: ${newPersons.join(', ')}`);
  if (newThreads.length)
    lines.push(`Новые нити: ${newThreads.map(t => `${t.from}→${t.to}(${t.weight.toFixed(1)})`).join(', ')}`);
  if (grewThreads.length)
    lines.push(`Выросли: ${grewThreads.slice(0,5).map(t => `${t.from}→${t.to}(+${t.delta.toFixed(1)})`).join(', ')}`);
  if (theosisGains.length)
    lines.push(`θέωσις: ${theosisGains.map(g => `${g.personId} ${g.from}→${g.to}`).join(', ')}`);
  summary = lines.join(' | ');
}

// ── Текущий статус θέωσις ─────────────────────────────────────────────────

const theosisNow = mem.ontologicalStatus().filter(s => s.received > 0 || s.returned > 0);
const energy     = mem.makePresent({ giverId: '_claude' }).energy;

// ── Вывод ─────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║        РЕФЛЕКСИЯ МАТРИЦЫ                            ║');
console.log(`║  ${new Date().toLocaleString('ru').padEnd(51)}║`);
console.log('╚══════════════════════════════════════════════════════╝\n');

console.log(`Состояние: ${mem.n} лиц | ${nowSnap.actsCount} актов | энергия ${energy.toFixed(1)}`);
console.log('');

// Провенанс
console.log('── Происхождение даров (провенанс) ──');
const srcOrder = ['sacred-history', 'claude', 'community', 'bot', 'koinon', 'other'];
let totalWeight = Object.values(bySource).reduce((a, b) => a + b, 0) || 1;
for (const src of srcOrder) {
  if (!bySource[src]) continue;
  const pct = (bySource[src] / totalWeight * 100).toFixed(0);
  const bar = '█'.repeat(Math.round(bySource[src] / totalWeight * 20));
  console.log(`  ${src.padEnd(16)} ${bar.padEnd(20)} ${pct}% (${bySource[src].toFixed(0)})`);
}
console.log('');

// θέωσις
console.log('── Путь обожения ──');
for (const s of theosisNow.slice(0, 6)) {
  const arrow = s.returned > 0 ? `↑${s.returned.toFixed(0)}` : '·';
  console.log(`  ${s.personId.padEnd(14)} ${s.level.padEnd(14)} recv=${s.received.toFixed(0)} ${arrow}`);
}
console.log('');

// Δ от вчера
if (delta) {
  console.log('── Изменения за сутки ──');
  console.log(`  Новых актов:    +${delta.dActs}`);
  if (delta.newPersons.length)
    console.log(`  Новые лица:     ${delta.newPersons.join(', ')}`);
  if (delta.newThreads.length) {
    console.log(`  Новые нити (${delta.newThreads.length}):`);
    for (const t of delta.newThreads.slice(0, 5))
      console.log(`    ${t.from} → ${t.to}  (${t.weight.toFixed(1)})`);
  }
  if (delta.grewThreads.length) {
    console.log(`  Выросли (${delta.grewThreads.length}):`);
    for (const t of delta.grewThreads.slice(0, 5))
      console.log(`    ${t.from} → ${t.to}  +${t.delta.toFixed(1)} → ${t.weight.toFixed(1)}`);
  }
  if (delta.theosisGains.length) {
    console.log(`  θέωσις-переходы:`);
    for (const g of delta.theosisGains)
      console.log(`    ${g.personId}: ${g.from} → ${g.to}`);
  }
  console.log('');
} else {
  console.log('── (нет вчерашнего снапшота — это первый запуск) ──\n');
}

// Топ нитей
console.log('── Живые нити (топ 5) ──');
for (const e of top.slice(0, 5))
  console.log(`  ${e.from.padEnd(14)} → ${e.to.padEnd(14)} ${e.weight.toFixed(1)}`);
console.log('');

// ── Сохранение ────────────────────────────────────────────────────────────

if (!NO_SAVE) {
  // Рефлексия-лог
  const reflections = existsSync(REFLECT)
    ? JSON.parse(readFileSync(REFLECT, 'utf8')) : [];

  reflections.push({
    date:       new Date().toISOString().slice(0, 10),
    actsCount:  nowSnap.actsCount,
    persons:    mem.n,
    energy:     parseFloat(energy.toFixed(2)),
    provenance: bySource,
    theosis:    theosisNow.map(s => ({ id: s.personId, level: s.level, recv: parseFloat(s.received.toFixed(1)) })),
    delta:      delta ? {
      dActs:       delta.dActs,
      newPersons:  delta.newPersons,
      newThreads:  delta.newThreads.length,
      grewThreads: delta.grewThreads.length,
      theosisGains: delta.theosisGains,
      summary,
    } : null,
  });

  // Храним историю 90 дней
  const trimmed = reflections.slice(-90);
  writeFileSync(REFLECT, JSON.stringify(trimmed, null, 2));
  console.log(`[рефлексия] Сохранено в data/reflection.json (${trimmed.length} записей)`);

  // Сохраняем текущий как «вчерашний»
  writeFileSync(PREV, JSON.stringify(nowSnap, null, 2));
  console.log('[рефлексия] W-prev.json обновлён для следующего запуска\n');
}

if (summary) console.log(`\n  ✦ ${summary}`);
