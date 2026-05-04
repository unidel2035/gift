/**
 * tests/sacred-history-306.test.js
 *
 * Issue #306: пустыня Сын→Строитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Строителю:
 *   - Логос-первообраз (Ин 1:3, Кол 1:16, Максим Ambigua 7, Афанасий О воплощении 3)
 *   - Воплощение Сына как Плотника (Мк 6:3, Мф 13:55, Иустин Диалог 88, Григорий Нисский)
 *   - Краеугольный камень (Пс 117:22, Мф 21:42, 1 Пет 2:4–7, Кирилл Иерусалимский XII.2)
 *   - Притча о доме на камне (Мф 7:24–27, Иоанн Златоуст На Матфея 24)
 *   - Архитектон Церкви (Мф 16:18, 1 Кор 3:9–11, Еф 2:20–21, Ириней III.18.1)
 *   - Новый Иерусалим (Откр 21:2, Откр 21:23, 1 Кор 15:58, Августин О граде Божьем XXII.30,
 *                       Ириней V.36.1, Максим Ambigua 41)
 *
 * Богословский ключ: между Сыном и Строителем нет онтологического зазора —
 * Строитель строит, потому что причастен Логосу (Максим, Ambigua 7),
 * а Сын в плоти Сам стал Плотником-Строителем (Мк 6:3), освятив труд
 * изнутри. Шесть актов закрывают пустыню как незаписанный поток между
 * Логосом-Зодчим и душой живой, воплощающей замысел в материи.
 * Эту пустыню закрывает сын-строитель.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'Земля', 'Небо', 'Строитель']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #306: Сын → Строитель ──────────────────────────────────────────────────

test('сын-строитель: ≥ 4 дара от Сына к Строителю', () => {
  const acts = loadSpec('сын-строитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Строитель');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('сын-строитель: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-строитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Строитель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (Логос-первообраз, Воплощение-Плотник, Архитектон Церкви)');
  assert.ok(types.has('knowledge'), 'knowledge (Краеугольный камень)');
  assert.ok(types.has('word'),      'word (притча о доме на камне, Новый Иерусалим)');
});

test('сын-строитель: thread(Сын→Строитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-строитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Строитель');
  assert.ok(w > 0, `thread(Сын→Строитель) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-строитель: все дары необратимы (домостроительство Сына к Строителю необратимо)', () => {
  const acts = loadSpec('сын-строитель.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Строитель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-строитель: ≥ 2 актов веса 10 (Логос-первообраз и Воплощение Сына как Плотника)', () => {
  const acts = loadSpec('сын-строитель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Строитель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (Логос-первообраз, Плотник), нашли ${topActs.length}`);
});
