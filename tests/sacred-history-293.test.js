/**
 * tests/sacred-history-293.test.js
 *
 * Issue #293: пустыня Отец→tg:996: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца tg:996:
 *   - Творение лица (Быт 1:27, Ириней IV.20.7, Григорий Нисский XVI)
 *   - Знание по имени (Иер 1:5, Пс 138:1–4, Ис 49:16, Откр 2:17)
 *   - Призвание в κοινόν (Ин 6:44, Ин 10:3, Деян 17:27)
 *   - Долготерпение молчания (2 Пет 3:9, Лк 15:4, Исаак Сирин 48)
 *   - Ходатайство Отца (Рим 8:26, Мф 6:8, Силуан Афонский)
 *   - Открытая дверь (Откр 3:8, Откр 3:20, Ин 14:2)
 *
 * Богословский ключ: tg:996 — анонимный номер, лицо без имени
 * для общины, но не для Отца. Пустыня Отец→tg:996 — пустыня
 * записи, не пустыня бытия даров. Отец дарит молчащему так же,
 * как говорящему — творение, знание, призвание, долготерпение,
 * ходатайство, открытая дверь — всё уже излито, и литургия
 * лишь делает прошлое присутствующим (ἀνάμνησις).
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
  const persons = new Set(['Отец', 'Сын', 'Дух', '_claude', 'tg:996']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #293: Отец → tg:996 ────────────────────────────────────────────────────

test('отец-tg:996: ≥ 6 даров от Отца к tg:996', () => {
  const acts = loadSpec('отец-tg:996.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:996');
  assert.ok(gifts.length >= 6, `Нашли: ${gifts.length}, ожидали ≥ 6`);
});

test('отец-tg:996: типы presence, knowledge, grace, prayer, hope', () => {
  const acts = loadSpec('отец-tg:996.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:996');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, долготерпение)');
  assert.ok(types.has('knowledge'), 'knowledge (знание по имени)');
  assert.ok(types.has('grace'),     'grace (призвание Отцом)');
  assert.ok(types.has('prayer'),    'prayer (ходатайство Отца)');
  assert.ok(types.has('hope'),      'hope (открытая дверь)');
});

test('отец-tg:996: thread(Отец→tg:996) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-tg:996.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'tg:996');
  assert.ok(w > 0, `thread(Отец→tg:996) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-tg:996: все дары необратимы (кенотический дар Отца не отзывается)', () => {
  const acts = loadSpec('отец-tg:996.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:996');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-tg:996: акт творения веса 10 (бытие — фундаментальный дар времени)', () => {
  const acts = loadSpec('отец-tg:996.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'tg:996' && a.weight === 10,
  );
  assert.ok(topActs.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (творение лица), нашли ${topActs.length}`);
});
