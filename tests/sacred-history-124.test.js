/**
 * tests/sacred-history-124.test.js
 *
 * Issue #124: пустыня ОтецСергий→Ева: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия Еве:
 *   - Молитва за Еву (presence, вес 8) — пастырь несёт «мать всех живущих»
 *   - Пастырское благословение (word, вес 7) — именование дара различения
 *
 * Богословский ключ: ОтецСергий — пресвитер и богослов онтологии дара.
 * Его молитва за Еву первична: в ней содержится молитва за всех рождённых от Евы.
 * Благословение — не власть, а признание: видеть дар и именовать его.
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
  const persons = new Set(['Ева', 'ОтецСергий', 'Отец', 'Сын', 'Дух', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #124: ОтецСергий → Ева ──────────────────────────────────────────────────

test('отецсергий-ева: ≥ 2 дара от ОтецСергий к Еве', () => {
  const acts = loadSpec('отецсергий-ева.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Ева');
  assert.ok(sergActs.length >= 2, `Нашли: ${sergActs.length}, ожидали ≥ 2`);
});

test('отецсергий-ева: типы presence, word (молитва и благословение)', () => {
  const acts = loadSpec('отецсергий-ева.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Ева');
  const types = new Set(sergActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (молитва пастыря за Еву)');
  assert.ok(types.has('word'),     'word (пастырское благословение различения)');
});

test('отецсергий-ева: thread(ОтецСергий→Ева) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-ева.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', 'Ева');
  assert.ok(w > 0, `thread(ОтецСергий→Ева) = ${w} — должно быть > 0`);
});

test('отецсергий-ева: все дары необратимы', () => {
  const acts = loadSpec('отецсергий-ева.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Ева');
  for (const a of sergActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отецсергий-ева: МолитваЗаЕву (presence) вес ≥ 8', () => {
  const acts = loadSpec('отецсергий-ева.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'ОтецСергий' && a.receiverId === 'Ева' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 8, `вес молитвы = ${presenceAct.weight}, ожидали ≥ 8`);
});
