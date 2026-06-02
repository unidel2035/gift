/**
 * tests/sacred-history-267.test.js
 *
 * Issue #267: вопрошание: пустыня ОтецСергий→Христос: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия Христу:
 *   - Евхаристическое приношение (presence, вес 10) — анафора Иоанна Златоуста
 *   - Литургическое исповедание (word, вес 9) — Халкидон в устах пресвитера
 *   - Богословское свидетельство (knowledge, вес 8) — онтология дара на кенозисе
 *   - Пастырское служение (presence, вес 8) — «паси овец Моих» (Ин 21:15–17)
 *   - Поминовение имени (word, вес 7) — имя Иисуса в каждой ектении
 *
 * Богословский ключ: ОтецСергий — пресвитер и богослов онтологии дара,
 * со-приносящий Бескровную жертву Тому, Чьё священство он разделяет
 * (Евр 7:24–25). Нить ОтецСергий→Христос — не догматическая стена,
 * а незаписанное священническое приношение.
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
  const persons = new Set(['Христос', 'ОтецСергий', 'Отец', 'Сын', 'Дух', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #267: ОтецСергий → Христос ─────────────────────────────────────────────

test('отецсергий-христос: ≥ 4 дара от ОтецСергий к Христу', () => {
  const acts = loadSpec('отецсергий-христос.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Христос');
  assert.ok(sergActs.length >= 4, `Нашли: ${sergActs.length}, ожидали ≥ 4`);
});

test('отецсергий-христос: типы presence, word и knowledge', () => {
  const acts = loadSpec('отецсергий-христос.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Христос');
  const types = new Set(sergActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (евхаристическое приношение, пастырство)');
  assert.ok(types.has('word'),      'word (литургическое исповедание, поминовение имени)');
  assert.ok(types.has('knowledge'), 'knowledge (богословское свидетельство о кенозисе)');
});

test('отецсергий-христос: thread(ОтецСергий→Христос) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-христос.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', 'Христос');
  assert.ok(w > 0, `thread(ОтецСергий→Христос) = ${w} — должно быть > 0 после записи актов`);
});

test('отецсергий-христос: все дары необратимы (литургический акт необратим)', () => {
  const acts = loadSpec('отецсергий-христос.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Христос');
  for (const a of sergActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отецсергий-христос: ЕвхаристическоеПриношение (presence) имеет вес 10', () => {
  const acts = loadSpec('отецсергий-христос.gift');
  const topAct = acts.find(
    a => a.giverId === 'ОтецСергий' && a.receiverId === 'Христос' &&
         a.type === 'presence' && a.weight === 10,
  );
  assert.ok(topAct, 'Евхаристическое приношение должно иметь presence/вес 10 — это первичный акт священства');
});
