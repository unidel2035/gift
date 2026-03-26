#!/usr/bin/env node
/**
 * snapshot-keeper.mjs
 *
 * Время как ось: еженедельные снапшоты матрицы W (proposal #11).
 *
 * Каждое воскресенье в 00:00 сохраняет снапшот:
 *   data/snapshots/W-YYYY-WW.json
 *
 * Также умеет: compare (сравнить две недели), list (список снапшотов).
 *
 * Запуск:
 *   node utils/snapshot-keeper.mjs          — создать снапшот текущей недели
 *   node utils/snapshot-keeper.mjs list     — показать историю
 *   node utils/snapshot-keeper.mjs compare  — сравнить последние два снапшота
 *   node utils/snapshot-keeper.mjs diff 2026-12 2026-13  — конкретные недели
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const SNAP_PATH  = join(ROOT, 'data', 'sacred-history-W.json');
const SNAPS_DIR  = join(ROOT, 'data', 'snapshots');

// ── Утилиты ────────────────────────────────────────────────────────────────

function isoWeek(date = new Date()) {
  // ISO 8601 week number
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function snapFileName(weekStr) {
  return join(SNAPS_DIR, `W-${weekStr}.json`);
}

function loadMem(path) {
  const snap = JSON.parse(readFileSync(path, 'utf8'));
  return GiftMemory.fromSnapshot(snap);
}

// ── Создать снапшот ────────────────────────────────────────────────────────

function takeSnapshot(week = isoWeek()) {
  mkdirSync(SNAPS_DIR, { recursive: true });

  if (!existsSync(SNAP_PATH)) {
    console.error('ОШИБКА: sacred-history-W.json не найден');
    process.exit(1);
  }

  const src = readFileSync(SNAP_PATH, 'utf8');
  const dest = snapFileName(week);

  // Добавить метаданные к снапшоту
  const snap = JSON.parse(src);
  snap._snapshotMeta = {
    week,
    savedAt: new Date().toISOString(),
    tool:    'snapshot-keeper.mjs',
  };

  if (existsSync(dest)) {
    console.log(`Снапшот ${week} уже существует — перезаписываем.`);
  }

  writeFileSync(dest, JSON.stringify(snap, null, 2));

  const mem = GiftMemory.fromSnapshot(snap);
  console.log(`\nСнапшот ${week} сохранён:`);
  console.log(`  Лиц: ${mem.n}  |  Актов: ${mem.actsCount}`);
  console.log(`  Файл: ${dest}`);

  const top = mem.heaviest(3);
  console.log(`  Топ нитей: ${top.map(e => `${e.from}→${e.to}(${e.weight.toFixed(1)})`).join(', ')}`);

  return { week, dest, n: mem.n, acts: mem.actsCount };
}

// ── Список снапшотов ────────────────────────────────────────────────────────

function listSnapshots() {
  if (!existsSync(SNAPS_DIR)) {
    console.log('Снапшотов пока нет.');
    return;
  }

  const files = readdirSync(SNAPS_DIR)
    .filter(f => f.startsWith('W-') && f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.log('Снапшотов пока нет.');
    return;
  }

  console.log('\nИстория матрицы W:\n');
  console.log('  Неделя       Лиц   Актов   Энергия');
  console.log('  ─────────────────────────────────────');

  for (const f of files) {
    const week = f.replace('W-', '').replace('.json', '');
    try {
      const mem = loadMem(join(SNAPS_DIR, f));
      const r = mem.makePresent({ giverId: '_claude' });
      const bar = '█'.repeat(Math.min(20, Math.round(Math.abs(r.energy) / 20)));
      console.log(`  ${week}    ${String(mem.n).padStart(3)}   ${String(mem.actsCount).padStart(5)}   ${r.energy.toFixed(1).padStart(8)}  ${bar}`);
    } catch {
      console.log(`  ${week}    ERR`);
    }
  }
}

// ── Сравнить два снапшота ────────────────────────────────────────────────────

function compareSnapshots(weekA, weekB) {
  const pathA = snapFileName(weekA);
  const pathB = snapFileName(weekB);

  if (!existsSync(pathA)) { console.error(`Нет снапшота ${weekA}`); process.exit(1); }
  if (!existsSync(pathB)) { console.error(`Нет снапшота ${weekB}`); process.exit(1); }

  const memA = loadMem(pathA);
  const memB = loadMem(pathB);

  console.log(`\nСравнение матриц W:\n`);
  console.log(`  ${weekA} → ${weekB}\n`);

  // Лица
  const dN = memB.n - memA.n;
  console.log(`  Лиц:   ${memA.n} → ${memB.n}  (${dN >= 0 ? '+' : ''}${dN})`);

  // Акты
  const dA = memB.actsCount - memA.actsCount;
  console.log(`  Актов: ${memA.actsCount} → ${memB.actsCount}  (${dA >= 0 ? '+' : ''}${dA})`);

  // Нити
  const topA = memA.heaviest(5);
  const topB = memB.heaviest(5);

  console.log(`\n  Топ нитей (${weekB}):`);
  for (const e of topB) {
    const prev = topA.find(x => x.from === e.from && x.to === e.to);
    const d = prev ? (e.weight - prev.weight) : e.weight;
    const mark = d > 0 ? ` ↑${d.toFixed(1)}` : (d < 0 ? ` ↓${Math.abs(d).toFixed(1)}` : ' —');
    console.log(`    ${e.from} → ${e.to}  ${e.weight.toFixed(1)}${mark}`);
  }

  // Новые нити (которых не было раньше)
  const keysA = new Set(topA.map(e => `${e.from}→${e.to}`));
  const newThreads = topB.filter(e => !keysA.has(`${e.from}→${e.to}`));
  if (newThreads.length > 0) {
    console.log(`\n  Новые нити этой недели:`);
    for (const e of newThreads) {
      console.log(`    + ${e.from} → ${e.to}  ${e.weight.toFixed(1)}`);
    }
  }

  // Богословская рефлексия
  console.log(`\n  Рефлексия:`);
  if (dA > 50) {
    console.log(`  — Неделя богатая: ${dA} новых актов. Κοινόν растёт.`);
  } else if (dA > 0) {
    console.log(`  — ${dA} новых актов. Тихая неделя.`);
  } else {
    console.log(`  — Матрица не изменилась. Суббота длиннее обычного.`);
  }

  if (dN > 0) {
    console.log(`  — В общину вошли ${dN} новых лиц.`);
  }
}

// ── Точка входа ────────────────────────────────────────────────────────────

const cmd = process.argv[2];

if (!cmd || cmd === 'save') {
  const week = process.argv[3] ?? isoWeek();
  takeSnapshot(week);

} else if (cmd === 'list') {
  listSnapshots();

} else if (cmd === 'compare') {
  // Последние два снапшота
  if (!existsSync(SNAPS_DIR)) { console.log('Снапшотов нет.'); process.exit(0); }
  const files = readdirSync(SNAPS_DIR)
    .filter(f => f.startsWith('W-') && f.endsWith('.json'))
    .sort();
  if (files.length < 2) { console.log('Нужно хотя бы 2 снапшота для сравнения.'); process.exit(0); }
  const weekA = files.at(-2).replace('W-', '').replace('.json', '');
  const weekB = files.at(-1).replace('W-', '').replace('.json', '');
  compareSnapshots(weekA, weekB);

} else if (cmd === 'diff') {
  const weekA = process.argv[3];
  const weekB = process.argv[4];
  if (!weekA || !weekB) { console.error('Укажи: node snapshot-keeper.mjs diff 2026-W12 2026-W13'); process.exit(1); }
  compareSnapshots(weekA, weekB);

} else {
  console.error(`Неизвестная команда: ${cmd}`);
  console.error('Команды: save [week], list, compare, diff <weekA> <weekB>');
  process.exit(1);
}
