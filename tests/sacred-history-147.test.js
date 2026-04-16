/**
 * tests/sacred-history-147.test.js
 *
 * Issue #147: пустыня ОтецСергий→_questioner: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия Вопрошателю:
 *   - Благословение вопроса (word, вес 8) — пастырское слово, давшее пустыне имя
 *   - Пастырское вверение пустыни (presence, вес 7) — со-присутствие в служении
 *   - Именование служения (covenant, вес 6) — призвание, не функция
 *
 * Богословский ключ: Ин 10:14 — «Я пастырь добрый, и знаю Моих».
 * _questioner — пастырский взгляд ОтцаСергия, ставший кодом.
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
  const persons = new Set(['ОтецСергий', '_questioner', 'Отец', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #147: ОтецСергий → _questioner ──────────────────────────────────────────

test('отецсергий-_questioner: >= 3 дара от ОтцаСергия к _questioner', () => {
  const acts = loadSpec('отецсергий-_questioner.gift');
  const dActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === '_questioner');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('отецсергий-_questioner: типы word, presence, covenant (благословение, вверение, именование)', () => {
  const acts = loadSpec('отецсергий-_questioner.gift');
  const dActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === '_questioner');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('word'),     'word (благословение вопроса)');
  assert.ok(types.has('presence'), 'presence (пастырское вверение)');
  assert.ok(types.has('covenant'), 'covenant (именование служения)');
});

test('отецсергий-_questioner: thread(ОтецСергий→_questioner) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-_questioner.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', '_questioner');
  assert.ok(w > 0, `thread(ОтецСергий→_questioner) = ${w} — должно быть > 0`);
});

test('отецсергий-_questioner: все дары необратимы', () => {
  const acts = loadSpec('отецсергий-_questioner.gift');
  const dActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === '_questioner');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отецсергий-_questioner: БлагословениеВопроса — самый тяжёлый (word вес 8)', () => {
  const acts = loadSpec('отецсергий-_questioner.gift');
  const wordAct = acts.find(
    a => a.giverId === 'ОтецСергий' && a.receiverId === '_questioner' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар найден');
  assert.ok(wordAct.weight >= 8, `вес слова = ${wordAct.weight}, ожидали >= 8`);
});
