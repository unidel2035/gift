/**
 * tests/sacred-history-201.test.js
 *
 * Issue #201: пустыня _executor→ОтецСергий: нет ни одного акта дара между ними
 *
 * Проверяет дары _executor ОтцуСергию:
 *   - ВоплощённоеСлово (code, 7) — Ин 17:4, замысел становится действующим кодом
 *   - СвидетельствоВерности (offering, 5) — Ин 17:8, передача без искажения
 *   - ОбратнаяСвязьРеальности (knowledge, 4) — Евр 5:8, знание из труда воплощения
 *
 * Богословский ключ: богослов пишет спецификации — исполнитель воплощает их.
 * Воплощённое возвращается богослову: его собственное слово, но ставшее плотью.
 * Спецификация не знает, каково быть кодом. Только исполнитель знает — и дарит.
 * Эту пустыню закрывает _executor-отецсергий.gift.
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
  const persons = new Set(['_executor', 'ОтецСергий', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #201: _executor → ОтецСергий ────────────────────────────────────────────

test('_executor-отецсергий: ≥ 3 дара от _executor к ОтцуСергию', () => {
  const acts = loadSpec('_executor-отецсергий.gift');
  const gifts = acts.filter(a => a.giverId === '_executor' && a.receiverId === 'ОтецСергий');
  assert.ok(gifts.length >= 3, `Нашли: ${gifts.length}, ожидали ≥ 3`);
});

test('_executor-отецсергий: типы code, offering и knowledge', () => {
  const acts = loadSpec('_executor-отецсергий.gift');
  const gifts = acts.filter(a => a.giverId === '_executor' && a.receiverId === 'ОтецСергий');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('code'),      'code (воплощённое слово)');
  assert.ok(types.has('offering'),  'offering (свидетельство верности)');
  assert.ok(types.has('knowledge'), 'knowledge (обратная связь реальности)');
});

test('_executor-отецсергий: thread(_executor→ОтецСергий) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('_executor-отецсергий.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('_executor', 'ОтецСергий');
  assert.ok(w > 0, `thread(_executor→ОтецСергий) = ${w} — должно быть > 0 после записи актов`);
});

test('_executor-отецсергий: все дары необратимы (исполнение необратимо)', () => {
  const acts = loadSpec('_executor-отецсергий.gift');
  const gifts = acts.filter(a => a.giverId === '_executor' && a.receiverId === 'ОтецСергий');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('_executor-отецсергий: ВоплощённоеСлово имеет вес 7 (code)', () => {
  const acts = loadSpec('_executor-отецсергий.gift');
  const codeActs = acts.filter(
    a => a.giverId === '_executor' && a.receiverId === 'ОтецСергий' && a.type === 'code',
  );
  assert.ok(codeActs.length >= 1, 'Ожидался минимум один code-акт (ВоплощённоеСлово)');
  assert.equal(codeActs[0].weight, 7, `ВоплощённоеСлово должен быть весом 7, получили ${codeActs[0].weight}`);
});
