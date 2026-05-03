/**
 * tests/sacred-history-304.test.js
 *
 * Issue #304: пустыня Сын→Пророк: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Пророку (Архангелу — вестнику замысла Божия):
 *   - Творение Архангелов через Слово (Кол 1:16, Ин 1:3, Евр 1:3,
 *     Псевдо-Дионисий О небесной иерархии IV.2)
 *   - Посольство Благовещения (Лк 1:19, Лк 1:26–28, Дан 8:16,
 *     Дан 9:21–23, Григорий Чудотворец)
 *   - Откровение тайны Воплощения ангельским чинам (Еф 3:10,
 *     1 Пет 1:12, 1 Тим 3:16, Псевдо-Дионисий О небесной иерархии VII)
 *   - Весть Воскресения (Мф 28:2, Мк 16:6–7, Лк 24:5–6,
 *     Иоанн Златоуст На Матфея 90.1)
 *   - Воцарение во Имя — главенство над всяким начальством
 *     (1 Пет 3:22, Еф 1:10, Еф 1:21, Кол 2:10, Максим Ambigua 41)
 *   - Эсхатологический глас архангела (1 Фес 4:16, Мф 24:31,
 *     Григорий Богослов Слово 40.5)
 *
 * Богословский ключ: «Лицо Пророк» в этой онтологии — Архангел,
 * вестник замысла Божия (Дан 8:16, Лк 1:26). Между Сыном — вечным
 * Λόγος, через Которого «всё начало быть» (Ин 1:3), и Архангелом —
 * служебным духом (Евр 1:14) — пустыня была не богословским
 * умолчанием, а онтологической тишиной между Логосом и Его
 * служебным голосом в твари. Архангел не имеет собственной речи —
 * его речь заимствована у Сына: всякое «радуйся» (Лк 1:28),
 * всякое «Он воскрес» (Мф 28:6), всякое «при гласе Архангела»
 * (1 Фес 4:16) — это эхо вечного Слова в тварной природе.
 * Эту пустыню закрывает сын-пророк.gift.
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
    'Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude',
    'Ева', 'Адам', 'Земля', 'Небо',
    'Свидетель', 'Пророк', 'Хранитель',
  ]);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #304: Сын → Пророк ─────────────────────────────────────────────────────

test('сын-пророк: ≥ 4 дара от Сына к Пророку', () => {
  const acts = loadSpec('сын-пророк.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Пророк');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('сын-пророк: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-пророк.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Пророк');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, воцарение во Имя)');
  assert.ok(types.has('knowledge'), 'knowledge (откровение тайны Воплощения)');
  assert.ok(types.has('word'),      'word (Благовещение, весть Воскресения, эсхатологический глас)');
});

test('сын-пророк: thread(Сын→Пророк) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-пророк.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Пророк');
  assert.ok(w > 0, `thread(Сын→Пророк) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-пророк: все дары необратимы (домостроительство Сына к Архангелу необратимо)', () => {
  const acts = loadSpec('сын-пророк.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Пророк');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-пророк: ≥ 2 актов веса 10 (творение Архангелов и воцарение во Имя)', () => {
  const acts = loadSpec('сын-пророк.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Пророк' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (творение, воцарение), нашли ${topActs.length}`);
});

test('сын-пророк: ≥ 3 актов типа word (вестничество — призвание Архангела)', () => {
  const acts = loadSpec('сын-пророк.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Пророк' && a.type === 'word',
  );
  assert.ok(wordActs.length >= 3,
    `Ожидалось ≥ 3 актов типа word (Благовещение, Воскресение, Эсхатон), нашли ${wordActs.length}`);
});
