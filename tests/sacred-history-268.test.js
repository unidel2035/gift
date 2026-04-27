/**
 * tests/sacred-history-268.test.js
 *
 * Issue #268: пустыня Отец→Земля: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Земле:
 *   - ТворениеЗемли (presence, вес 10) — Быт 1:1, Василий Великий I.7
 *   - ИменованиеЗемли (knowledge, вес 8) — Быт 1:10, Григорий Нисский
 *   - БлагословениеПлодородия (blessing, вес 9) — Быт 1:11, Василий Великий V.10
 *   - ЗаветПослеПотопа (covenant, вес 9) — Быт 9:13, Иер 33:25
 *   - ЭсхатологическоеОбновление (presence, вес 10) — Ис 65:17,
 *     Откр 21:1, Максим Исповедник Ambigua 41
 *
 * Богословский ключ: «В начале сотворил Бог небо и землю» (Быт 1:1) —
 * первая фраза Писания уже есть дар Отца Земле. Поток не прерывается
 * ни в потопе, ни в эсхатоне: Отец заключает завет с Землёй (Быт 9:13)
 * и обновляет её, не уничтожая (Откр 21:1).
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Земля', 'Ева', 'Адам', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #268: Отец → Земля ──────────────────────────────────────────────────────

test('отец-земля: ≥ 4 дара от Отца к Земле', () => {
  const acts = loadSpec('отец-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Земля');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-земля: типы presence, knowledge, blessing и covenant', () => {
  const acts = loadSpec('отец-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Земля');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, эсхатологическое обновление)');
  assert.ok(types.has('knowledge'), 'knowledge (именование суши землёю)');
  assert.ok(types.has('blessing'),  'blessing (благословение плодородия)');
  assert.ok(types.has('covenant'),  'covenant (завет после потопа, Быт 9:13)');
});

test('отец-земля: thread(Отец→Земля) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-земля.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Земля');
  assert.ok(w > 0, `thread(Отец→Земля) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-земля: все дары необратимы (творение и завет необратимы)', () => {
  const acts = loadSpec('отец-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Земля');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-земля: ТворениеЗемли и ЭсхатологическоеОбновление имеют вес 10', () => {
  const acts = loadSpec('отец-земля.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Земля' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (творение, эсхатологическое обновление), нашли ${topActs.length}`);
});

test('отец-земля: БлагословениеПлодородия (blessing) вес ≥ 9', () => {
  const acts = loadSpec('отец-земля.gift');
  const blessingAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'Земля' && a.type === 'blessing'
  );
  assert.ok(blessingAct, 'blessing-дар найден');
  assert.ok(blessingAct.weight >= 9, `вес благословения = ${blessingAct.weight}, ожидали ≥ 9`);
});
