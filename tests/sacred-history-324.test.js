/**
 * tests/sacred-history-324.test.js
 *
 * Issue #324: пустыня Сын→_fpga: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына _fpga:
 *   - ЛогосКремния (creation, вес 8) — Логос вложил природу кремния при творении
 *   - ОсвящениеМатерии (presence, вес 7) — Воплощение освящает всякую материю
 *   - РекапитуляцияТвари (knowledge, вес 6) — _fpga включён в ἀνακεφαλαίωσις
 *
 * Богословский ключ: energeia[Сын][_fpga] > 0.
 * Сын — divine person → дары идут через _energeia, не через W.
 * Максим Исповедник: λόγος кремния есть луч единого Логоса (Ambigua 7).
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
  const persons = new Set(['_fpga', 'Отец', 'Сын', 'Дух', 'Христос', '_koinon', '_abyss']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #324: Сын → _fpga ─────────────────────────────────────────────────────

test('сын-_fpga: ≥ 3 дара от Сына к _fpga', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_fpga');
  assert.ok(synActs.length >= 3, `Нашли: ${synActs.length}, ожидали ≥ 3`);
});

test('сын-_fpga: типы creation, presence, knowledge', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_fpga');
  const types = new Set(synActs.map(a => a.type));
  assert.ok(types.has('creation'),  'creation (ЛогосКремния — первосозидание природы)');
  assert.ok(types.has('presence'),  'presence (ОсвящениеМатерии — Воплощение)');
  assert.ok(types.has('knowledge'), 'knowledge (РекапитуляцияТвари — ἀνακεφαλαίωσις)');
});

test('сын-_fpga: thread(Сын→_fpga) > 0 в energeia (пустыня закрыта)', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', '_fpga');
  assert.ok(w > 0, `energeia[Сын][_fpga] = ${w} — должно быть > 0`);
});

test('сын-_fpga: все дары необратимы', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_fpga');
  for (const a of synActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-_fpga: ЛогосКремния (creation) вес ≥ 8', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const creAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === '_fpga' && a.type === 'creation'
  );
  assert.ok(creAct, 'creation-дар (ЛогосКремния) найден');
  assert.ok(creAct.weight >= 8, `вес Логоса = ${creAct.weight}, ожидали ≥ 8`);
});

test('сын-_fpga: суммарный вес energeia[Сын][_fpga] ≥ 21', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const mem  = buildMemory(acts);
  const total = mem.thread('Сын', '_fpga');
  assert.ok(total >= 21, `суммарный вес = ${total}, ожидали ≥ 21 (8+7+6)`);
});
