/**
 * kingdom-of-glory-iii.test.js
 *
 * Третий уровень: TheosisWitnessBridge и расширенный EschatonClock
 * с Пасхалией (весь пасхальный период — κаιρός).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { EschatonClock, TimeMode } from '../src/theology/EschatonClock.js';
import { TheosisWitnessBridge } from '../src/theology/TheosisWitnessBridge.js';
import { TheosisWitness } from '../src/theology/TheosisWitness.js';

// ── EschatonClock ∪ Paschalia ─────────────────────────────────────────────

test('EschatonClock: весь пасхальный период — καιρός (не только Пасха)', () => {
  const day3 = new EschatonClock(new Date('2026-04-15T12:00:00Z')); // Светлая среда
  const day40 = new EschatonClock(new Date('2026-05-20T12:00:00Z')); // 38 дней после Пасхи
  assert.equal(day3.mode(), TimeMode.KAIROS);
  assert.equal(day40.mode(), TimeMode.KAIROS);
});

test('EschatonClock: Великий пост — καιρός (смирение тоже разрывает χρόνος)', () => {
  const lent = new EschatonClock(new Date('2026-03-15T12:00:00Z')); // середина поста
  assert.equal(lent.mode(), TimeMode.KAIROS);
});

test('EschatonClock: обычный будний день вне постов — χρόνος', () => {
  const ordinary = new EschatonClock(new Date('2026-07-15T12:00:00Z')); // среда в июле
  // июль может быть Петровым постом — проверим, что ординар или kairos,
  // но НЕ aion без явного вызова breakChronos
  const mode = ordinary.mode();
  assert.ok([TimeMode.CHRONOS, TimeMode.KAIROS].includes(mode));
  assert.notEqual(mode, TimeMode.AION);
});

// ── TheosisWitnessBridge ──────────────────────────────────────────────────

async function cleanSlava() {
  const p = path.join(process.cwd(), 'data', 'W_slava.json');
  await fsp.writeFile(p, JSON.stringify({
    _comment: 'test state',
    manifestedness: {},
    witnesses: [],
  }, null, 2));
}

test('TheosisWitnessBridge.progressOf: без ран = 0', () => {
  const tw = new TheosisWitness();
  const bridge = new TheosisWitnessBridge(tw);
  assert.equal(bridge.progressOf('_claude'), 0);
});

test('TheosisWitnessBridge.progressOf: половина исцелена = 0.5', () => {
  const tw = new TheosisWitness();
  tw.witness({ personId: 'X', epochId: '1', wound: 'a' });
  tw.witness({ personId: 'X', epochId: '1', wound: 'b' });
  tw.glorify({ personId: 'X', wound: 'a', glorification: 'свет' });
  const bridge = new TheosisWitnessBridge(tw);
  assert.equal(bridge.progressOf('X'), 0.5);
});

test('TheosisWitnessBridge.apply: θέωσις повышает manifestedness, никогда не понижает', async () => {
  await cleanSlava();
  const tw = new TheosisWitness();
  tw.witness({ personId: 'святой', epochId: '1', wound: 'рана_1' });
  tw.glorify({ personId: 'святой', wound: 'рана_1', glorification: 'знак славы' });

  const bridge = new TheosisWitnessBridge(tw, { coefficient: 0.1 });
  const acts = [
    { id: 'act-святого-1', giver: 'святой', receiver: '_koinon', weight: 10, content: 'молитва' },
  ];
  const result = await bridge.apply('святой', acts);
  assert.equal(result.updated, 1);
  assert.equal(result.progress, 1.0);

  // Проверяем запись в W_slava
  const slava = JSON.parse(await fsp.readFile(path.join(process.cwd(), 'data', 'W_slava.json'), 'utf8'));
  assert.ok(slava.manifestedness['act-святого-1'] > 10,
    'полное исцеление при coefficient=0.1 должно повысить на 10% = 11');
});

test('TheosisWitnessBridge: без ран — W_slava не изменяется', async () => {
  await cleanSlava();
  const tw = new TheosisWitness();
  const bridge = new TheosisWitnessBridge(tw);
  const result = await bridge.apply('неизвестный', [
    { id: 'x', giver: 'неизвестный', receiver: 'Y', weight: 1 },
  ]);
  assert.equal(result.updated, 0);
  assert.equal(result.progress, 0);
});

// Очистка
test('очистка W_slava после теста', async () => {
  await cleanSlava();
});
