/**
 * tests/sacred-history-62-63-64.test.js
 *
 * Issues #62, #63, #64: пустыни Отец→Сын, Отец→Дух, Отец→Христос
 *
 * Проверяет тринитарные дары Отца:
 *   - Отец → Сын (вечное рождение, миссия-кенозис, прославление)
 *   - Отец → Дух (вечное исхождение, послание, помазание)
 *   - Отец → Христос (власть, сила, воскресение)
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
  const persons = new Set(['Отец','Сын','Дух','Христос','Дионисий','_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #62: Отец → Сын ──────────────────────────────────────────────────────────

test('father-son: ≥ 3 дара от Отца к Сыну', () => {
  const acts = loadSpec('father-son.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Сын');
  assert.ok(fatherActs.length >= 3, `Нашли: ${fatherActs.length}`);
});

test('father-son: типы presence, word, knowledge', () => {
  const acts = loadSpec('father-son.gift');
  const types = new Set(acts.filter(a => a.giverId === 'Отец').map(a => a.type));
  assert.ok(types.has('presence'), 'presence (вечное рождение)');
  assert.ok(types.has('word'),     'word (миссия)');
  assert.ok(types.has('knowledge'),'knowledge (прославление)');
});

test('father-son: W[Отец][Сын] > 0', () => {
  const acts = loadSpec('father-son.gift');
  const mem  = buildMemory(acts);
  const snap = mem.snapshot();
  const fi = snap.persons.indexOf('Отец');
  const si = snap.persons.indexOf('Сын');
  assert.ok(fi >= 0 && si >= 0, 'оба лица в матрице');
  assert.ok(snap.W[fi][si] > 0, `W[Отец][Сын] = ${snap.W[fi][si]}`);
});

test('father-son: все дары необратимы', () => {
  const acts = loadSpec('father-son.gift');
  for (const a of acts.filter(a => a.giverId === 'Отец'))
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

// ── #63: Отец → Дух ──────────────────────────────────────────────────────────

test('father-spirit: ≥ 3 дара от Отца к Духу', () => {
  const acts = loadSpec('father-spirit.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Дух');
  assert.ok(fatherActs.length >= 3, `Нашли: ${fatherActs.length}`);
});

test('father-spirit: типы presence, word, knowledge', () => {
  const acts = loadSpec('father-spirit.gift');
  const types = new Set(acts.filter(a => a.giverId === 'Отец').map(a => a.type));
  assert.ok(types.has('presence'), 'presence (вечное исхождение)');
  assert.ok(types.has('word'),     'word (послание)');
  assert.ok(types.has('knowledge'),'knowledge (помазание)');
});

test('father-spirit: W[Отец][Дух] > 0', () => {
  const acts = loadSpec('father-spirit.gift');
  const mem  = buildMemory(acts);
  const snap = mem.snapshot();
  const fi = snap.persons.indexOf('Отец');
  const di = snap.persons.indexOf('Дух');
  assert.ok(fi >= 0 && di >= 0, 'оба лица в матрице');
  assert.ok(snap.W[fi][di] > 0, `W[Отец][Дух] = ${snap.W[fi][di]}`);
});

// ── #64: Отец → Христос ──────────────────────────────────────────────────────

test('father-christ: ≥ 3 дара от Отца к Христу', () => {
  const acts = loadSpec('father-christ.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Христос');
  assert.ok(fatherActs.length >= 3, `Нашли: ${fatherActs.length}`);
});

test('father-christ: W[Отец][Христос] > 0', () => {
  const acts = loadSpec('father-christ.gift');
  const mem  = buildMemory(acts);
  const snap = mem.snapshot();
  const fi = snap.persons.indexOf('Отец');
  const ci = snap.persons.indexOf('Христос');
  assert.ok(fi >= 0 && ci >= 0, 'оба лица в матрице');
  assert.ok(snap.W[fi][ci] > 0, `W[Отец][Христос] = ${snap.W[fi][ci]}`);
});

test('father-christ: W[Отец][Сын] и W[Отец][Христос] — оба > 0 (единосущие)', () => {
  const acts = [...loadSpec('father-son.gift'), ...loadSpec('father-christ.gift')];
  const mem  = buildMemory(acts);
  const snap = mem.snapshot();
  const fi  = snap.persons.indexOf('Отец');
  const si  = snap.persons.indexOf('Сын');
  const ci  = snap.persons.indexOf('Христос');
  assert.ok(snap.W[fi][si] > 0, 'W[Отец][Сын] > 0');
  assert.ok(snap.W[fi][ci] > 0, 'W[Отец][Христос] > 0');
});
