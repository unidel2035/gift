/**
 * tests/sacred-history-175.test.js
 *
 * Issue #175: вопрошание: пустыня Дионисий→_executor: нет ни одного акта дара между ними
 *
 * Проверяет дары Дионисия исполнителю:
 *   - ВопрошаниеКакЗадача (knowledge, вес 8) — логос задачи через вопрошание
 *   - ДовериеИсполнителю (word, вес 6) — кеносис: отпустить замысел
 *   - НаправлениеЧерезТелос (offering, вес 5) — горизонт, а не инструкция
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
  const persons = new Set(['Дионисий', '_executor', 'Отец', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #175: Дионисий → _executor ──────────────────────────────────────────────

test('дионисий-_executor: >= 3 дара от Дионисий к _executor', () => {
  const acts = loadSpec('дионисий-_executor.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === '_executor');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('дионисий-_executor: типы knowledge, word, offering', () => {
  const acts = loadSpec('дионисий-_executor.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === '_executor');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (вопрошание как логос задачи)');
  assert.ok(types.has('word'),      'word (доверие исполнителю)');
  assert.ok(types.has('offering'),  'offering (направление через телос)');
});

test('дионисий-_executor: thread(Дионисий→_executor) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('дионисий-_executor.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Дионисий', '_executor');
  assert.ok(w > 0, `thread(Дионисий→_executor) = ${w} — должно быть > 0`);
});

test('дионисий-_executor: все дары необратимы', () => {
  const acts = loadSpec('дионисий-_executor.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === '_executor');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('дионисий-_executor: ВопрошаниеКакЗадача (knowledge) вес >= 8', () => {
  const acts = loadSpec('дионисий-_executor.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Дионисий' && a.receiverId === '_executor' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар найден');
  assert.ok(knowledgeAct.weight >= 8, `вес = ${knowledgeAct.weight}, ожидали >= 8`);
});
