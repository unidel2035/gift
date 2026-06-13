import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';

test('conserves: настоящий перенос ок, фикция ловится', () => {
  assert.equal(GiftMemory.conserves({ giverId: 'A', receiverId: 'B' }).ok, true);
  assert.equal(GiftMemory.conserves({ receiverId: 'B' }).ok, false);        // приём без дарителя
  assert.match(GiftMemory.conserves({ receiverId: 'B' }).reason, /claim без акта/);
  assert.equal(GiftMemory.conserves({ giverId: 'A' }).ok, false);           // дар без получателя
  assert.equal(GiftMemory.conserves({}).ok, false);                         // пустой
});

test('receive: фиктивный акт отвергается, W не меняется', () => {
  const m = new GiftMemory(['A', 'B']);
  const beforeGiven = m.totalGiven('B');
  m.receive({ receiverId: 'B', weight: 5 });   // приём без дарителя — фикция
  assert.equal(m.rejectedActs().length, 1);
  assert.match(m.rejectedActs()[0].reason, /claim без акта/);
  assert.equal(m.totalReceived('B'), beforeGiven); // W нетронут (0)
});

test('receive: настоящий перенос проходит в W', () => {
  const m = new GiftMemory(['A', 'B']);
  m.receive({ giverId: 'A', receiverId: 'B', weight: 5 });
  assert.equal(m.rejectedActs().length, 0);
  assert.ok(m.totalReceived('B') > 0);          // дошло до W
  assert.ok(m.totalGiven('A') > 0);
});

test('snapshot: _rejected переживает round-trip', () => {
  const m = new GiftMemory(['A', 'B']);
  m.receive({ receiverId: 'B' });               // фикция
  const snap = m.snapshot();
  assert.equal(snap.rejected.length, 1);
  const m2 = GiftMemory.fromSnapshot(snap);
  assert.equal(m2.rejectedActs().length, 1);
  assert.match(m2.rejectedActs()[0].reason, /claim без акта/);
});

test('старый снапшот без rejected грузится без ошибки', () => {
  const m = new GiftMemory(['A']);
  const snap = m.snapshot();
  delete snap.rejected;                          // эмуляция старого формата
  const m2 = GiftMemory.fromSnapshot(snap);
  assert.deepEqual(m2.rejectedActs(), []);       // graceful
});
