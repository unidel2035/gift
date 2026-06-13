import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kron, kronPow, kronVec, actVector, isConserved, chainConserved, genrePowerLabels } from '../utils/genotensor.mjs';

test('kron: каноническое произведение', () => {
  // [[1,2],[3,4]] ⊗ [[0,5],[6,7]]
  const A = [[1, 2], [3, 4]], B = [[0, 5], [6, 7]];
  const K = kron(A, B);
  assert.deepEqual(K, [
    [0, 5, 0, 10],
    [6, 7, 12, 14],
    [0, 15, 0, 20],
    [18, 21, 24, 28],
  ]);
  assert.equal(K.length, 4); assert.equal(K[0].length, 4);
});

test('kronPow: размер растёт как 2^n', () => {
  const P = [[1, 1], [1, 1]];
  assert.equal(kronPow(P, 3).length, 8);   // 2^3
});

test('actVector: даритель −1, получатель +1, свидетель 0', () => {
  assert.deepEqual(actVector({ giverId: 'A', receiverId: 'C' }, ['A', 'B', 'C']), [-1, 0, 1]);
});

test('isConserved: настоящий перенос сохранён, фикция ловится', () => {
  assert.equal(isConserved([-1, 0, 1]).conserved, true);            // A→C перенос
  assert.equal(isConserved([0, 1, 0]).conserved, false);            // приём без дарителя
  assert.match(isConserved([0, 1, 0]).reason, /claim без акта|приём без/);
  assert.equal(isConserved([-1, 0, 0]).conserved, false);           // дар без получателя
  assert.match(isConserved([-1, 0, 0]).reason, /пустоту|без получателя/);
  assert.equal(isConserved([0, 0, 0]).conserved, false);            // пустой акт
});

test('chainConserved: Σ(a⊗b)=Σa·Σb → цепь сохранных сохранна', () => {
  const a = [-1, 1], b = [-1, 1];           // оба сохранны (Σ=0)
  assert.equal(chainConserved(a, b).conserved, true);
  assert.equal(chainConserved(a, b).composite_sum, 0);
  // kronVec длины 4
  assert.equal(kronVec(a, b).length, 4);
  // если один НЕ сохранён (Σ≠0) — но другой Σ=0 → произведение Σ=0 (закон мультипликативен)
  assert.equal(chainConserved([1, 0], [-1, 1]).composite_sum, 0);
  // оба не сохранны → произведение не ноль
  assert.notEqual(chainConserved([1, 0], [1, 0]).composite_sum, 0);
});

test('genrePowerLabels: 4^n составных жанров', () => {
  assert.equal(genrePowerLabels(1).length, 4);
  assert.equal(genrePowerLabels(2).length, 16);
  assert.ok(genrePowerLabels(2).includes('дар·приём'));
});
