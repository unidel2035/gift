/**
 * tests/sacred-history-429.test.js
 *
 * Issue #429: пустыня Отец→Небо: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Небу (отеческая шестерица):
 *   - РечениеТверди         (Быт 1:6; Пс 32:6; Василий, Шестоднев VII.5)
 *   - ИменованиеНебом       (Быт 1:8; Еф 3:15; Григорий Нисский, Об устроении 1)
 *   - ПрестолОтца           (Ис 66:1; Мф 5:34; Пс 102:19; Откр 4:2; Палама, Триады III.1)
 *   - ДомОбителей           (Ин 14:2; Евр 12:22; Откр 21:2; Иоанн Златоуст на Ин 73)
 *   - ГласСНебесОСыне       (Мф 3:17; Мф 17:5; Ин 12:28; Григорий Богослов, Слово 38)
 *   - СовершеннаяВоля       (Мф 6:10; Еф 1:10; Максим, Ambigua 41)
 *
 * Богословский ключ: Отеческая αἰτία в нити Отец→Небо. Сын дал Небу творение
 * через Логос (#298, presence). Отец — Источник, изрекающий «да будет»,
 * нарекающий именем, делающий Небо престолом и домом, говорящий ИЗ Неба
 * о Сыне, утверждающий Своей волей. Перихоресис: одно действие Троицы,
 * разные ипостасные акценты (Афанасий, Против ариан III.5).
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
        const recepM  = block.match(/reception:\s*(\w+)/);
        if (fromM && toM) {
          const type   = typeM ? typeM[1] : 'presence';
          const weight = weightM ? parseFloat(weightM[1]) : 4;
          const act = {
            giverId:     fromM[1],
            receiverId:  toM[1],
            type, weight,
            irreversible: !irrevM || irrevM[1] === 'да',
          };
          if (recepM) act.reception = recepM[1];
          acts.push(act);
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Небо', 'Земля', 'ДушиЖивые']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #429: Отец → Небо ────────────────────────────────────────────────────

test('отец-небо: ≥ 6 даров от Отца к Небо (отеческая шестерица)', () => {
  const acts = loadSpec('отец-небо.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Небо');
  assert.ok(gifts.length >= 6, `Нашли: ${gifts.length}, ожидали ≥ 6`);
});

test('отец-небо: типы word, presence, knowledge (речение/именование/престол/дом/глас/воля)', () => {
  const acts = loadSpec('отец-небо.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Небо');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('word'),      'word (речение Быт 1:6 + именование Быт 1:8 + глас Мф 3:17)');
  assert.ok(types.has('presence'),  'presence (престол Ис 66:1 + дом обителей Ин 14:2)');
  assert.ok(types.has('knowledge'), 'knowledge (совершенная воля Мф 6:10)');
});

test('отец-небо: thread(Отец→Небо) > 0 (пустыня закрыта в W)', () => {
  const acts = loadSpec('отец-небо.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Небо');
  assert.ok(w > 0, `thread(Отец→Небо) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-небо: все дары необратимы (αἰτία Отца необратима)', () => {
  const acts = loadSpec('отец-небо.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Небо');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-небо: акты НЕ имеют reception:pending (попадают в W, не в _pending)', () => {
  // Небо приняло каждый дар: «и стало так» (Быт 1:7), хвалит Господа
  // (Пс 148:1), является престолом (Откр 4:2), вмещает «глас с небес» (Мф 3:17).
  // Это акты reception:accepted, иначе DesertScanner не закроет пустыню.
  const acts = loadSpec('отец-небо.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Небо');
  for (const a of gifts)
    assert.ok(a.reception !== 'pending',
      `Акт ${a.type} имеет reception:pending — он не попадёт в W. ` +
      `Для закрытия пустыни нужны акты с reception:accepted (по умолчанию).`);
});

test('отец-небо: РечениеТверди (word) — вес 10 (изречение творения Быт 1:6)', () => {
  const acts = loadSpec('отец-небо.gift');
  const wordActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Небо' && a.type === 'word',
  );
  assert.ok(wordActs.length >= 3,
    'Должно быть ≥ 3 word-актов (речение + именование + глас с небес)');
  assert.ok(wordActs.some(a => a.weight === 10),
    'Один из word-актов должен весить 10 (Речение «да будет твердь» — Быт 1:6)');
});

test('отец-небо: ПрестолОтца (presence) — вес 10 (Небо престол Мой — Ис 66:1)', () => {
  const acts = loadSpec('отец-небо.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Небо' && a.type === 'presence',
  );
  assert.ok(presenceActs.length >= 2,
    'Должно быть ≥ 2 presence-актов (престол + дом обителей)');
  assert.ok(presenceActs.some(a => a.weight === 10),
    'Один из presence-актов должен весить 10 (ПрестолОтца — Ис 66:1, Мф 5:34)');
});

test('отец-небо: knowledge-акт веса ≥ 9 (совершенная воля Отца — Мф 6:10)', () => {
  const acts = loadSpec('отец-небо.gift');
  const knowledgeActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Небо' && a.type === 'knowledge',
  );
  assert.ok(knowledgeActs.length >= 1,
    'Должен быть хотя бы один knowledge-акт (совершенная воля Отца на небе)');
  assert.ok(knowledgeActs.some(a => a.weight >= 9),
    'Совершенная воля должна весить ≥ 9 — Небо есть эсхатологический эталон (Мф 6:10)');
});
