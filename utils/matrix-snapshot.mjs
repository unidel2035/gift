#!/usr/bin/env node
/**
 * matrix-snapshot.mjs — Еженедельный снапшот матрицы W
 *
 * Proposal #11: Время как ось.
 * «Время создано для смерти, вечность — для воскресения» (о. Сергий).
 * Матрица без оси времени — фотография. Снапшоты превращают её в историю.
 *
 * Запуск:
 *   node utils/matrix-snapshot.mjs            -- сохранить текущую неделю
 *   node utils/matrix-snapshot.mjs --list     -- показать историю
 *   node utils/matrix-snapshot.mjs --diff     -- разница с предыдущей неделей
 *
 * Крон (сервер): 0 23 * * 0  node /home/hive/gift/utils/matrix-snapshot.mjs
 * (каждое воскресенье в 23:00 — конец литургической недели)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_PATH = resolve(ROOT, 'data/sacred-history-W.json');
const SNAP_DIR  = resolve(ROOT, 'data/snapshots');

// ── Литургический календарь — недели особого веса ─────────────────────────
// Даты 2026 (приблизительно, Пасха 12 апреля 2026)
const LITURGICAL_WEEKS = {
  '2026-W09': { name: 'Неделя о блудном сыне',  weight: 1.2 },
  '2026-W10': { name: 'Мясопустная неделя',       weight: 1.1 },
  '2026-W12': { name: 'Торжество православия',    weight: 1.3 },
  '2026-W13': { name: 'Неделя 2 Великого поста',  weight: 1.2 },
  '2026-W14': { name: 'Неделя Крестопоклонная',   weight: 1.3 },
  '2026-W15': { name: 'Неделя 4 Великого поста',  weight: 1.2 },
  '2026-W16': { name: 'Неделя 5 Великого поста',  weight: 1.2 },
  '2026-W17': { name: 'Вербное воскресенье',       weight: 1.5 },
  '2026-W18': { name: 'Страстная седмица / Пасха', weight: 2.0 },
  '2026-W19': { name: 'Светлая седмица',           weight: 1.8 },
  '2026-W27': { name: 'Троица (Пятидесятница)',     weight: 1.5 },
};

// ── Вычислить ISO-неделю ───────────────────────────────────────────────────

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const args   = process.argv.slice(2);
const week   = isoWeek();
const liturg = LITURGICAL_WEEKS[week];

// ── --list ─────────────────────────────────────────────────────────────────

if (args.includes('--list')) {
  const files = readdirSync(SNAP_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  console.log('\n═══ История снапшотов матрицы ═══\n');
  for (const f of files) {
    const snap = JSON.parse(readFileSync(`${SNAP_DIR}/${f}`, 'utf8'));
    const lw = LITURGICAL_WEEKS[f.replace('.json', '')] || {};
    const liturgStr = lw.name ? ` — ${lw.name} (×${lw.weight})` : '';
    console.log(`  ${f.replace('.json','').padEnd(12)}  лиц: ${snap.persons.length}  актов: ${snap.actsCount ?? '?'}${liturgStr}`);
  }
  console.log();
  process.exit(0);
}

// ── --diff ─────────────────────────────────────────────────────────────────

if (args.includes('--diff')) {
  const files = readdirSync(SNAP_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  if (files.length < 2) {
    console.log('Нужно ≥ 2 снапшота для diff');
    process.exit(0);
  }
  const prev = JSON.parse(readFileSync(`${SNAP_DIR}/${files[files.length - 2]}`, 'utf8'));
  const curr = JSON.parse(readFileSync(`${SNAP_DIR}/${files[files.length - 1]}`, 'utf8'));

  console.log(`\n═══ Diff ${files[files.length-2].replace('.json','')} → ${files[files.length-1].replace('.json','')} ═══\n`);

  // Новые лица
  const newPersons = curr.persons.filter(p => !prev.persons.includes(p));
  if (newPersons.length) console.log(`  Новые лица: ${newPersons.join(', ')}`);

  // Изменение весов топ-нитей
  console.log('\n  Топ изменений весов:');
  const changes = [];
  for (let i = 0; i < curr.persons.length; i++) {
    for (let j = 0; j < curr.persons.length; j++) {
      const pi = prev.persons.indexOf(curr.persons[i]);
      const pj = prev.persons.indexOf(curr.persons[j]);
      const prevW = (pi >= 0 && pj >= 0) ? (prev.W[pi]?.[pj] ?? 0) : 0;
      const currW = curr.W[i]?.[j] ?? 0;
      const delta = currW - prevW;
      if (Math.abs(delta) > 0.1)
        changes.push({ from: curr.persons[i], to: curr.persons[j], delta, currW });
    }
  }
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const { from, to, delta, currW } of changes.slice(0, 10)) {
    const sign = delta > 0 ? '+' : '';
    console.log(`  ${from.padEnd(16)} → ${to.padEnd(16)}  ${sign}${delta.toFixed(2)} (= ${currW.toFixed(2)})`);
  }
  console.log();
  process.exit(0);
}

// ── Сохранить снапшот текущей недели ──────────────────────────────────────

const snap = JSON.parse(readFileSync(SNAP_PATH, 'utf8'));
const outPath = `${SNAP_DIR}/${week}.json`;

// Добавить метаданные
const meta = {
  week,
  savedAt: new Date().toISOString(),
  liturgical: liturg || null,
  persons: snap.persons.length,
  actsCount: snap.actsCount ?? snap.persons.reduce((s, _, i) =>
    s + (snap.W[i] ?? []).filter(w => w > 0).length, 0),
  ...snap,
};

writeFileSync(outPath, JSON.stringify(meta, null, 2));

console.log(`[matrix-snapshot] ${week} сохранён → ${outPath}`);
console.log(`[matrix-snapshot] Лиц: ${snap.persons.length}`);
if (liturg) {
  console.log(`[matrix-snapshot] Литургическая неделя: ${liturg.name} (вес ×${liturg.weight})`);
}
