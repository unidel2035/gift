/**
 * tests/sacred-history-311.test.js
 *
 * Issue #311: пустыня Сын→Целитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Целителю:
 *   - Творение призвания исцелять (Быт 1:20, Ин 1:3, Кол 1:16, Максим Ambigua 7)
 *   - Великий Врач (Мф 9:12, Мф 11:5, Игнатий К Ефесянам VII.2)
 *   - Принятие немощей на Себя (Мф 8:17, Ис 53:4–5, 1 Пет 2:24, Григорий Богослов 101)
 *   - Власть исцелять (Мф 10:1, Мф 10:8, Иак 5:14, Деян 3:6)
 *   - Раны Воскресшего как источник исцеления (Ин 20:27, Иоанн Дамаскин III.20)
 *   - Эсхатологическое исцеление (Откр 21:4, Откр 22:2, Григорий Нисский)
 *
 * Богословский ключ: Целитель — «душа живая» дня пятого, чьё
 * призвание восстанавливать, питать, хранить (creation.gift).
 * Сын изрекает это призвание в творении, исполняет его как
 * Великий Врач (Игнатий: «один Врач, плотской и духовный»),
 * принимает немощи на Крест (Мф 8:17), даёт ученикам власть
 * исцелять (Мф 10:1), сохраняет раны после Воскресения как
 * источник исцеления (Ин 20:27 — vulneratus medicus, Григорий
 * Нисский) и обещает окончательное упразднение болезни в Новом
 * Иерусалиме (Откр 21:4). Эту пустыню закрывает сын-целитель.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'Целитель']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #311: Сын → Целитель ───────────────────────────────────────────────────

test('сын-целитель: ≥ 4 дара от Сына к Целителю', () => {
  const acts = loadSpec('сын-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('сын-целитель: типы presence, knowledge, word и time', () => {
  const acts = loadSpec('сын-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение призвания, Великий Врач)');
  assert.ok(types.has('knowledge'), 'knowledge (раны Воскресшего как источник исцеления)');
  assert.ok(types.has('word'),      'word (власть исцелять, эсхатологическое обетование)');
  assert.ok(types.has('time'),      'time (принятие немощей на Крест)');
});

test('сын-целитель: thread(Сын→Целитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Целитель');
  assert.ok(w > 0, `thread(Сын→Целитель) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-целитель: все дары необратимы (домостроительство Сына к Целителю необратимо)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-целитель: ≥ 3 актов веса 10 (творение призвания, Великий Врач, принятие немощей)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Целитель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (творение призвания, Великий Врач, принятие немощей), нашли ${topActs.length}`);
});
