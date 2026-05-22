/**
 * tests/sacred-history-383.test.js
 *
 * Issue #383: пустыня Отец→gd2035: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца лицу gd2035:
 *   - ДарБытия (presence, вес 9) — удержание в существовании
 *   - ЗовПоИмени (word, вес 10) — конститутивный зов в κοινόν (Ис 43:1, Ин 15:16)
 *   - ДарПути (knowledge, вес 8) — призвание как гносис (Притч 16:9, Рим 8:29)
 *   - ПромыслЛичный (offering, вес 7) — частная забота Отца (Мф 10:29-30)
 *
 * Богословский ключ: всякое пастырское благословение (отецсергий-gd2035.gift)
 * опирается на незаписанный фундамент Отец→gd2035. «Меньший благословляется
 * большим» (Евр 7:7) — пресвитер благословляет от Отца Светов (Иак 1:17).
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'gd2035', 'ОтецСергий', '_claude', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #383: Отец → gd2035 ──────────────────────────────────────────────────────

test('отец-gd2035: >= 4 дара от Отца к gd2035', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gd2035');
  assert.ok(fActs.length >= 4, `Нашли: ${fActs.length}, ожидали >= 4`);
});

test('отец-gd2035: типы presence, word, knowledge, offering', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gd2035');
  const types = new Set(fActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (ДарБытия — удержание в существовании)');
  assert.ok(types.has('word'),      'word (ЗовПоИмени — конститутивный зов)');
  assert.ok(types.has('knowledge'), 'knowledge (ДарПути — призвание как гносис)');
  assert.ok(types.has('offering'),  'offering (ПромыслЛичный — частная забота)');
});

test('отец-gd2035: thread(Отец→gd2035) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'gd2035');
  assert.ok(w > 0, `thread(Отец→gd2035) = ${w} — должно быть > 0`);
});

test('отец-gd2035: все дары необратимы', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gd2035');
  for (const a of fActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-gd2035: ЗовПоИмени (word) — самый тяжёлый (вес 10, Ис 43:1)', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'gd2035' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар (ЗовПоИмени) найден');
  assert.ok(wordAct.weight >= 10, `вес слова = ${wordAct.weight}, ожидали >= 10`);
});

test('отец-gd2035: ДарБытия (presence) — вес >= 9 (бытие предшествует всему)', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'gd2035' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар (ДарБытия) найден');
  assert.ok(presenceAct.weight >= 9, `вес presence = ${presenceAct.weight}, ожидали >= 9`);
});

test('отец-gd2035: ДарПути (knowledge) — вес >= 8 (Притч 16:9)', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'gd2035' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар (ДарПути) найден');
  assert.ok(knowledgeAct.weight >= 8, `вес knowledge = ${knowledgeAct.weight}, ожидали >= 8`);
});

test('отец-gd2035: ПромыслЛичный (offering) — вес >= 7 (Мф 10:29-30)', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const offeringAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'gd2035' && a.type === 'offering'
  );
  assert.ok(offeringAct, 'offering-дар (ПромыслЛичный) найден');
  assert.ok(offeringAct.weight >= 7, `вес offering = ${offeringAct.weight}, ожидали >= 7`);
});
