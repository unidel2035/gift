import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GenreTensorW, composeGenre, genreOneHot, genreKron } from '../utils/genre-tensor-w.mjs';

test('add + срезы по жанрам', () => {
  const t = new GenreTensorW();
  t.add('A', 'B', 'code', 5);
  t.add('A', 'B', 'covenant', 3);
  t.add('A', 'C', 'code', 2);
  assert.equal(t.pairGenre('A', 'B', 'code'), 5);
  assert.equal(t.pairGenre('A', 'B', 'covenant'), 3);
  assert.deepEqual(t.genres().sort(), ['code', 'covenant']);
});

test('flat W = Σ по жанрам (проекция = старый скаляр)', () => {
  const t = new GenreTensorW();
  t.add('A', 'B', 'code', 5);
  t.add('A', 'B', 'covenant', 3);
  assert.equal(t.flatPair('A', 'B'), 8);          // 5+3 — маргинал
});

test('genreMarginal суммирует по жанру', () => {
  const t = new GenreTensorW();
  t.add('A', 'B', 'code', 5); t.add('A', 'C', 'code', 2); t.add('A', 'B', 'gift', 4);
  assert.deepEqual(t.genreMarginal(), { code: 7, gift: 4 });
});

test('flatMatrix — проекция жанрового тензора в NC×NC', () => {
  const t = new GenreTensorW();
  t.add('A', 'B', 'code', 5); t.add('A', 'B', 'gift', 3); t.add('B', 'A', 'code', 1);
  const W = t.flatMatrix(['A', 'B']);
  assert.equal(W[0][1], 8);   // A→B = 5+3
  assert.equal(W[1][0], 1);   // B→A
  assert.equal(W[0][0], 0);
});

test('помехоустойчивость: фиктивный акт не входит', () => {
  const t = new GenreTensorW();
  assert.equal(t.add(null, 'B', 'code', 5), false);   // приём без дарителя
  assert.equal(t.add('A', '', 'code', 5), false);     // дар без получателя
  assert.equal(t.rejected, 2);
  assert.equal(t.flatPair('A', 'B'), 0);
});

test('fromActs строит тензор из лога', () => {
  const acts = [
    { from: 'A', to: 'B', type: 'code', weight: 4 },
    { from: 'A', to: 'B', type: 'reception', weight: 1 },
    { from: 'X', to: null, type: 'code', weight: 9 },   // фикция
  ];
  const t = GenreTensorW.fromActs(acts);
  assert.equal(t.flatPair('A', 'B'), 5);
  assert.equal(t.rejected, 1);
});

test('Кронекер жанров: composeGenre + genreKron one-hot', () => {
  assert.equal(composeGenre('завет', 'дар'), 'завет·дар');
  const alpha = ['code', 'gift', 'covenant'];
  assert.deepEqual(genreOneHot('gift', alpha), [0, 1, 0]);
  // gift ⊗ covenant: one-hot 3×3=9, единица на позиции gift*3+covenant = 1*3+2 = 5
  const k = genreKron('gift', 'covenant', alpha);
  assert.equal(k.length, 9);
  assert.equal(k[5], 1);
  assert.equal(k.reduce((a, b) => a + b, 0), 1);   // ровно одна единица — чистый составной жанр
});
