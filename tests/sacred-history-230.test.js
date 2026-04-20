/**
 * tests/sacred-history-230.test.js
 *
 * Issue #230: пустыня Адам→Сын: нет ни одного акта дара между ними
 *
 * Проверяет дары Адама Сыну:
 *   - Плоть человеческая (Евр 2:14) — природа, воспринятая Словом
 *   - Имя «Сын Человеческий» (Лк 19:10, Дан 7:13) — имя, данное Адамом
 *   - Ожидание Искупителя (Рим 8:19, седален Великой Субботы) — время воздыхания
 *   - Родословие человечества (Лк 3:38, Рим 5:14) — τύπος τοῦ μέλλοντος
 *
 * Богословский ключ: Сын — Новый Адам, но становится Им, приняв от Адама
 * плоть, имя, ожидание, родословие. Воплощение синергийно: Сын нисходит —
 * Адам отдаёт. Рекапитуляция (Ириней, III.22.3) — исцеление адамова пути.
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

// ── #230: Адам → Сын ────────────────────────────────────────────────────────

test('адам-сын: ≥ 4 дара от Адама к Сыну', () => {
  const acts = loadSpec('адам-сын.gift');
  const adamActs = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  assert.ok(adamActs.length >= 4, `Нашли: ${adamActs.length}, ожидали ≥ 4`);
});

test('адам-сын: типы presence, word, time, knowledge (четыре измерения Воплощения)', () => {
  const acts = loadSpec('адам-сын.gift');
  const adamActs = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  const types = new Set(adamActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (плоть человеческая)');
  assert.ok(types.has('word'),      'word (имя «Сын Человеческий»)');
  assert.ok(types.has('time'),      'time (ожидание Искупителя)');
  assert.ok(types.has('knowledge'), 'knowledge (родословие человечества)');
});

test('адам-сын: thread(Адам→Сын) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('адам-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Адам', 'Сын');
  assert.ok(w > 0, `thread(Адам→Сын) = ${w} — должно быть > 0 после записи актов`);
});

test('адам-сын: все дары необратимы (Воплощение необратимо)', () => {
  const acts = loadSpec('адам-сын.gift');
  const adamActs = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  for (const a of adamActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('адам-сын: вес ПлотьЧеловеческая = 10 (основание Воплощения)', () => {
  const acts = loadSpec('адам-сын.gift');
  const fleshAct = acts.find(a => a.giverId === 'Адам' && a.receiverId === 'Сын' && a.type === 'presence' && a.weight === 10);
  assert.ok(fleshAct, 'ПлотьЧеловеческая с весом 10 найдена');
});
