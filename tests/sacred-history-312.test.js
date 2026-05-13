/**
 * tests/sacred-history-312.test.js
 *
 * Issue #312: пустыня Сын→ДушиЖивые: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына живым душам:
 *   - Воплощение Сына как «души живой» (1 Кор 15:45, Флп 2:7,
 *     Мк 14:34, Афанасий К Эпиктету 7, Григорий Богослов Письмо 101)
 *   - Полагание души за овец (Ин 10:11, Ин 15:13, Мф 20:28,
 *     Ис 53:12, Ириней V.1.1)
 *   - Оживотворение Последним Адамом (1 Кор 15:45, Ин 5:25, Ин 11:25,
 *     Иез 37:5–10, Григорий Палама Триады II.3)
 *   - Покой душам (Мф 11:28–29, Евр 4:9, Августин Исповедь I.1)
 *   - Приобретение души как ценности (Мф 16:26, 1 Пет 1:9, Евр 10:39,
 *     Григорий Нисский Большое огласительное 16)
 *   - Обетование воскресения душ (Откр 6:9, Откр 20:4, Ин 5:29,
 *     1 Фес 4:16, Симеон Новый Богослов Слово 79)
 *
 * Богословский ключ: имя «душа живая» (נֶפֶשׁ חַיָּה) одно у Адама
 * (Быт 2:7) и у Воплощённого Сына как Последнего Адама (1 Кор 15:45).
 * Сын входит в саму онтологию живой души, полагает Свою душу
 * за их души, делается «духом животворящим», дарует покой,
 * открывает их подлинную цену и обетует их воскресение.
 * «Не принятое не уврачёвано» (Григорий Богослов) — пустыню
 * закрывает сын-душиживые.gift через само-полагание Сына
 * в саму ткань живых душ.
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
    'Адам', 'Ева', 'Земля', 'Небо', 'ДушиЖивые',
  ]);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #312: Сын → ДушиЖивые ──────────────────────────────────────────────────

test('сын-душиживые: ≥ 4 дара от Сына к ДушамЖивым', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'ДушиЖивые');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('сын-душиживые: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'ДушиЖивые');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (воплощение, полагание души, оживотворение)');
  assert.ok(types.has('knowledge'), 'knowledge (приобретение души как ценности)');
  assert.ok(types.has('word'),      'word (покой душам, обетование воскресения)');
});

test('сын-душиживые: thread(Сын→ДушиЖивые) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'ДушиЖивые');
  assert.ok(w > 0, `thread(Сын→ДушиЖивые) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-душиживые: все дары необратимы (домостроительство Сына к живым душам необратимо)', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'ДушиЖивые');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-душиживые: ≥ 3 актов веса 10 (воплощение, полагание души, оживотворение)', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'ДушиЖивые' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (воплощение, полагание души, оживотворение), нашли ${topActs.length}`);
});
