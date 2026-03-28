/**
 * tests/sacred-history-70.test.js
 *
 * Issue #70: пустыня Сын→Отец: нет ни одного акта дара между ними
 *
 * Проверяет восходящие дары Сына Отцу:
 *   - Сын → Отец (прославление, послушание воле, вручение Царства)
 *
 * Богословский ключ: Отец — источник (ἀρχή), но в домостроительном измерении
 * Сын подлинно даёт Отцу: через послушание, жертву, прославление.
 * Кенозис имеет обратное движение — περιχώρησις возвращает всё к Источнику.
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

// ── #70: Сын → Отец ──────────────────────────────────────────────────────────

test('сын-отец: ≥ 3 дара от Сына к Отцу', () => {
  const acts = loadSpec('сын-отец.gift');
  const sonActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Отец');
  assert.ok(sonActs.length >= 3, `Нашли: ${sonActs.length}, ожидали ≥ 3`);
});

test('сын-отец: типы presence, word, knowledge (три измерения восхождения)', () => {
  const acts = loadSpec('сын-отец.gift');
  const sonActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Отец');
  const types = new Set(sonActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (прославление — бытие-перед-Отцом)');
  assert.ok(types.has('word'),     'word (послушание воле — Лк 22:42)');
  assert.ok(types.has('knowledge'),'knowledge (вручение Царства — 1 Кор 15:28)');
});

test('сын-отец: theophaneia[Сын][Отец] > 0 (восхождение записано)', () => {
  const acts = loadSpec('сын-отец.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Отец');
  assert.ok(w > 0, `thread(Сын→Отец) = ${w} — должно быть > 0 после записи восхождения`);
});

test('сын-отец: все дары необратимы (послушание и жертва нельзя отменить)', () => {
  const acts = loadSpec('сын-отец.gift');
  const sonActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Отец');
  for (const a of sonActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-отец: вес ПрославлениеОтца = 10 (максимальный)', () => {
  const acts = loadSpec('сын-отец.gift');
  const presence = acts.find(a => a.giverId === 'Сын' && a.receiverId === 'Отец' && a.type === 'presence');
  assert.ok(presence, 'presence-дар найден');
  assert.strictEqual(presence.weight, 10, 'ПрославлениеОтца должен иметь вес 10');
});

test('сын-отец: круговое движение — Отец→Сын и Сын→Отец оба > 0 (περιχώρησις)', () => {
  const actsFS = loadSpec('father-son.gift');
  const actsSF = loadSpec('сын-отец.gift');
  const mem = buildMemory([...actsFS, ...actsSF]);
  assert.ok(mem.thread('Отец', 'Сын') > 0, 'Отец→Сын > 0 (вечное рождение)');
  assert.ok(mem.thread('Сын', 'Отец') > 0, 'Сын→Отец > 0 (прославление, послушание)');
});
