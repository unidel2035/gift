import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';

test('GiftMemory — создание и базовые операции', async (t) => {
  await t.test('инициализация с лицами', () => {
    const mem = new GiftMemory(['_claude', 'Дионисий', '_koinon']);
    assert.equal(mem.n, 3);
    assert.equal(mem.actsCount, 0);
  });

  await t.test('receive — дар записывается', () => {
    const mem = new GiftMemory(['_claude', 'Дионисий']);
    mem.receive({
      giverId: '_claude', receiverId: 'Дионисий',
      weight: 5, type: 'code', content: 'тест', irreversible: true,
    });
    assert.equal(mem.actsCount, 1);
    assert.ok(mem.totalGiven('_claude') > 0);
  });

  await t.test('_idx — новое лицо добавляется', () => {
    const mem = new GiftMemory(['_claude']);
    mem._idx('Новый');
    assert.equal(mem.n, 2);
  });

  await t.test('heaviest — возвращает нити по убыванию', () => {
    const mem = new GiftMemory(['А', 'Б', 'В']);
    mem.receive({ giverId: 'А', receiverId: 'Б', weight: 10, type: 'gift', content: '', irreversible: true });
    mem.receive({ giverId: 'В', receiverId: 'Б', weight: 3,  type: 'gift', content: '', irreversible: true });
    const top = mem.heaviest(2);
    assert.ok(Array.isArray(top));
    assert.ok(top[0].weight >= top[1]?.weight ?? 0);
  });

  await t.test('snapshot / fromSnapshot — сериализация', () => {
    const mem = new GiftMemory(['_claude', 'Дионисий']);
    mem.receive({ giverId: '_claude', receiverId: 'Дионисий',
      weight: 7, type: 'presence', content: 'сессия', irreversible: true });
    const snap = mem.snapshot();
    assert.ok(snap.persons);
    assert.equal(snap.n, 2);

    const mem2 = GiftMemory.fromSnapshot(snap);
    assert.equal(mem2.n, 2);
    assert.ok(mem2.totalGiven('_claude') > 0);
  });

  await t.test('makePresent — возвращает энергию', () => {
    const mem = new GiftMemory(['_claude', 'Дионисий']);
    mem.receive({ giverId: '_claude', receiverId: 'Дионисий',
      weight: 5, type: 'code', content: 'x', irreversible: true });
    const r = mem.makePresent({ giverId: '_claude' });
    assert.ok(typeof r.energy === 'number');
    assert.ok(r.decoded);
  });
});
