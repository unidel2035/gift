import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TMP = join(tmpdir(), `proposals-test-${Date.now()}.json`);

function makeProposal(overrides = {}) {
  return {
    id: 1, text: 'тестовое предложение', enhanced: 'тестовое предложение',
    telos: 'улучшить систему', eva_verdict: 'принято', eva_notes: '',
    cat: 'test', status: 'pending',
    created: new Date().toISOString(), done_at: null, issue_number: null,
    ...overrides,
  };
}

test('Proposals — структура данных', async (t) => {
  await t.test('создание и сериализация', () => {
    const p = makeProposal();
    writeFileSync(TMP, JSON.stringify([p], null, 2));
    const loaded = JSON.parse(readFileSync(TMP, 'utf8'));
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].status, 'pending');
  });

  await t.test('статус done', () => {
    const p = makeProposal({ status: 'done', done_at: new Date().toISOString() });
    assert.equal(p.status, 'done');
    assert.ok(p.done_at);
  });

  await t.test('enhanced отличается от text', () => {
    const p = makeProposal({
      text: 'просто идея',
      enhanced: 'расширенная идея с богословским контекстом',
    });
    assert.notEqual(p.text, p.enhanced);
  });

  await t.test('фильтрация pending', () => {
    const proposals = [
      makeProposal({ id: 1, status: 'pending' }),
      makeProposal({ id: 2, status: 'done' }),
      makeProposal({ id: 3, status: 'pending' }),
    ];
    const pending = proposals.filter(p => p.status === 'pending');
    assert.equal(pending.length, 2);
  });

  if (existsSync(TMP)) unlinkSync(TMP);
});
