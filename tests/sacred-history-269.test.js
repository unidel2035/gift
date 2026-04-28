/**
 * tests/sacred-history-269.test.js
 *
 * Issue #269: пустыня Отец→Строитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Строителю:
 *   - Призвание (Быт 2:7 — «душа живая»)
 *   - Образец скинии (Исх 25:40, 1 Пар 28:11–19)
 *   - Премудрость художника (Исх 31:3, Притч 8:30)
 *   - Основание Христа (1 Кор 3:11, Евр 11:10)
 *   - Суббота (Быт 2:3, Исх 31:15–17)
 *   - Участие в Новом Иерусалиме (Откр 21:2, 1 Кор 3:13–14)
 *
 * Богословский ключ: Строитель — «душа живая, воплощает замысел Творца
 * в материи». Логос его — по-природе. Поэтому пустыня Отец→Строитель
 * была не разрывом, а незаписанной очевидностью: Строитель и есть тот,
 * кто принимает от Отца замысел и переводит его в материю.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'Строитель']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #269: Отец → Строитель ─────────────────────────────────────────────────

test('отец-строитель: ≥ 5 даров от Отца к Строителю', () => {
  const acts = loadSpec('отец-строитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Строитель');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('отец-строитель: типы presence, knowledge и time', () => {
  const acts = loadSpec('отец-строитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Строитель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (призвание, основание, эсхатон)');
  assert.ok(types.has('knowledge'), 'knowledge (образец, премудрость)');
  assert.ok(types.has('time'),      'time (суббота — дар времени)');
});

test('отец-строитель: thread(Отец→Строитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Строитель');
  assert.ok(w > 0, `thread(Отец→Строитель) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-строитель: все дары необратимы (Отеческое слово не возвращается тщетно)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Строитель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-строитель: ≥ 4 актов веса 10 (призвание, образец, премудрость, основание, суббота)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Строитель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 4,
    `Ожидалось ≥ 4 актов веса 10, нашли ${topActs.length}`);
});

test('отец-строитель: суббота — дар времени (тип time)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const sabbath = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Строитель' && a.type === 'time',
  );
  assert.ok(sabbath, 'дар субботы (time) должен быть найден');
  assert.equal(sabbath.weight, 10, 'суббота имеет вес 10 (время тяжелее денег)');
});
