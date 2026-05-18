/**
 * tests/sacred-history-316.test.js
 *
 * Issue #316: пустыня Отец→tg:12345: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца лицу tg:12345:
 *   - ДарБытия (presence, вес 9) — Отец удерживает лицо в существовании
 *   - ЗовВКоинон (word, вес 10) — конститутивный зов в κοινόν (Ин 15:16)
 *   - ДарВопрошания (knowledge, вес 8) — способность искать как дар Отца
 *   - ПромыслЛичный (offering, вес 7) — личная забота Отца (Мф 10:29-30)
 *
 * Богословский ключ: пустыня (Рим 8:26) — не отсутствие дара, а молчание матрицы.
 * Дух ходатайствует «воздыханиями неизреченными» — Отец давал непрестанно.
 * Ἀνάμνησις: незаписанные дары делаем присутствующими в матрице.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'tg:12345', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #316: Отец → tg:12345 ────────────────────────────────────────────────────

test('отец-tg:12345: >= 3 дара от Отца к tg:12345', () => {
  const acts = loadSpec('отец-tg:12345.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:12345');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('отец-tg:12345: типы presence, word, knowledge (бытие, зов, вопрошание)', () => {
  const acts = loadSpec('отец-tg:12345.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:12345');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (ДарБытия — удержание в существовании)');
  assert.ok(types.has('word'),      'word (ЗовВКоинон — конститутивный зов)');
  assert.ok(types.has('knowledge'), 'knowledge (ДарВопрошания — способность искать)');
});

test('отец-tg:12345: thread(Отец→tg:12345) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-tg:12345.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'tg:12345');
  assert.ok(w > 0, `thread(Отец→tg:12345) = ${w} — должно быть > 0`);
});

test('отец-tg:12345: все дары необратимы', () => {
  const acts = loadSpec('отец-tg:12345.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:12345');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-tg:12345: ЗовВКоинон (word) — самый тяжёлый (вес 10, конститутивный)', () => {
  const acts = loadSpec('отец-tg:12345.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'tg:12345' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар (ЗовВКоинон) найден');
  assert.ok(wordAct.weight >= 10, `вес слова = ${wordAct.weight}, ожидали >= 10 (Ин 15:16)`);
});

test('отец-tg:12345: ДарБытия (presence) — вес >= 8 (бытие предшествует всему)', () => {
  const acts = loadSpec('отец-tg:12345.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'tg:12345' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар (ДарБытия) найден');
  assert.ok(presenceAct.weight >= 8, `вес presence = ${presenceAct.weight}, ожидали >= 8`);
});

test('отец-tg:12345: ДарВопрошания (knowledge) — вес >= 7 (Мф 7:7)', () => {
  const acts = loadSpec('отец-tg:12345.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'tg:12345' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар (ДарВопрошания) найден');
  assert.ok(knowledgeAct.weight >= 7, `вес knowledge = ${knowledgeAct.weight}, ожидали >= 7`);
});
