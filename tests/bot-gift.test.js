/**
 * tests/bot-gift.test.js
 *
 * Тестирует: bot-gift.mjs записывает дар в матрицу W
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_PATH = join(ROOT, 'data', 'sacred-history-W.json');
const BOT_GIFT = join(ROOT, 'utils', 'bot-gift.mjs');

// Снапшот до тестов — восстановим после
let snapBefore;
try { snapBefore = readFileSync(SNAP_PATH, 'utf8'); } catch { snapBefore = null; }

function runBotGift(args) {
  return spawnSync(process.execPath, [BOT_GIFT, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    cwd: ROOT,
  });
}

function loadMatrix() {
  const snap = JSON.parse(readFileSync(SNAP_PATH, 'utf8'));
  return GiftMemory.fromSnapshot(snap);
}

// ── Тесты ────────────────────────────────────────────────────────────────────

test('bot-gift: дар через бота к общине (_koinon) записывается через Дионисия', async () => {
  const result = runBotGift(['tg:999', '_koinon', 'presence', 'тест-дар']);
  assert.equal(result.status, 0, `exit code != 0: ${result.stderr}`);

  const mem = loadMatrix();
  const snap = mem.snapshot();
  const gi = snap.persons.indexOf('tg:999');
  // _koinon → матрица записывает через Дионисия как хранителя общины
  const ri = snap.persons.indexOf('Дионисий');
  assert.ok(gi >= 0, 'giver должен появиться в матрице');
  assert.ok(ri >= 0, 'Дионисий должен быть в матрице');
  assert.ok(snap.W[gi][ri] > 0, 'W[tg:999][Дионисий] должно быть > 0 (дар через общину)');
});

test('bot-gift: дар времени к общине — weight > presence', async () => {
  runBotGift(['tg:998', '_koinon', 'time', 'час волонтёрства', '1']);

  const mem = loadMatrix();
  const snap = mem.snapshot();
  const gi = snap.persons.indexOf('tg:998');
  const ri = snap.persons.indexOf('Дионисий');
  assert.ok(gi >= 0, 'giver tg:998 в матрице');
  assert.ok(snap.W[gi][ri] > 0, 'W[tg:998][Дионисий] > 0 после дара времени');
});

test('bot-gift: увеличивает actsCount', async () => {
  const countBefore = loadMatrix().actsCount;
  runBotGift(['tg:997', '_koinon', 'money', 'донат', '500']);
  const countAfter = loadMatrix().actsCount;
  assert.ok(countAfter > countBefore, 'actsCount должен вырасти');
});

test('bot-gift: крупная сумма логарифмически нормируется (не > baseWeight)', async () => {
  // 100 единиц времени — weight = 10 * log(101)/log(101) = 10 (baseWeight)
  runBotGift(['tg:996', '_koinon', 'time', 'марафон', '100']);
  const mem = loadMatrix();
  const snap = mem.snapshot();
  const gi = snap.persons.indexOf('tg:996');
  const ri = snap.persons.indexOf('Дионисий');
  assert.ok(gi >= 0, 'tg:996 в матрице');
  assert.ok(snap.W[gi][ri] > 0, 'W[tg:996][Дионисий] > 0');
  // Логарифмическая нормировка: для amount=100 weight = baseWeight = 10
  assert.ok(snap.W[gi][ri] <= 12, 'Вес не превышает 12 даже для крупного дара');
});

test('bot-gift: без аргументов — exit code 1', async () => {
  const result = runBotGift([]);
  assert.equal(result.status, 1, 'должен вернуть exit code 1 без аргументов');
});

// Восстанавливаем снапшот
if (snapBefore) {
  writeFileSync(SNAP_PATH, snapBefore);
}
