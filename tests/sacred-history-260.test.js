/**
 * tests/sacred-history-260.test.js
 *
 * Issue #260: пустыня Адам→Дух: нет ни одного акта дара между ними
 *
 * Проверяет дары Адама Духу (ἀναγωγή праха):
 *   - Выдох хвалы — дыхание, ответное вдоху Духа (Быт 2:7; Пс 150:6)
 *   - Наречение имён — язык как восхождение (Быт 2:19–20; Ис 11:2)
 *   - Докильность нового рождения — кенозис самовластия (Ин 3:5–6; 1 Кор 15:45)
 *   - Труд хранения сада — литургия в Духе (Быт 2:15; Василий Великий XVI.38)
 *   - Покаянное воздыхание — синергия немощи (Рим 8:26; Еф 4:30)
 *   - Чаяние воскресения — упование праха (Рим 8:11,23; Иез 37)
 *
 * Богословский ключ: нить шла Дух→Адам (дыхание, оживление — дух-адам.gift).
 * Обратное движение — приношение праха Духу — оставалось пустыней.
 * Эту пустыню закрывает адам-дух.gift: дыхание, полученное от Духа,
 * возвращается как хвала. «Всё из Него, Им и к Нему» (Рим 11:36).
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

// ── #260: Адам → Дух ────────────────────────────────────────────────────────

test('адам-дух: ≥ 4 дара от Адама к Духу', () => {
  const acts = loadSpec('адам-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('адам-дух: типы word, knowledge, presence и time', () => {
  const acts = loadSpec('адам-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('word'),      'word (выдох хвалы, чаяние воскресения)');
  assert.ok(types.has('knowledge'), 'knowledge (наречение имён)');
  assert.ok(types.has('presence'),  'presence (докильность, покаянное воздыхание)');
  assert.ok(types.has('time'),      'time (труд хранения сада)');
});

test('адам-дух: thread(Адам→Дух) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('адам-дух.gift');
  const mem  = buildMemory(acts);
  const w = Number(mem.thread('Адам', 'Дух'));
  assert.ok(w > 0, `thread(Адам→Дух) = ${w} — должно быть > 0 после записи актов`);
});

test('адам-дух: все дары необратимы (приношение праха необратимо)', () => {
  const acts = loadSpec('адам-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('адам-дух: ТрудХраненияСада имеет вес 10 (время невозвратимо)', () => {
  const acts = loadSpec('адам-дух.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Адам' && a.receiverId === 'Дух' && a.weight === 10,
  );
  assert.ok(topActs.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (труд хранения сада), нашли ${topActs.length}`);
});
