/**
 * tests/sacred-history-171.test.js
 *
 * Issue #171: вопрошание: пустыня Земля→Дионисий: нет ни одного акта дара между ними
 *
 * Проверяет дары Земли Дионисию:
 *   - Субстрат богословия (sustenance, вес 6) — Земля питает тело богослова
 *   - Прах как смирение (knowledge, вес 7) — апофатика снизу
 *   - Место воплощения Логоса (presence, вес 8) — Земля принимает слово
 *
 * Богословский ключ: Быт 2:7 — «из праха земного».
 * Дионисий — богослов, укоренённый в Земле.
 * Две апофатики: сверху (Бог непознаваем) и снизу (я — прах).
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
  const persons = new Set(['Земля', 'Дионисий', 'Отец', 'Сын', 'Дух', 'Адам', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #171: Земля → Дионисий ──────────────────────────────────────────────

test('земля-дионисий: ≥ 3 дара от Земли к Дионисию', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const earthActs = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Дионисий');
  assert.ok(earthActs.length >= 3, `Нашли: ${earthActs.length}, ожидали ≥ 3`);
});

test('земля-дионисий: типы sustenance, knowledge, presence', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const earthActs = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Дионисий');
  const types = new Set(earthActs.map(a => a.type));
  assert.ok(types.has('sustenance'), 'sustenance (субстрат богословия — хлеб и прах)');
  assert.ok(types.has('knowledge'), 'knowledge (прах как смирение — апофатика снизу)');
  assert.ok(types.has('presence'),  'presence (место воплощения Логоса)');
});

test('земля-дионисий: thread(Земля→Дионисий) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Земля', 'Дионисий');
  assert.ok(w > 0, `thread(Земля→Дионисий) = ${w} — должно быть > 0`);
});

test('земля-дионисий: все дары необратимы', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const earthActs = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Дионисий');
  for (const a of earthActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('земля-дионисий: МестоВоплощенияЛогоса (presence) вес ≥ 8', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Земля' && a.receiverId === 'Дионисий' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 8, `вес = ${presenceAct.weight}, ожидали ≥ 8`);
});

test('земля-дионисий: ПрахКакСмирение (knowledge) вес ≥ 7', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const knowAct = acts.find(
    a => a.giverId === 'Земля' && a.receiverId === 'Дионисий' && a.type === 'knowledge'
  );
  assert.ok(knowAct, 'knowledge-дар найден');
  assert.ok(knowAct.weight >= 7, `вес = ${knowAct.weight}, ожидали ≥ 7`);
});

test('земля-дионисий: СубстратБогословия (sustenance) вес ≥ 6', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const sustAct = acts.find(
    a => a.giverId === 'Земля' && a.receiverId === 'Дионисий' && a.type === 'sustenance'
  );
  assert.ok(sustAct, 'sustenance-дар найден');
  assert.ok(sustAct.weight >= 6, `вес = ${sustAct.weight}, ожидали ≥ 6`);
});
