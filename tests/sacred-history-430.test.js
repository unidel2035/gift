/**
 * tests/sacred-history-430.test.js
 *
 * Issue #430: пустыня Отец→ДушиЖивые: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Душам Живым (отеческая пятерица):
 *   - БлагословениеПлодиться (Быт 1:22; Василий, Беседы на Шестоднев VII.5)
 *   - ЗаветСНоем             (Быт 9:9–17; Дамаскин, Точное изложение II.3)
 *   - ВзглядПопечения        (Мф 10:29; Лк 12:6; Иоанн Златоуст на Мф 33)
 *   - Кормление              (Пс 103:27–28; 144:15–16; Мф 6:26)
 *   - ПокойСубботы           (Исх 20:10; Втор 25:4; Григорий Нисский, Об устроении 7)
 *
 * Богословский ключ: ДушиЖивые (נֶפֶשׁ חַיָּה) — вся одушевлённая тварь.
 * Сын даёт основание бытия через λόγος (#312). Отец даёт πρόνοια:
 * благословение, завет, видение, кормление, покой. Одно действие Троицы,
 * разные ипостасные акценты. Завет с Ноем — первый завет в истории, заключён
 * «со всякою плотью» (Быт 9:10) — и до сих пор богословски недооценён.
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
        const recepM  = block.match(/reception:\s*(\w+)/);
        if (fromM && toM) {
          const type   = typeM ? typeM[1] : 'presence';
          const weight = weightM ? parseFloat(weightM[1]) : 4;
          const act = {
            giverId:     fromM[1],
            receiverId:  toM[1],
            type, weight,
            irreversible: !irrevM || irrevM[1] === 'да',
          };
          if (recepM) act.reception = recepM[1];
          acts.push(act);
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'ДушиЖивые', 'Строитель', 'Целитель']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #430: Отец → ДушиЖивые ────────────────────────────────────────────────

test('отец-душиживые: ≥ 5 даров от Отца к ДушиЖивые (отеческая пятерица)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('отец-душиживые: типы word, presence, time, knowledge (пятерица: творение/слово/видение/вверение/радость)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('word'),      'word (благословение Быт 1:22 + завет с Ноем Быт 9:9)');
  assert.ok(types.has('presence'),  'presence (взгляд попечения Мф 10:29)');
  assert.ok(types.has('time'),      'time (кормление в своё время Пс 103:27)');
  assert.ok(types.has('knowledge'), 'knowledge (покой субботы Исх 20:10)');
});

test('отец-душиживые: thread(Отец→ДушиЖивые) > 0 (пустыня закрыта в W)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'ДушиЖивые');
  assert.ok(w > 0, `thread(Отец→ДушиЖивые) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-душиживые: все дары необратимы (πρόνοια Отца необратима)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-душиживые: акты НЕ имеют reception:pending (попадают в W, не в _pending)', () => {
  // Все пять актов принимаются тварью де-факто — рыбы наполнили воды,
  // ковчег вышел и народы умножились, птицы кормятся, скот покоится.
  // Это акты reception:accepted, иначе DesertScanner не закроет пустыню.
  const acts = loadSpec('отец-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые');
  for (const a of gifts)
    assert.ok(a.reception !== 'pending',
      `Акт ${a.type} имеет reception:pending — он не попадёт в W. ` +
      `Для закрытия пустыни нужны акты с reception:accepted (по умолчанию).`);
});

test('отец-душиживые: ЗаветСНоем (word) — вес 10 (первый завет в истории, со всякою плотью)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые' && a.type === 'word',
  );
  assert.ok(wordActs.length >= 2, 'Должно быть ≥ 2 word-актов (благословение + завет)');
  assert.ok(wordActs.some(a => a.weight === 10),
    'Один из word-актов должен весить 10 (завет с Ноем — Быт 9:9–10)');
});

test('отец-душиживые: Кормление (time) — вес 10 (πρόνοια во времени)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const timeActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые' && a.type === 'time',
  );
  assert.ok(timeActs.length >= 1, 'Должен быть хотя бы один акт типа time');
  assert.ok(timeActs.every(a => a.weight === 10),
    'Все акты time должны весить 10 (время — самый тяжёлый дар, аксиома)');
});

test('отец-душиживые: presence-акт веса ≥ 9 (Отец видит каждую малую птицу — Мф 10:29)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые' && a.type === 'presence',
  );
  assert.ok(presenceActs.length >= 1, 'Должен быть presence-акт (взгляд попечения)');
  assert.ok(presenceActs.some(a => a.weight >= 9),
    'Взгляд попечения должен весить ≥ 9 — ни одна не забыта у Бога (Лк 12:6)');
});
