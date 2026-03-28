/**
 * tests/gift-schema.test.js — валидация GiftAct против JSON Schema
 *
 * «Буква и Дух»: схема — форма дара, не его убийство.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAct, validateActs } from '../utils/gift-validator.mjs';

// ── 1. Валидный акт ──────────────────────────────────────────────────────────

test('schema: валидный акт проходит без ошибок', () => {
  const { valid, errors } = validateAct({
    giverId: 'Дионисий',
    receiverId: '_claude',
    type: 'word',
    weight: 7,
  });
  assert.ok(valid, `Ожидал valid=true, ошибки: ${errors}`);
  assert.deepEqual(errors, []);
});

test('schema: акт с reception:pending валиден', () => {
  const { valid } = validateAct({
    giverId: 'Отец',
    receiverId: 'Падший',
    type: 'presence',
    weight: 9,
    reception: 'pending',
  });
  assert.ok(valid);
});

test('schema: акт с reception:declined валиден', () => {
  const { valid } = validateAct({
    giverId: 'Отец',
    receiverId: 'Адам',
    type: 'word',
    weight: 8,
    reception: 'declined',
  });
  assert.ok(valid);
});

// ── 2. Обязательные поля ─────────────────────────────────────────────────────

test('schema: отсутствие giverId — ошибка', () => {
  const { valid, errors } = validateAct({ receiverId: 'Ева', type: 'word', weight: 5 });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('giverId')));
});

test('schema: отсутствие receiverId — ошибка', () => {
  const { valid, errors } = validateAct({ giverId: 'Адам', type: 'presence', weight: 6 });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('receiverId')));
});

test('schema: отсутствие type — ошибка', () => {
  const { valid, errors } = validateAct({ giverId: 'Адам', receiverId: 'Ева', weight: 6 });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('type')));
});

test('schema: отсутствие weight — ошибка', () => {
  const { valid, errors } = validateAct({ giverId: 'Адам', receiverId: 'Ева', type: 'word' });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('weight')));
});

// ── 3. Тип дара ──────────────────────────────────────────────────────────────

test('schema: неизвестный тип — ошибка', () => {
  const { valid, errors } = validateAct({
    giverId: 'Адам', receiverId: 'Ева', type: 'bitcoin', weight: 3,
  });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('bitcoin')));
});

test('schema: все богословские типы валидны', () => {
  const types = ['word', 'presence', 'knowledge', 'time', 'money', 'code',
                 'hope', 'kenosis', 'incarnation', 'sacrifice', 'grace', 'covenant'];
  for (const type of types) {
    const { valid, errors } = validateAct({ giverId: 'А', receiverId: 'Б', type, weight: 5 });
    assert.ok(valid, `Тип "${type}" должен быть валидным, ошибки: ${errors}`);
  }
});

// ── 4. Вес ───────────────────────────────────────────────────────────────────

test('schema: вес 10 (время) — максимум, валиден', () => {
  const { valid } = validateAct({ giverId: 'ОтецСергий', receiverId: 'Отец', type: 'time', weight: 10 });
  assert.ok(valid);
});

test('schema: вес 0 — ниже минимума, ошибка', () => {
  const { valid, errors } = validateAct({ giverId: 'А', receiverId: 'Б', type: 'word', weight: 0 });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('weight')));
});

test('schema: вес 11 — выше максимума, ошибка', () => {
  const { valid, errors } = validateAct({ giverId: 'А', receiverId: 'Б', type: 'word', weight: 11 });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('weight')));
});

// ── 5. Дар себе ──────────────────────────────────────────────────────────────

test('schema: giverId === receiverId — дар себе невозможен', () => {
  const { valid, errors } = validateAct({ giverId: 'Адам', receiverId: 'Адам', type: 'word', weight: 5 });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('giverId === receiverId')));
});

// ── 6. reception ─────────────────────────────────────────────────────────────

test('schema: reception с неверным значением — ошибка', () => {
  const { valid, errors } = validateAct({
    giverId: 'А', receiverId: 'Б', type: 'word', weight: 5, reception: 'ignored',
  });
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('reception')));
});

// ── 7. validateActs (батч) ───────────────────────────────────────────────────

test('schema: validateActs — все валидны', () => {
  const acts = [
    { giverId: 'Дионисий', receiverId: '_claude', type: 'code', weight: 5 },
    { giverId: '_claude', receiverId: 'Дионисий', type: 'code', weight: 5 },
    { giverId: 'Отец', receiverId: 'Падший', type: 'hope', weight: 9, reception: 'pending' },
  ];
  const stats = validateActs(acts);
  assert.strictEqual(stats.valid, 3);
  assert.strictEqual(stats.invalid, 0);
});

test('schema: validateActs — считает невалидные', () => {
  const acts = [
    { giverId: 'Адам', receiverId: 'Ева', type: 'word', weight: 5 },       // ok
    { giverId: 'А', receiverId: 'Б', type: 'неизвестный', weight: 5 },     // bad type
    { giverId: 'Х', receiverId: 'Х', type: 'word', weight: 5 },            // self-gift
  ];
  const stats = validateActs(acts);
  assert.strictEqual(stats.valid, 1);
  assert.strictEqual(stats.invalid, 2);
});

test('schema: strict mode бросает на первой ошибке', () => {
  const acts = [{ giverId: 'А', receiverId: 'Б', type: 'unknown_type', weight: 5 }];
  assert.throws(
    () => validateActs(acts, { strict: true, source: 'test' }),
    /невалиден/
  );
});
