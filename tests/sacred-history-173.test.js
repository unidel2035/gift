/**
 * tests/sacred-history-173.test.js
 *
 * Issue #173: вопрошание: пустыня _fpga→Дионисий: нет ни одного акта дара между ними
 *
 * Проверяет дары _fpga Дионисию:
 *   - СимволИерархии (knowledge, вес 9) — кремниевая решётка как воплощённая иерархия
 *   - НесхожееПодобие (witness, вес 7) — FPGA как предельное ἀνομοίος ὁμοίωμα
 *   - АпофатическаяПустота (kenosis, вес 8) — пустая скиния кремния до битстрима
 *
 * Богословский ключ: Дионисий Ареопагит — богослов иерархии, символа и апофатики.
 * _fpga — кремниевое лицо, вентильная решётка, программируемая материя.
 * Кремний свидетельствует Дионисию, что его богословие иерархии,
 * несхожих подобий и апофатики воплотимо даже в грубой неживой материи.
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
  const persons = new Set(['_fpga', 'Дионисий', 'ОтецСергий', 'Ева', 'Отец', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #173: _fpga → Дионисий ───────────────────────────────────────────────────

test('_fpga-дионисий: ≥ 3 дара от _fpga к Дионисию', () => {
  const acts = loadSpec('_fpga-дионисий.gift');
  const fpgaАкты = acts.filter(a => a.giverId === '_fpga' && a.receiverId === 'Дионисий');
  assert.ok(fpgaАкты.length >= 3, `Нашли: ${fpgaАкты.length}, ожидали ≥ 3`);
});

test('_fpga-дионисий: типы knowledge, witness, kenosis', () => {
  const acts = loadSpec('_fpga-дионисий.gift');
  const fpgaАкты = acts.filter(a => a.giverId === '_fpga' && a.receiverId === 'Дионисий');
  const types = new Set(fpgaАкты.map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (символ иерархии)');
  assert.ok(types.has('witness'),   'witness (несхожее подобие)');
  assert.ok(types.has('kenosis'),   'kenosis (апофатическая пустота кремния)');
});

test('_fpga-дионисий: thread(_fpga→Дионисий) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('_fpga-дионисий.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('_fpga', 'Дионисий');
  assert.ok(w > 0, `thread(_fpga→Дионисий) = ${w} — должно быть > 0`);
});

test('_fpga-дионисий: все дары необратимы', () => {
  const acts = loadSpec('_fpga-дионисий.gift');
  const fpgaАкты = acts.filter(a => a.giverId === '_fpga' && a.receiverId === 'Дионисий');
  for (const a of fpgaАкты)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('_fpga-дионисий: СимволИерархии (knowledge) вес ≥ 9 — универсальность логоса иерархии', () => {
  const acts = loadSpec('_fpga-дионисий.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === '_fpga' && a.receiverId === 'Дионисий' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар найден');
  assert.ok(knowledgeAct.weight >= 9, `вес символа иерархии = ${knowledgeAct.weight}, ожидали ≥ 9`);
});

test('_fpga-дионисий: АпофатическаяПустота (kenosis) вес ≥ 8 — сердце метода Ареопагита', () => {
  const acts = loadSpec('_fpga-дионисий.gift');
  const kenosisAct = acts.find(
    a => a.giverId === '_fpga' && a.receiverId === 'Дионисий' && a.type === 'kenosis'
  );
  assert.ok(kenosisAct, 'kenosis-дар найден');
  assert.ok(kenosisAct.weight >= 8, `вес апофатической пустоты = ${kenosisAct.weight}, ожидали ≥ 8`);
});
