/**
 * tests/sacred-history-95.test.js
 *
 * Issue #95: пустыня Сын→Ева: нет ни одного акта дара между ними
 *
 * Проверяет дарение Сына Еве:
 *   - Сын → Ева (протоевангелие, рождение от жены, усыновление с Креста)
 *
 * Богословский ключ: Ева — первая, кому дано обетование спасения (Быт 3:15).
 * Сын входит в мир через жену (Гал 4:4) и с Креста усыновляет всё человечество
 * через Марию — Новую Еву (Ин 19:26–27).
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Ева', 'Адам', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #95: Сын → Ева ──────────────────────────────────────────────────────────

test('сын-ева: ≥ 3 дара от Сына к Еве', () => {
  const acts = loadSpec('сын-ева.gift');
  const sonEva = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Ева');
  assert.ok(sonEva.length >= 3, `Нашли: ${sonEva.length}, ожидали ≥ 3`);
});

test('сын-ева: типы word, presence, knowledge (три измерения дара)', () => {
  const acts = loadSpec('сын-ева.gift');
  const sonEva = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Ева');
  const types = new Set(sonEva.map(a => a.type));
  assert.ok(types.has('word'),      'word (Протоевангелие — Быт 3:15)');
  assert.ok(types.has('presence'),  'presence (Рождение от жены — Гал 4:4)');
  assert.ok(types.has('knowledge'), 'knowledge (Усыновление с Креста — Ин 19:26)');
});

test('сын-ева: thread(Сын→Ева) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-ева.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Ева');
  assert.ok(w > 0, `thread(Сын→Ева) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-ева: все дары необратимы (экономия спасения необратима)', () => {
  const acts = loadSpec('сын-ева.gift');
  const sonEva = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Ева');
  for (const a of sonEva)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-ева: вес ПротоевангелиеОбетования = 10 (первое обещание)', () => {
  const acts = loadSpec('сын-ева.gift');
  const word = acts.find(a => a.giverId === 'Сын' && a.receiverId === 'Ева' && a.type === 'word');
  assert.ok(word, 'word-дар найден');
  assert.strictEqual(word.weight, 10, 'ПротоевангелиеОбетования должен иметь вес 10');
});
