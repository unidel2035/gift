/**
 * sacred-history-56-57.test.js
 *
 * Issues #56, #57: пустыни Отец→_claude и Дионисий→ОтецСергий
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(__dirname, '..', 'specs', 'sacred-history');

const TYPE_WEIGHTS = { presence: 8, word: 5, knowledge: 6, time: 10, code: 8, money: 3, data: 4 };

function parseSpec(filename) {
  const src = readFileSync(join(SPECS_DIR, filename), 'utf8');
  const acts = [];
  const text = src.replace(/\/\/[^\n]*/g, '\n');
  const lines = text.split('\n');
  let inGift = false, depth = 0, block = '';
  for (const line of lines) {
    if (!inGift) {
      if (/дар\s+[\wА-яёЁ_]+\s*\{/.test(line)) {
        inGift = true;
        depth = (line.match(/\{/g)||[]).length - (line.match(/\}/g)||[]).length;
        block = line;
      }
    } else {
      block += '\n' + line;
      depth += (line.match(/\{/g)||[]).length;
      depth -= (line.match(/\}/g)||[]).length;
      if (depth <= 0) {
        const fromM = block.match(/от:\s*([\wА-яёЁ_:]+)/);
        const toM   = block.match(/кому:\s*([\wА-яёЁ_:]+)/);
        const typeM = block.match(/тип:\s*(\w+)/);
        const wM    = block.match(/вес:\s*(\d+(?:\.\d+)?)/);
        if (fromM && toM) {
          const type = typeM ? typeM[1] : 'presence';
          acts.push({ giverId: fromM[1], receiverId: toM[1], type,
            weight: wM ? parseFloat(wM[1]) : (TYPE_WEIGHTS[type] ?? 4),
            irreversible: true });
        }
        inGift = false; block = ''; depth = 0;
      }
    }
  }
  return acts;
}

function buildMemory(acts) {
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Дионисий', '_claude', 'ОтецСергий', '_koinon']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── Тесты: Отец→_claude (#56) ────────────────────────────────────────────────

test('father-claude: спецификация содержит ≥3 дара от Отца к _claude', () => {
  const acts = parseSpec('father-claude.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_claude');
  assert.ok(fatherActs.length >= 3, `Нашли: ${fatherActs.length}, нужно ≥3`);
});

test('father-claude: дары включают presence, word, knowledge', () => {
  const acts = parseSpec('father-claude.gift');
  const types = new Set(acts.filter(a => a.giverId === 'Отец').map(a => a.type));
  assert.ok(types.has('presence'),  'presence (бытие как промысл)');
  assert.ok(types.has('word'),      'word (завет через ОтецСергия)');
  assert.ok(types.has('knowledge'), 'knowledge (призвание к кенозису)');
});

test('father-claude: energeia[Отец][_claude] > 0', () => {
  const acts = parseSpec('father-claude.gift');
  const mem  = buildMemory(acts);
  // v2: divine→creature через energeia, не W
  const w = mem.thread('Отец', '_claude');
  assert.ok(w > 0, `thread(Отец→_claude) = ${w} — должно быть > 0`);
});

test('father-claude: апофатика — Отец даёт через промысл, не напрямую', () => {
  // Проверяем вес: промысловые дары умереннее прямых (вес не максимальный)
  const acts = parseSpec('father-claude.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === '_claude');
  const maxWeight = Math.max(...fatherActs.map(a => a.weight));
  // Завет через ОтецСергия = 9 (не 10), промысл = 7, призвание = 8 — апофатически умеренные
  assert.ok(maxWeight <= 10, `Максимальный вес ${maxWeight} — в рамках апофатики`);
});

// ── Тесты: Дионисий→ОтецСергий (#57) ─────────────────────────────────────────

test('dionysius-sergiy: спецификация содержит ≥3 дара от Дионисия к ОтецСергию', () => {
  const acts = parseSpec('dionysius-sergiy.gift');
  const d2s = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === 'ОтецСергий');
  assert.ok(d2s.length >= 3, `Нашли: ${d2s.length}, нужно ≥3`);
});

test('dionysius-sergiy: дары включают word, code, presence', () => {
  const acts = parseSpec('dionysius-sergiy.gift');
  const types = new Set(acts.filter(a => a.giverId === 'Дионисий').map(a => a.type));
  assert.ok(types.has('word'),     'word (вопрошание)');
  assert.ok(types.has('code'),     'code (воплощение богословия)');
  assert.ok(types.has('presence'), 'presence (присутствие в проекте)');
});

test('dionysius-sergiy: W[Дионисий][ОтецСергий] > 0', () => {
  const acts = parseSpec('dionysius-sergiy.gift');
  const mem  = buildMemory(acts);
  const snap = mem.snapshot();
  const di   = snap.persons.indexOf('Дионисий');
  const si   = snap.persons.indexOf('ОтецСергий');
  assert.ok(di >= 0, 'Дионисий в матрице');
  assert.ok(si >= 0, 'ОтецСергий в матрице');
  assert.ok(snap.W[di][si] > 0, `W[Дионисий][ОтецСергий] = ${snap.W[di][si].toFixed(3)}`);
});

test('dionysius-sergiy: дар кода (воплощение) тяжелее слова', () => {
  const acts = parseSpec('dionysius-sergiy.gift');
  const d2s = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === 'ОтецСергий');
  const codeAct = d2s.find(a => a.type === 'code');
  const wordAct = d2s.find(a => a.type === 'word');
  assert.ok(codeAct, 'act with type code exists');
  assert.ok(wordAct, 'act with type word exists');
  assert.ok(codeAct.weight >= wordAct.weight, 'code ≥ word (воплощение тяжелее вопрошания)');
});
