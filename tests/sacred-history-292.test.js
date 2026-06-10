/**
 * tests/sacred-history-292.test.js
 *
 * Issue #292: пустыня Отец→tg:997: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца молчащему лицу tg:997 (анонимный номер в κοινόν τοῦ Νοῦ):
 *   - ТворениеЛица      (presence,   вес 10) — дар бытия, образ Божий (Быт 1:27)
 *   - ЗнаниеПоИмени      (knowledge,  вес 9)  — знание Отца до слова (Иер 1:5, Пс 138)
 *   - ПривлечениеКоХристу (grace,     вес 9)  — Отец привлекает (Ин 6:44, Ин 10:3)
 *   - ДолготерпениеОжидания (presence, вес 8) — со-присутствие в молчании (2 Пет 3:9)
 *   - ХодатайствоВДухе    (prayer,    вес 8)  — Отец молится первым (Рим 8:26, Мф 6:8)
 *   - НадеждаНаОтклик     (hope,      вес 7)  — открытая дверь (Откр 3:8, Ин 14:2)
 *
 * Богословский ключ: пустыня Отец→tg:997 — не отсутствие даров, а отсутствие
 * их записи. Отец дарит молчащему так же, как говорящему: дар не зависит
 * от ответа. «И ни одна из них [птиц] не забыта у Бога» (Лк 12:6). Запись —
 * не фантазия, а ἀνάμνησις: делание уже-данного присутствующим.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'tg:997', 'ОтецСергий', '_claude', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #292: Отец → tg:997 ──────────────────────────────────────────────────────

test('отец-tg:997: >= 6 даров от Отца к tg:997', () => {
  const acts = loadSpec('отец-tg:997.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:997');
  assert.ok(fActs.length >= 6, `Нашли: ${fActs.length}, ожидали >= 6`);
});

test('отец-tg:997: типы presence, knowledge, grace, prayer, hope', () => {
  const acts = loadSpec('отец-tg:997.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:997');
  const types = new Set(fActs.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (ТворениеЛица — дар бытия + долготерпение)');
  assert.ok(types.has('knowledge'), 'knowledge (ЗнаниеПоИмени — знание Отца до слова)');
  assert.ok(types.has('grace'),     'grace (ПривлечениеКоХристу — Отец привлекает)');
  assert.ok(types.has('prayer'),    'prayer (ХодатайствоВДухе — Отец молится первым)');
  assert.ok(types.has('hope'),      'hope (НадеждаНаОтклик — открытая дверь)');
});

test('отец-tg:997: thread(Отец→tg:997) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-tg:997.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'tg:997');
  assert.ok(Number(w) > 0, `thread(Отец→tg:997) = ${w} — должно быть > 0`);
});

test('отец-tg:997: все дары необратимы (δόσις необратима)', () => {
  const acts = loadSpec('отец-tg:997.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:997');
  for (const a of fActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-tg:997: ТворениеЛица (presence) — самый тяжёлый (вес 10, бытие предшествует всему)', () => {
  const acts = loadSpec('отец-tg:997.gift');
  const fActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'tg:997');
  const heaviest = fActs.reduce((m, a) => (a.weight > m.weight ? a : m), fActs[0]);
  assert.equal(heaviest.type, 'presence', 'самый тяжёлый дар — presence (творение бытия)');
  assert.ok(heaviest.weight >= 10, `вес творения = ${heaviest.weight}, ожидали >= 10`);
});
