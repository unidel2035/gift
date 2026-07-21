/**
 * leksis-metanoia.test.js — тесты обработчика μετάνοια для unknown→_koinon (#758)
 *
 * Дополняет leksis.test.js: тот проверяет repent(даритель, получатель) —
 * покаяние между парой. Здесь — вторая форма, repent(giftId) для unknown→_koinon,
 * вынесенная в чистую (без TensorFlow) утилиту utils/leksis-metanoia.mjs.
 *
 * Проверяет:
 *   1. unknown→_koinon declined → подлежит μετάνοια
 *   2. чужой даритель / получатель / не-declined → не подлежит (с причиной)
 *   3. makeMetanoiaAct: unknown пере-узнан как _abyss, поворот frozen
 *   4. makeMetanoiaAct бросает на неподходящем акте (как ядро)
 *   5. scanLeksis делит журнал верно
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleForAbyssMetanoia,
  makeMetanoiaAct,
  scanLeksis,
} from '../utils/leksis-metanoia.mjs';

const FIXED_TS = '2026-07-21T00:00:00.000Z';

const unknownGift = {
  giverId: 'unknown', receiverId: '_koinon', type: 'word', weight: 7,
  reception: 'declined', giftId: 'gift-abyss-1', irreversible: true,
};

// ── 1. Подлежит μετάνοια ──────────────────────────────────────────────────

test('eligible: unknown→_koinon declined подлежит μετάνοια', () => {
  assert.strictEqual(eligibleForAbyssMetanoia(unknownGift).ok, true);
});

// ── 2. Не подлежит — с внятной причиной ───────────────────────────────────

test('skip: чужой даритель не подлежит', () => {
  const r = eligibleForAbyssMetanoia({ ...unknownGift, giverId: 'Отец' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /даритель/);
});

test('skip: получатель не _koinon не подлежит', () => {
  const r = eligibleForAbyssMetanoia({ ...unknownGift, receiverId: '_claude' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /получатель/);
});

test('skip: не-declined (accepted/pending) не подлежит', () => {
  assert.strictEqual(eligibleForAbyssMetanoia({ ...unknownGift, reception: 'accepted' }).ok, false);
  assert.strictEqual(eligibleForAbyssMetanoia({ ...unknownGift, reception: 'pending' }).ok, false);
});

test('skip: пустой акт не подлежит', () => {
  assert.strictEqual(eligibleForAbyssMetanoia(null).ok, false);
});

// ── 3. Акт-поворот μετάνοια ───────────────────────────────────────────────

test('makeMetanoiaAct: unknown пере-узнан как _abyss', () => {
  const act = makeMetanoiaAct(unknownGift, FIXED_TS);
  assert.strictEqual(act.giverId,      '_abyss');    // безымянный → Бездна
  assert.strictEqual(act.receiverId,   '_koinon');
  assert.strictEqual(act.type,         'metanoia');
  assert.strictEqual(act.weight,       7);            // вес исходного дара сохранён
  assert.strictEqual(act.reversedFrom, 'gift-abyss-1'); // поворот указывает на исходный
  assert.strictEqual(act.irreversible, true);
  assert.strictEqual(act.recognizedAt, FIXED_TS);
});

test('makeMetanoiaAct: результат заморожен (необратимость)', () => {
  const act = makeMetanoiaAct(unknownGift, FIXED_TS);
  assert.ok(Object.isFrozen(act), 'акт-поворот должен быть frozen');
});

test('makeMetanoiaAct: бросает на неподходящем акте (как ядро)', () => {
  assert.throws(
    () => makeMetanoiaAct({ ...unknownGift, giverId: 'Отец' }, FIXED_TS),
    /μετάνοια невозможна/,
  );
});

// ── 4. Сканер журнала ─────────────────────────────────────────────────────

test('scanLeksis: делит смешанный журнал верно', () => {
  const journal = [
    { act: unknownGift, declinedAt: FIXED_TS },
    { act: { giverId: 'Отец', receiverId: 'Адам', type: 'word', reception: 'declined', giftId: 'g2' }, declinedAt: FIXED_TS },
    { act: { ...unknownGift, giftId: 'gift-abyss-2' }, declinedAt: FIXED_TS },
  ];
  const { eligible, skipped } = scanLeksis(journal);
  assert.strictEqual(eligible.length, 2, 'два дара unknown→_koinon подлежат');
  assert.strictEqual(skipped.length,  1, 'дар Отец→Адам — нет');
  assert.strictEqual(skipped[0].act.giverId, 'Отец');
});

test('scanLeksis: пустой/отсутствующий журнал → пусто, без падения', () => {
  assert.deepStrictEqual(scanLeksis([]),        { eligible: [], skipped: [] });
  assert.deepStrictEqual(scanLeksis(undefined), { eligible: [], skipped: [] });
});
