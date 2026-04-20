/**
 * tests/sacred-history-229.test.js
 *
 * Issue #229: пустыня Дионисий→Христос: нет ни одного акта дара между ними
 *
 * Проверяет дары Дионисия Христу:
 *   - Исповедание Имени (word, вес 9) — апофатическое сверх-имянаречение (Флп 2:9)
 *   - Вопрошание как молитва (presence, вес 8) — каждое вопрошание обращено ко Христу (1 Фес 5:17)
 *   - Тело богословия (knowledge, вес 8) — корпус проекта как жертва живая (Рим 12:1)
 *   - Служение общине ради Христа (word, вес 7) — Мф 25:40 / Кол 1:18
 *
 * Богословский ключ: Христос — Глава Тела (Кол 1:18), Первосвященник (Евр 4:14).
 * Каждая нить Дионисий→X есть скрытая нить Дионисий→Христос.
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
  const persons = new Set(['Дионисий', 'Христос', 'Отец', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #229: Дионисий → Христос ─────────────────────────────────────────────────

test('дионисий-христос: >= 4 дара от Дионисия к Христу', () => {
  const acts = loadSpec('дионисий-христос.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === 'Христос');
  assert.ok(dActs.length >= 4, `Нашли: ${dActs.length}, ожидали >= 4`);
});

test('дионисий-христос: типы word, presence, knowledge (исповедание, молитва, богословие, служение)', () => {
  const acts = loadSpec('дионисий-христос.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === 'Христос');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('word'),      'word (исповедание / служение)');
  assert.ok(types.has('presence'),  'presence (вопрошание-молитва)');
  assert.ok(types.has('knowledge'), 'knowledge (тело богословия)');
});

test('дионисий-христос: thread(Дионисий→Христос) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('дионисий-христос.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Дионисий', 'Христос');
  assert.ok(w > 0, `thread(Дионисий→Христос) = ${w} — должно быть > 0`);
});

test('дионисий-христос: все дары необратимы', () => {
  const acts = loadSpec('дионисий-христос.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === 'Христос');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('дионисий-христос: ИсповеданиеИмени — самый тяжёлый (word вес >= 9)', () => {
  const acts = loadSpec('дионисий-христос.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Дионисий' && a.receiverId === 'Христос' && a.type === 'word'
  );
  const maxWord = Math.max(...wordActs.map(a => a.weight));
  assert.ok(maxWord >= 9, `максимальный вес word = ${maxWord}, ожидали >= 9 (Флп 2:9)`);
});

test('дионисий-христос: суммарный вес потока >= 30 (плотная нить)', () => {
  const acts = loadSpec('дионисий-христос.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === 'Христос');
  const total = dActs.reduce((s, a) => s + a.weight, 0);
  assert.ok(total >= 30, `суммарный вес = ${total}, ожидали >= 30`);
});
