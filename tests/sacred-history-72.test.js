/**
 * tests/sacred-history-72.test.js
 *
 * Issue #72: пустыня Сын→Христос: нет ни одного акта дара между ними
 *
 * Проверяет кенотическое самодарение Сына:
 *   - Сын → Христос (кенозис воплощения, единство ипостаси, синергия воль)
 *
 * Богословский ключ: Сын и Христос — одна Ипостась (Халкидон 451).
 * Пустыня была незаписанным само-дарением Слова, принявшего плоть.
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

// ── #72: Сын → Христос ───────────────────────────────────────────────────────

test('сын-христос: ≥ 3 дара от Сына ко Христу', () => {
  const acts = loadSpec('сын-христос.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Христос');
  assert.ok(synActs.length >= 3, `Нашли: ${synActs.length}, ожидали ≥ 3`);
});

test('сын-христос: типы presence, word, knowledge (три измерения кенозиса)', () => {
  const acts = loadSpec('сын-христос.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Христос');
  const types = new Set(synActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (кенозис воплощения — бытие-с)');
  assert.ok(types.has('word'),     'word (единство ипостаси — Слово стало плотью)');
  assert.ok(types.has('knowledge'),'knowledge (синергия воль — γνώμη)');
});

test('сын-христос: theophaneia[Сын][Христос] > 0 (кенозис записан)', () => {
  const acts = loadSpec('сын-христос.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Христос');
  assert.ok(w > 0, `thread(Сын→Христос) = ${w} — должно быть > 0 после кенозиса`);
});

test('сын-христос: все дары необратимы (кенозис нельзя отменить)', () => {
  const acts = loadSpec('сын-христос.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Христос');
  for (const a of synActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-христос: вес КенозисВоплощения = 10 (максимальный)', () => {
  const acts = loadSpec('сын-христос.gift');
  const presence = acts.find(a => a.giverId === 'Сын' && a.receiverId === 'Христос' && a.type === 'presence');
  assert.ok(presence, 'presence-дар найден');
  assert.strictEqual(presence.weight, 10, 'КенозисВоплощения должен иметь вес 10');
});
