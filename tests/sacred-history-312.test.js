/**
 * tests/sacred-history-312.test.js
 *
 * Issue #312: пустыня Сын→ДушиЖивые: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Душам Живым (нефеш хайя, Быт 1:20, 1:24, 2:7):
 *   - Воплощение как со-присутствие (Ин 1:14, Мф 26:38, Халкидонский орос)
 *   - Дыхание Нового Творения (Ин 20:22, Быт 2:7 LXX, 1 Кор 15:45)
 *   - Хлеб Жизни (Ин 6:48-54, Ириней V.2.3)
 *   - Воскрешение из мёртвых (Ин 11:43, Мк 5:41, Лк 7:14, Откр 1:18)
 *   - Сошествие во ад (1 Пет 3:19, 4:6, Дамаскин III.29, Пасхальный канон)
 *   - Жизнь с избытком (Ин 10:10, Ин 5:24-26, Максим Ambigua 7, Палама)
 *
 * Богословский ключ: ДушиЖивые — не индивидуальное лицо, а онтологический
 * класс твари (всё, что имеет дыхание, Быт 1:20, 1:24, 2:7). Сын входит
 * в этот класс изнутри — становится Сам Душой Живой через Воплощение
 * («совершенный человек из души разумной и тела», Халкидон), чтобы
 * уврачевать душу («что не воспринято, то не уврачёвано», Григорий
 * Богослов, Письмо 101). Шесть даров — шесть моментов одного движения:
 * Логос вошёл в чин душ живых, чтобы возвести их в Себя.
 * Эту пустыню закрывает сын-душиживые.gift.
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
    'Ева', 'Адам', 'Земля', 'Небо', 'ДушиЖивые',
  ]);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #312: Сын → ДушиЖивые ────────────────────────────────────────────────

test('сын-душиживые: ≥ 6 даров от Сына к Душам Живым', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'ДушиЖивые');
  assert.ok(gifts.length >= 6, `Нашли: ${gifts.length}, ожидали ≥ 6 (шестерица сотериологическая)`);
});

test('сын-душиживые: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'ДушиЖивые');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (воплощение, дыхание, хлеб, сошествие)');
  assert.ok(types.has('knowledge'), 'knowledge (воскрешение из мёртвых)');
  assert.ok(types.has('word'),      'word (жизнь с избытком — эсхатологическое обетование)');
});

test('сын-душиживые: thread(Сын→ДушиЖивые) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'ДушиЖивые');
  assert.ok(w > 0, `thread(Сын→ДушиЖивые) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-душиживые: все дары необратимы (домостроительство Сына к душам живым необратимо)', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'ДушиЖивые');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-душиживые: ≥ 3 актов веса 10 (воплощение, дыхание, сошествие во ад)', () => {
  const acts = loadSpec('сын-душиживые.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'ДушиЖивые' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (воплощение, дыхание, сошествие), нашли ${topActs.length}`);
});
