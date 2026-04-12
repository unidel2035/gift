/**
 * tests/sacred-history-151.test.js
 *
 * Issue #151: вопрошание: пустыня ОтецСергий→Денис: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия Денису:
 *   - Пастырское благословение (blessing, вес 8) — священник благословляет носителя имени Дионисия
 *   - Молитва о Денисе (presence, вес 7) — поминовение по имени в молитвенном потоке
 *   - Апофатическое слово (word, вес 6) — богословское свидетельство об апофатике и онтологии дара
 *
 * Богословский ключ: ОтецСергий — пресвитер и богослов онтологии дара.
 * Денис носит имя Дионисия Ареопагита (Деян 17:34) — первого афинянина,
 * уверовавшего через Павла. Апофатика Ареопагита питает онтологию дара:
 * оба говорят о превосходящем, неисчерпаемом Боге.
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
  const persons = new Set(['Денис', 'ОтецСергий', 'Отец', 'Сын', 'Дух', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #151: ОтецСергий → Денис ─────────────────────────────────────────────────

test('отецсергий-денис: ≥ 2 дара от ОтецСергий к Денису', () => {
  const acts = loadSpec('отецсергий-денис.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Денис');
  assert.ok(sergActs.length >= 2, `Нашли: ${sergActs.length}, ожидали ≥ 2`);
});

test('отецсергий-денис: типы blessing, presence (благословение и молитва)', () => {
  const acts = loadSpec('отецсергий-денис.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Денис');
  const types = new Set(sergActs.map(a => a.type));
  assert.ok(types.has('blessing'), 'blessing (пастырское благословение носителя имени Дионисия)');
  assert.ok(types.has('presence'), 'presence (молитвенное поминовение Дениса)');
});

test('отецсергий-денис: thread(ОтецСергий→Денис) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-денис.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', 'Денис');
  assert.ok(w > 0, `thread(ОтецСергий→Денис) = ${w} — должно быть > 0`);
});

test('отецсергий-денис: все дары необратимы', () => {
  const acts = loadSpec('отецсергий-денис.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Денис');
  for (const a of sergActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отецсергий-денис: ПастырскоеБлагословение (blessing) вес ≥ 8', () => {
  const acts = loadSpec('отецсергий-денис.gift');
  const blessingAct = acts.find(
    a => a.giverId === 'ОтецСергий' && a.receiverId === 'Денис' && a.type === 'blessing'
  );
  assert.ok(blessingAct, 'blessing-дар найден');
  assert.ok(blessingAct.weight >= 8, `вес благословения = ${blessingAct.weight}, ожидали ≥ 8`);
});
