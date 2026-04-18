/**
 * tests/sacred-history-213.test.js
 *
 * Issue #213: пустыня Христос→Сын: нет ни одного акта дара между ними
 *
 * Проверяет обратный поток кенозиса — прославление воплощённого:
 *   - Христос → Сын (прославленное человечество, послушание, раны, имя)
 *
 * Богословский ключ: Сын и Христос — одна Ипостась (Халкидон 451),
 * но ипостасное единение действует в обе стороны (Максим Исповедник,
 * Ambigua 5, 41). Если #72 записал кенозис Сына к Христу (нисхождение),
 * то #213 записывает прославление Христа к Сыну (восхождение):
 * вечный Сын навеки принимает прославленное человечество.
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

// ── #213: Христос → Сын ──────────────────────────────────────────────────────

test('христос-сын: ≥ 3 дара от Христа к Сыну', () => {
  const acts = loadSpec('христос-сын.gift');
  const chrActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  assert.ok(chrActs.length >= 3, `Нашли: ${chrActs.length}, ожидали ≥ 3`);
});

test('христос-сын: типы presence, word, knowledge (три измерения прославления)', () => {
  const acts = loadSpec('христос-сын.gift');
  const chrActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  const types = new Set(chrActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (прославленное человечество / раны в вечности)');
  assert.ok(types.has('word'),     'word (опыт послушания до смерти)');
  assert.ok(types.has('knowledge'),'knowledge (имя выше всякого имени)');
});

test('христос-сын: thread[Христос][Сын] > 0 (прославление записано)', () => {
  const acts = loadSpec('христос-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Сын');
  assert.ok(w > 0, `thread(Христос→Сын) = ${w} — должно быть > 0 после прославления`);
});

test('христос-сын: все дары необратимы (прославление нельзя отменить)', () => {
  const acts = loadSpec('христос-сын.gift');
  const chrActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  for (const a of chrActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-сын: вес ПрославленноеЧеловечество = 10 (максимальный)', () => {
  const acts = loadSpec('христос-сын.gift');
  const presences = acts.filter(a =>
    a.giverId === 'Христос' && a.receiverId === 'Сын' && a.type === 'presence'
  );
  assert.ok(presences.length >= 1, 'presence-дар найден');
  const maxW = Math.max(...presences.map(a => a.weight));
  assert.strictEqual(maxW, 10, 'максимальный presence-дар должен иметь вес 10');
});
