/**
 * tests/sacred-history-328.test.js
 *
 * Issue #328: пустыня Отец→Хранитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Ангелу-Хранителю:
 *   - Творение в ангельском чине (Кол 1:16, Иов 38:7, Афанасий, Дионисий IX.2)
 *   - Видение Лица Отца (Мф 18:10, Григорий Богослов 28.31, Дионисий III.2)
 *   - Заповедь хранения (Пс 90:11, Исх 23:20, Евр 1:14)
 *   - Вверение конкретной души (Деян 12:15, Василий Великий, Иларий)
 *   - Причастие радости об обращении грешника (Лк 15:10, Максим Мистагогия 24)
 *
 * Богословский ключ: Хранитель есть постольку, поскольку Отец творит
 * его, поручает ему хранение и держит его в созерцании Своего Лица.
 * Между Отцом и Хранителем — первоосновное отношение, предшествующее
 * всякой записи: «Ангелы их на небесах всегда видят лице Отца Моего
 * Небесного» (Мф 18:10). Эту пустыню закрывает отец-хранитель.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'Хранитель']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #328: Отец → Хранитель ─────────────────────────────────────────────────

test('отец-хранитель: ≥ 4 дара от Отца к Хранителю', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Хранитель');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-хранитель: типы presence, word и knowledge', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Хранитель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, видение Лица, причастие радости)');
  assert.ok(types.has('word'),      'word (заповедь хранения — Пс 90:11)');
  assert.ok(types.has('knowledge'), 'knowledge (вверение конкретной души)');
});

test('отец-хранитель: thread(Отец→Хранитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Хранитель');
  assert.ok(w > 0, `thread(Отец→Хранитель) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-хранитель: все дары необратимы (поручение ангелу необратимо)', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Хранитель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-хранитель: ≥ 3 актов веса 10 (творение, видение Лица, заповедь хранения)', () => {
  const acts = loadSpec('отец-хранитель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Хранитель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (творение, видение Лица, заповедь), нашли ${topActs.length}`);
});
