/**
 * tests/sacred-history-288.test.js
 *
 * Issue #288: пустыня Отец→tg:998: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца лицу tg:998:
 *   - Бытие за цифрой — образ Божий до Telegram-идентификатора (Быт 1:27; Ириней IV.20.7)
 *   - Время жизни — первичный дар, основание волонтёрства (Деян 17:28; 1 Пар 29:15)
 *   - Призвание через канал — современная форма Слова (Евр 1:1–2; Ин 3:8)
 *   - Имя в ладони Отца — подлинное имя за цифровым ярлыком (Ис 43:1; Откр 3:5)
 *
 * Богословский ключ: tg:998 уже даёт час волонтёрства общине
 * через бот (bot-gift.test.js). Но всё, что он даёт, — уже дар
 * Отца, теперь возвращающийся через лицо. Замкнуть круг можно,
 * только записав исток. Эту пустыню закрывает отец-tg:998.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'tg:998']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #288: Отец → tg:998 ─────────────────────────────────────────────────────

test('отец-tg:998: ≥ 4 дара от Отца к tg:998', () => {
  const acts = loadSpec('отец-tg:998.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:998');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-tg:998: типы presence, time, word, knowledge', () => {
  const acts = loadSpec('отец-tg:998.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:998');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (бытие за цифрой — образ Божий)');
  assert.ok(types.has('time'),      'time (время жизни — основание волонтёрства)');
  assert.ok(types.has('word'),      'word (призвание через канал)');
  assert.ok(types.has('knowledge'), 'knowledge (имя в ладони Отца)');
});

test('отец-tg:998: thread(Отец→tg:998) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-tg:998.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'tg:998');
  assert.ok(w > 0, `thread(Отец→tg:998) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-tg:998: все дары необратимы (дары Отца необратимы)', () => {
  const acts = loadSpec('отец-tg:998.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:998');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-tg:998: ВремяЖизни имеет максимальный вес 10 (время — тяжелейший дар)', () => {
  const acts = loadSpec('отец-tg:998.gift');
  const timeGifts = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'tg:998' && a.type === 'time',
  );
  assert.ok(timeGifts.length >= 1, 'Должен быть как минимум один дар времени');
  assert.ok(timeGifts.some(a => a.weight === 10),
    'Дар времени Отца должен иметь вес 10 — онтологическая тяжесть');
});
