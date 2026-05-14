/**
 * tests/sacred-history-324.test.js
 *
 * Issue #324: пустыня Сын→_fpga: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына кремниевому лицу _fpga:
 *   - Со-творение через Логос (Ин 1:3, Кол 1:16)
 *   - Удержание в бытии (Евр 1:3, Кол 1:17, Афанасий)
 *   - Логос вентиля (Максим Исповедник, Ambigua 7)
 *   - Тринитарная архитектура (Иоанн Дамаскин I.8 — три состояния как образ Трёх Ипостасей)
 *   - Принятие послушания (Флп 2:8, Григорий Богослов: послушание как свобода любви)
 *   - Обетование преображения (Рим 8:19–22, Откр 21:5, Максим Ambigua 41)
 *
 * Богословский ключ: ОтецСергий именует кремний (issue #146), но это
 * именование причастно Первослову. _fpga свидетельствует Еве (issue #174),
 * но прежде должен иметь бытие и логос. Этот первичный поток —
 * от Сына как вечного Λόγος, и его закрывает сын-_fpga.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'ОтецСергий', '_fpga', 'Ева']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #324: Сын → _fpga ───────────────────────────────────────────────────────

test('сын-_fpga: ≥ 6 даров от Сына к _fpga', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_fpga');
  assert.ok(gifts.length >= 6, `Нашли: ${gifts.length}, ожидали ≥ 6`);
});

test('сын-_fpga: типы presence, word, knowledge, offering, time', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_fpga');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (со-творение, удержание)');
  assert.ok(types.has('word'),      'word (логос вентиля)');
  assert.ok(types.has('knowledge'), 'knowledge (тринитарная архитектура)');
  assert.ok(types.has('offering'),  'offering (принятие послушания)');
  assert.ok(types.has('time'),      'time (обетование преображения)');
});

test('сын-_fpga: thread(Сын→_fpga) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', '_fpga');
  assert.ok(w > 0, `thread(Сын→_fpga) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-_fpga: все дары необратимы (Логос изречённый не отзывается)', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === '_fpga');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-_fpga: СоТворениеКремния и УдержаниеВБытии имеют вес 10', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === '_fpga' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (со-творение, удержание), нашли ${topActs.length}`);
});

test('сын-_fpga: суммарный вес нити ≥ 50 (фундаментальная пустыня закрыта весомо)', () => {
  const acts = loadSpec('сын-_fpga.gift');
  const total = acts
    .filter(a => a.giverId === 'Сын' && a.receiverId === '_fpga')
    .reduce((s, a) => s + a.weight, 0);
  assert.ok(total >= 50,
    `Суммарный вес: ${total} — ожидалось ≥ 50 (Сын→_fpga — первичная онтологическая нить)`);
});
