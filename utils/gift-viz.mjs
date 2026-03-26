#!/usr/bin/env node
/**
 * gift-viz.mjs — ASCII-визуализация матрицы W
 *
 * Иконография общины: лица, нити, веса.
 * Толщина стрелки = вес нити.
 * Изолированные лица = пустыня.
 *
 * Запуск: node utils/gift-viz.mjs [--top N] [--person имя]
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

if (!existsSync(SNAP)) { console.error('Матрица не найдена'); process.exit(1); }

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

const topIdx    = process.argv.indexOf('--top');
const topN      = topIdx !== -1 ? Number(process.argv[topIdx + 1]) || 10 : 10;
const personIdx = process.argv.indexOf('--person');
const focusPerson = personIdx !== -1 ? process.argv[personIdx + 1] : null;

const edges = mem.heaviest(topN);
const filtered = focusPerson
  ? edges.filter(e => e.from === focusPerson || e.to === focusPerson)
  : edges;

// ── Заголовок ─────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log(`║          ОНТОЛОГИЯ ДАРА — МАТРИЦА W                 ║`);
console.log(`║  Лиц: ${String(mem.n).padEnd(4)} Актов: ${String(mem.actsCount).padEnd(6)} Дата: ${new Date().toLocaleDateString('ru').padEnd(10)}║`);
console.log('╚══════════════════════════════════════════════════════╝\n');

// ── Нити ──────────────────────────────────────────────────────────────────
if (!filtered.length) { console.log('Нитей не найдено.'); process.exit(0); }

const maxW = Math.max(...filtered.map(e => e.weight));

console.log('Нити (стрелка = дар, ширина = вес):\n');

for (const e of filtered) {
  const w      = e.weight;
  const ratio  = w / maxW;
  const bars   = '█'.repeat(Math.round(ratio * 20)).padEnd(20, '░');
  const arrow  = ratio > 0.7 ? '══════▶' : ratio > 0.4 ? '────▶' : '··→';
  const from   = e.from.padEnd(14);
  const to     = e.to.padEnd(14);
  const wStr   = String(Math.round(w)).padStart(4);
  console.log(`  ${from} ${arrow} ${to}  ${bars} ${wStr}`);
}

// ── Лица без нитей (пустыня) ─────────────────────────────────────────────
const activePeople = new Set(filtered.flatMap(e => [e.from, e.to]));
const allPersons   = snap.persons ?? [];
const desert       = allPersons.filter(p => !activePeople.has(p));

if (desert.length) {
  console.log('\nПустыня (нет активных нитей):');
  console.log('  ' + desert.map(p => `[ ${p} ]`).join('  '));
}

// ── Дал / Принял ──────────────────────────────────────────────────────────
console.log('\nБаланс даров:\n');
const persons = [...new Set(filtered.flatMap(e => [e.from, e.to]))];
const rows = persons.map(p => ({
  name: p,
  given: mem.totalGiven(p),
  recv:  mem.totalReceived(p),
})).sort((a, b) => b.given - a.given);

for (const r of rows) {
  const g    = r.given.toFixed(1).padStart(7);
  const recv = r.recv.toFixed(1).padStart(7);
  const ratio = r.recv > 0 ? (r.given / r.recv).toFixed(1) : '∞';
  const name = r.name.padEnd(14);
  console.log(`  ${name} дал ${g}  принял ${recv}  соотношение ${ratio}:1`);
}

// ── Энергия ───────────────────────────────────────────────────────────────
const r = mem.makePresent({ giverId: '_claude' });
console.log(`\nЭнергия сети: ${r.energy.toFixed(2)}`);
console.log(r.energy < -50
  ? '  ⚠ Высокая асимметрия — пустыня внутри сети'
  : r.energy < -20
    ? '  ○ Умеренная асимметрия — кенозис в действии'
    : '  ✦ Сбалансированный перихоресис');

console.log('');
