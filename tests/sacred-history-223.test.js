/**
 * tests/sacred-history-223.test.js
 *
 * Issue #223: пустыня Христос→Адам: нет ни одного акта дара между ними
 *
 * Проверяет дары Воплощённого Христа Адаму (отличая от сын-адам.gift,
 * issue #94, который записывает дары вечного Сына через икономию):
 *   - Анастасис как касание (1 Пет 3:19, иконография Воскресения)
 *   - Братство по плоти (Евр 2:11–14, Лк 3:38)
 *   - Прославленная плоть как Второй Адам (1 Кор 15:45–49, Афанасий О воплощении 9)
 *   - Проповедь в темнице (1 Пет 3:18–19, 4:6, Иоанн Дамаскин III.27)
 *   - Евхаристия как пища Адама (Ин 6:50–58, Кавасила О жизни во Христе IV.4)
 *   - Адам в родословии (Лк 3:38, Григорий Богослов Слово 45.22)
 *   - Ключи ада и смерти (Откр 1:18, Ефрем Сирин Гимны на Воскресение IX)
 *
 * Богословский ключ: Сын как вечное Слово даёт Адаму через Воплощение
 * (сын-адам.gift). Христос — Сын в прославленной плоти — даёт Адаму
 * то, что возможно только в Богочеловеке: касание воскресшей руки,
 * братство по плоти и крови, Евхаристия. Пустыня — не отсутствие связи,
 * а незаписанная человечность Бога, обращённая к первочеловеку.
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

// ── #223: Христос → Адам ────────────────────────────────────────────────────

test('христос-адам: ≥ 5 даров от Христа к Адаму', () => {
  const acts = loadSpec('христос-адам.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Адам');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('христос-адам: типы presence, knowledge, word и time', () => {
  const acts = loadSpec('христос-адам.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Адам');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (касание Анастасиса, братство, Евхаристия)');
  assert.ok(types.has('knowledge'), 'knowledge (Второй Адам, родословие)');
  assert.ok(types.has('word'),      'word (проповедь в темнице)');
  assert.ok(types.has('time'),      'time (ключи ада и смерти)');
});

test('христос-адам: thread(Христос→Адам) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-адам.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Адам');
  assert.ok(w > 0, `thread(Христос→Адам) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-адам: все дары необратимы (Воплощение и Воскресение необратимы)', () => {
  const acts = loadSpec('христос-адам.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Адам');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-адам: ≥ 3 акта веса 10 (касание, братство, Второй Адам)', () => {
  const acts = loadSpec('христос-адам.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Адам' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (Анастасис, братство, Второй Адам), нашли ${topActs.length}`);
});
