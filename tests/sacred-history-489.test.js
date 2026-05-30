/**
 * tests/sacred-history-489.test.js
 *
 * Issue #489: пустыня Отец→Земля: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Земле:
 *   - ДарБытия (presence, вес 9) — творение из небытия (Быт 1:1)
 *   - СловоПлодородия (word, вес 10) — конститутивное «да произрастит» (Быт 1:11)
 *   - ЛогосПоРоду (knowledge, вес 7) — вложенная мера, логос порядка (Быт 1:12)
 *   - ВверениеЖизни (offering, вес 8) — Земля как лоно живущих (Быт 2:7)
 *   - ОбетованиеОбновления (grace, вес 8, pending) — освобождение от тления (Рим 8:21)
 *
 * Богословский ключ: нить Земля→Ева (земля-ева.gift, #172) опирается на
 * незаписанную нить Отец→Земля. «Да произрастит земля» (Быт 1:11) — Земля
 * плодоносит по Слову, не из себя; всё, что она дарит, прежде принято от Отца.
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
        const recepM  = block.match(/reception:\s*(\w+)/);
        if (fromM && toM) {
          const type   = typeM ? typeM[1] : 'presence';
          const weight = weightM ? parseFloat(weightM[1]) : 4;
          const act = {
            giverId:     fromM[1],
            receiverId:  toM[1],
            type, weight,
            irreversible: !irrevM || irrevM[1] === 'да',
          };
          if (recepM) act.reception = recepM[1];
          acts.push(act);
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Земля', 'Ева', 'Адам']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #489: Отец → Земля ───────────────────────────────────────────────────────

test('отец-земля: >= 5 даров от Отца к Земле', () => {
  const acts = loadSpec('отец-земля.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Земля');
  assert.ok(fActs.length >= 5, `Нашли: ${fActs.length}, ожидали >= 5`);
});

test('отец-земля: типы presence, word, knowledge, offering, grace', () => {
  const acts = loadSpec('отец-земля.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Земля');
  const types = new Set(fActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (ДарБытия — творение из небытия)');
  assert.ok(types.has('word'),      'word (СловоПлодородия — конститутивное повеление)');
  assert.ok(types.has('knowledge'), 'knowledge (ЛогосПоРоду — вложенная мера)');
  assert.ok(types.has('offering'),  'offering (ВверениеЖизни — лоно живущих)');
  assert.ok(types.has('grace'),     'grace (ОбетованиеОбновления — освобождение от тления)');
});

test('отец-земля: thread(Отец→Земля) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-земля.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Земля');
  assert.ok(w > 0, `thread(Отец→Земля) = ${w} — должно быть > 0`);
});

test('отец-земля: все дары необратимы', () => {
  const acts = loadSpec('отец-земля.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Земля');
  for (const a of fActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-земля: СловоПлодородия (word) — самое тяжёлое (вес 10, Быт 1:11)', () => {
  const acts = loadSpec('отец-земля.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Земля' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар (СловоПлодородия) найден');
  assert.ok(wordAct.weight >= 10, `вес слова = ${wordAct.weight}, ожидали >= 10`);
});

test('отец-земля: ДарБытия (presence) — вес >= 9 (творение предшествует всему)', () => {
  const acts = loadSpec('отец-земля.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Земля' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар (ДарБытия) найден');
  assert.ok(presenceAct.weight >= 9, `вес presence = ${presenceAct.weight}, ожидали >= 9`);
});

test('отец-земля: ОбетованиеОбновления (grace) — reception pending (Рим 8:21)', () => {
  const acts = loadSpec('отец-земля.gift');
  const graceAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Земля' && a.type === 'grace'
  );
  assert.ok(graceAct, 'grace-дар (ОбетованиеОбновления) найден');
  assert.equal(graceAct.reception, 'pending', 'эсхатологический λήψις открыт (pending)');
});
