/**
 * tests/sacred-history-406.test.js
 *
 * Issue #406: пустыня Отец→Строитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Строителю — отеческую пятерицу:
 *   - ТворениеСтроителя (presence, вес 9) — бытие как удержание в присутствии
 *   - НареченияПризвания (word, вес 10) — конститутивное слово, рождающее ремесло
 *   - ВидениеЧертежа (knowledge, вес 9) — «по образу, показанному тебе на горе»
 *   - ВверениеМатериала (offering, вес 8) — кеносис Отца, доверие свободе
 *   - РадостьЗавершённого (blessing, вес 8) — «увидел Бог: хорошо весьма»
 *
 * Богословский ключ: Быт 1:1 — Отец как Первый Строитель;
 * Исх 25:40 / 1 Пар 28:11–19 — чертёж от Отца; Исх 31:1–6 — наречение Веселиила;
 * Быт 1:31 — радость завершения. Святоотеческое: Ириней IV.20.1
 * (Бог творит руками Сына и Духа), Василий Великий (Бог-Художник).
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Строитель', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #406: Отец → Строитель ──────────────────────────────────────────────────

test('отец-строитель: >= 4 дара от Отца к Строителю (отеческая пятерица)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Строитель');
  assert.ok(dActs.length >= 4, `Нашли: ${dActs.length}, ожидали >= 4`);
});

test('отец-строитель: типы presence, word, knowledge, offering (творение/призвание/чертёж/вверение)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Строитель');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение как удержание в бытии)');
  assert.ok(types.has('word'),      'word (наречение призвания)');
  assert.ok(types.has('knowledge'), 'knowledge (видение чертежа)');
  assert.ok(types.has('offering'),  'offering (вверение материала)');
});

test('отец-строитель: thread(Отец→Строитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Строитель');
  assert.ok(w > 0, `thread(Отец→Строитель) = ${w} — должно быть > 0`);
});

test('отец-строитель: все дары необратимы', () => {
  const acts = loadSpec('отец-строитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Строитель');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-строитель: НареченияПризвания (word) — самая тяжёлая (вес 10)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Строитель' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар найден');
  assert.ok(wordAct.weight >= 10, `вес слова = ${wordAct.weight}, ожидали >= 10 (конститутивное призвание)`);
});

test('отец-строитель: ВидениеЧертежа (knowledge) — вес >= 8 (гносис через причастие)', () => {
  const acts = loadSpec('отец-строитель.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Строитель' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар найден');
  assert.ok(knowledgeAct.weight >= 8, `вес гносиса = ${knowledgeAct.weight}, ожидали >= 8`);
});
