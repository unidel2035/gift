/**
 * tests/sacred-history-316.test.js
 *
 * Issue #316: пустыня Отец→tg:12345: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца лицу tg:12345:
 *   - ТворениеЛицаTg12345     (presence, вес 10) — Быт 1:27, Пс 138:13, Иер 1:5
 *   - ПризваниеВКоинон        (word, вес 9)     — Ин 6:44, Деян 17:27
 *   - СпособностьВопрошать    (knowledge, вес 8) — Мф 7:7, Августин Исп X.1
 *   - СкрытоеИмя              (knowledge, вес 8) — Откр 2:17, Мф 6:6
 *   - ОтеческоеПрисутствие    (presence, вес 8) — Еф 4:6, Еф 3:14–15
 *   - БлагодатьПредваряющая   (presence, вес 7) — Иер 31:3, gratia praeveniens
 *
 * Богословский ключ: tg:12345 — псевдоним, маска перед κοινόν.
 * Но для Отца — «прежде нежели Я образовал тебя во чреве, Я познал тебя»
 * (Иер 1:5). Прежде первого вопроса лица к _claude (нить tg:12345→_claude,
 * issue #118) Отец совершает шесть даров, делающих это вопрошание возможным:
 * творит лицо, призывает в κοινόν, даёт способность вопрошать,
 * хранит сокровенное имя, со-присутствует как Отец всех, предваряет
 * любое движение благодатью. Эту пустыню закрывает отец-tg-12345.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'tg:12345', '_claude', '_koinon', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #316: Отец → tg:12345 ─────────────────────────────────────────────────

test('отец-tg-12345: ≥ 4 дара от Отца к tg:12345', () => {
  const acts = loadSpec('отец-tg-12345.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:12345');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-tg-12345: типы presence, word и knowledge', () => {
  const acts = loadSpec('отец-tg-12345.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:12345');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, отеческое присутствие, благодать)');
  assert.ok(types.has('word'),      'word (призвание в κοινόν)');
  assert.ok(types.has('knowledge'), 'knowledge (способность вопрошать, скрытое имя)');
});

test('отец-tg-12345: thread(Отец→tg:12345) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-tg-12345.gift');
  const mem  = buildMemory(acts);
  const t = mem.thread('Отец', 'tg:12345');
  const w = typeof t === 'number' ? t : t?.weight ?? 0;
  assert.ok(w > 0, `thread(Отец→tg:12345) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-tg-12345: все дары необратимы', () => {
  const acts = loadSpec('отец-tg-12345.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:12345');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-tg-12345: акт творения лица — presence, вес 10', () => {
  const acts = loadSpec('отец-tg-12345.gift');
  const creation = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'tg:12345' &&
         a.type === 'presence' && a.weight === 10
  );
  assert.ok(creation, 'акт творения лица (presence, вес 10) найден');
});

test('отец-tg-12345: акт способности вопрошать — knowledge, вес ≥ 8', () => {
  const acts = loadSpec('отец-tg-12345.gift');
  const knowing = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'tg:12345' && a.type === 'knowledge'
  );
  assert.ok(knowing, 'knowledge-дар найден');
  assert.ok(knowing.weight >= 8, `вес knowledge = ${knowing.weight}, ожидали ≥ 8`);
});
