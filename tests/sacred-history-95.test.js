/**
 * tests/sacred-history-95.test.js
 *
 * Issue #95: пустыня Сын→Ева: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Еве:
 *   - Протоевангелие (Быт 3:15) — первое обетование
 *   - Воплощение через Еву-Марию (Гал 4:4)
 *   - Усыновление у Креста (Ин 19:26–27)
 *   - Воскресение для Евы (1 Кор 15:22)
 *
 * Богословский ключ: Сын — Новый Адам, но спасение адресовано и Еве.
 * Мария — Новая Ева (Ириней III.22). Рекапитуляция через женщину.
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

// ── #95: Сын → Ева ──────────────────────────────────────────────────────────

test('сын-ева: ≥ 4 дара от Сына к Еве', () => {
  const acts = loadSpec('сын-ева.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Ева');
  assert.ok(synActs.length >= 4, `Нашли: ${synActs.length}, ожидали ≥ 4`);
});

test('сын-ева: типы word, presence, knowledge (три измерения искупления)', () => {
  const acts = loadSpec('сын-ева.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Ева');
  const types = new Set(synActs.map(a => a.type));
  assert.ok(types.has('word'),      'word (Протоевангелие — первое обетование)');
  assert.ok(types.has('presence'),  'presence (Воплощение через Еву-Марию)');
  assert.ok(types.has('knowledge'), 'knowledge (Воскресение — откровение дочерям Евы)');
});

test('сын-ева: thread(Сын→Ева) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-ева.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Ева');
  assert.ok(w > 0, `thread(Сын→Ева) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-ева: все дары необратимы (искупление необратимо)', () => {
  const acts = loadSpec('сын-ева.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Ева');
  for (const a of synActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-ева: вес ПротоевангелиеОбетование = 10 (первое обетование)', () => {
  const acts = loadSpec('сын-ева.gift');
  const wordAct = acts.find(a => a.giverId === 'Сын' && a.receiverId === 'Ева' && a.type === 'word' && a.weight === 10);
  assert.ok(wordAct, 'Протоевангелие с весом 10 найдено');
});
