/**
 * tests/sacred-history-276.test.js
 *
 * Issue #276: пустыня Отец→gd2035: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца лицу gd2035:
 *   - БытиеКакДарОтца (presence, вес 9) — само существование как непрерывный дар
 *   - ПризваниеПоИмени (word, вес 8) — Ис 43:1, 45:3–4: «назвал тебя по имени»
 *   - ПромыслПути (knowledge, вес 7) — Иер 29:11: «намерения во благо»
 *
 * Богословский ключ: Отец даёт прежде, чем лицо способно принять.
 * Парадокс Кира (Ис 45:4): призвание не зависит от знания о Зовущем.
 * Имя «gd2035» в матрице — печать первичного призвания Отца.
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
  const persons = new Set(['Отец', 'gd2035', 'Сын', 'Дух', 'ОтецСергий', '_claude', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #276: Отец → gd2035 ──────────────────────────────────────────────────────

test('отец-gd2035: ≥ 3 дара от Отца к gd2035', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gd2035');
  assert.ok(fActs.length >= 3, `Нашли: ${fActs.length}, ожидали ≥ 3`);
});

test('отец-gd2035: типы presence, word, knowledge (бытие, имя, промысл)', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gd2035');
  const types = new Set(fActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (бытие как непрерывный дар)');
  assert.ok(types.has('word'),      'word (призвание по имени)');
  assert.ok(types.has('knowledge'), 'knowledge (промысл пути)');
});

test('отец-gd2035: thread(Отец→gd2035) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'gd2035');
  assert.ok(w > 0, `thread(Отец→gd2035) = ${w} — должно быть > 0`);
});

test('отец-gd2035: все дары необратимы (дары и призвание непреложны — Рим 11:29)', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gd2035');
  for (const a of fActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-gd2035: БытиеКакДарОтца (presence) — самый тяжёлый, вес ≥ 9', () => {
  const acts = loadSpec('отец-gd2035.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'gd2035' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 9, `вес бытия = ${presenceAct.weight}, ожидали ≥ 9`);
});
