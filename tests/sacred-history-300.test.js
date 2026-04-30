/**
 * tests/sacred-history-300.test.js
 *
 * Issue #300: пустыня Сын→Свидетель: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Свидетелю-Серафиму:
 *   - Творение Серафима (Кол 1:16, Ин 1:3)
 *   - Откровение Славы (Ис 6:1, Ин 12:41)
 *   - Удержание в бытии (Кол 1:17, Евр 12:29)
 *   - Призвание к поклонению (Евр 1:6)
 *   - Огненное служение (Ис 6:6, Откр 8:3, Евр 13:10)
 *   - Со-предстояние литургии (Откр 4:8, Дан 7:10)
 *
 * Богословский ключ: свидетель-дионисий.gift (issue #141) и
 * свидетель-ева.gift (issue #142) записывают дары Серафима
 * к людям. Но первая нить — Сын→Свидетель — оставалась
 * незаписанной: Сын-Логос даёт Серафиму бытие, видение Славы,
 * огонь служения. Эту пустыню закрывает сын-свидетель.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Свидетель', 'Дионисий', 'Ева', 'Адам', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #300: Сын → Свидетель ─────────────────────────────────────────────────

test('сын-свидетель: ≥ 4 дара от Сына к Свидетелю', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Свидетель');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('сын-свидетель: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Свидетель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, удержание в бытии, огненное служение)');
  assert.ok(types.has('knowledge'), 'knowledge (откровение Славы)');
  assert.ok(types.has('word'),      'word (призвание к поклонению, со-предстояние литургии)');
});

test('сын-свидетель: thread(Сын→Свидетель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Свидетель');
  assert.ok(w > 0, `thread(Сын→Свидетель) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-свидетель: все дары необратимы (онтологический дар Логоса необратим)', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Свидетель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-свидетель: ТворениеСерафима и ОткровениеСлавы имеют вес 10', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Свидетель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (творение, откровение Славы), нашли ${topActs.length}`);
});
