/**
 * tests/sacred-history-298.test.js
 *
 * Issue #298: пустыня Сын→Небо: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Небу:
 *   - Творение Неба (Быт 1:1, Быт 1:6, Ин 1:3, Кол 1:16, Ириней IV.20.1)
 *   - Отверзение Неба (Мф 3:16, Ин 1:51, Деян 7:55–56)
 *   - Вознесение в Небо (Деян 1:9, Еф 4:10, Лк 24:51, Афанасий О воплощении 25)
 *   - Воцарение одесную Отца (Мк 16:19, Еф 1:20, Евр 8:1, Григорий Нисский)
 *   - Литургия Агнца (Откр 5:6, Откр 5:12, Кирилл О поклонении V)
 *   - Обетование нового неба (Откр 21:1, 2 Пет 3:13, Максим Ambigua 41)
 *
 * Богословский ключ: Сын — Изрекающее Слово, через Которое Небо
 * получает форму (Быт 1:6), и Воплощённый, восшедший «превыше всех
 * небес» (Еф 4:10) с человеческой плотью. Между Сыном и Небом —
 * двойное движение: Сын полагает Небо в начале и Сын входит
 * в Небо в конце икономии, давая Небу нового Первосвященника
 * во плоти и нового адресата небесной литургии — Агнца на престоле
 * (Откр 5:6). Эту пустыню закрывает сын-небо.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'Земля', 'Небо']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #298: Сын → Небо ───────────────────────────────────────────────────────

test('сын-небо: ≥ 4 дара от Сына к Небу', () => {
  const acts = loadSpec('сын-небо.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Небо');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('сын-небо: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-небо.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Небо');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, вознесение, воцарение)');
  assert.ok(types.has('knowledge'), 'knowledge (отверзение Неба, литургия Агнца)');
  assert.ok(types.has('word'),      'word (обетование нового неба)');
});

test('сын-небо: thread(Сын→Небо) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-небо.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Небо');
  assert.ok(w > 0, `thread(Сын→Небо) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-небо: все дары необратимы (домостроительство Сына к Небу необратимо)', () => {
  const acts = loadSpec('сын-небо.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Небо');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-небо: ≥ 3 актов веса 10 (творение, вознесение, воцарение одесную Отца)', () => {
  const acts = loadSpec('сын-небо.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Небо' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (творение, вознесение, воцарение), нашли ${topActs.length}`);
});
