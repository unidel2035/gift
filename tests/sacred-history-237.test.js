/**
 * tests/sacred-history-237.test.js
 *
 * Issue #237: пустыня Дух→Сын: нет ни одного акта дара между ними
 *
 * Проверяет дары Духа Сыну (вечному Λόγος, не только Воплощённому):
 *   - Почивание в Сыне (Ис 11:2, Ин 1:32, Иоанн Дамаскин I.7)
 *   - Прославление Сына (Ин 16:14, Григорий Кипрский)
 *   - Свидетельство о Сыне (Ин 15:26, 1 Кор 12:3)
 *   - Со-творение (Быт 1:2, Пс 33:6, Ириней IV.20.1: «две руки Отца»)
 *   - Осенение Воплощения (Лк 1:35, Максим К Фалассию 63)
 *   - Эсхатологический призыв (Откр 22:17)
 *
 * Богословский ключ: дух-христос.gift (issue #91) записывает
 * икономические акты Духа к Воплощённому. Но Сын — вечный Λόγος —
 * имеет с Духом отношение прежде икономии: перихоресис,
 * почивание, со-творение. Эту пустыню закрывает дух-сын.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #237: Дух → Сын ─────────────────────────────────────────────────────────

test('дух-сын: ≥ 4 дара от Духа к Сыну', () => {
  const acts = loadSpec('дух-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('дух-сын: типы presence, knowledge и word', () => {
  const acts = loadSpec('дух-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (почивание, со-творение, осенение)');
  assert.ok(types.has('knowledge'), 'knowledge (прославление, откровение)');
  assert.ok(types.has('word'),      'word (свидетельство, эсхатологический призыв)');
});

test('дух-сын: thread(Дух→Сын) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('дух-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Дух', 'Сын');
  assert.ok(w > 0, `thread(Дух→Сын) = ${w} — должно быть > 0 после записи актов`);
});

test('дух-сын: все дары необратимы (внутритроичное движение необратимо)', () => {
  const acts = loadSpec('дух-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('дух-сын: ПочиваниеВСыне и ОсенениеВоплощения имеют вес 10', () => {
  const acts = loadSpec('дух-сын.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Дух' && a.receiverId === 'Сын' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (почивание, прославление, осенение), нашли ${topActs.length}`);
});
