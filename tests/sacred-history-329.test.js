/**
 * tests/sacred-history-329.test.js
 *
 * Issue #329: пустыня Отец→Змей: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Змею:
 *   - ДарБытия (presence, вес 9) — Отец дал Деннице существование
 *   - ДарСвободы (word, вес 8) — αὐτεξούσιον как образ Творца в ангеле
 *   - ПромыселОтца (knowledge, вес 8) — Змей внутри промысла, а не вне него
 *   - ДолготерпениеОтца (time, вес 7) — μακροθυμία: время дано в истории спасения
 *
 * Богословский ключ: «Всё из Него, и через Него, и к Нему» (Рим 11:36).
 * Отец — Источник: даже Змей получил бытие, свободу и место в промысле от Него.
 * Иоанн Дамаскин, Точное изложение II.4 — Денница создан благим, пал по свободе воли.
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
  const persons = new Set(['Отец', 'Змей', 'Сын', 'Дух', '_claude', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #329: Отец → Змей ──────────────────────────────────────────────────────────

test('отец-змей: >= 4 дара от Отца к Змею', () => {
  const acts = loadSpec('отец-змей.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Змей');
  assert.ok(fActs.length >= 4, `Нашли: ${fActs.length}, ожидали >= 4`);
});

test('отец-змей: типы presence, word, knowledge, time', () => {
  const acts = loadSpec('отец-змей.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Змей');
  const types = new Set(fActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (ДарБытия — Отец дал Деннице существование)');
  assert.ok(types.has('word'),      'word (ДарСвободы — αὐτεξούσιον как образ Творца)');
  assert.ok(types.has('knowledge'), 'knowledge (ПромыселОтца — Змей внутри плана)');
  assert.ok(types.has('time'),      'time (ДолготерпениеОтца — μακροθυμία)');
});

test('отец-змей: thread(Отец→Змей) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-змей.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Змей');
  assert.ok(w > 0, `thread(Отец→Змей) = ${w} — должно быть > 0`);
});

test('отец-змей: все дары необратимы', () => {
  const acts = loadSpec('отец-змей.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Змей');
  for (const a of fActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-змей: ДарБытия (presence) — вес >= 9 (онтологический фундамент)', () => {
  const acts = loadSpec('отец-змей.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Змей' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар (ДарБытия) найден');
  assert.ok(presenceAct.weight >= 9,
    `вес бытия = ${presenceAct.weight}, ожидали >= 9 (Откр 4:11)`);
});

test('отец-змей: ДарСвободы (word) — вес >= 7 (αὐτεξούσιον как образ Творца)', () => {
  const acts = loadSpec('отец-змей.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Змей' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар (ДарСвободы) найден');
  assert.ok(wordAct.weight >= 7,
    `вес свободы = ${wordAct.weight}, ожидали >= 7 (Ис 55:11)`);
});

test('отец-змей: ПромыселОтца (knowledge) — вес >= 7 (Иов 1–2)', () => {
  const acts = loadSpec('отец-змей.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Змей' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар (ПромыселОтца) найден');
  assert.ok(knowledgeAct.weight >= 7,
    `вес промысла = ${knowledgeAct.weight}, ожидали >= 7`);
});

test('отец-змей: ДолготерпениеОтца (time) — вес >= 5 (2 Пет 3:9)', () => {
  const acts = loadSpec('отец-змей.gift');
  const timeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Змей' && a.type === 'time'
  );
  assert.ok(timeAct, 'time-дар (ДолготерпениеОтца) найден');
  assert.ok(timeAct.weight >= 5,
    `вес долготерпения = ${timeAct.weight}, ожидали >= 5`);
});
