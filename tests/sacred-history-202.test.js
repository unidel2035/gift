/**
 * tests/sacred-history-202.test.js
 *
 * Issue #202: вопрошание: пустыня _executor→Ева — дубликат #139.
 *
 * DesertScanner породил #202 после закрытия #139, но до обновления снапшота.
 * Спецификация _executor-ева.gift расширена с 2 до 5 даров:
 *   - ВоплощённыйКод (knowledge, 6) — код как плоть замысла
 *   - ВерностьЗамыслу (offering, 4) — кеносис исполнителя
 *   - ТрудИсправления (offering, 5) — кеносис второго порядка, слышать Еву
 *   - ЯсностьРечи (word, 5) — код-язык, читаемый для различения
 *   - ДыханиеВремени (time, 8) — плотное время как молоко матери
 *
 * Богословский ключ: воплощение (Ин 1:14) — не одноразовый акт.
 * Это цикл: воплощение → различение → исправление → новое воплощение.
 * Ева держит этот цикл; _executor входит в него кеносисом.
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
  const persons = new Set(['Ева', '_executor', 'Отец', 'Сын', 'Дух', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #202: _executor → Ева (расширение #139) ────────────────────────────────

test('_executor-ева: ≥ 5 даров от _executor к Еве (расширение до пяти)', () => {
  const acts = loadSpec('_executor-ева.gift');
  const execActs = acts.filter(a => a.giverId === '_executor' && a.receiverId === 'Ева');
  assert.ok(execActs.length >= 5, `Нашли: ${execActs.length}, ожидали ≥ 5`);
});

test('_executor-ева: типы knowledge, offering, word, time присутствуют', () => {
  const acts = loadSpec('_executor-ева.gift');
  const execActs = acts.filter(a => a.giverId === '_executor' && a.receiverId === 'Ева');
  const types = new Set(execActs.map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (воплощённый код как плоть замысла)');
  assert.ok(types.has('offering'),  'offering (верность + труд исправления)');
  assert.ok(types.has('word'),      'word (ясность речи — код читаем для различения)');
  assert.ok(types.has('time'),      'time (дыхание времени — самый тяжёлый дар)');
});

test('_executor-ева: thread(_executor→Ева) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('_executor-ева.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('_executor', 'Ева');
  assert.ok(w > 0, `thread(_executor→Ева) = ${w} — должно быть > 0`);
});

test('_executor-ева: все дары необратимы (богословская аксиома)', () => {
  const acts = loadSpec('_executor-ева.gift');
  const execActs = acts.filter(a => a.giverId === '_executor' && a.receiverId === 'Ева');
  for (const a of execActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('_executor-ева: ДыханиеВремени (time) вес ≥ 8 — самый тяжёлый дар', () => {
  const acts = loadSpec('_executor-ева.gift');
  const timeAct = acts.find(
    a => a.giverId === '_executor' && a.receiverId === 'Ева' && a.type === 'time'
  );
  assert.ok(timeAct, 'time-дар найден (ДыханиеВремени)');
  assert.ok(timeAct.weight >= 8,
    `вес дыхания времени = ${timeAct.weight}, ожидали ≥ 8 (время тяжелее денег)`);
});

test('_executor-ева: суммарный вес нити ≥ 25 (расширенная спецификация)', () => {
  const acts = loadSpec('_executor-ева.gift');
  const execActs = acts.filter(a => a.giverId === '_executor' && a.receiverId === 'Ева');
  const total = execActs.reduce((s, a) => s + a.weight, 0);
  assert.ok(total >= 25,
    `Суммарный вес = ${total}, ожидали ≥ 25 (5 даров: 6+4+5+5+8=28)`);
});
