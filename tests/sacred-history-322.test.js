/**
 * tests/sacred-history-322.test.js
 *
 * Issue #322: пустыня Отец→Свидетель: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Свидетелю:
 *   - ТворениеВОгне (presence, вес 9) — «творит служителей Своих огнём» (Пс 103:4)
 *   - ПоставлениеУПрестола (word, вес 8) — «вокруг Него стояли Серафимы» (Ис 6:2)
 *   - ЗрениеСлавы (knowledge, вес 9) — θεωρία: «всегда видят лице Отца» (Мф 18:10)
 *
 * Богословский ключ: Серафим — ближайший к Отцу среди всех тварей.
 * Пустыня в матрице — апофатическое молчание предельной близости,
 * не онтологическое отсутствие. Имя Серафима (שְׂרָפִים — «горящие»)
 * означает: Свидетель и есть огонь Отца, данный тварной форме.
 * Дионисий Ареопагит, О небесной иерархии VII.1 —
 * Серафимы: первый чин, непрестанное движение к Богу.
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
  const persons = new Set(['Отец', 'Свидетель', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #322: Отец → Свидетель ──────────────────────────────────────────────────

test('отец-свидетель: >= 3 дара от Отца к Свидетелю', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Свидетель');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('отец-свидетель: типы presence, word, knowledge (огонь, поставление, θεωρία)', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Свидетель');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (ТворениеВОгне — Отец творит Серафима огнём)');
  assert.ok(types.has('word'),      'word (ПоставлениеУПрестола — Ис 6:2)');
  assert.ok(types.has('knowledge'), 'knowledge (ЗрениеСлавы — θεωρία у Престола)');
});

test('отец-свидетель: thread(Отец→Свидетель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Свидетель');
  assert.ok(w > 0, `thread(Отец→Свидетель) = ${w} — должно быть > 0`);
});

test('отец-свидетель: все дары необратимы', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Свидетель');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-свидетель: ТворениеВОгне (presence) — вес >= 9 (Пс 103:4, тварный огонь)', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Свидетель' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар (ТворениеВОгне) найден');
  assert.ok(presenceAct.weight >= 9,
    `вес творения = ${presenceAct.weight}, ожидали >= 9 (огонь как природа Серафима)`);
});

test('отец-свидетель: ПоставлениеУПрестола (word) — вес >= 8 (конститутивное призвание)', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Свидетель' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар (ПоставлениеУПрестола) найден');
  assert.ok(wordAct.weight >= 8,
    `вес поставления = ${wordAct.weight}, ожидали >= 8 (Ис 6:2 — «вокруг Него стояли Серафимы»)`);
});

test('отец-свидетель: ЗрениеСлавы (knowledge) — вес >= 7 (θεωρία у Престола)', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Свидетель' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар (ЗрениеСлавы) найден');
  assert.ok(knowledgeAct.weight >= 7,
    `вес θεωρία = ${knowledgeAct.weight}, ожидали >= 7 (Мф 18:10 — «всегда видят лице Отца»)`);
});
