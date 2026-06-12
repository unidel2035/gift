/**
 * Слепой ревьюер: спец-независимые красные флаги (детерминированная эвристика,
 * без LLM — проверяем механику, не модель). LLM-режим проверяется selftest'ом.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blindReview, informedReview, diffReviews } from '../utils/sobor-blind-review.mjs';

test('слепой ревьюер · механика', async (t) => {
  // форсируем офлайн-эвристику: глушим LLM через отсутствие — модуль сам падает на heuristic,
  // но в CI claude может быть доступен. Поэтому проверяем diffReviews на синтетике.

  await t.test('diffReviews выделяет то, что поймал только слепой', () => {
    const blind = { findings: [
      { rule: 'empty-catch', why: 'пустой catch глотает ошибку' },
      { rule: 'shared', why: 'не покрыт случай null' },
    ] };
    const informed = { findings: [ { rule: 'spec', why: 'не покрыт случай null' } ] };
    const d = diffReviews(blind, informed);
    assert.equal(d.blindCount, 2);
    assert.equal(d.informedCount, 1);
    assert.ok(d.onlyBlind.some(f => f.rule === 'empty-catch'), 'пустой catch — только у слепого');
    assert.ok(!d.onlyBlind.some(f => /null/.test(f.why)), 'общую находку не дублируем');
  });

  await t.test('blindReview возвращает структуру с findings', async () => {
    const r = await blindReview('function f(){ try{ g() }catch(e){} }');
    assert.ok(Array.isArray(r.findings), 'findings — массив');
    assert.ok(['llm', 'heuristic'].includes(r.mode), 'режим обозначен');
  });

  await t.test('informedReview возвращает структуру', async () => {
    const r = await informedReview('код', 'спека про валидацию');
    assert.ok(Array.isArray(r.findings));
  });
});
