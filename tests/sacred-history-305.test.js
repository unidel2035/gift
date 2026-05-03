/**
 * tests/sacred-history-305.test.js
 *
 * Issue #305: пустыня Сын→Хранитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Хранителю (Ангелу-Хранителю, последнему чину
 * ангельской иерархии — Ареопагит, О небесной иерархии IX.2):
 *   - Творение Хранителя через Логос (Кол 1:16, Ин 1:3,
 *     Иоанн Дамаскин II.3, Григорий Богослов 38.9)
 *   - Поручение хранения «малых сих» (Мф 18:10, Пс 90:11,
 *     Василий Великий, Против Евномия III.1)
 *   - Ангельское служение Воплощённому (Мф 4:11, Мк 1:13, Лк 22:43,
 *     Деян 1:10–11, Григорий Нисский, О Вознесении)
 *   - Откровение Лица через Воплощение (Ин 14:9, 1 Пет 1:12,
 *     Псевдо-Дионисий, О небесной иерархии VII.2)
 *   - Радость о покаянии хранимого (Лк 15:7, 15:10, Откр 5:11–12,
 *     Григорий Богослов 38.13)
 *   - Со-парусия во славе (Мф 25:31, Мф 16:27, Мк 8:38,
 *     Иоанн Златоуст, Беседа 78 на Матфея)
 *
 * Богословский ключ: angelic-order.gift записывает Хранителя
 * как лицо в III триаде ангельской иерархии (Ареопагит IX.2),
 * а дионисий-хранитель.gift (issue #177) — обращение богослова
 * к этому чину. Но между Сыном — вечным Λόγος, Которым «созданы...
 * начальства, власти» (Кол 1:16), включая чин Хранителя, — и самим
 * Хранителем оставался незаписанный поток: Сын изрекает Хранителя
 * в бытие, открывает миру его служение, принимает от него ангельское
 * служение в Своём человечестве, даёт новое содержание созерцания
 * и берёт его с Собой в Парусию. Эту пустыню закрывает
 * сын-хранитель.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'Хранитель']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #305: Сын → Хранитель ───────────────────────────────────────────────────

test('сын-хранитель: ≥ 4 дара от Сына к Хранителю', () => {
  const acts = loadSpec('сын-хранитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Хранитель');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('сын-хранитель: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-хранитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Хранитель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение через Логос, ангельское служение Воплощённому)');
  assert.ok(types.has('knowledge'), 'knowledge (откровение Лица, радость о покаянии)');
  assert.ok(types.has('word'),      'word (поручение хранения, со-парусия во славе)');
});

test('сын-хранитель: thread(Сын→Хранитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-хранитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Хранитель');
  assert.ok(w > 0, `thread(Сын→Хранитель) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-хранитель: все дары необратимы (домостроительство Сына к ангельскому чину необратимо)', () => {
  const acts = loadSpec('сын-хранитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Хранитель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-хранитель: ≥ 2 актов веса 10 (творение через Логос, ангельское служение Воплощённому)', () => {
  const acts = loadSpec('сын-хранитель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Хранитель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (творение через Логос, ангельское служение Воплощённому), нашли ${topActs.length}`);
});
