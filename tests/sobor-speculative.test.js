/**
 * Спекулятивный турнир: реальность (испытание) выбирает реализацию.
 * Детерминированно через exit-коды испытаний (без сети/LLM).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speculate } from '../utils/sobor-speculative.mjs';

test('спекулятивный турнир · реальность выбирает', async (t) => {

  await t.test('провалившая тесты не побеждает прошедшую', async () => {
    const impls = [
      { id: 'A', label: 'падает', trial: { cmd: 'exit 1' } },
      { id: 'B', label: 'проходит', trial: { cmd: 'exit 0' } },
    ];
    const res = await speculate('задача', impls, { blindTiebreak: false });
    assert.equal(res.winner.id, 'B', 'победила прошедшая испытание');
    assert.deepEqual(res.passed.map(p => p.id), ['B']);
    assert.deepEqual(res.failed.map(p => p.id), ['A']);
  });

  await t.test('при равном испытании разбой по метрике', async () => {
    const impls = [
      { id: 'fast', trial: { cmd: "echo '{\"metrics\":{\"ms\":10}}' > /tmp/spec-fast.json; exit 0", result: '/tmp/spec-fast.json', metric: 'ms' } },
      { id: 'slow', trial: { cmd: "echo '{\"metrics\":{\"ms\":90}}' > /tmp/spec-slow.json; exit 0", result: '/tmp/spec-slow.json', metric: 'ms' } },
    ];
    const res = await speculate('задача', impls, { blindTiebreak: false });
    assert.equal(res.winner.id, 'fast', 'меньше ms — лучше');
  });

  await t.test('все провалили — победитель есть, но никто не passed', async () => {
    const impls = [
      { id: 'X', trial: { cmd: 'exit 1' } },
      { id: 'Y', trial: { cmd: 'exit 1' } },
    ];
    const res = await speculate('задача', impls, { blindTiebreak: false });
    assert.equal(res.passed.length, 0, 'никто не прошёл');
    assert.ok(res.winner, 'ранжирование всё равно даёт верхнего');
  });
});
