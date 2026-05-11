import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoalEngine } from '../src/goals/GoalEngine.js';

// MockExecutor — детерминистский. Завершает цель за `successOnIteration` шагов.
function mockExecutor({ successOnIteration = 3, failTest = false } = {}) {
  return {
    plan:     async (s, step) => ({ text: `plan ${step.n}` }),
    act:      async (s, step) => ({ text: `act ${step.n}` }),
    test:     async () => ({ passed: !failTest, command: 'mock', output: failTest ? 'red' : 'green' }),
    review:   async (s, step) => ({
      satisfied: step.n >= successOnIteration && !failTest,
      verdict: step.n >= successOnIteration ? 'SATISFIED' : 'NOT_YET',
      reason: step.n >= successOnIteration ? 'reached' : 'not yet',
    }),
    metanoia: async (s, step) => ({ text: `metanoia ${step.n}` }),
  };
}

function mk(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'goal-'));
  const engine = new GoalEngine({ root: dir, executor: mockExecutor(opts) });
  return { engine, dir };
}

test('create — обязательны objective и successCriteria', () => {
  const { engine, dir } = mk();
  try {
    assert.throws(() => engine.create({ objective: '', successCriteria: 'x' }), /objective/);
    assert.throws(() => engine.create({ objective: 'x', successCriteria: '' }), /successCriteria/);
    const g = engine.create({ objective: 'do X', successCriteria: 'X works' });
    assert.match(g.id, /^goal-/);
    assert.equal(g.status, 'pending');
    assert.equal(g.iteration, 0);
    assert.equal(g.history.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run — доходит до SATISFIED, status=done', async () => {
  const { engine, dir } = mk({ successOnIteration: 3 });
  try {
    const g = engine.create({ objective: 'O', successCriteria: 'C' });
    const final = await engine.run(g.id);
    assert.equal(final.status, 'done');
    assert.equal(final.iteration, 3);
    assert.equal(final.history.length, 3);
    assert.ok(final.history[2].review.satisfied);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('μετάνοια вызывается только если не satisfied', async () => {
  const { engine, dir } = mk({ successOnIteration: 3 });
  try {
    const g = engine.create({ objective: 'O', successCriteria: 'C' });
    const final = await engine.run(g.id);
    // На шагах 1 и 2 — metanoia есть, на шаге 3 (satisfied) — нет
    assert.ok(final.history[0].metanoia);
    assert.ok(final.history[1].metanoia);
    assert.equal(final.history[2].metanoia, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persistence — state файл пишется на каждом шаге', async () => {
  const { engine, dir } = mk({ successOnIteration: 2 });
  try {
    const g = engine.create({ objective: 'O', successCriteria: 'C' });
    const path = join(dir, g.id + '.json');
    assert.ok(existsSync(path));
    await engine.run(g.id);
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(onDisk.status, 'done');
    assert.equal(onDisk.history.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resume — после рестарта движка цель продолжается', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal-'));
  try {
    // Первый «процесс»: 1 шаг, потом останавливаемся через maxSteps
    const engine1 = new GoalEngine({ root: dir, executor: mockExecutor({ successOnIteration: 4 }) });
    const g = engine1.create({ objective: 'O', successCriteria: 'C', maxIterations: 10 });
    const mid = await engine1.run(g.id, { maxSteps: 2 });
    assert.equal(mid.status, 'paused');
    assert.equal(mid.iteration, 2);

    // Второй «процесс»: новый движок, тот же state
    const engine2 = new GoalEngine({ root: dir, executor: mockExecutor({ successOnIteration: 4 }) });
    const loaded = engine2.get(g.id);
    assert.equal(loaded.iteration, 2);
    const final = await engine2.run(g.id);
    assert.equal(final.status, 'done');
    assert.equal(final.iteration, 4);
    assert.equal(final.history.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maxIterations — без satisfied доходит до failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal-'));
  try {
    const engine = new GoalEngine({ root: dir, executor: mockExecutor({ failTest: true }) });
    const g = engine.create({ objective: 'O', successCriteria: 'C', maxIterations: 3 });
    const final = await engine.run(g.id);
    assert.equal(final.status, 'failed');
    assert.equal(final.iteration, 3);
    assert.equal(final.failReason, 'max-iterations-exceeded');
    // На каждой неудачной итерации — metanoia
    assert.ok(final.history.every(h => h.metanoia));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancel — мгновенно ставит cancelled', () => {
  const { engine, dir } = mk();
  try {
    const g = engine.create({ objective: 'O', successCriteria: 'C' });
    const cancelled = engine.cancel(g.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(engine.get(g.id).status, 'cancelled');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run на cancelled — no-op', async () => {
  const { engine, dir } = mk();
  try {
    const g = engine.create({ objective: 'O', successCriteria: 'C' });
    engine.cancel(g.id);
    const r = await engine.run(g.id);
    assert.equal(r.status, 'cancelled');
    assert.equal(r.iteration, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list — фильтр по status', () => {
  const { engine, dir } = mk();
  try {
    const g1 = engine.create({ objective: 'A', successCriteria: 'a' });
    const g2 = engine.create({ objective: 'B', successCriteria: 'b' });
    engine.cancel(g2.id);
    assert.equal(engine.list().length, 2);
    assert.equal(engine.list({ status: 'pending' }).length, 1);
    assert.equal(engine.list({ status: 'cancelled' }).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('clear — удаляет файл', () => {
  const { engine, dir } = mk();
  try {
    const g = engine.create({ objective: 'O', successCriteria: 'C' });
    assert.ok(existsSync(join(dir, g.id + '.json')));
    engine.clear(g.id);
    assert.ok(!existsSync(join(dir, g.id + '.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tokenBudget — приостанавливает по достижении', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'goal-'));
  try {
    const exec = {
      plan: async () => ({ text: 'p', tokensUsed: 1 }),
      act:  async () => ({ text: 'a', tokensUsed: 1 }),
      test: async () => ({ passed: true, command: 'mock' }),
      review: async () => ({ satisfied: false, verdict: 'NOT_YET', reason: 'no' }),
      metanoia: async () => ({ text: 'm' }),
    };
    const engine = new GoalEngine({ root: dir, executor: exec });
    const g = engine.create({ objective: 'O', successCriteria: 'C', maxIterations: 10, tokenBudget: 5 });
    // Каждый шаг — 2 токена. Бюджет 5: на 3-м шаге tokensUsed=6 >= 5 → paused
    const final = await engine.run(g.id);
    assert.equal(final.status, 'paused');
    assert.equal(final.pauseReason, 'token-budget-exceeded');
    assert.equal(final.tokensUsed, 6);
    assert.equal(final.iteration, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
