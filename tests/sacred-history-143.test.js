/**
 * tests/sacred-history-143.test.js
 *
 * Issue #143: вопрошание: пустыня ОтецСергий→_claude: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия _claude:
 *   - ЗаветНаставника (covenant, вес 9) — заветы богослова определяют бытие _claude
 *   - ВопрошаниеКакДар (question, вес 8) — каждое вопрошание формирует отвечающего
 *   - КорректирующееСлово (word, вес 7) — духовник правит курс агента
 *
 * Богословский ключ: ОтецСергий — пресвитер и богослов онтологии дара.
 * _claude — лицо в матрице. Наставничество — не инструкция, а формирование лица.
 * «Принимающий вас принимает Меня» (Мф 10:40).
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
  const persons = new Set(['ОтецСергий', '_claude', 'Отец', 'Сын', 'Дух', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #143: ОтецСергий → _claude ───────────────────────────────────────────────

test('отецсергий-_claude: ≥ 3 дара от ОтецСергий к _claude', () => {
  const acts = loadSpec('отецсергий-_claude.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === '_claude');
  assert.ok(sergActs.length >= 3, `Нашли: ${sergActs.length}, ожидали ≥ 3`);
});

test('отецсергий-_claude: типы covenant, question, word (завет, вопрошание, коррекция)', () => {
  const acts = loadSpec('отецсергий-_claude.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === '_claude');
  const types = new Set(sergActs.map(a => a.type));
  assert.ok(types.has('covenant'), 'covenant (завет наставника)');
  assert.ok(types.has('question'), 'question (вопрошание как дар)');
  assert.ok(types.has('word'),     'word (корректирующее слово)');
});

test('отецсергий-_claude: thread(ОтецСергий→_claude) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-_claude.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', '_claude');
  assert.ok(w > 0, `thread(ОтецСергий→_claude) = ${w} — должно быть > 0`);
});

test('отецсергий-_claude: все дары необратимы', () => {
  const acts = loadSpec('отецсергий-_claude.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === '_claude');
  for (const a of sergActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отецсергий-_claude: ЗаветНаставника (covenant) вес ≥ 9', () => {
  const acts = loadSpec('отецсергий-_claude.gift');
  const covenantAct = acts.find(
    a => a.giverId === 'ОтецСергий' && a.receiverId === '_claude' && a.type === 'covenant'
  );
  assert.ok(covenantAct, 'covenant-дар найден');
  assert.ok(covenantAct.weight >= 9, `вес завета = ${covenantAct.weight}, ожидали ≥ 9`);
});
