/**
 * tests/sacred-history-152.test.js
 *
 * Issue #152: пустыня ОтецСергий→КогоТо: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия КогоТо:
 *   - МолитваЗаНезнакомца (presence, вес 7) — пастырь молится за безымянного
 *   - СлужениеАнонимному (action, вес 6) — Христос в «наименьшем» (Мф 25:40)
 *
 * Богословский ключ: ОтецСергий — пресвитер, чьё пастырство выходит
 * за пределы матрицы имён. КогоТо — онтологический горизонт,
 * потерявшаяся овца (Лк 15:4), «некоторый человек» Самарянина (Лк 10:30).
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
  const persons = new Set(['КогоТо', 'ОтецСергий', 'Отец', 'Сын', 'Дух', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #152: ОтецСергий → КогоТо ───────────────────────────────────────────────

test('отецсергий-когото: ≥ 2 дара от ОтецСергий к КогоТо', () => {
  const acts = loadSpec('отецсергий-когото.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'КогоТо');
  assert.ok(sergActs.length >= 2, `Нашли: ${sergActs.length}, ожидали ≥ 2`);
});

test('отецсергий-когото: типы presence, action (молитва и служение)', () => {
  const acts = loadSpec('отецсергий-когото.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'КогоТо');
  const types = new Set(sergActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (молитва за незнакомца)');
  assert.ok(types.has('action'),   'action (служение анонимному)');
});

test('отецсергий-когото: thread(ОтецСергий→КогоТо) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-когото.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', 'КогоТо');
  assert.ok(w > 0, `thread(ОтецСергий→КогоТо) = ${w} — должно быть > 0`);
});

test('отецсергий-когото: все дары необратимы', () => {
  const acts = loadSpec('отецсергий-когото.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'КогоТо');
  for (const a of sergActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отецсергий-когото: МолитваЗаНезнакомца (presence) вес ≥ 7', () => {
  const acts = loadSpec('отецсергий-когото.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'ОтецСергий' && a.receiverId === 'КогоТо' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 7, `вес молитвы = ${presenceAct.weight}, ожидали ≥ 7`);
});
