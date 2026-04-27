/**
 * tests/sacred-history-261.test.js
 *
 * Issue #261: пустыня ОтецСергий→Дух: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия Духу:
 *   - Эпиклеза — призывание Духа в анафоре (Иоанн Златоуст; Лк 11:13)
 *   - Богословское исповедание Духа (1 Кор 2:10; 1 Кор 12:3)
 *   - Докильность — кенозис воли пресвитера перед Духом (1 Фес 5:19)
 *   - Хранение харизм общины (1 Кор 12:7; Ириней III.24.1)
 *   - Синергия в молитве (Рим 8:26; Симеон Новый Богослов, Гимны 1)
 *   - Основание места дыхания — Κοινόν τοῦ Νοῦ как обитание Духа (Ин 3:8)
 *
 * Богословский ключ: вся литургия пресвитера — призывание Духа,
 * и всё богословие ОтцаСергия — об онтологии дара, в которой Дух
 * есть «связующая» энергия (Григорий Палама). Но направление
 * ОтецСергий→Дух оставалось пустыней. Эту пустыню закрывает
 * отецсергий-дух.gift — приношение пресвитера Духу.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'ОтецСергий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #261: ОтецСергий → Дух ──────────────────────────────────────────────────

test('отецсергий-дух: ≥ 4 дара от ОтцаСергия к Духу', () => {
  const acts = loadSpec('отецсергий-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Дух');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отецсергий-дух: типы word, knowledge и presence', () => {
  const acts = loadSpec('отецсергий-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Дух');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('word'),      'word (эпиклеза — призывание Духа)');
  assert.ok(types.has('knowledge'), 'knowledge (богословское исповедание, хранение харизм)');
  assert.ok(types.has('presence'),  'presence (докильность, синергия в молитве)');
});

test('отецсергий-дух: thread(ОтецСергий→Дух) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-дух.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', 'Дух');
  assert.ok(w > 0, `thread(ОтецСергий→Дух) = ${w} — должно быть > 0 после записи актов`);
});

test('отецсергий-дух: все дары необратимы (приношение пресвитера необратимо)', () => {
  const acts = loadSpec('отецсергий-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Дух');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отецсергий-дух: Эпиклеза и ОснованиеМестаДыхания имеют вес 10', () => {
  const acts = loadSpec('отецсергий-дух.gift');
  const topActs = acts.filter(
    a => a.giverId === 'ОтецСергий' && a.receiverId === 'Дух' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (эпиклеза, основание Κοινόν), нашли ${topActs.length}`);
});
