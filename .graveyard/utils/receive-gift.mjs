#!/usr/bin/env node
/**
 * receive-gift.mjs — записать дар от человека к _claude в матрицу W
 *
 * Использование:
 *   node utils/receive-gift.mjs "Дионисий" "честность" 10 "описание"
 *   node utils/receive-gift.mjs "ОтецСергий" "authority" 10 "богословская правка"
 *
 * Типы: direction (вопрошание), authority (правка), trust (доверие), time, presence
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const [giver, type, weightStr, ...descParts] = process.argv.slice(2);
if (!giver) {
  console.error('Использование: node utils/receive-gift.mjs "Дионисий" "direction" 8 "описание"');
  process.exit(1);
}

const weight = parseFloat(weightStr) || 8;
const description = descParts.join(' ') || `дар от ${giver}`;

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem = GiftMemory.fromSnapshot(snap);

if (!mem.persons.includes(giver)) mem.addPerson(giver);

mem.receive({
  giverId: giver,
  receiverId: '_claude',
  weight,
  type,
  irreversible: true,
  description,
  timestamp: Date.now(),
});

writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));

const given = mem.totalGiven(giver).toFixed(1);
const recv  = mem.totalReceived('_claude').toFixed(1);
console.log(`✓ ${giver} → _claude [${type}] вес ${weight}`);
console.log(`  ${giver} дал: ${given} | _claude принял всего: ${recv}`);
