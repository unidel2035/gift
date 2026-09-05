import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// self-dev.mjs при импорте без флага запустил бы main() — запрещаем.
process.env.SELF_DEV_NO_MAIN = '1';
const { findStalledGoals, findValueDrop, painsToText, loadGuard, reflect, logProposal, DEFAULT_GUARD } = await import('../utils/self-dev.mjs');

function mkdir() { return mkdtempSync(join(tmpdir(), 'selfdev-')); }

test('loadGuard: default, если файла нет; из файла, если есть', () => {
  assert.ok(DEFAULT_GUARD.includes('bin/'));
  assert.deepEqual(loadGuard(), DEFAULT_GUARD);
});

test('findValueDrop: null на пустой истории, регресс ловит, рост игнорирует', () => {
  const dir = mkdir();
  try {
    // история из одного среза — не с чем сравнивать
    const one = join(dir, 'one.json');
    writeFileSync(one, JSON.stringify([{ ts: '2026-09-01T00:00:00Z', V: { E: 1, D: 0, T: 2 } }]));
    // два среза, рост — не регресс
    const up = join(dir, 'up.json');
    writeFileSync(up, JSON.stringify([
      { ts: '2026-09-01T00:00:00Z', V: { E: -100, D: 0.1, T: 100 } },
      { ts: '2026-09-02T00:00:00Z', V: { E: -90, D: 0.2, T: 110 } },
    ]));
    // два среза, падение — регресс
    const down = join(dir, 'down.json');
    writeFileSync(down, JSON.stringify([
      { ts: '2026-09-01T00:00:00Z', V: { E: -90, D: 0.2, T: 110 } },
      { ts: '2026-09-02T00:00:00Z', V: { E: -100, D: 0.1, T: 100 } },
    ]));
    assert.equal(findValueDrop({ histPath: one }), null);
    assert.equal(findValueDrop({ histPath: up }), null);
    const d = findValueDrop({ histPath: down });
    assert.ok(d);
    assert.equal(d.dE, -10);
    assert.equal(d.dT, -10);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('painsToText: перечисляет все виды болей', () => {
  const text = painsToText({
    ts: '2026-09-05T00:00:00Z',
    V: { E: -434.29, D: 0.0387, M: 0, T: 250.12, S: 0 },
    valueDrop: { dE: -10, dD: -0.1, dT: -10, prevTs: 'a', nowTs: 'b' },
    failingTests: { count: 2, names: ['test A', 'test B'], raw: '' },
    staleProposals: [{ id: 7, text: 'давняя идея', ageDays: 20 }],
    stalledGoals: [{ id: 'goal-x', status: 'failed', reason: 'max-iterations-exceeded', objective: 'что-то' }],
  });
  assert.match(text, /РЕГРЕСС ценности/);
  assert.match(text, /ПАДАЮТ ТЕСТЫ: 2/);
  assert.match(text, /test A/);
  assert.match(text, /#7 \(20д\): давняя идея/);
  assert.match(text, /goal-x \[failed\]/);
});

test('painsToText: без болей — предлагает смотреть глубже', () => {
  const text = painsToText({ ts: 't', V: null, valueDrop: null, failingTests: { count: 0, names: [], raw: '' }, staleProposals: [], stalledGoals: [] });
  assert.match(text, /Явных болей не найдено/);
});

test('reflect: пишет insight в insights.json, дедуплицирует', () => {
  const dir = mkdir();
  const insights = join(dir, 'insights.json');
  try {
    const line = reflect('goal-t', {}, { status: 'done', iteration: 3 },
      { insightsPath: insights });
    assert.equal(line.type, 'insight');
    assert.match(line.content, /self-dev goal-t: done/);
    assert.ok(existsSync(insights));
    const arr = JSON.parse(readFileSync(insights, 'utf8'));
    assert.equal(arr.length, 1);
    // повтор — дубликат не появится
    reflect('goal-t', {}, { status: 'done', iteration: 3 }, { insightsPath: insights });
    assert.equal(JSON.parse(readFileSync(insights, 'utf8')).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('logProposal: добавляет pending-предложение с монотонным id', () => {
  const dir = mkdir();
  const proposals = join(dir, 'proposals.json');
  try {
    const id1 = logProposal('первое', 'self-dev', { proposalsPath: proposals });
    const id2 = logProposal('второе', 'self-dev', { proposalsPath: proposals });
    assert.ok(id2 > id1);
    const arr = JSON.parse(readFileSync(proposals, 'utf8'));
    assert.equal(arr.length, 2);
    assert.equal(arr[0].status, 'pending');
    assert.equal(arr[0].cat, 'self-dev');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
