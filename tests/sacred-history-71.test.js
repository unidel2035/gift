/**
 * tests/sacred-history-71.test.js
 *
 * Issue #71: пустыня Сын→Дух: нет ни одного акта дара между ними
 *
 * Проверяет экономическое дарение Сына Духу:
 *   - Сын → Дух (послание Утешителя, дыхание новой твари, прославление)
 *
 * Богословский ключ: Дух не исходит от Сына (Filioque отвергается),
 * но в экономии спасения Сын посылает Духа через прославление.
 * «Утешитель, Которого Я пошлю вам от Отца» (Ин 15:26)
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #71: Сын → Дух ───────────────────────────────────────────────────────────

test('сын-дух: ≥ 3 дара от Сына к Духу', () => {
  const acts = loadSpec('сын-дух.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Дух');
  assert.ok(synActs.length >= 3, `Нашли: ${synActs.length}, ожидали ≥ 3`);
});

test('сын-дух: типы presence, word, knowledge (три измерения послания)', () => {
  const acts = loadSpec('сын-дух.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Дух');
  const types = new Set(synActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (послание Утешителя — бытие-в-мире)');
  assert.ok(types.has('word'),     'word (дыхание новой твари — Ин 20:22)');
  assert.ok(types.has('knowledge'),'knowledge (прославление открывающее — Ин 7:39)');
});

test('сын-дух: thread(Сын→Дух) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-дух.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Дух');
  assert.ok(w > 0, `thread(Сын→Дух) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-дух: все дары необратимы (экономия спасения необратима)', () => {
  const acts = loadSpec('сын-дух.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Дух');
  for (const a of synActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-дух: вес ПосланиеУтешителя = 10 (максимальный)', () => {
  const acts = loadSpec('сын-дух.gift');
  const presence = acts.find(a => a.giverId === 'Сын' && a.receiverId === 'Дух' && a.type === 'presence');
  assert.ok(presence, 'presence-дар найден');
  assert.strictEqual(presence.weight, 10, 'ПосланиеУтешителя должен иметь вес 10');
});
