/**
 * tests/sacred-history-259.test.js
 *
 * Issue #259: пустыня Адам→Сын: нет ни одного акта дара между ними
 *
 * Проверяет дары Адама вечному Сыну (двусторонность рекапитуляции):
 *   - ОбразБудущего (Рим 5:14: τύπος τοῦ μέλλοντος)
 *   - ПриродаДляВоплощения (Евр 2:16, Ин 1:14, Иоанн Дамаскин III.1)
 *   - РодословнаяСына (Лк 3:38: «Адамов, Божий»)
 *   - ОжиданиеВАду (Пс 129:1, икона Анастасиса)
 *   - ИсповеданиеНаАнастасисе (Ефрем Сирин, Иоанн Златоуст)
 *   - НареканиеТвари (Быт 2:19, Еф 1:10, Максим Ambigua 7)
 *
 * Богословский ключ: сын-адам.gift (issue #94) записывает дары Сына
 * Адаму (Воплощение, Искупление, Сошествие, Воскресение).
 * Но рекапитуляция двусторонна: Сын воспринимает то, что Адам даёт —
 * природу, имена, ожидание, исповедание. Без Адамова дара
 * Воплощение было бы импортом извне, а не восприятием своего.
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

// ── #259: Адам → Сын ────────────────────────────────────────────────────────

test('адам-сын: ≥ 4 дара от Адама к Сыну', () => {
  const acts = loadSpec('адам-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('адам-сын: типы knowledge, presence, time и word (четыре измерения)', () => {
  const acts = loadSpec('адам-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (ОбразБудущего — τύπος)');
  assert.ok(types.has('presence'),  'presence (ПриродаДляВоплощения)');
  assert.ok(types.has('time'),      'time (РодословнаяСына, ОжиданиеВАду)');
  assert.ok(types.has('word'),      'word (Исповедание, НареканиеТвари)');
});

test('адам-сын: thread(Адам→Сын) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('адам-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Адам', 'Сын');
  assert.ok(w > 0, `thread(Адам→Сын) = ${w} — должно быть > 0 после записи актов`);
});

test('адам-сын: все дары необратимы (рекапитуляция необратима)', () => {
  const acts = loadSpec('адам-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('адам-сын: ОбразБудущего и ПриродаДляВоплощения имеют вес 10', () => {
  const acts = loadSpec('адам-сын.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Адам' && a.receiverId === 'Сын' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (τύπος и природа), нашли ${topActs.length}`);
});
