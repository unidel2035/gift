import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftEngine } from '../src/core/GiftEngine.js';

test('engine.theosis(person, gifts[]) — траектория θέωσις', async (t) => {

  await t.test('возвращает { stage, delta, vector }', () => {
    const result = GiftEngine._computeTheosisTrajectory('personA', [
      { id: 'gift-1', glorification: 'рана вошла в свет' },
      { id: 'gift-2', glorification: 'рана прославлена' },
      { id: 'gift-3' }, // открытая рана
    ]);
    assert.ok('stage' in result, 'должно быть поле stage');
    assert.ok('delta' in result, 'должно быть поле delta');
    assert.ok('vector' in result, 'должно быть поле vector');
  });

  await t.test('stage=hyper_physin когда все дары прославлены (100%)', () => {
    const result = GiftEngine._computeTheosisTrajectory('personB', [
      { id: 'g1', glorification: 'прославлен' },
      { id: 'g2', glorification: 'прославлен' },
      { id: 'g3', glorification: 'прославлен' },
    ]);
    assert.equal(result.stage, 'hyper_physin');
    assert.equal(result.delta, 3);
    assert.equal(result.vector, 'ascending');
  });

  await t.test('stage=para_physin когда нет прославленных даров', () => {
    const result = GiftEngine._computeTheosisTrajectory('personC', [
      { id: 'g1' },
      { id: 'g2' },
    ]);
    assert.equal(result.stage, 'para_physin');
    assert.equal(result.delta, -2);
    assert.equal(result.vector, 'descending');
  });

  await t.test('vector=stable когда равное число открытых и исцелённых', () => {
    const result = GiftEngine._computeTheosisTrajectory('personD', [
      { id: 'g1', glorification: 'прославлен' },
      { id: 'g2' },
    ]);
    assert.equal(result.delta, 0);
    assert.equal(result.vector, 'stable');
  });

  await t.test('vector=unknown когда даров нет', () => {
    const result = GiftEngine._computeTheosisTrajectory('personE', []);
    assert.equal(result.vector, 'unknown');
  });

  await t.test('engine.theosis(personId) — старая сигнатура сохранена', () => {
    const engine = new GiftEngine();
    // Без воскресения theosis невозможна — метод должен вернуть объект с possible:false
    const result = engine.theosis('non-existent-person');
    // Возвращает null или { possible: false } — в любом случае не ломается
    assert.ok(result === null || typeof result === 'object');
  });

});
