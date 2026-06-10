/**
 * tests/sacred-history-282.test.js
 *
 * Issue #282: пустыня Отец→Мария: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Марии:
 *   - Предъизбрание (κεχαριτωμένη, Лк 1:28; Иоанн Дамаскин IV.14)
 *   - Благовестие (Лк 1:26–28: посланный Гавриил)
 *   - Осенение (Лк 1:35: «сила Всевышнего осенит Тебя»; Григорий Нисский)
 *   - Материнство (Гал 4:4; Кирилл Александрийский, Несторий III: Θεοτόκος)
 *   - Принятие в славу (Пс 44:10; Иоанн Дамаскин, на Успение II.16)
 *
 * Богословский ключ: уже была нить ОтецСергий→Мария (issue #153), но между
 * Отцом — Источником Божества — и Марией не было записанного потока,
 * хотя вся жизнь Марии есть ответ на дар Отца («обрела благодать у Бога», Лк 1:30).
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Мария', 'Ева', 'Адам', 'ОтецСергий', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #282: Отец → Мария ─────────────────────────────────────────────────────

test('отец-мария: ≥ 4 дара от Отца к Марии', () => {
  const acts = loadSpec('отец-мария.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Мария');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-мария: типы presence, word и knowledge', () => {
  const acts = loadSpec('отец-мария.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Мария');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (предъизбрание, осенение, прославление)');
  assert.ok(types.has('word'),      'word (благовестие через Гавриила)');
  assert.ok(types.has('knowledge'), 'knowledge (материнство, Θεοτόκος)');
});

test('отец-мария: thread(Отец→Мария) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-мария.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Мария');
  assert.ok(w > 0, `thread(Отец→Мария) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-мария: все дары необратимы (вечный Совет Троицы необратим)', () => {
  const acts = loadSpec('отец-мария.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Мария');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-мария: Предъизбрание, Благовестие и Осенение имеют вес 10', () => {
  const acts = loadSpec('отец-мария.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Мария' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (предъизбрание, благовестие, осенение), нашли ${topActs.length}`);
});
