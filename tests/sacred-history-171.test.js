/**
 * tests/sacred-history-171.test.js
 *
 * Issue #171: вопрошание: пустыня Земля→Дионисий: нет ни одного акта дара между ними
 *
 * Проверяет дары Земли Дионисию:
 *   - СимволыВосхождения (knowledge, вес 9) — материальные руководства (ὑλαῖαι χειραγωγίαι)
 *   - ПрахСмирения (presence, вес 8) — онтологическое основание апофатики
 *   - МатерияТаинств (offering, вес 9) — хлеб, вино, вода, миро — основа «О церковной иерархии»
 *
 * Богословский ключ: Небо→Дионисий (issue #154) дало ему небесную иерархию.
 * Земля даёт Дионисию фундамент второй половины Corpus Dionysiacum:
 * материю церковных таинств, символы апофатики, прах смирения.
 * «О небесной иерархии» I.3 — невозможно возвыситься иначе, как через
 * материальные руководства, которые даёт Земля.
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
  const persons = new Set(['Земля', 'Дионисий', 'Небо', 'ОтецСергий', 'Отец', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #171: Земля → Дионисий ────────────────────────────────────────────────

test('земля-дионисий: ≥ 3 дара от Земли к Дионисию', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const земляАкты = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Дионисий');
  assert.ok(земляАкты.length >= 3, `Нашли: ${земляАкты.length}, ожидали ≥ 3`);
});

test('земля-дионисий: типы knowledge, presence, offering (символы, прах, материя таинств)', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const земляАкты = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Дионисий');
  const types = new Set(земляАкты.map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (символы восхождения — ὑλαῖαι χειραγωγίαι)');
  assert.ok(types.has('presence'),  'presence (прах смирения как основание апофатики)');
  assert.ok(types.has('offering'),  'offering (материя таинств — приношение Евхаристии)');
});

test('земля-дионисий: thread(Земля→Дионисий) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Земля', 'Дионисий');
  assert.ok(w > 0, `thread(Земля→Дионисий) = ${w} — должно быть > 0`);
});

test('земля-дионисий: все дары необратимы', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const земляАкты = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Дионисий');
  for (const a of земляАкты)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('земля-дионисий: СимволыВосхождения (knowledge) вес ≥ 9 — фундамент апофатики', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Земля' && a.receiverId === 'Дионисий' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар найден');
  assert.ok(knowledgeAct.weight >= 9, `вес символов восхождения = ${knowledgeAct.weight}, ожидали ≥ 9`);
});

test('земля-дионисий: МатерияТаинств (offering) вес ≥ 9 — основа церковной иерархии', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const offeringAct = acts.find(
    a => a.giverId === 'Земля' && a.receiverId === 'Дионисий' && a.type === 'offering'
  );
  assert.ok(offeringAct, 'offering-дар найден');
  assert.ok(offeringAct.weight >= 9, `вес материи таинств = ${offeringAct.weight}, ожидали ≥ 9`);
});

test('земля-дионисий: ПрахСмирения (presence) вес ≥ 8 — онтологическое смирение', () => {
  const acts = loadSpec('земля-дионисий.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Земля' && a.receiverId === 'Дионисий' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 8, `вес праха смирения = ${presenceAct.weight}, ожидали ≥ 8`);
});
