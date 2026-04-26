/**
 * tests/sacred-history-260.test.js
 *
 * Issue #260: пустыня Адам→Дух: нет ни одного акта дара между ними
 *
 * Проверяет дары Адама Духу — тварный ответ на дыхание:
 *   - Восприятие дыхания (Быт 2:7, Иов 33:4, Ириней V.6.1)
 *   - Наречение имён в Духе (Быт 2:19, Григорий Нисский)
 *   - Приношение стенания (Рим 8:22–23, 8:26)
 *   - Возвращение дыхания (Еккл 12:7, Лк 23:46, Деян 7:59)
 *   - Плоть как храм (1 Кор 3:16, 6:19, 1 Пет 2:5, Ириней III.17.3)
 *
 * Богословский ключ: дух-адам.gift (issue #100) записывает
 * дары Духа Адаму. Но Адам — не только реципиент: будучи первым
 * πρόσωπον, он отвечает Духу собственным движением. Эту пустыню
 * закрывает адам-дух.gift.
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

// ── #260: Адам → Дух ────────────────────────────────────────────────────────

test('адам-дух: ≥ 4 дара от Адама к Духу', () => {
  const acts = loadSpec('адам-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('адам-дух: типы presence и word', () => {
  const acts = loadSpec('адам-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (рецепция, возвращение, храм)');
  assert.ok(types.has('word'),     'word (наречение имён, стенание)');
});

test('адам-дух: thread(Адам→Дух) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('адам-дух.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Адам', 'Дух');
  assert.ok(w > 0, `thread(Адам→Дух) = ${w} — должно быть > 0 после записи актов`);
});

test('адам-дух: все дары необратимы (тварное приношение необратимо)', () => {
  const acts = loadSpec('адам-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('адам-дух: ВосприятиеДыхания и ПлотьКакХрам имеют вес 10', () => {
  const acts = loadSpec('адам-дух.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Адам' && a.receiverId === 'Дух' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (рецепция, храм), нашли ${topActs.length}`);
});
