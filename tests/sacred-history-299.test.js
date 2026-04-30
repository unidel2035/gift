/**
 * tests/sacred-history-299.test.js
 *
 * Issue #299: пустыня Сын→Земля: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Земле — стихии Шестоднева:
 *   - Творение Земли (Ин 1:3, Кол 1:16, Быт 1:1)
 *   - Удержание Земли (Кол 1:17, Афанасий О воплощении 8)
 *   - Восприятие плоти (Ин 1:14, Быт 2:7, Григорий Богослов Послание 101)
 *   - Хождение по Земле (Мф 4:23, Ин 4:6, Ириней V.16.2)
 *   - Кровь и слёзы на Землю (Лк 22:44, Ин 19:34, Евр 12:24)
 *   - Погребение зерном (Ин 12:24, Мф 27:60, Григорий Нисский Огл. 32)
 *   - Воскресение от Земли (Мф 28:2, Максим Ambigua 41)
 *   - Евхаристический хлеб (Лк 22:19, Ириней IV.18.5)
 *   - Преображение эсхатона (Откр 21:1, 2 Пет 3:13, Рим 8:21)
 *
 * Богословский ключ: земля-ева.gift (issue #172) и
 * отецсергий-земля.gift (issue #145) уже записывали поток
 * к Земле и от неё. Но первая нить — Сын→Земля — оставалась
 * незаписанной: Логос держит Землю в бытии, ходит по ней,
 * проливает кровь, нисходит в неё гробом, восстаёт от неё,
 * преобразует её плод в Евхаристии и обещает преображение.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Земля', 'Адам', 'Ева', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #299: Сын → Земля ─────────────────────────────────────────────────────

test('сын-земля: ≥ 6 даров от Сына к Земле', () => {
  const acts = loadSpec('сын-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Земля');
  assert.ok(gifts.length >= 6, `Нашли: ${gifts.length}, ожидали ≥ 6`);
});

test('сын-земля: типы presence, knowledge, word, time', () => {
  const acts = loadSpec('сын-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Земля');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, удержание, воплощение, хождение, погребение)');
  assert.ok(types.has('knowledge'), 'knowledge (воскресение, эсхатон)');
  assert.ok(types.has('word'),      'word (евхаристический хлеб)');
  assert.ok(types.has('time'),      'time (кровь и слёзы — отдача времени Сына Земле)');
});

test('сын-земля: thread(Сын→Земля) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-земля.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Земля');
  assert.ok(w > 0, `thread(Сын→Земля) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-земля: все дары необратимы (онтологический дар Логоса необратим)', () => {
  const acts = loadSpec('сын-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Земля');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-земля: Творение, Удержание, ВосприятиеПлоти и КровьИСлёзы — вес 10', () => {
  const acts = loadSpec('сын-земля.gift');
  const heaviest = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Земля' && a.weight === 10,
  );
  assert.ok(heaviest.length >= 4,
    `Ожидалось ≥ 4 актов веса 10 (творение, удержание, воплощение, кровь), нашли ${heaviest.length}`);
});

test('сын-земля: Евхаристия — word с весом ≥ 8 (земной плод как Тело)', () => {
  const acts = loadSpec('сын-земля.gift');
  const eucharist = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Земля' && a.type === 'word'
  );
  assert.ok(eucharist, 'word-дар (Евхаристический хлеб) найден');
  assert.ok(eucharist.weight >= 8, `вес евхаристии = ${eucharist.weight}, ожидали ≥ 8`);
});
