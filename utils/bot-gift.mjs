#!/usr/bin/env node
/**
 * bot-gift.mjs — записать дар из бота в матрицу W
 *
 * Использование:
 *   node utils/bot-gift.mjs <giverId> <receiverId> <type> <content> [amount]
 *
 * Вызывается из tg-koinon-bot.mjs после incarnateGift().
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { GiftMemory } from '../src/core/GiftMemory.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_PATH = join(ROOT, 'data', 'sacred-history-W.json');

const [,, giverId, receiverId, type = 'presence', content = 'дар через бота', amountStr] = process.argv;

if (!giverId || !receiverId) {
  console.error('Usage: node utils/bot-gift.mjs <giverId> <receiverId> <type> <content> [amount]');
  process.exit(1);
}

// _koinon и _abyss — специальные получатели, не имеющие stigmergy-индекса в GiftMemory.
// Для W-матрицы записываем дар как данный общине через Дионисия (богослов-хранитель).
// Для анамнезис-сервера — оригинальный receiverId (не меняем).
const matrixReceiver = (receiverId === '_koinon' || receiverId === '_abyss')
  ? 'Дионисий'
  : receiverId;

// Вес: деньги = 3, время = 10, код = 8, присутствие = 5, слово = 2
const TYPE_WEIGHTS = { money: 3, time: 10, code: 8, presence: 5, word: 2, data: 4, knowledge: 6 };
const baseWeight = TYPE_WEIGHTS[type] ?? 4;
const amount = amountStr ? Number(amountStr) : null;
// Если дар измерим (деньги/время) — weight = amount * baseWeight / нормировка
// Используем логарифмическую нормировку чтобы крупные суммы не доминировали
const weight = amount && amount > 0
  ? baseWeight * Math.log1p(amount) / Math.log1p(100)
  : baseWeight;

let mem;
try {
  const snap = JSON.parse(readFileSync(SNAP_PATH, 'utf8'));
  mem = GiftMemory.fromSnapshot(snap);
} catch {
  mem = new GiftMemory(['_koinon', '_abyss', '_claude']);
}

mem.receive({
  giverId,
  receiverId: matrixReceiver,
  weight,
  type,
  content,
  irreversible: true,
});

writeFileSync(SNAP_PATH, JSON.stringify(mem.snapshot(), null, 2));

console.log(`[bot-gift] ${giverId} → ${receiverId} | ${type} | weight=${weight.toFixed(2)} | total acts: ${mem.actsCount}`);
