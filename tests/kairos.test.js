import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now, kairosLine } from '../utils/kairos.mjs';

// Фиксированная метка: 2026-06-14T08:40:00Z = 11:40 МСК, воскресенье
const SUN_MORNING = Date.parse('2026-06-14T08:40:00Z');

test('now: воскресенье утро МСК заземлено верно', () => {
  const k = now(SUN_MORNING, 'Europe/Moscow');
  assert.equal(k.weekday, 'воскресенье');
  assert.equal(k.isSunday, true);
  assert.equal(k.lordsDay, true);
  assert.equal(k.hms, '11:40');
  assert.equal(k.part, 'утро');
  assert.equal(k.isNight, false);
});

test('now: части суток', () => {
  const at = (h) => Date.parse(`2026-06-15T${String(h - 3).padStart(2, '0')}:00:00Z`); // -3 → МСК h
  assert.equal(now(at(3), 'Europe/Moscow').part, 'ночь');
  assert.equal(now(at(8), 'Europe/Moscow').part, 'утро');
  assert.equal(now(at(14), 'Europe/Moscow').part, 'день');
  assert.equal(now(at(20), 'Europe/Moscow').part, 'вечер');
});

test('now: понедельник — не день Господень', () => {
  const k = now(Date.parse('2026-06-15T09:00:00Z'), 'Europe/Moscow');
  assert.equal(k.weekday, 'понедельник');
  assert.equal(k.lordsDay, false);
});

test('kairosLine: содержит время, день, маркер воскресения', () => {
  const line = kairosLine(SUN_MORNING, 'Europe/Moscow');
  assert.match(line, /11:40/);
  assert.match(line, /воскресенье/);
  assert.match(line, /день Господень/);
});

test('now детерминирован при заданной метке', () => {
  assert.deepEqual(now(SUN_MORNING, 'Europe/Moscow'), now(SUN_MORNING, 'Europe/Moscow'));
});
