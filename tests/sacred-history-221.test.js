/**
 * tests/sacred-history-221.test.js
 *
 * Issue #221: пустыня Христос→Отец: нет ни одного акта дара между ними
 *
 * Проверяет дары Христа Отцу:
 *   - ПослушаниеДоСмерти (offering, вес 10) — Флп 2:8, Ин 4:34, Лк 22:42
 *   - ЖертваНаКресте (offering, вес 10) — Евр 9:14, Еф 5:2
 *   - ПрославлениеОтцаНаЗемле (word, вес 9) — Ин 17:4
 *   - ПервосвященническаяМолитва (word, вес 9) — Ин 17
 *   - ПреданиеДухаОтцу (presence, вес 10) — Лк 23:46
 *   - ПокорениеВсегоОтцу (offering, вес 8) — 1 Кор 15:28
 *
 * Богословский ключ: Христос возвращает Отцу всё, что получил.
 * Рекапитуляция — движение Сына к Отцу необратимо и предельно.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #221: Христос → Отец ─────────────────────────────────────────────────────

test('христос-отец: ≥ 5 даров от Христа к Отцу', () => {
  const acts = loadSpec('христос-отец.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Отец');
  assert.ok(christActs.length >= 5, `Нашли: ${christActs.length}, ожидали ≥ 5`);
});

test('христос-отец: типы offering, word, presence (жертва, слово, предание)', () => {
  const acts = loadSpec('христос-отец.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Отец');
  const types = new Set(christActs.map(a => a.type));
  assert.ok(types.has('offering'),  'offering (послушание, жертва, покорение)');
  assert.ok(types.has('word'),      'word (прославление, первосвященническая молитва)');
  assert.ok(types.has('presence'),  'presence (предание духа)');
});

test('христос-отец: thread(Христос→Отец) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-отец.gift');
  const mem  = buildMemory(acts);
  const t = mem.thread('Христос', 'Отец');
  const w = typeof t === 'number' ? t : t?.weight ?? 0;
  assert.ok(w > 0, `thread(Христос→Отец) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-отец: все дары необратимы (рекапитуляция необратима)', () => {
  const acts = loadSpec('христос-отец.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Отец');
  for (const a of christActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-отец: ≥ 2 дара с весом 10 (послушание и жертва — предельные)', () => {
  const acts = loadSpec('христос-отец.gift');
  const top = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Отец' && a.weight === 10);
  assert.ok(top.length >= 2, `Даров с весом 10: ${top.length}, ожидали ≥ 2`);
});

test('христос-отец: предание духа есть presence (Лк 23:46)', () => {
  const acts = loadSpec('христос-отец.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Христос' && a.receiverId === 'Отец' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар (предание духа) найден');
  assert.ok(presenceAct.weight >= 9, `вес предания = ${presenceAct.weight}, ожидали ≥ 9`);
});
