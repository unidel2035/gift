/**
 * tests/sacred-history-256.test.js
 *
 * Issue #256: вопрошание: пустыня Дух→Сын (вторая запись)
 *
 * Первая запись (issue #237, дух-сын.gift) закрыла догматический
 * пласт нити Дух→Сын: почивание, прославление, свидетельство,
 * со-творение, осенение Воплощения, эсхатологический призыв.
 * Пульс онтологии обнаружил пустыню повторно — как знак того,
 * что нить ещё не дописана в измерении опыта и кенозиса.
 *
 * Вторая запись (дух-сын-ликование.gift) продолжает нить:
 *   - Ликование Сына в Духе (Лк 10:21, Рим 14:17)
 *   - Печать Сыновства (Ин 6:27, Еф 1:13, 2 Кор 1:22)
 *   - Дух огня жертвы (Евр 9:14, Иоанн Златоуст)
 *   - Со-ходатайство в кенозисе (Рим 8:26, Мф 27:46)
 *   - Премудрость в со-действии (Прем 7:25, 1 Кор 2:10, Ириней IV.7.4)
 *
 * Богословский ключ: Дух→Сын — не одномоментная догматическая
 * стена, а вечно-текущий поток, каждый пласт которого требует
 * отдельной записи в матрице W. Issue #256 — второй пласт.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #256: Дух → Сын (вторая запись) ────────────────────────────────────────

test('дух-сын-ликование: ≥ 4 дара от Духа к Сыну', () => {
  const acts = loadSpec('дух-сын-ликование.gift');
  const gifts = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('дух-сын-ликование: типы presence, knowledge, covenant и offering', () => {
  const acts = loadSpec('дух-сын-ликование.gift');
  const gifts = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (ликование, со-ходатайство в кенозисе)');
  assert.ok(types.has('covenant'),  'covenant (печать Сыновства)');
  assert.ok(types.has('offering'),  'offering (Дух огня жертвы)');
  assert.ok(types.has('knowledge'), 'knowledge (Премудрость в со-действии)');
});

test('дух-сын-ликование: thread(Дух→Сын) > 0 (пустыня остаётся закрытой)', () => {
  const acts = loadSpec('дух-сын-ликование.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Дух', 'Сын');
  assert.ok(w > 0, `thread(Дух→Сын) = ${w} — должно быть > 0 после записи актов`);
});

test('дух-сын-ликование: все дары необратимы', () => {
  const acts = loadSpec('дух-сын-ликование.gift');
  const gifts = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('дух-сын-ликование: ПечатьСыновства и ДухОгняЖертвы имеют вес 10', () => {
  const acts = loadSpec('дух-сын-ликование.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Дух' && a.receiverId === 'Сын' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (печать Сыновства, Дух огня жертвы), нашли ${topActs.length}`);
});

test('дух-сын-ликование: сумма весов (второй пласт) ≥ 40', () => {
  const acts = loadSpec('дух-сын-ликование.gift');
  const total = acts
    .filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын')
    .reduce((s, a) => s + a.weight, 0);
  assert.ok(total >= 40, `Сумма весов: ${total}, ожидали ≥ 40`);
});

test('дух-сын: обе записи (#237 и #256) вместе дают поток > 90', () => {
  const first  = loadSpec('дух-сын.gift');
  const second = loadSpec('дух-сын-ликование.gift');
  const mem = buildMemory([...first, ...second]);
  const w = mem.thread('Дух', 'Сын');
  assert.ok(w > 90, `thread(Дух→Сын) суммарно = ${w} — должно быть > 90 (6 + 5 даров)`);
});
