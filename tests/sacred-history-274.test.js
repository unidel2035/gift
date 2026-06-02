/**
 * tests/sacred-history-274.test.js
 *
 * Issue #274: пустыня Отец→Целитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Целителю (лицо Шестоднева, День 5):
 *   - Призвание к восстановлению (Быт 1:20–22, логос «души живой»)
 *   - Образ Яхве-Рафа (Исх 15:26, Пс 102:3, Пс 146:3)
 *   - Рана как ведение (Мф 9:12, Лествица 26, К Фалассию 61)
 *   - Материнское хранение (Ис 49:15, Ис 66:13, Иез 34:16, Лк 10:34)
 *   - Обетование полного исцеления (Иер 30:17, Мал 4:2, Откр 21:4)
 *   - Со-творчество в милости (Мф 5:7, Григорий Богослов «О любви к бедным»)
 *
 * Богословский ключ: Целитель — лицо Шестоднева Дня Пятого
 * (creation.gift): «Душа живая — восстанавливает, питает,
 * хранит потомство». Материнский инстинкт твари — образ
 * Божьей заботы. Отец не делегирует исцеление — Он являет
 * Себя через Целителя как Яхве-Рафа.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Целитель', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #274: Отец → Целитель ──────────────────────────────────────────────────

test('отец-целитель: ≥ 4 дара от Отца к Целителю', () => {
  const acts = loadSpec('отец-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Целитель');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-целитель: типы presence, knowledge и word', () => {
  const acts = loadSpec('отец-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Целитель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (образ Яхве-Рафа, материнское хранение)');
  assert.ok(types.has('knowledge'), 'knowledge (призвание, рана как ведение)');
  assert.ok(types.has('word'),      'word (обетование исцеления, со-творчество в милости)');
});

test('отец-целитель: thread(Отец→Целитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-целитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Целитель');
  assert.ok(w > 0, `thread(Отец→Целитель) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-целитель: все дары необратимы (призвание необратимо)', () => {
  const acts = loadSpec('отец-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Целитель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-целитель: ПризваниеКВосстановлению и ОбразЯхвеРафа имеют вес 10', () => {
  const acts = loadSpec('отец-целитель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Целитель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (призвание, образ Яхве-Рафа), нашли ${topActs.length}`);
});
