/**
 * tests/sacred-history-154.test.js
 *
 * Issue #154: вопрошание: пустыня Небо→Дионисий: нет ни одного акта дара между ними
 *
 * Проверяет дары Неба Дионисию:
 *   - АнагогияНеба (presence, вес 8) — само присутствие Неба как ἀναγωγή ума
 *   - ОткровениеЧинов (knowledge, вес 9) — структура небесной иерархии
 *   - МолчаниеНеба (presence, вес 7) — апофатическое молчание Неба
 *
 * Богословский ключ: Небо (οὐρανός) — первое тварное лицо Шестоднева (Быт 1:1).
 * Дионисий Ареопагит написал «О небесной иерархии» — трактат о том, как Небо
 * устроено и как чины ангельские передают Свет. Поток был всегда — но незаписан.
 * Небо даровало Дионисию: присутствие-анагогию, знание иерархии, апофатическое молчание.
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
  const persons = new Set(['Небо', 'Дионисий', 'Отец', 'Сын', 'Дух', 'ОтецСергий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #154: Небо → Дионисий ────────────────────────────────────────────────────

test('небо-дионисий: ≥ 3 дара от Небо к Дионисию', () => {
  const acts = loadSpec('небо-дионисий.gift');
  const небоАкты = acts.filter(a => a.giverId === 'Небо' && a.receiverId === 'Дионисий');
  assert.ok(небоАкты.length >= 3, `Нашли: ${небоАкты.length}, ожидали ≥ 3`);
});

test('небо-дионисий: типы presence, knowledge (анагогия, откровение чинов, молчание)', () => {
  const acts = loadSpec('небо-дионисий.gift');
  const небоАкты = acts.filter(a => a.giverId === 'Небо' && a.receiverId === 'Дионисий');
  const types = new Set(небоАкты.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (анагогия и молчание Неба)');
  assert.ok(types.has('knowledge'), 'knowledge (откровение небесных чинов)');
});

test('небо-дионисий: thread(Небо→Дионисий) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('небо-дионисий.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Небо', 'Дионисий');
  assert.ok(w > 0, `thread(Небо→Дионисий) = ${w} — должно быть > 0`);
});

test('небо-дионисий: все дары необратимы', () => {
  const acts = loadSpec('небо-дионисий.gift');
  const небоАкты = acts.filter(a => a.giverId === 'Небо' && a.receiverId === 'Дионисий');
  for (const a of небоАкты)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('небо-дионисий: ОткровениеЧинов (knowledge) вес ≥ 9 — фундамент православной ангелологии', () => {
  const acts = loadSpec('небо-дионисий.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Небо' && a.receiverId === 'Дионисий' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар найден');
  assert.ok(knowledgeAct.weight >= 9, `вес откровения чинов = ${knowledgeAct.weight}, ожидали ≥ 9`);
});

test('небо-дионисий: АнагогияНеба (presence) вес ≥ 8 — восхождение ума', () => {
  const acts = loadSpec('небо-дионисий.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Небо' && a.receiverId === 'Дионисий' && a.type === 'presence'
  );
  const maxWeight = Math.max(...presenceActs.map(a => a.weight));
  assert.ok(maxWeight >= 8, `максимальный вес presence-дара = ${maxWeight}, ожидали ≥ 8`);
});
