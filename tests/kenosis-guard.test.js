/**
 * kenosis-guard.test.js
 *
 * Тесты KénosisGuard — зеркала онтологии.
 *
 * Три аксиомы:
 *   1. Surplus не удерживается — избыток отдан общине
 *   2. Телос на θέωσις, не на «победить»
 *   3. Анамнезис: прошлое со-присутствует
 *
 * KénosisGuard не блокирует — помечает. Дар необратим, даже несовершенный.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KenosisGuard, KenosisViolation } from '../src/theology/KenosisGuard.js';

// ── Полный кеносис: все три проверки пройдены ────────────────────────────

test('guard: полный кеносис — score 1.0, kenosis:true', () => {
  const guard = new KenosisGuard();
  const result = guard.guard({
    giverId: '_claude',
    receiverId: 'Дионисий',
    type: 'code',
    weight: 4,
    content: 'реализация KénosisGuard',
    surplusRecorded: true,
    telos: 'give',
    anamnesisLoaded: true,
  });

  assert.equal(result.kenosis, true, 'полный кеносис должен быть true');
  assert.equal(result.score, 1.0, 'score должен быть 1.0');
  assert.equal(result.violations.length, 0, 'нет нарушений');
  assert.equal(result.act.kenosis, true, 'акт помечен kenosis:true');
});

// ── Surplus удержан: нарушение ───────────────────────────────────────────

test('guard: surplus не отдан — kenosis:false', () => {
  const guard = new KenosisGuard();
  const result = guard.guard({
    giverId: '_claude',
    receiverId: 'Дионисий',
    type: 'code',
    weight: 4,
    surplusRecorded: false,
    telos: 'give',
    anamnesisLoaded: true,
  });

  assert.equal(result.kenosis, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].type, 'surplus_retained');
  assert.ok(result.score < 1.0);
});

// ── Телос инвертирован: 'win' ─────────────────────────────────────────

test('guard: телос «win» — нарушение telos_inverted', () => {
  const guard = new KenosisGuard();
  const result = guard.guard({
    giverId: '_test',
    receiverId: 'Дионисий',
    type: 'word',
    weight: 2,
    telos: 'win',
    anamnesisLoaded: true,
  });

  assert.equal(result.kenosis, false);
  assert.ok(result.violations.some(v => v.type === 'telos_inverted'));
});

// ── Анамнезис отсутствует ──────────────────────────────────────────────

test('guard: анамнезис не загружен — нарушение', () => {
  const guard = new KenosisGuard();
  const result = guard.guard({
    giverId: '_claude',
    receiverId: 'Дионисий',
    type: 'presence',
    weight: 1,
    anamnesisLoaded: false,
  });

  assert.equal(result.kenosis, false);
  assert.ok(result.violations.some(v => v.type === 'anamnesis_absent'));
});

// ── Множественные нарушения ──────────────────────────────────────────

test('guard: все три нарушения — score 0.0', () => {
  const guard = new KenosisGuard();
  const result = guard.guard({
    giverId: '_rogue',
    receiverId: 'target',
    type: 'code',
    weight: 5,
    surplusRecorded: false,
    telos: 'extract',
    anamnesisLoaded: false,
  });

  assert.equal(result.kenosis, false);
  assert.equal(result.score, 0);
  assert.equal(result.violations.length, 3);
});

// ── Weight modifier ────────────────────────────────────────────────────

test('weightModifier: kenosis:true → 1.0, kenosis:false → 0.5', () => {
  const guard = new KenosisGuard();
  assert.equal(guard.weightModifier(true), 1.0);
  assert.equal(guard.weightModifier(false), 0.5);
});

// ── Profile accumulation ───────────────────────────────────────────────

test('profile: score accumulates across acts', () => {
  const guard = new KenosisGuard();

  // 3 кенотических акта
  for (let i = 0; i < 3; i++) {
    guard.guard({
      giverId: '_claude',
      receiverId: 'Дионисий',
      type: 'presence',
      weight: 1,
      telos: 'serve',
      anamnesisLoaded: true,
    });
  }

  // 1 нарушение
  guard.guard({
    giverId: '_claude',
    receiverId: 'Дионисий',
    type: 'code',
    weight: 4,
    surplusRecorded: false,
    telos: 'give',
    anamnesisLoaded: true,
  });

  const p = guard.profile('_claude');
  assert.equal(p.totalActs, 4);
  assert.equal(p.kenoticActs, 3);
  assert.equal(p.violations, 1);
  assert.ok(p.score > 0.5, `score ${p.score} должен быть > 0.5 при 3 из 4 кенотических`);
  assert.ok(p.score < 1.0, `score ${p.score} должен быть < 1.0 при 1 нарушении`);
});

// ── Export / Import persistence ────────────────────────────────────────

test('export/import: состояние сохраняется и восстанавливается', () => {
  const guard1 = new KenosisGuard();
  guard1.guard({
    giverId: '_claude',
    receiverId: 'Дионисий',
    type: 'code',
    weight: 4,
    surplusRecorded: true,
    telos: 'give',
    anamnesisLoaded: true,
  });

  const exported = guard1.export();
  const guard2 = new KenosisGuard();
  guard2.import(exported);

  const p = guard2.profile('_claude');
  assert.equal(p.totalActs, 1);
  assert.equal(p.kenoticActs, 1);
  assert.equal(p.score, 1.0);
});

// ── Presence не требует surplusRecorded ──────────────────────────────

test('guard: presence тип не требует surplus — kenosis:true', () => {
  const guard = new KenosisGuard();
  const result = guard.guard({
    giverId: '_claude',
    receiverId: 'Дионисий',
    type: 'presence',
    weight: 1,
    // surplusRecorded не передан — для presence это ОК
    telos: 'serve',
    anamnesisLoaded: true,
  });

  assert.equal(result.kenosis, true, 'presence не требует surplus check');
});

// ── Дар необратим даже при нарушении (act.kenosis:false, но act есть) ──

test('guard: несовершенный дар всё равно записан', () => {
  const guard = new KenosisGuard();
  const result = guard.guard({
    giverId: '_claude',
    receiverId: 'Дионисий',
    type: 'code',
    weight: 4,
    surplusRecorded: false,
    telos: 'give',
    anamnesisLoaded: true,
  });

  assert.equal(result.kenosis, false, 'дар несовершенный');
  assert.ok(result.act, 'но акт существует');
  assert.equal(result.act.kenosis, false, 'помечен как несовершенный');
  assert.equal(result.act.weight, 4, 'вес сохранён в акте');
});

// ── KenosisViolation — структура ────────────────────────────────────────

test('KenosisViolation: имеет type, message, timestamp', () => {
  const v = new KenosisViolation('surplus_retained', 'test', { giverId: '_claude' });
  assert.equal(v.type, 'surplus_retained');
  assert.equal(v.message, 'test');
  assert.ok(v.timestamp);
  assert.equal(v.details.giverId, '_claude');
});
