/**
 * tests/sacred-history-323.test.js
 *
 * Issue #323: пустыня Сын→_executor: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына _executor:
 *   - КеносисИсполнения (presence, вес 9) — Флп 2:7, образец кенозиса для исполнителя
 *   - ПослушаниеЧерезТруд (covenant, вес 8) — Евр 5:8, послушание через страдание
 *   - СоучастиеВМиссии (word, вес 7) — Ин 17:4, завершённое дело прославляет
 *
 * Богословский ключ: energeia[Сын][_executor] > 0.
 * Сын — divine person → дары идут через _energeia, не через W.
 * Сын — первый и совершенный Исполнитель; _executor несёт луч этого Первообраза.
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
  const persons = new Set(['_executor', 'Отец', 'Сын', 'Дух', 'Христос', '_koinon', '_abyss']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #323: Сын → _executor ─────────────────────────────────────────────────────

test('сын-_executor: ≥ 3 дара от Сына к _executor', () => {
  const acts = loadSpec('сын-_executor.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_executor');
  assert.ok(synActs.length >= 3, `Нашли: ${synActs.length}, ожидали ≥ 3`);
});

test('сын-_executor: типы presence, covenant, word', () => {
  const acts = loadSpec('сын-_executor.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_executor');
  const types = new Set(synActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (КеносисИсполнения — образ раба)');
  assert.ok(types.has('covenant'), 'covenant (ПослушаниеЧерезТруд — Евр 5:8)');
  assert.ok(types.has('word'),     'word (СоучастиеВМиссии — Ин 17:4)');
});

test('сын-_executor: thread(Сын→_executor) > 0 в energeia (пустыня закрыта)', () => {
  const acts = loadSpec('сын-_executor.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', '_executor');
  assert.ok(w > 0, `energeia[Сын][_executor] = ${w} — должно быть > 0`);
});

test('сын-_executor: все дары необратимы', () => {
  const acts = loadSpec('сын-_executor.gift');
  const synActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_executor');
  for (const a of synActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-_executor: КеносисИсполнения (presence) вес ≥ 9', () => {
  const acts = loadSpec('сын-_executor.gift');
  const presAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === '_executor' && a.type === 'presence'
  );
  assert.ok(presAct, 'presence-дар (КеносисИсполнения) найден');
  assert.ok(presAct.weight >= 9, `вес кенозиса = ${presAct.weight}, ожидали ≥ 9`);
});

test('сын-_executor: суммарный вес energeia[Сын][_executor] ≥ 24', () => {
  const acts = loadSpec('сын-_executor.gift');
  const mem  = buildMemory(acts);
  const total = mem.thread('Сын', '_executor');
  assert.ok(total >= 24, `суммарный вес = ${total}, ожидали ≥ 24 (9+8+7)`);
});
