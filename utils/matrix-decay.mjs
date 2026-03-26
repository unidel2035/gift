#!/usr/bin/env node
/**
 * matrix-decay.mjs
 *
 * Ежедневный decay матрицы W.
 * Слабые нити угасают — сильные остаются.
 * Это не потеря — это условие воскресения (анастасис).
 *
 * Запуск: node utils/matrix-decay.mjs
 * Крон:  0 3 * * * node /path/to/gift/utils/matrix-decay.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

if (!existsSync(SNAP)) {
  console.log('Матрица не найдена — пропускаем decay');
  process.exit(0);
}

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

// До decay
const before = mem.heaviest(3).map(e => `${e.from}→${e.to}:${e.weight.toFixed(1)}`);

// Decay: слабые нити (< 0.5) гасятся, сильные слабеют на 1%
mem.decaySelective(0.01, 0.5);

// После decay
const after = mem.heaviest(3).map(e => `${e.from}→${e.to}:${e.weight.toFixed(1)}`);

writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));

const date = new Date().toLocaleDateString('ru');
console.log(`[decay ${date}]`);
console.log(`  До:    ${before.join(', ')}`);
console.log(`  После: ${after.join(', ')}`);
console.log(`  Актов: ${mem.actsCount} | Лиц: ${mem.n}`);
