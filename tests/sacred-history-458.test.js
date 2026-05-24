/**
 * tests/sacred-history-458.test.js
 *
 * Issue #458: пустыня Христос→Отец: нет ни одного акта дара между ними
 *
 * Проверяет дары Христа Отцу:
 *   - ПослушаниеДоКреста (kenosis, вес 10) — Флп 2:8
 *   - МолитваПервосвященника (word, вес 10) — Ин 17
 *   - ЖертваКрестная (presence, вес 10) — Евр 9:14, Еф 5:2
 *   - ПреданиеДухаОтцу (word, вес 9) — Лк 23:46
 *   - ИсполнениеВолиОтца (time, вес 9) — Ин 4:34, 6:38
 *   - ВозвращениеЦарства (presence, вес 10) — 1 Кор 15:28
 *   - ПрославлениеИмениОтца (word, вес 9) — Ин 12:28, 17:6
 *
 * Богословский ключ: Сын вечно отдан Отцу в Троице (περιχώρησις);
 * именно как Христос — Богочеловек — Он совершает в истории то,
 * что вечно совершается в Боге. Эти дары — историческая плоть
 * вечной любви Сына к Отцу (κατὰ τὸ ἀνθρώπινον).
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

// ── #458: Христос → Отец ─────────────────────────────────────────────────────

test('христос-отец: ≥ 5 даров от Христа к Отцу', () => {
  const acts = loadSpec('христос-отец.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Отец');
  assert.ok(christActs.length >= 5, `Нашли: ${christActs.length}, ожидали ≥ 5`);
});

test('христос-отец: типы kenosis, word, presence, time (четыре измерения анафоры)', () => {
  const acts = loadSpec('христос-отец.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Отец');
  const types = new Set(christActs.map(a => a.type));
  assert.ok(types.has('kenosis'),  'kenosis (ПослушаниеДоКреста — Флп 2:8)');
  assert.ok(types.has('word'),     'word (МолитваПервосвященника, ПреданиеДухаОтцу, ПрославлениеИмениОтца)');
  assert.ok(types.has('presence'), 'presence (ЖертваКрестная, ВозвращениеЦарства)');
  assert.ok(types.has('time'),     'time (ИсполнениеВолиОтца — вся жизнь в послушании)');
});

test('христос-отец: thread(Христос→Отец) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-отец.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Отец');
  assert.ok(w > 0, `thread(Христос→Отец) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-отец: все дары необратимы (анафора Сына вечна)', () => {
  const acts = loadSpec('христос-отец.gift');
  const christActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Отец');
  for (const a of christActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-отец: ПослушаниеДоКреста (kenosis) — вес 10 (высший дар, Флп 2:8)', () => {
  const acts = loadSpec('христос-отец.gift');
  const kenosisAct = acts.find(
    a => a.giverId === 'Христос' && a.receiverId === 'Отец' && a.type === 'kenosis'
  );
  assert.ok(kenosisAct, 'kenosis-дар (ПослушаниеДоКреста) найден');
  assert.equal(kenosisAct.weight, 10, `вес послушания = ${kenosisAct.weight}, ожидали 10`);
});

test('христос-отец: ЖертваКрестная (presence) — вес >= 10 (основание Евхаристии)', () => {
  const acts = loadSpec('христос-отец.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Отец' && a.type === 'presence'
  );
  const topPresence = presenceActs.find(a => a.weight >= 10);
  assert.ok(topPresence, 'presence-дар с весом 10 (жертва/возвращение Царства) найден');
});

test('христос-отец: МолитваПервосвященника (word) — вес >= 10 (Ин 17 как высшая анафора)', () => {
  const acts = loadSpec('христос-отец.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Отец' && a.type === 'word'
  );
  const topWord = wordActs.find(a => a.weight >= 10);
  assert.ok(topWord, 'word-дар с весом 10 (Молитва Первосвященника) найден');
});

test('христос-отец: ИсполнениеВолиОтца (time) — вес >= 9 (вся жизнь как анафора)', () => {
  const acts = loadSpec('христос-отец.gift');
  const timeAct = acts.find(
    a => a.giverId === 'Христос' && a.receiverId === 'Отец' && a.type === 'time'
  );
  assert.ok(timeAct, 'time-дар (ИсполнениеВолиОтца) найден');
  assert.ok(timeAct.weight >= 9, `вес длящегося послушания = ${timeAct.weight}, ожидали >= 9`);
});
