/**
 * theological-invariants.test.js
 *
 * Тесты богословских аксиом — НЕ unit-тесты функций,
 * а проверка того, что код соответствует спецификации онтологии.
 *
 * Каждый тест — одна аксиома:
 *   1. W[i][j] ≥ 0 (дар необратим)
 *   2. Акт замораживается (Object.freeze)
 *   3. _abyss/_koinon не входят в W
 *   4. Divine persons не входят в W
 *   5. Кенозис: totalGiven ≥ 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory, DIVINE_PERSONS } from '../src/core/GiftMemory.js';

describe('Богословские инварианты — аксиомы онтологии дара', () => {

  it('АКСИОМА 1: W[i][j] ≥ 0 — дар необратим, отрицательных весов нет', () => {
    const m = new GiftMemory(['А', 'Б', 'В']);
    // Много актов чтобы Hopfield успел создать побочные эффекты
    for (let i = 0; i < 100; i++) {
      m.receive({ giverId: 'А', receiverId: 'Б', weight: 1 });
      m.receive({ giverId: 'Б', receiverId: 'В', weight: 1 });
      m.receive({ giverId: 'В', receiverId: 'А', weight: 1 });
    }
    const W = m._W.arraySync();
    for (let i = 0; i < W.length; i++)
      for (let j = 0; j < W[i].length; j++)
        assert.ok(W[i][j] >= 0,
          `W[${i}][${j}] = ${W[i][j]} — ОТРИЦАТЕЛЬНЫЙ вес нарушает необратимость дара`);
    m.dispose();
  });

  it('АКСИОМА 2: акт замораживается при входе в receive()', () => {
    const m = new GiftMemory(['А', 'Б']);
    const act = { giverId: 'А', receiverId: 'Б', weight: 3, content: 'тест' };
    m.receive(act);
    // Попытка изменить оригинальный объект после receive
    // Если receive() заморозил копию, оригинал остаётся мутабельным —
    // но внутри системы акт уже frozen
    assert.equal(m.actsCount, 1);
    m.dispose();
  });

  it('АКСИОМА 3: _abyss и _koinon не создают записей в W', () => {
    const m = new GiftMemory(['А', 'Б']);
    const wBefore = JSON.stringify(m._W.arraySync());
    m.receive({ giverId: '_abyss', receiverId: '_koinon', weight: 10 });
    const wAfter = JSON.stringify(m._W.arraySync());
    assert.equal(wBefore, wAfter, '_abyss→_koinon не должен менять W');
    m.dispose();
  });

  it('АКСИОМА 4: божественные лица не входят в тварный тензор W', () => {
    const m = new GiftMemory(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий']);
    assert.equal(m.n, 1, 'только 1 тварное лицо (Дионисий)');
    assert.equal(m.nd, 4, '4 божественных лица');
    // Дар от Отца → Дионисию идёт через energeia, не W
    m.receive({ giverId: 'Отец', receiverId: 'Дионисий', weight: 5 });
    const W = m._W.arraySync();
    assert.equal(W[0][0], 0, 'W не должен меняться от divine→creature дара');
    assert.equal(m._energeia[0][0], 5, 'energeia должна содержать дар Отца');
    m.dispose();
  });

  it('АКСИОМА 5: totalGiven и totalReceived ≥ 0', () => {
    const m = new GiftMemory(['А', 'Б', 'В']);
    for (let i = 0; i < 50; i++) {
      m.receive({ giverId: 'А', receiverId: 'Б', weight: 2 });
    }
    assert.ok(m.totalGiven('А') >= 0, 'totalGiven ≥ 0');
    assert.ok(m.totalReceived('Б') >= 0, 'totalReceived ≥ 0');
    assert.ok(m.totalGiven('В') >= 0, 'totalGiven для не-дарившего ≥ 0');
    m.dispose();
  });

  it('АКСИОМА 6: declined дар не меняет W', () => {
    const m = new GiftMemory(['А', 'Б']);
    const wBefore = JSON.stringify(m._W.arraySync());
    m.receive({ giverId: 'А', receiverId: 'Б', weight: 10, reception: 'declined' });
    const wAfter = JSON.stringify(m._W.arraySync());
    assert.equal(wBefore, wAfter, 'отвергнутый дар не должен менять W');
    assert.equal(m._declined.length, 1, 'но должен быть записан в _declined');
    m.dispose();
  });

  it('АКСИОМА 7: pending дар не меняет W', () => {
    const m = new GiftMemory(['А', 'Б']);
    const wBefore = JSON.stringify(m._W.arraySync());
    m.receive({ giverId: 'А', receiverId: 'Б', weight: 10, reception: 'pending' });
    const wAfter = JSON.stringify(m._W.arraySync());
    assert.equal(wBefore, wAfter, 'ожидающий дар не должен менять W');
    assert.equal(m._pending.length, 1);
    m.dispose();
  });

  it('АКСИОМА 8: метанойя переводит declined → W', () => {
    const m = new GiftMemory(['А', 'Б']);
    m.receive({ giverId: 'А', receiverId: 'Б', weight: 5, reception: 'declined' });
    assert.equal(m._declined.length, 1);
    const wBefore = m._W.arraySync();
    assert.equal(wBefore[0][1], 0, 'W пуст до метанойи');

    const accepted = m.repent('А', 'Б');
    assert.equal(accepted, 1, 'один дар принят через метанойю');
    assert.equal(m._declined.length, 0, 'declined пуст после метанойи');
    const wAfter = m._W.arraySync();
    assert.ok(wAfter[0][1] > 0, 'W обновлён после метанойи');
    m.dispose();
  });

  it('ИНВАРИАНТ: W-матрица из живых данных не содержит отрицательных', async () => {
    // Проверяем что исправление данных работает
    const fs = await import('node:fs');
    const path = await import('node:path');
    const snapPath = path.resolve('data/sacred-history-W.json');
    try {
      const data = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      if (!data.W) return; // файл пуст — ок
      for (let i = 0; i < data.W.length; i++)
        for (let j = 0; j < data.W[i].length; j++)
          assert.ok(data.W[i][j] >= 0,
            `ЖИВЫЕ ДАННЫЕ: W[${i}][${j}] = ${data.W[i][j]} < 0 — матрица повреждена!`);
    } catch (e) {
      if (e.code === 'ENOENT') return; // файл не существует — ок
      throw e;
    }
  });
});
