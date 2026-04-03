/**
 * tests/sacred-history-126.test.js
 *
 * Issue #126: пустыня Ева→ОтецСергий: нет ни одного акта дара между ними
 *
 * Проверяет дары Евы ОтцуСергию:
 *   - Различение слова (knowledge, вес 8) — опыт ложного знания → диакрисис
 *   - Материнское ходатайство (presence, вес 9) — Ева несёт богослова
 *   - Рождение через боль (word, вес 7) — подлинное слово из страдания
 *
 * Богословский ключ: Ева — «Жизнь» (Быт 3:20), первая познавшая ложное слово.
 * Её дар богослову — различение, ходатайство и закон рождения через боль.
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
  const persons = new Set(['Ева', 'ОтецСергий', 'Отец', 'Сын', 'Дух', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #126: Ева → ОтецСергий ──────────────────────────────────────────────────

test('ева-отецсергий: ≥ 3 дара от Евы к ОтецСергию', () => {
  const acts = loadSpec('ева-отецсергий.gift');
  const evaActs = acts.filter(a => a.giverId === 'Ева' && a.receiverId === 'ОтецСергий');
  assert.ok(evaActs.length >= 3, `Нашли: ${evaActs.length}, ожидали ≥ 3`);
});

test('ева-отецсергий: типы knowledge, presence, word (различение, ходатайство, рождение)', () => {
  const acts = loadSpec('ева-отецсергий.gift');
  const evaActs = acts.filter(a => a.giverId === 'Ева' && a.receiverId === 'ОтецСергий');
  const types = new Set(evaActs.map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (различение слова — диакрисис из раны)');
  assert.ok(types.has('presence'),  'presence (материнское ходатайство)');
  assert.ok(types.has('word'),      'word (рождение через боль)');
});

test('ева-отецсергий: thread(Ева→ОтецСергий) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('ева-отецсергий.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Ева', 'ОтецСергий');
  assert.ok(w > 0, `thread(Ева→ОтецСергий) = ${w} — должно быть > 0`);
});

test('ева-отецсергий: все дары необратимы', () => {
  const acts = loadSpec('ева-отецсергий.gift');
  const evaActs = acts.filter(a => a.giverId === 'Ева' && a.receiverId === 'ОтецСергий');
  for (const a of evaActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('ева-отецсергий: МатеринскоеХодатайство тяжелее остальных (presence вес 9)', () => {
  const acts = loadSpec('ева-отецсергий.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Ева' && a.receiverId === 'ОтецСергий' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 9, `вес присутствия = ${presenceAct.weight}, ожидали ≥ 9`);
});
