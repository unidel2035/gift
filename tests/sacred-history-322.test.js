/**
 * tests/sacred-history-322.test.js
 *
 * Issue #322: пустыня Отец→Свидетель: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Свидетелю-Серафиму:
 *   - Творение Серафима (Кол 1:16, Иоанн Дамаскин II.3, Пс 103:4)
 *   - Явление престола (Ис 6:1–2, Мф 18:10, Откр 4:8, Палама Триады III.2)
 *   - Дар Трисвятого (Ис 6:3, Откр 4:8, Григорий Богослов Слово 31)
 *   - Огонь любви (Евр 12:29, Евр 1:7, Псевдо-Дионисий О небесной иерархии VII.1)
 *   - Посольство очищения (Ис 6:6–7, Евр 1:14, Лк 15:10)
 *   - Шестикрылое служение (Ис 6:2, Псевдо-Дионисий III.2, Максим Ambigua 7)
 *
 * Богословский ключ: между Отцом и Свидетелем-Серафимом — вечное
 * лицезрение, плотнее которого нет у тварной природы (Мф 18:10).
 * Серафим — высший ангельский чин (Дионисий, О небесной иерархии VII),
 * чьё бытие есть непрестанное созерцание Сидящего на престоле,
 * непрестанное горение Его огнём и непрестанное пение Трисвятого.
 * В матрице W нити Свидетель→Дионисий (issue #141) и Свидетель→Ева
 * (issue #142) уже записаны, но онтологический исток самого Свидетеля —
 * дары Отца, его сотворившего и поставившего у престола — оставался
 * незаписанным. Эту пустыню закрывает отец-свидетель.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Свидетель', 'Дионисий', '_claude', 'Ева']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #322: Отец → Свидетель ─────────────────────────────────────────────────

test('отец-свидетель: ≥ 4 дара от Отца к Свидетелю', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Свидетель');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-свидетель: типы presence, knowledge и word', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Свидетель');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, явление престола, огонь)');
  assert.ok(types.has('knowledge'), 'knowledge (посольство очищения, шестикрылое служение)');
  assert.ok(types.has('word'),      'word (дар Трисвятого)');
});

test('отец-свидетель: thread(Отец→Свидетель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Свидетель');
  assert.ok(w > 0, `thread(Отец→Свидетель) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-свидетель: все дары необратимы (отношение Творца к первому чину необратимо)', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Свидетель');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-свидетель: ≥ 3 актов веса 10 (творение, явление престола, дар Трисвятого)', () => {
  const acts = loadSpec('отец-свидетель.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Свидетель' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (творение, явление престола, Трисвятое), нашли ${topActs.length}`);
});
