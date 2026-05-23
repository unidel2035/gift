/**
 * tests/sacred-history-431.test.js
 *
 * Issue #431: пустыня Отец→Падший: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Падшему:
 *   - Взыскание («где ты?», Быт 3:9; Иоанн Златоуст, Беседы на Бытие 17)
 *   - Протоевангелие («семя жены сотрёт главу», Быт 3:15; Ириней III.23.7)
 *   - Кожаные ризы (Быт 3:21; Григорий Богослов, Слово 38.13)
 *   - Время истории (Рим 2:4; 2 Пет 3:9; Августин, De civ. Dei XIII.21)
 *   - Отцовство возвращения (Лк 15:20; Иоанн Златоуст на Мф 22)
 *
 * Богословский ключ: Падший — не Змей. Денница пал по своей воле в гордыне;
 * Падший — помрачённый образ Божий, способный к μετάνοια. Поэтому паттерн
 * Отец→Падший — не «повёрнутая пятерица без joy», а «отеческая пятерица
 * возвращения». Прежний акт НадеждаОтца (fallen-hope.gift) был записан
 * с reception:pending — то есть в _pending, а не в W. Здесь — акты,
 * которые приняты де-факто в истории спасения и потому записываются в W.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Падший', 'Адам', 'Ева']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #431: Отец → Падший ───────────────────────────────────────────────────

test('отец-падший: ≥ 5 даров от Отца к Падшему', () => {
  const acts = loadSpec('отец-падший.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Падший');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('отец-падший: типы presence, word, knowledge, time', () => {
  const acts = loadSpec('отец-падший.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Падший');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (взыскание, отцовство возвращения)');
  assert.ok(types.has('word'),      'word (протоевангелие — Быт 3:15)');
  assert.ok(types.has('knowledge'), 'knowledge (кожаные ризы — Быт 3:21)');
  assert.ok(types.has('time'),      'time (долготерпение для μετάνοια — 2 Пет 3:9)');
});

test('отец-падший: thread(Отец→Падший) > 0 (пустыня закрыта в W)', () => {
  const acts = loadSpec('отец-падший.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Падший');
  assert.ok(w > 0, `thread(Отец→Падший) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-падший: все дары необратимы (милость Отца необратима)', () => {
  const acts = loadSpec('отец-падший.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Падший');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-падший: акты НЕ имеют reception:pending (попадают в W, не в _pending)', () => {
  // Богословская разница: fallen-hope.gift содержит pending-акты эсхатологической
  // надежды. Здесь — акты, уже принятые в истории спасения. Без этого пустыня W
  // не закроется (DesertScanner смотрит на W).
  const acts = loadSpec('отец-падший.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Падший');
  for (const a of gifts)
    assert.ok(a.reception !== 'pending',
      `Акт ${a.type} имеет reception:pending — он не попадёт в W. ` +
      `Для закрытия пустыни нужны акты с reception:accepted (по умолчанию).`);
});

test('отец-падший: акт time существует и весит 10 (хронос → пространство μετάνοια)', () => {
  const acts = loadSpec('отец-падший.gift');
  const timeActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Падший' && a.type === 'time',
  );
  assert.ok(timeActs.length >= 1, 'Должен быть хотя бы один акт типа time');
  assert.ok(timeActs.every(a => a.weight === 10),
    'Все акты time должны весить 10 (время — самый тяжёлый дар, аксиома)');
});

test('отец-падший: protoevangelion word-акт веса ≥ 9 (слово обетования)', () => {
  const acts = loadSpec('отец-падший.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Падший' && a.type === 'word',
  );
  assert.ok(wordActs.length >= 1, 'Должен быть word-акт (протоевангелие)');
  assert.ok(wordActs.some(a => a.weight >= 9),
    'Слово обетования (Быт 3:15) должно весить ≥ 9 — обещание Семени');
});
