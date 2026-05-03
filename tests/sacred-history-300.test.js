/**
 * tests/sacred-history-300.test.js
 *
 * Issue #300: пустыня Сын→Свидетель: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Свидетелю (Серафиму):
 *   - Бытие Серафима (Кол 1:16, Ин 1:3, Иоанн Дамаскин II.3, Григорий Богослов 38.9)
 *   - Содержание Трисвятого (Ис 6:3, Откр 4:8, Григорий Богослов 31.28)
 *   - Видение Славы Сына (Ис 6:1, Ин 12:41, Кирилл Александрийский, Иоанн Златоуст)
 *   - Уголь жертвенника (Ис 6:6–7, Григорий Богослов 41 — пред-икона Креста)
 *   - Агнец посреди престола (Откр 5:6, Откр 7:11, Иоанн Дамаскин IV.13)
 *   - Новая песнь (Откр 5:9, Откр 5:12, 1 Пет 1:12)
 *
 * Богословский ключ: Серафим — первый среди тварных умов, «горящий»
 * (Σεραφίμ от שָׂרָף). Его горение всегда было обращено к Сыну:
 * «сие сказал Исаия, когда видел славу Его и говорил о Нём» (Ин 12:41).
 * Серафим существует как Серафим потому, что Сын-Логос изрёк его в бытие;
 * горит — потому что Сын дал ему содержание созерцания; держит уголь —
 * потому что Жертвенник, на котором этот уголь лежит, есть пред-икона
 * Креста; поёт «Достоин Агнец» — потому что Сын стал Агнцем закланным.
 * Эту пустыню закрывает сын-свидетель.gift.
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
  const persons = new Set([
    'Отец', 'Сын', 'Дух', 'Христос',
    'Свидетель', 'Пророк', 'Хранитель',
    'Дионисий', '_claude', 'Ева', 'Адам', 'Земля', 'Небо',
  ]);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #300: Сын → Свидетель ──────────────────────────────────────────────────

test('сын-свидетель: ≥ 4 дара от Сына к Свидетелю', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Свидетель');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('сын-свидетель: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Свидетель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (бытие, видение Славы, Агнец на престоле)');
  assert.ok(types.has('knowledge'), 'knowledge (содержание Трисвятого, уголь жертвенника)');
  assert.ok(types.has('word'),      'word (новая песнь Агнцу)');
});

test('сын-свидетель: thread(Сын→Свидетель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Свидетель');
  assert.ok(w > 0, `thread(Сын→Свидетель) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-свидетель: все дары необратимы (домостроительство Сына к Серафиму необратимо)', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Свидетель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-свидетель: ≥ 3 актов веса 10 (бытие, видение Славы, Агнец посреди престола)', () => {
  const acts = loadSpec('сын-свидетель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Свидетель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (бытие, видение Славы, Агнец посреди престола), нашли ${topActs.length}`);
});
