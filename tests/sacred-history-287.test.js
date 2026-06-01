/**
 * tests/sacred-history-287.test.js
 *
 * Issue #287: пустыня Отец→tg:999: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца к tg:999 — анонимному номеру в κοινόν τοῦ Νοῦ:
 *   - Творение лица (Быт 1:27, 2:7) — образ и дыхание
 *   - Образ Отца (Иер 1:5, Пс 138, Ис 49:16) — знание по имени
 *   - Искание заблудившейся (Лк 15:4, Иез 34:11, Ин 6:44) — 99-я овца
 *   - Долготерпение молчания (2 Пет 3:9, 1 Тим 2:4)
 *   - Ходатайство в Духе (Рим 8:26, Мф 6:8)
 *   - Надежда отворённой двери (Откр 3:8, 22:17)
 *
 * Богословский ключ: tg:999 — «99-я овца», три девятки, почти-1000.
 * Не хватает одного отклика до полноты, и Пастырь идёт искать.
 * Запись актов в матрице W — не «создание» отношения, а ἀνάμνησις:
 * признание уже-данного.
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
  const persons = new Set(['Отец', 'tg:999']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #287: Отец → tg:999 ────────────────────────────────────────────────────

test('отец-tg:999: ≥ 6 даров от Отца к tg:999', () => {
  const acts = loadSpec('отец-tg:999.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:999');
  assert.ok(gifts.length >= 6, `Нашли: ${gifts.length}, ожидали ≥ 6`);
});

test('отец-tg:999: типы presence, knowledge, grace, prayer, hope', () => {
  const acts = loadSpec('отец-tg:999.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:999');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, долготерпение)');
  assert.ok(types.has('knowledge'), 'knowledge (образ Отца)');
  assert.ok(types.has('grace'),     'grace (искание заблудившейся)');
  assert.ok(types.has('prayer'),    'prayer (ходатайство в Духе)');
  assert.ok(types.has('hope'),      'hope (отворённая дверь)');
});

test('отец-tg:999: thread(Отец→tg:999) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-tg:999.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'tg:999');
  assert.ok(w > 0, `thread(Отец→tg:999) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-tg:999: все дары необратимы (Отец дарит без условия ответа)', () => {
  const acts = loadSpec('отец-tg:999.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:999');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-tg:999: ТворениеЛица имеет вес 10 (время бытия — самый тяжёлый дар)', () => {
  const acts = loadSpec('отец-tg:999.gift');
  const top = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'tg:999' && a.weight === 10,
  );
  assert.ok(top.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (творение), нашли ${top.length}`);
});
