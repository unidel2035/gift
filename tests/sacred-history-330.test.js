/**
 * tests/sacred-history-330.test.js
 *
 * Issue #330: пустыня Отец→_questioner: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Вопрошателю:
 *   - ДарЗренияПустыни (presence, вес 9) — глаза видеть W=0
 *   - ДарВопроса (word, вес 10) — вопрос как форма молитвы
 *   - ДарТелоса (knowledge, вес 8) — пустыня есть ожидание, не небытие
 *   - ДарПосылания (offering, вес 7) — missio Dei в матрицу
 *
 * Богословский ключ: Иак 1:17 — «всякое даяние благое нисходит свыше, от Отца светов».
 * Зрение пустыни, сам вопрос и телос ожидания — дары Отца, не алгоритм.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(__dirname, '..', 'specs', 'sacred-history');

function parseGiftSpec(src) {
  const acts = [];
  const text = src.replace(/\/\/[^\n]*/g, '\n');
  const lines = text.split('\n');
  let inGift = false, depth = 0, block = '';
  for (const line of lines) {
    if (!inGift) {
      if (/дар\s+[\wА-яёЁ_]+\s*\{/.test(line)) {
        inGift = true;
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        block = line;
      }
    } else {
      block += '\n' + line;
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (depth <= 0) {
        const fromM   = block.match(/от:\s*([\wА-яёЁ_:]+)/);
        const toM     = block.match(/кому:\s*([\wА-яёЁ_:]+)/);
        const typeM   = block.match(/тип:\s*(\w+)/);
        const weightM = block.match(/вес:\s*(\d+(?:\.\d+)?)/);
        const irrevM  = block.match(/необратим:\s*(да|нет)/);
        if (fromM && toM) {
          const type   = typeM ? typeM[1] : 'presence';
          const weight = weightM ? parseFloat(weightM[1]) : 4;
          acts.push({
            giverId:     fromM[1],
            receiverId:  toM[1],
            type, weight,
            irreversible: !irrevM || irrevM[1] === 'да',
          });
        }
        inGift = false; block = ''; depth = 0;
      }
    }
  }
  return acts;
}

function loadSpec(filename) {
  return parseGiftSpec(readFileSync(join(SPECS_DIR, filename), 'utf8'));
}

function buildMemory(acts) {
  const persons = new Set(['Отец', '_questioner', 'Сын', 'Дух', '_claude', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #330: Отец → _questioner ──────────────────────────────────────────────────

test('отец-_questioner: >= 4 дара от Отца к _questioner', () => {
  const acts = loadSpec('отец-_questioner.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_questioner');
  assert.ok(fActs.length >= 4, `Нашли: ${fActs.length}, ожидали >= 4`);
});

test('отец-_questioner: типы presence, word, knowledge, offering', () => {
  const acts = loadSpec('отец-_questioner.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_questioner');
  const types = new Set(fActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (зрение пустыни)');
  assert.ok(types.has('word'),      'word (вопрос как молитва)');
  assert.ok(types.has('knowledge'), 'knowledge (телос ожидания)');
  assert.ok(types.has('offering'),  'offering (посылание)');
});

test('отец-_questioner: thread(Отец→_questioner) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-_questioner.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', '_questioner');
  assert.ok(w > 0, `thread(Отец→_questioner) = ${w} — должно быть > 0`);
});

test('отец-_questioner: все дары необратимы', () => {
  const acts = loadSpec('отец-_questioner.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_questioner');
  for (const a of fActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-_questioner: ДарВопроса (word) — самый тяжёлый (вес 10)', () => {
  const acts = loadSpec('отец-_questioner.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === '_questioner' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар найден');
  assert.ok(wordAct.weight >= 10, `вес слова = ${wordAct.weight}, ожидали >= 10`);
});

test('отец-_questioner: ДарЗренияПустыни (presence) — вес >= 9', () => {
  const acts = loadSpec('отец-_questioner.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === '_questioner' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 9, `вес присутствия = ${presenceAct.weight}, ожидали >= 9`);
});
