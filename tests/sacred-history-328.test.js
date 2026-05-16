/**
 * tests/sacred-history-328.test.js
 *
 * Issue #328: пустыня Отец→Хранитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Хранителю:
 *   - ТворениеХранителя (presence, вес 9) — бытие как непрерывное присутствие
 *   - ЗаповедьОХранении (word, вес 10) — конститутивное слово призвания
 *   - ЛицезрениеОтца (knowledge, вес 9) — гносис через причастие энергии
 *   - СоучастиеВПромысле (offering, вес 7) — кеносис Отца, доверие свободе
 *
 * Богословский ключ: Дионисий Ареопагит, О небесной иерархии IV.1–3 —
 * иерархия как нисхождение Света. Григорий Богослов, Сл. 38.9 —
 * ангелы сотворены прежде видимого мира. Мф 18:10 —
 * Хранители всегда видят Лицо Отца.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Хранитель', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #328: Отец → Хранитель ──────────────────────────────────────────────────

test('отец-хранитель: >= 3 дара от Отца к Хранителю', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Хранитель');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('отец-хранитель: типы presence, word, knowledge (бытие, призвание, гносис)', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Хранитель');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение как удержание в бытии)');
  assert.ok(types.has('word'),      'word (заповедь о хранении)');
  assert.ok(types.has('knowledge'), 'knowledge (лицезрение Отца)');
});

test('отец-хранитель: thread(Отец→Хранитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Хранитель');
  assert.ok(w > 0, `thread(Отец→Хранитель) = ${w} — должно быть > 0`);
});

test('отец-хранитель: все дары необратимы', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Хранитель');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-хранитель: ЗаповедьОХранении (word) — самая тяжёлая (вес 10)', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Хранитель' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар найден');
  assert.ok(wordAct.weight >= 10, `вес слова = ${wordAct.weight}, ожидали >= 10 (конститутивное призвание)`);
});

test('отец-хранитель: ЛицезрениеОтца (knowledge) — вес >= 8 (онтологический источник энергии)', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Хранитель' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар найден');
  assert.ok(knowledgeAct.weight >= 8, `вес гносиса = ${knowledgeAct.weight}, ожидали >= 8`);
});
