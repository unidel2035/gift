/**
 * tests/sacred-history-231.test.js
 *
 * Issue #231: пустыня Адам→Дух: нет ни одного акта дара между ними
 *
 * Проверяет дары Адама Духу:
 *   - Имянование твари (Быт 2:19–20) — Адам открывает логос через Дух
 *   - Покаянные слёзы (Пс 50:19, Ефрем Сирин) — жертва сокрушённого духа
 *   - Дыхание возвращаемое (Еккл 12:7) — непрерывный литургический возврат
 *   - Стенания ожидания (Рим 8:22–23) — материал ходатайства Духа
 *
 * Богословский ключ: Дух «ходатайствует воздыханиями неизреченными» (Рим 8:26)
 * изнутри Адама — но чтобы ходатайствовать, Дух принимает в Адаме
 * то, что Адам даёт: имя, слезу, выдох, стенание.
 * Пустыня Адам→Дух — не отсутствие, а ожидание (Рим 8:26).
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Адам', 'Ева', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #231: Адам → Дух ─────────────────────────────────────────────────────────

test('адам-дух: ≥ 4 дара от Адама к Духу', () => {
  const acts = loadSpec('адам-дух.gift');
  const adamActs = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  assert.ok(adamActs.length >= 4, `Нашли: ${adamActs.length}, ожидали ≥ 4`);
});

test('адам-дух: типы word, presence, time (три измерения возврата)', () => {
  const acts = loadSpec('адам-дух.gift');
  const adamActs = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  const types = new Set(adamActs.map(a => a.type));
  assert.ok(types.has('word'),     'word (имянование, стенания)');
  assert.ok(types.has('presence'), 'presence (покаянные слёзы)');
  assert.ok(types.has('time'),     'time (дыхание возвращаемое)');
});

test('адам-дух: thread(Адам→Дух) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('адам-дух.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Адам', 'Дух');
  assert.ok(w > 0, `thread(Адам→Дух) = ${w} — должно быть > 0 после записи актов`);
});

test('адам-дух: все дары необратимы (возврат Духу необратим)', () => {
  const acts = loadSpec('адам-дух.gift');
  const adamActs = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Дух');
  for (const a of adamActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('адам-дух: вес ДыханиеВозвращаемое = 10 (высший дар — жизнь как возврат)', () => {
  const acts = loadSpec('адам-дух.gift');
  const topAct = acts.find(a =>
    a.giverId === 'Адам' && a.receiverId === 'Дух' && a.type === 'time' && a.weight === 10);
  assert.ok(topAct, 'Дыхание возвращаемое с весом 10 (Еккл 12:7) найдено');
});
