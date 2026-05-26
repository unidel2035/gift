/**
 * tests/sacred-history-467.test.js
 *
 * Issue #467: пустыня Отец→ДушиЖивые: нет ни одного акта дара между ними
 *
 * Проверяет шестерицу первотворения от Отца к ДушиЖивым:
 *   - ТворениеЖивых (presence, вес 10) — Быт 1:20, 1:24: «да произведёт вода/земля душу живую»
 *   - ДыханиеЖизни (presence, вес 9) — Быт 2:7 / Деян 17:25: «дая всему жизнь и дыхание»
 *   - БлагословениеПлодиться (word, вес 8) — Быт 1:22: «плодитесь и размножайтесь»
 *   - ПромыслОМалом (knowledge, вес 8) — Мф 10:29 / Пс 49:11
 *   - ПрокормлениеТварей (time, вес 7) — Пс 144:15, Мф 6:26
 *   - ЗаветСоВсякойДушой (word, вес 9) — Быт 9:9–11: единственный завет «со всякою душою живою»
 *
 * Богословский ключ: Отец — Источник всякой жизни; Шестоднев — литургия Отца к твари.
 * Пустыня была не разрывом, а незаписанным первотворением.
 * Григорий Богослов, Слово 38: «От Отца — через Сына — в Духе всё бывает».
 * Исаак Сирин, LXXXI: «У Бога нет малого творения».
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'ДушиЖивые', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #467: Отец → ДушиЖивые ──────────────────────────────────────────────────

test('отец-душиживые: >= 5 даров от Отца к ДушиЖивым', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые');
  assert.ok(dActs.length >= 5, `Нашли: ${dActs.length}, ожидали >= 5 (шестерица первотворения)`);
});

test('отец-душиживые: типы presence, word, knowledge, time', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, дыхание жизни)');
  assert.ok(types.has('word'),      'word (благословение, завет)');
  assert.ok(types.has('knowledge'), 'knowledge (промысл о малом — Мф 10:29)');
  assert.ok(types.has('time'),      'time (прокормление — Пс 144:15)');
});

test('отец-душиживые: thread(Отец→ДушиЖивые) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'ДушиЖивые');
  assert.ok(w > 0, `thread(Отец→ДушиЖивые) = ${w} — должно быть > 0`);
});

test('отец-душиживые: все дары необратимы', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-душиживые: ТворениеЖивых (presence) — самый тяжёлый (вес >= 10)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые' && a.type === 'presence'
  );
  assert.ok(presenceActs.length > 0, 'presence-дар найден');
  const maxWeight = Math.max(...presenceActs.map(a => a.weight));
  assert.ok(maxWeight >= 10, `вес presence = ${maxWeight}, ожидали >= 10 (само бытие — основа)`);
});

test('отец-душиживые: ЗаветСоВсякойДушой (word) — вес >= 9 (Быт 9:9–11)', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые' && a.type === 'word'
  );
  assert.ok(wordActs.length > 0, 'word-дар найден');
  const maxWord = Math.max(...wordActs.map(a => a.weight));
  assert.ok(maxWord >= 9, `максимальный вес word = ${maxWord}, ожидали >= 9 (завет — тяжелейшее слово)`);
});

test('отец-душиживые: ПромыслОМалом (knowledge) — Мф 10:29 — вес >= 7', () => {
  const acts = loadSpec('отец-душиживые.gift');
  const knAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'ДушиЖивые' && a.type === 'knowledge'
  );
  assert.ok(knAct, 'knowledge-дар найден');
  assert.ok(knAct.weight >= 7, `вес knowledge = ${knAct.weight}, ожидали >= 7`);
});
