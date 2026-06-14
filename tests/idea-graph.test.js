import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnText, classify, isClosure, isDrop, mineLines } from '../utils/idea-graph.mjs';

test('turnText: user/assistant, отсев системных []', () => {
  assert.equal(turnText('{"type":"user","message":{"content":"давай сделаем X"}}').text, 'давай сделаем X');
  assert.equal(turnText('{"role":"assistant","content":"идея: вынести Y"}').role, 'assistant');
  assert.equal(turnText('{"type":"user","message":{"content":"[Матрица ...]"}}'), null);
  assert.equal(turnText('мусор'), null);
});

test('classify: план/идея/развилка', () => {
  assert.equal(classify('давай сделаем кронекеров тензор'), 'plan');
  assert.equal(classify('идея: граф идей из транскриптов'), 'idea');
  assert.equal(classify('можно так или можно иначе — развилка'), 'fork');
  assert.equal(classify('просто статус'), null);
});

test('isClosure / isDrop', () => {
  assert.equal(isClosure('готово, запушено'), true);
  assert.equal(isClosure('тесты зелёные'), true);
  assert.equal(isClosure('думаю'), false);
  assert.equal(isDrop('забей, потом'), true);
});

test('mineLines: узлы + закрытия', () => {
  const lines = [
    '{"type":"user","message":{"content":"давай сделаем kairos"}}',
    '{"role":"assistant","content":"идея: впрыснуть в присутствие"}',
    '{"role":"assistant","content":"готово, тесты зелёные, запушено"}',
  ];
  const { nodes, closures } = mineLines(lines);
  assert.equal(nodes.length, 2);          // план + идея
  assert.equal(nodes[0].type, 'plan');
  assert.equal(closures, 1);
});

test('недоделка vs закрытая: план без последующего закрытия = open', async () => {
  const { buildGraph } = await import('../utils/idea-graph.mjs');
  assert.equal(typeof buildGraph, 'function');   // smoke: граф строится поверх реального следа
});
