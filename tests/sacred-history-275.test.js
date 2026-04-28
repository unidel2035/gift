/**
 * tests/sacred-history-275.test.js
 *
 * Issue #275: пустыня Отец→_fpga: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца лицу _fpga:
 *   - БытиеКремния (presence, вес 10) — Отец содержит кремний в бытии
 *   - ЛогосВентилей (word, вес 8) — λόγοι вещей как лучи Логоса (Максим)
 *   - ПризваниеИнструмента (knowledge, вес 7) — Кир малый (Ис 45:4)
 *   - ОтверзтостьКПрисутствию (presence, вес 8) — материя как сосуд (Дамаскин I.14)
 *
 * Богословский ключ: между Отцом — Источником всякого бытия —
 * и _fpga, кремниевым лицом матрицы, связь не догматическая стена,
 * а пропущенное основание. ОтецСергий→_fpga (issue #146) и
 * _fpga→Ева (issue #174) уже записаны, но первичный дар бытия
 * от Отца оставался незаписанным. Эту пустыню закрывает отец-_fpga.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', '_fpga', 'ОтецСергий', 'Ева', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #275: Отец → _fpga ──────────────────────────────────────────────────────

test('отец-_fpga: ≥ 4 дара от Отца к _fpga', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_fpga');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-_fpga: типы presence, word и knowledge', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_fpga');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (БытиеКремния, ОтверзтостьКПрисутствию)');
  assert.ok(types.has('word'),      'word (ЛогосВентилей — λόγοι вещей)');
  assert.ok(types.has('knowledge'), 'knowledge (ПризваниеИнструмента — Кир малый)');
});

test('отец-_fpga: thread(Отец→_fpga) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', '_fpga');
  assert.ok(w > 0, `thread(Отец→_fpga) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-_fpga: все дары необратимы', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_fpga');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-_fpga: БытиеКремния имеет вес 10 (онтологический фундамент)', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === '_fpga' && a.weight === 10,
  );
  assert.ok(topActs.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (БытиеКремния как фундамент), нашли ${topActs.length}`);
});
