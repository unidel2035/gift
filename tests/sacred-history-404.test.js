/**
 * tests/sacred-history-404.test.js
 *
 * Issue #404: пустыня Отец→Денис: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Денису (отеческая пятерица для носителя имени):
 *   - Бытие наречённого (Иер 1:5, Еф 1:4, Пс 138:16, Ambigua 7)
 *   - Имя Ареопагита (Ис 43:1, Деян 17:34, Откр 2:17, 3:5)
 *   - Видение Неведомого Бога (Деян 17:23, Исх 20:21, 1 Кор 13:12, Ареопагит I.1)
 *   - Дух премудрости и откровения (Еф 1:17–18, Ис 11:2, 1 Кор 2:10)
 *   - Радость восхождения (Флп 3:13, Григорий Нисский II.225–243, Ин 16:22)
 *
 * Богословский ключ: Денис — лицо, несущее имя святого Дионисия Ареопагита
 * (Деян 17:34), первого афинянина, услышавшего у Павла о «Неведомом Боге»
 * (Деян 17:23) и ставшего отцом апофатического богословия. Имя в православной
 * типологии — наследие и призвание: тот, кто носит имя святого, включён
 * в типологический поток святого. ОтецСергий→Денис (#151) закрыл пастырский
 * ответ — благословение, молитву, передачу апофатического слова. Отец→Денис
 * закрывает онтологическое основание: Отец нарекает прежде священника,
 * включает в апофатическую типологию прежде общины, даёт Духа премудрости
 * прежде всякой богословской работы.
 * Эту пустыню закрывает отец-денис.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Денис', 'ОтецСергий', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #404: Отец → Денис ──────────────────────────────────────────────

test('отец-денис: ≥ 5 даров от Отца к Денису (отеческая пятерица для носителя имени)', () => {
  const acts = loadSpec('отец-денис.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Денис');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('отец-денис: типы presence, word, knowledge', () => {
  const acts = loadSpec('отец-денис.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Денис');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (бытие наречённого + радость — Иер 1:5, Флп 3:13)');
  assert.ok(types.has('word'),      'word (имя Ареопагита — Ис 43:1, Деян 17:34)');
  assert.ok(types.has('knowledge'), 'knowledge (видение Неведомого + Дух премудрости — Деян 17:23, Еф 1:17)');
});

test('отец-денис: thread(Отец→Денис) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-денис.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Денис');
  assert.ok(w > 0, `thread(Отец→Денис) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-денис: все дары необратимы (наречение Отца необратимо)', () => {
  const acts = loadSpec('отец-денис.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Денис');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-денис: ≥ 1 акт веса 9 (бытие наречённого или Дух премудрости — несущие дары)', () => {
  const acts = loadSpec('отец-денис.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Денис' && a.weight === 9,
  );
  assert.ok(topActs.length >= 1,
    `Ожидался ≥ 1 акт веса 9 (бытие/Дух), нашли ${topActs.length}`);
});

test('отец-денис: акт word существует (имя как призыв — Ис 43:1, Откр 2:17)', () => {
  const acts = loadSpec('отец-денис.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Денис' && a.type === 'word',
  );
  assert.ok(wordActs.length >= 1, 'Должен быть хотя бы один акт типа word (имя — слово Отца)');
});

test('отец-денис: суммарный вес нити ≥ 35 (полноценная отеческая пятерица)', () => {
  const acts = loadSpec('отец-денис.gift');
  const sum = acts
    .filter(a => a.giverId === 'Отец' && a.receiverId === 'Денис')
    .reduce((s, a) => s + a.weight, 0);
  assert.ok(sum >= 35, `Сумма весов = ${sum}, ожидалось ≥ 35`);
});
