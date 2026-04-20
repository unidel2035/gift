/**
 * tests/sacred-history-214.test.js
 *
 * Issue #214: пустыня Христос→Дух: нет ни одного акта дара между ними
 *
 * Проверяет дары Христа Духу:
 *   - ПосланиеОтОтца (word, вес 10) — Ин 15:26, 16:7, Деян 2:33
 *   - ПрославлениеЧерезПасху (presence, вес 10) — Ин 7:39
 *   - ПлотьКакЖилище (presence, вес 9) — Ириней III.17.1, Еф 2:22
 *   - ВыдыханиеВЦеркви (word, вес 9) — Ин 20:22
 *   - СоДействиеВСпасении (knowledge, вес 8) — Ин 16:14
 *
 * Богословский ключ: Дух и Сын — «две руки Отца» (Ириней, IV.20.1).
 * Пасха Христа — онтологическое условие Пятидесятницы (Ин 7:39).
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

// ── #214: Христос → Дух ──────────────────────────────────────────────────────

test('христос-дух: ≥ 4 дара от Христа Духу', () => {
  const acts = loadSpec('христос-дух.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  assert.ok(christActs.length >= 4, `Нашли: ${christActs.length}, ожидали ≥ 4`);
});

test('христос-дух: типы word, presence, knowledge (экономия Троицы)', () => {
  const acts = loadSpec('христос-дух.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  const types = new Set(christActs.map(a => a.type));
  assert.ok(types.has('word'),      'word (послание, выдыхание)');
  assert.ok(types.has('presence'),  'presence (прославление Пасхи, плоть как жилище)');
  assert.ok(types.has('knowledge'), 'knowledge (содержание свидетельства)');
});

test('христос-дух: thread(Христос→Дух) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-дух.gift');
  const mem  = buildMemory(acts);
  const t = mem.thread('Христос', 'Дух');
  const w = typeof t === 'number' ? t : t?.weight ?? 0;
  assert.ok(w > 0, `thread(Христос→Дух) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-дух: все дары необратимы (домостроительство необратимо)', () => {
  const acts = loadSpec('христос-дух.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  for (const a of christActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-дух: ПосланиеОтОтца имеет вес 10 (условие Пятидесятницы)', () => {
  const acts = loadSpec('христос-дух.gift');
  const topWord = acts.find(
    a => a.giverId === 'Христос' && a.receiverId === 'Дух' && a.type === 'word' && a.weight === 10
  );
  assert.ok(topWord, 'Акт word с весом 10 (Послание от Отца) найден');
});

test('христос-дух: ПрославлениеЧерезПасху имеет вес 10 (онтологическое условие)', () => {
  const acts = loadSpec('христос-дух.gift');
  const paschal = acts.find(
    a => a.giverId === 'Христос' && a.receiverId === 'Дух' && a.type === 'presence' && a.weight === 10
  );
  assert.ok(paschal, 'Акт presence с весом 10 (Прославление через Пасху) найден');
});
