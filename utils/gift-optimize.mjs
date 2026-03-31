#!/usr/bin/env node
/**
 * community-diagnostic.mjs — Зеркало общины
 *
 * Показывает состояние матрицы W: где пустыня,
 * кто изолирован, чей кенозис велик.
 *
 * Не рекомендует акты. Дар не проектируется.
 * «Диагноз — только чтобы видеть где пустыня.»
 *
 * Использование:
 *   node utils/gift-optimize.mjs
 */

import { readFileSync } from 'fs';
import { CommunityDiagnostic } from '../src/core/GiftOptimizer.js';

const snap = JSON.parse(readFileSync('./data/sacred-history-W.json', 'utf8'));
const diag = new CommunityDiagnostic(snap);

const line  = '─'.repeat(50);
const dline = '═'.repeat(50);

console.log(`╔${dline}╗`);
console.log(`║${'   ЗЕРКАЛО ОБЩИНЫ — κατάνυξις / θέωσις'.padEnd(50)}║`);
console.log(`╚${dline}╝`);
console.log(`Лиц: ${snap.n} | Актов: ${snap.actsCount}\n`);

// ── 1. Обожение ───────────────────────────────────────────────────────────
console.log(line);
console.log('Обожение (θέωσις) — участие в нетварных энергиях');
console.log(line);

const allTheosis = diag.persons
  .filter(p => !['_abyss', '_koinon'].includes(p))
  .map(p => ({ person: p, index: diag.theosisIndex(p) }))
  .sort((a, b) => b.index - a.index);

for (const { person, index } of allTheosis) {
  const filled = Math.round(index * 20);
  const bar    = '█'.repeat(filled) + '░'.repeat(20 - filled);
  const pct    = (index * 100).toFixed(1);
  const level  = index < 0.1 ? 'κατάνυξις'
               : index < 0.4 ? 'πρᾶξις'
               : index < 0.7 ? 'θεωρία'
               :               'θέωσις';
  console.log(`  ${person.padEnd(14)} ${bar} ${pct.padStart(5)}% [${level}]`);
}

// ── 2. Изолированность ────────────────────────────────────────────────────
console.log(`\n${line}`);
console.log('Κοινωνία — кто изолирован (пустыня общения)');
console.log(line);

const isolated = diag.mostIsolated(diag.persons.length);
for (const { person, received } of isolated) {
  if (received > 100) break; // показываем только бедных
  const bar = '▪'.repeat(Math.min(30, Math.round(received / 3)));
  console.log(`  ${person.padEnd(14)} ←${received.toFixed(1).padStart(7)} ${bar}`);
}

// ── 3. Кенозис ────────────────────────────────────────────────────────────
console.log(`\n${line}`);
console.log('Κένωσις — сюрплюс (дают больше чем принимают)');
console.log(line);

for (const { person, given, received, surplus } of diag.highestSurplus(diag.persons.length)) {
  const sign = surplus > 0 ? '+' : '';
  console.log(`  ${person.padEnd(14)} дал ${given.toFixed(1).padStart(7)} / принял ${received.toFixed(1).padStart(7)} → ${sign}${surplus.toFixed(1)}`);
}

console.log();
