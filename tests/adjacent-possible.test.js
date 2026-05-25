import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';

describe('Adjacent Possible — surplus как вычислимая метрика (Кауффман)', () => {
  it('пустая матрица — нет adjacent possible', () => {
    const m = new GiftMemory(['Алиса', 'Борис', 'Вера']);
    const ap = m.adjacentPossible();
    assert.equal(ap.length, 0);
  });

  it('одна нить — нет AP (нет посредника)', () => {
    const m = new GiftMemory(['Алиса', 'Борис', 'Вера']);
    m.receive({ giverId: 'Алиса', receiverId: 'Борис', weight: 3 });
    const ap = m.adjacentPossible();
    assert.equal(ap.length, 0);
  });

  it('две нити через посредника — появляется AP', () => {
    const m = new GiftMemory(['Алиса', 'Борис', 'Вера']);
    m.receive({ giverId: 'Алиса', receiverId: 'Борис', weight: 3 });
    m.receive({ giverId: 'Борис', receiverId: 'Вера', weight: 2 });

    const ap = m.adjacentPossible();
    assert.ok(ap.length > 0, 'должна быть хотя бы одна AP-нить');

    // Алиса→Вера через Бориса
    const aliceToVera = ap.find(a => a.from === 'Алиса' && a.to === 'Вера');
    assert.ok(aliceToVera, 'Алиса→Вера должна быть в AP');
    assert.equal(aliceToVera.via, 'Борис');
    assert.ok(aliceToVera.potential > 0, 'потенциал должен быть положительным');
  });

  it('реализованная нить выходит из AP', () => {
    const m = new GiftMemory(['Алиса', 'Борис', 'Вера']);
    m.receive({ giverId: 'Алиса', receiverId: 'Борис', weight: 3 });
    m.receive({ giverId: 'Борис', receiverId: 'Вера', weight: 2 });

    const apBefore = m.adjacentPossible();
    assert.ok(apBefore.some(a => a.from === 'Алиса' && a.to === 'Вера'));

    // Реализуем потенциальную нить
    m.receive({ giverId: 'Алиса', receiverId: 'Вера', weight: 1 });

    const apAfter = m.adjacentPossible();
    assert.ok(!apAfter.some(a => a.from === 'Алиса' && a.to === 'Вера'),
      'Реализованная нить не должна быть в AP');
  });

  it('measureSurplus считает прирост AP', () => {
    const m = new GiftMemory(['Алиса', 'Борис', 'Вера', 'Глеб']);

    // Создаём начальную структуру: Алиса→Борис
    m.receive({ giverId: 'Алиса', receiverId: 'Борис', weight: 3 });

    // Измеряем surplus добавления Борис→Вера
    // До: AP = 0 (одна нить, нет цепочек)
    // После: AP > 0 (Алиса→Вера через Бориса)
    const result = m.measureSurplus({
      giverId: 'Борис', receiverId: 'Вера', weight: 2,
    });

    assert.equal(result.before, 0);
    assert.ok(result.after > 0, 'после акта AP должен вырасти');
    assert.ok(result.surplus > 0, 'surplus должен быть положительным');
    assert.ok(result.newPossible.length > 0, 'должны быть новые возможные нити');
  });

  it('adjacentPossibleSize() возвращает число', () => {
    const m = new GiftMemory(['А', 'Б', 'В']);
    m.receive({ giverId: 'А', receiverId: 'Б', weight: 1 });
    m.receive({ giverId: 'Б', receiverId: 'В', weight: 1 });
    assert.ok(typeof m.adjacentPossibleSize() === 'number');
    assert.ok(m.adjacentPossibleSize() > 0);
  });

  it('surplus при полной связности — 0 (нет новых возможных)', () => {
    const m = new GiftMemory(['А', 'Б', 'В']);
    // Полный граф: все дарят всем
    m.receive({ giverId: 'А', receiverId: 'Б', weight: 1 });
    m.receive({ giverId: 'А', receiverId: 'В', weight: 1 });
    m.receive({ giverId: 'Б', receiverId: 'А', weight: 1 });
    m.receive({ giverId: 'Б', receiverId: 'В', weight: 1 });
    m.receive({ giverId: 'В', receiverId: 'А', weight: 1 });
    m.receive({ giverId: 'В', receiverId: 'Б', weight: 1 });

    assert.equal(m.adjacentPossibleSize(), 0, 'полный граф — нет AP');
  });
});
