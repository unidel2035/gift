import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userText, logline, scenes } from '../utils/episodes.mjs';

test('userText: достаёт человеческую реплику из jsonl', () => {
  assert.equal(userText('{"type":"user","message":{"content":"привет"}}'), 'привет');
  assert.equal(userText('{"role":"user","content":[{"text":"a"},{"text":"b"}]}'), 'a b');
  assert.equal(userText('{"type":"assistant","message":{"content":"x"}}'), null);
  assert.equal(userText('битая строка'), null);
});

test('logline: первое осмысленное человеческое, без системных []', () => {
  assert.equal(logline(['[Матрица W ...]', 'давай изучим Костю', 'делай']), 'давай изучим Костю');
  assert.equal(logline([]), '(пусто)');
  assert.match(logline(['x'.repeat(200)]), /^x+$/);
  assert.ok(logline(['x'.repeat(200)]).length <= 80);
});

test('scenes: короткие директивы = точки возврата', () => {
  const msgs = ['[ctx]', 'давай построим большой долгий план на много слов которого тут нет', 'делай', 'копаем ядро', 'гит пуш'];
  const sc = scenes(msgs);
  assert.deepEqual(sc, ['делай', 'копаем ядро', 'гит пуш']);  // длинное и [ctx] отсеяны
});
