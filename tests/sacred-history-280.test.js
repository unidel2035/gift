/**
 * tests/sacred-history-280.test.js
 *
 * Issue #280: вопрошание: пустыня Отец→Денис: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Денису:
 *   - Бытие в Отце (presence, вес 9) — Отец присутствует в самом бытии Дениса
 *   - Имя как призвание (word, вес 8) — имя Дионисия Ареопагита открывает апофатику
 *   - Усыновление в Крещении (word, вес 10) — «Ты сын Мой возлюбленный»
 *   - Призвание свидетельства (knowledge, вес 7) — апофатическая честность ума
 *
 * Богословский ключ: Отец — Источник всякого имени (Еф 3:14–15).
 * Денис — лицо общины, носящее имя Дионисия Ареопагита (Деян 17:34).
 * Пустыня между Отцом и Денисом — не разрыв, а незаписанная первооснова:
 * бытие, имя, усыновление, призвание. Без Отца Денис — прах; в Отце — сын.
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
  const persons = new Set(['Денис', 'Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', 'ОтецСергий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #280: Отец → Денис ───────────────────────────────────────────────────────

test('отец-денис: ≥ 3 дара от Отца к Денису', () => {
  const acts = loadSpec('отец-денис.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Денис');
  assert.ok(fatherActs.length >= 3, `Нашли: ${fatherActs.length}, ожидали ≥ 3`);
});

test('отец-денис: типы presence, word, knowledge (бытие, имя/усыновление, призвание)', () => {
  const acts = loadSpec('отец-денис.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Денис');
  const types = new Set(fatherActs.map(a => a.type));
  assert.ok(types.has('presence'),   'presence (бытие в Отце — Отец присутствует в самом бытии Дениса)');
  assert.ok(types.has('word'),       'word (имя как призвание; усыновление — «Ты сын Мой»)');
  assert.ok(types.has('knowledge'),  'knowledge (апофатическое призвание свидетельства)');
});

test('отец-денис: thread(Отец→Денис) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-денис.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Денис');
  assert.ok(w > 0, `thread(Отец→Денис) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-денис: все дары необратимы (слово Отца не возвращается тщетным — Ис 55:11)', () => {
  const acts = loadSpec('отец-денис.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Денис');
  for (const a of fatherActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-денис: УсыновлениеВКрещении (word) вес = 10 (высший дар — «Ты сын Мой»)', () => {
  const acts = loadSpec('отец-денис.gift');
  const adoption = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Денис' && a.type === 'word' && a.weight === 10
  );
  assert.ok(adoption, 'Усыновление в Крещении с весом 10 найдено (Мк 1:11; 1 Ин 3:1)');
});

test('отец-денис: БытиеВОтце (presence) вес ≥ 9 (бытие — основание всех даров)', () => {
  const acts = loadSpec('отец-денис.gift');
  const beingAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Денис' && a.type === 'presence'
  );
  assert.ok(beingAct, 'presence-дар найден');
  assert.ok(beingAct.weight >= 9, `вес бытия = ${beingAct.weight}, ожидали ≥ 9 (Иер 1:5; Еф 1:4)`);
});
