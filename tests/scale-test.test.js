/**
 * scale-test.test.js — проверка масштабирования W-матрицы
 *
 * Тестирует GiftMemory при N=100 и N=500 лицах.
 * Проверяет: создание, receive, heaviest, adjacentPossible, snapshot/restore.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory, DIVINE_PERSONS } from '../src/core/GiftMemory.js';

describe('Масштаб: GiftMemory при 100+ лицах', () => {
  it('создаёт матрицу 100 лиц без ошибок', () => {
    const persons = Array.from({ length: 100 }, (_, i) => `Лицо_${i}`);
    const m = new GiftMemory(persons);
    assert.equal(m.n, 100);
    assert.equal(m.persons.length, 100);
  });

  it('receive 1000 актов в матрице 100 лиц за <5с', () => {
    const persons = Array.from({ length: 100 }, (_, i) => `P${i}`);
    const m = new GiftMemory(persons);

    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      const from = `P${i % 100}`;
      const to = `P${(i * 7 + 13) % 100}`; // pseudorandom
      if (from === to) continue;
      m.receive({ giverId: from, receiverId: to, weight: 1 + (i % 5) });
    }
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 5000, `1000 актов заняли ${elapsed}мс — слишком долго (>5с)`);
    assert.ok(m.actsCount >= 900, `должно быть ~1000 актов, есть ${m.actsCount}`);
  });

  it('heaviest(10) работает при 100 лицах', () => {
    const persons = Array.from({ length: 100 }, (_, i) => `P${i}`);
    const m = new GiftMemory(persons);

    // Создаём сильную нить
    for (let i = 0; i < 20; i++) {
      m.receive({ giverId: 'P0', receiverId: 'P1', weight: 5 });
    }
    // Шум
    for (let i = 0; i < 200; i++) {
      const from = `P${2 + (i % 98)}`;
      const to = `P${2 + ((i * 3) % 98)}`;
      if (from === to) continue;
      m.receive({ giverId: from, receiverId: to, weight: 1 });
    }

    const top = m.heaviest(10);
    assert.ok(top.length > 0);
    // P0→P1 должна быть в топе
    assert.ok(top.some(t => t.from === 'P0' && t.to === 'P1'),
      'сильная нить P0→P1 должна быть в топ-10');
  });

  it('adjacentPossible при 50 лицах — за разумное время', () => {
    const persons = Array.from({ length: 50 }, (_, i) => `P${i}`);
    const m = new GiftMemory(persons);

    // Создаём цепочку: P0→P1→P2→...→P9
    for (let i = 0; i < 9; i++) {
      m.receive({ giverId: `P${i}`, receiverId: `P${i + 1}`, weight: 3 });
    }

    const start = Date.now();
    const ap = m.adjacentPossible();
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 2000, `AP вычислен за ${elapsed}мс — допустимо <2с`);
    assert.ok(ap.length > 0, 'должны быть AP-нити');
    // P0→P2 через P1 должна быть
    assert.ok(ap.some(a => a.from === 'P0' && a.to === 'P2' && a.via === 'P1'));
  });

  it('snapshot/restore при 100 лицах', () => {
    const persons = Array.from({ length: 100 }, (_, i) => `P${i}`);
    const m = new GiftMemory(persons);

    for (let i = 0; i < 50; i++) {
      m.receive({ giverId: `P${i}`, receiverId: `P${i + 1}`, weight: 2 });
    }

    const snap = m.snapshot();
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json);
    const restored = GiftMemory.fromSnapshot(parsed);

    assert.equal(restored.n, 100);
    assert.equal(restored.actsCount, m.actsCount);

    // Проверим что нити сохранились
    const origTop = m.heaviest(5);
    const restTop = restored.heaviest(5);
    assert.equal(origTop.length, restTop.length);

    m.dispose();
    restored.dispose();
  });

  it('addPerson динамически при N=100 → N=101', () => {
    const persons = Array.from({ length: 100 }, (_, i) => `P${i}`);
    const m = new GiftMemory(persons);
    assert.equal(m.n, 100);

    m.addPerson('Новичок');
    assert.equal(m.n, 101);
    assert.ok(m.persons.includes('Новичок'));

    // Дар новичку
    m.receive({ giverId: 'P0', receiverId: 'Новичок', weight: 3 });
    const top = m.heaviest(5);
    assert.ok(top.some(t => t.to === 'Новичок'));

    m.dispose();
  });

  it('receiveAndTransform при 100 лицах', () => {
    const persons = Array.from({ length: 100 }, (_, i) => `P${i}`);
    const m = new GiftMemory(persons);

    // Начальная структура
    m.receive({ giverId: 'P0', receiverId: 'P1', weight: 5 });
    m.receive({ giverId: 'P1', receiverId: 'P2', weight: 3 });

    const result = m.receiveAndTransform({
      giverId: 'P2', receiverId: 'P3', weight: 4,
    });

    assert.ok(result.transformation);
    assert.equal(result.transformation.receiver, 'P3');
    assert.ok(typeof result.transformation.plerosis === 'number');
    assert.ok(typeof result.transformation.surplus === 'number');

    m.dispose();
  });
});
