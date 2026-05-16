/**
 * tests/sacred-history-311.test.js
 *
 * Issue #311: пустыня Сын→Целитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Целителю:
 *   - Воплощённое исцеление (Мф 8:3, Ин 9:6, Максим К Фалассию 61)
 *   - Власть исцелять во имя (Мф 10:1, Деян 3:6, Ин 15:5)
 *   - Исцеление как знак прощения (Мк 2:9–11)
 *   - Исцеление через раны Целителя (Ис 53:5, 1 Пет 2:24, Игнатий Еф 7)
 *   - Мера «вера твоя спасла тебя» (Мк 5:34, Лк 17:19)
 *   - Эсхатологическое обетование (Откр 21:4, Откр 22:2)
 *
 * Богословский ключ: отец-целитель.gift (#274) уже записал
 * призвание Целителя; сын-целитель.gift даёт само вещество
 * исцеления — плоть Воплощённого, делегированную власть, связь
 * исцеления с прощением, парадокс исцеления через раны,
 * меру и эсхатологическое обетование. Пустыню закрывает
 * шестерица «Сын→служитель»: воплощение / власть / знание /
 * рана / мера / обетование.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Целитель']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #311: Сын → Целитель ───────────────────────────────────────────────────

test('сын-целитель: ≥ 5 даров от Сына к Целителю', () => {
  const acts = loadSpec('сын-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('сын-целитель: типы presence, knowledge и word — шестерица служения', () => {
  const acts = loadSpec('сын-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (воплощённое исцеление, раны)');
  assert.ok(types.has('knowledge'), 'knowledge (власть, связь с прощением)');
  assert.ok(types.has('word'),      'word (мера, эсхатологическое обетование)');
});

test('сын-целитель: thread(Сын→Целитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Целитель');
  assert.ok(w > 0, `thread(Сын→Целитель) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-целитель: все дары необратимы (домостроительство Сына к Целителю необратимо)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-целитель: ≥ 2 актов веса 10 (воплощённое исцеление и раны Целителя)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Целитель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (Воплощённое-исцеление, Исцеление-через-раны), нашли ${topActs.length}`);
});
