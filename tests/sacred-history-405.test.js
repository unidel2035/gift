/**
 * tests/sacred-history-405.test.js
 *
 * Issue #405: пустыня Отец→КогоТо: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца КомуТо (отеческая пятерица для безымянного):
 *   - Бытие Безымянного (Деян 17:26–28, Иер 1:5, Максим Ambigua 7)
 *   - Имя на небесах (Лк 10:20, Откр 2:17, 2 Тим 2:19, Ис 43:1)
 *   - Взгляд помнящий (Лк 12:6–7, Пс 138:16, Ис 49:15–16, Исаак Сирин 81)
 *   - Промысл о найденности (Лк 15:4, Лк 19:10, Мф 18:14, 2 Пет 3:9)
 *   - Долготерпение до встречи (2 Пет 3:9, Лк 15:20, Откр 21:3)
 *
 * Богословский ключ: КогоТо — онтологическая категория всякого незнакомого,
 * безымянного, ещё не вошедшего в общину. ОтецСергий→КогоТо (#152, #167)
 * закрыл пастырский ответ — молитву за безымянных, поиск потерявшейся овцы.
 * Отец→КогоТо закрывает онтологическое основание: бытие даровано прежде
 * имени, имя записано в Книге Жизни прежде матрицы, взгляд помнит до последнего
 * волоса, промысл движется к найденности, долготерпение длится до встречи.
 * Эту пустыню закрывает отец-когото.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'КогоТо', 'ОтецСергий', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #405: Отец → КогоТо ──────────────────────────────────────────────

test('отец-когото: ≥ 5 даров от Отца к КогоТо (отеческая пятерица для безымянного)', () => {
  const acts = loadSpec('отец-когото.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('отец-когото: типы presence, word, knowledge, time', () => {
  const acts = loadSpec('отец-когото.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (бытие безымянного — Деян 17:28)');
  assert.ok(types.has('word'),      'word (имя на небесах — Лк 10:20, Откр 2:17)');
  assert.ok(types.has('knowledge'), 'knowledge (взгляд помнящий + промысл — Лк 12:7, Лк 15:4)');
  assert.ok(types.has('time'),      'time (долготерпение до встречи — 2 Пет 3:9)');
});

test('отец-когото: thread(Отец→КогоТо) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-когото.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'КогоТо');
  assert.ok(w > 0, `thread(Отец→КогоТо) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-когото: все дары необратимы (промысл Отца необратим)', () => {
  const acts = loadSpec('отец-когото.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-когото: ≥ 1 акт веса 10 (долготерпение до встречи — самое тяжёлое)', () => {
  const acts = loadSpec('отец-когото.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'КогоТо' && a.weight === 10,
  );
  assert.ok(topActs.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (долготерпение), нашли ${topActs.length}`);
});

test('отец-когото: акт time существует и весит 10 (μακροθυμία — 2 Пет 3:9)', () => {
  const acts = loadSpec('отец-когото.gift');
  const timeActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'КогоТо' && a.type === 'time',
  );
  assert.ok(timeActs.length >= 1, 'Должен быть хотя бы один акт типа time');
  assert.ok(timeActs.every(a => a.weight === 10),
    'Все акты time должны весить 10 (долготерпение — самый тяжёлый дар)');
});

test('отец-когото: суммарный вес нити ≥ 35 (полноценная отеческая пятерица)', () => {
  const acts = loadSpec('отец-когото.gift');
  const sum = acts
    .filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо')
    .reduce((s, a) => s + a.weight, 0);
  assert.ok(sum >= 35, `Сумма весов = ${sum}, ожидалось ≥ 35`);
});
