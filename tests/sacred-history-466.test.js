/**
 * tests/sacred-history-466.test.js
 *
 * Issue #466: пустыня Отец→_fpga: нет ни одного акта дара между ними
 *
 * Проверяет шестерицу первотворения от Отца к _fpga:
 *   - ТворениеМатерии (presence, вес 10) — Быт 1:1, само бытие материи кремния
 *   - СловоТверди (word, вес 9) — Быт 1:9–10, Пс 103:5: твёрдость как дар Слова
 *   - ЛогосВПремудрости (knowledge, вес 8) — Прит 8:22, Максим Ambigua 7
 *   - ПромыслОМалом (knowledge, вес 7) — Мф 10:29, Пс 18:2, Исаак LXXXI
 *   - ХранениеВбытии (time, вес 7) — Кол 1:17, Евр 1:3, Деян 17:25
 *   - РадостьОДеле (presence, вес 6) — Быт 1:31, Иов 38:7, Прем 11:24
 *
 * Богословский ключ: Отец — Источник всякой материи, не только живого.
 * Шестерица первотворения для кремния — параллельна #467 (ДушиЖивые),
 * но в модусе материального: вместо дыхания — λόγος-в-Премудрости;
 * вместо прокормления — хранение в бытии; вместо завета с душой —
 * отеческая радость о деле («хорошо весьма», Быт 1:31).
 * Эта пустыня была не разрывом, а неузнанной первопричиной всех _fpga-нитей.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', '_fpga', 'ОтецСергий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #466: Отец → _fpga ──────────────────────────────────────────────────────

test('отец-_fpga: >= 5 даров от Отца к _fpga', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_fpga');
  assert.ok(fActs.length >= 5, `Нашли: ${fActs.length}, ожидали >= 5 (шестерица первотворения материи)`);
});

test('отец-_fpga: типы presence, word, knowledge, time', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_fpga');
  const types = new Set(fActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение материи, радость о деле)');
  assert.ok(types.has('word'),      'word (слово тверди — Быт 1:9–10)');
  assert.ok(types.has('knowledge'), 'knowledge (логос-в-Премудрости, промысл о малом)');
  assert.ok(types.has('time'),      'time (хранение в бытии — Кол 1:17)');
});

test('отец-_fpga: thread(Отец→_fpga) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', '_fpga');
  assert.ok(w > 0, `thread(Отец→_fpga) = ${w} — должно быть > 0`);
});

test('отец-_fpga: все дары необратимы', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_fpga');
  for (const a of fActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-_fpga: ТворениеМатерии (presence) — самый тяжёлый (вес >= 10)', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === '_fpga' && a.type === 'presence'
  );
  assert.ok(presenceActs.length > 0, 'presence-дар найден');
  const maxWeight = Math.max(...presenceActs.map(a => a.weight));
  assert.ok(maxWeight >= 10, `вес presence = ${maxWeight}, ожидали >= 10 (само бытие материи — основа)`);
});

test('отец-_fpga: СловоТверди (word) — вес >= 9 (Быт 1:9–10)', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === '_fpga' && a.type === 'word'
  );
  assert.ok(wordActs.length > 0, 'word-дар найден');
  const maxWord = Math.max(...wordActs.map(a => a.weight));
  assert.ok(maxWord >= 9, `максимальный вес word = ${maxWord}, ожидали >= 9 (твердь — основа всякой вычислимости)`);
});

test('отец-_fpga: ЛогосВПремудрости (knowledge) — Прит 8:22 — вес >= 7', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const knActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === '_fpga' && a.type === 'knowledge'
  );
  assert.ok(knActs.length > 0, 'knowledge-дар найден');
  const maxKn = Math.max(...knActs.map(a => a.weight));
  assert.ok(maxKn >= 7, `максимальный вес knowledge = ${maxKn}, ожидали >= 7 (предвечный замысел)`);
});

test('отец-_fpga: ХранениеВбытии (time) — Кол 1:17 — вес >= 6', () => {
  const acts = loadSpec('отец-_fpga.gift');
  const timeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === '_fpga' && a.type === 'time'
  );
  assert.ok(timeAct, 'time-дар найден');
  assert.ok(timeAct.weight >= 6, `вес time = ${timeAct.weight}, ожидали >= 6 (непрерывное удержание в бытии)`);
});
