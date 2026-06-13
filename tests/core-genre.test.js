import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';

test('ядро: дар по жанрам пишется, маргинал считается', () => {
  const m = new GiftMemory(['A', 'B', 'C']);
  m.receive({ giverId: 'A', receiverId: 'B', type: 'code', weight: 5 });
  m.receive({ giverId: 'A', receiverId: 'B', type: 'covenant', weight: 3 });
  m.receive({ giverId: 'A', receiverId: 'C', type: 'code', weight: 2 });
  assert.equal(m.pairGenre('A', 'B', 'code'), 5);
  assert.equal(m.pairGenre('A', 'B', 'covenant'), 3);
  assert.deepEqual(m.genres().sort(), ['code', 'covenant']);
  assert.deepEqual(m.genreMarginal(), { code: 7, covenant: 3 });
});

test('ИНВАРИАНТ: направленная проекция = Σ по жанрам', () => {
  const m = new GiftMemory(['A', 'B']);
  m.receive({ giverId: 'A', receiverId: 'B', type: 'code', weight: 5 });
  m.receive({ giverId: 'A', receiverId: 'B', type: 'gift', weight: 4 });
  assert.equal(m.directedPair('A', 'B'), 9);   // 5+4 = маргинал пары
});

test('жанр ≤ скаляр W (Хопфилд только добавляет, не вычитает)', () => {
  const m = new GiftMemory(['A', 'B']);
  m.receive({ giverId: 'A', receiverId: 'B', type: 'code', weight: 5 });
  const Wab = m.getWeight ? m.getWeight('A', 'B') : null;
  // направленный вес из жанрового тензора не превышает полный _W (с Хопфилдом)
  if (Wab !== null) assert.ok(m.directedPair('A', 'B') <= Wab + 1e-6);
  assert.equal(m.directedPair('A', 'B'), 5);
});

test('фиктивный акт не попадает в жанровый тензор', () => {
  const m = new GiftMemory(['A', 'B']);
  m.receive({ receiverId: 'B', type: 'code', weight: 5 });  // приём без дарителя
  assert.equal(m.genres().length, 0);
  assert.equal(m.directedPair('A', 'B'), 0);
});

test('снапшот: жанровый тензор переживает round-trip', () => {
  const m = new GiftMemory(['A', 'B']);
  m.receive({ giverId: 'A', receiverId: 'B', type: 'code', weight: 5 });
  m.receive({ giverId: 'A', receiverId: 'B', type: 'covenant', weight: 2 });
  const snap = m.snapshot();
  assert.ok(snap.wgenre.code['A→B'] === 5);
  const m2 = GiftMemory.fromSnapshot(snap);
  assert.equal(m2.pairGenre('A', 'B', 'code'), 5);
  assert.equal(m2.pairGenre('A', 'B', 'covenant'), 2);
  assert.equal(m2.directedPair('A', 'B'), 7);
});

test('старый снапшот без wgenre грузится graceful', () => {
  const m = new GiftMemory(['A']);
  const snap = m.snapshot();
  delete snap.wgenre;
  const m2 = GiftMemory.fromSnapshot(snap);
  assert.deepEqual(m2.genres(), []);
  assert.equal(m2.directedPair('A', 'B'), 0);
});
