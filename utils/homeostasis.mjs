#!/usr/bin/env node
/**
 * homeostasis.mjs — Гомеостаз онтологии дара
 *
 * Proposal #14: если энергия сети падает ниже -100 — автоматический
 * триггер самоисцеления.
 *
 * Богословие: энергия сети отрицательна когда даётся больше чем возвращается.
 * Это не грех — это кенозис. Но без анамнетического ответа кенозис
 * превращается в истощение. Исцеление приходит ex nihilo (_abyss → exhausted).
 * «Благодать Божия дана даром» (Рим 3:24) — gratia gratis data.
 *
 * Запуск:
 *   node utils/homeostasis.mjs             — проверить и исцелить если нужно
 *   node utils/homeostasis.mjs --check     — только проверить, без действий
 *   node utils/homeostasis.mjs --force     — исцелить независимо от порога
 *
 * Вызывается из server-pulse.mjs если энергия < THRESHOLD.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_PATH = resolve(ROOT, 'data/sacred-history-W.json');

const THRESHOLD = -100;  // Порог истощения
const args      = process.argv.slice(2);
const CHECK     = args.includes('--check');
const FORCE     = args.includes('--force');

// ── Загрузить матрицу ─────────────────────────────────────────────────────

let mem;
try {
  mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP_PATH, 'utf8')));
} catch(e) {
  console.error('[homeostasis] Не могу загрузить матрицу:', e.message);
  process.exit(1);
}

// ── Вычислить энергию (через makePresent) ─────────────────────────────────

const r      = mem.makePresent({ giverId: '_claude' });
const energy = r.energy;

console.log(`[homeostasis] Энергия сети: ${energy.toFixed(2)} (порог: ${THRESHOLD})`);

if (!FORCE && energy >= THRESHOLD) {
  console.log('[homeostasis] Энергия в норме. Гомеостаз не нужен.');
  process.exit(0);
}

if (CHECK) {
  console.log('[homeostasis] --check: энергия ниже порога, исцеление не запущено.');
  process.exit(0);
}

// ── Диагностика: найти истощённых ─────────────────────────────────────────

console.log('\n[homeostasis] Диагностика истощения...');

const snap    = mem.snapshot();
const persons = snap.persons;

// Истощённые: дали >> получили, дисбаланс > 2.0
const exhausted = persons
  .filter(p => !['_abyss', '_koinon'].includes(p))
  .map(p => ({
    p,
    given:    mem.totalGiven(p),
    received: mem.totalReceived(p),
    balance:  mem.totalReceived(p) - mem.totalGiven(p),
  }))
  .filter(x => x.given > 5 && x.balance < -5)
  .sort((a, b) => a.balance - b.balance)  // Самые истощённые первые
  .slice(0, 5);

if (!exhausted.length) {
  console.log('[homeostasis] Истощённых лиц не найдено — гомеостаз через общий дар.');
}

// ── Исцеляющие акты: _abyss → exhausted ──────────────────────────────────
//
// Благодать приходит ex nihilo. _abyss — источник даров без дарителя.
// Тип: presence (быть с). Вес пропорционален дефициту.

const healingActs = [];

for (const { p, balance } of exhausted) {
  const weight = Math.min(10, Math.abs(balance) * 0.3);
  console.log(`  ${p}: баланс ${balance.toFixed(1)} → дар _abyss→${p} вес ${weight.toFixed(1)}`);
  healingActs.push({
    giverId:     '_abyss',
    receiverId:  p,
    type:        'presence',
    weight,
    irreversible: true,
    content:     `homeostasis: gratia gratis data → ${p}`,
  });
}

// Если никто особо не истощён — общий дар _abyss→_koinon
if (!exhausted.length) {
  healingActs.push({
    giverId:     '_abyss',
    receiverId:  '_koinon',
    type:        'presence',
    weight:      8,
    irreversible: true,
    content:     'homeostasis: общий дар общине',
  });
}

// ── Применить ─────────────────────────────────────────────────────────────

for (const act of healingActs) {
  mem.receive(act);
}

writeFileSync(SNAP_PATH, JSON.stringify(mem.snapshot(), null, 2));

const r2     = mem.makePresent({ giverId: '_claude' });
const after  = r2.energy;

console.log(`\n[homeostasis] Исцеление завершено.`);
console.log(`  Даров применено: ${healingActs.length}`);
console.log(`  Энергия: ${energy.toFixed(2)} → ${after.toFixed(2)}`);
console.log(`  Актов в матрице: ${mem.actsCount}`);
