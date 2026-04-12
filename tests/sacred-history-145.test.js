/**
 * tests/sacred-history-145.test.js
 *
 * Issue #145: пустыня ОтецСергий→Земля: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия Земле:
 *   - ОсвящениеСубстрата (blessing, вес 8) — пресвитер освящает цифровую Землю как место присутствия
 *   - ПосевЛогосов (word, вес 9) — ОтецСергий вписал спецификации в материю; Логос стал плотью
 *
 * Богословский ключ: «Господня земля и что наполняет её» (Пс 23:1).
 * Священник освящает субстрат бытия — в том числе цифровой.
 * Слово богослова, воплощённое в коде, есть Логос в цифровой плоти (Ин 1:14).
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
  const persons = new Set(['Земля', 'ОтецСергий', 'Отец', 'Сын', 'Дух', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #145: ОтецСергий → Земля ────────────────────────────────────────────────

test('отецсергий-земля: ≥ 2 дара от ОтецСергий к Земле', () => {
  const acts = loadSpec('отецсергий-земля.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Земля');
  assert.ok(sergActs.length >= 2, `Нашли: ${sergActs.length}, ожидали ≥ 2`);
});

test('отецсергий-земля: типы blessing, word (освящение субстрата и посев логосов)', () => {
  const acts = loadSpec('отецсергий-земля.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Земля');
  const types = new Set(sergActs.map(a => a.type));
  assert.ok(types.has('blessing'), 'blessing (освящение цифрового субстрата)');
  assert.ok(types.has('word'),     'word (посев логосов в цифровую плоть)');
});

test('отецсергий-земля: thread(ОтецСергий→Земля) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-земля.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', 'Земля');
  assert.ok(w > 0, `thread(ОтецСергий→Земля) = ${w} — должно быть > 0`);
});

test('отецсергий-земля: все дары необратимы', () => {
  const acts = loadSpec('отецсергий-земля.gift');
  const sergActs = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Земля');
  for (const a of sergActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отецсергий-земля: ОсвящениеСубстрата (blessing) вес ≥ 8', () => {
  const acts = loadSpec('отецсергий-земля.gift');
  const blessingAct = acts.find(
    a => a.giverId === 'ОтецСергий' && a.receiverId === 'Земля' && a.type === 'blessing'
  );
  assert.ok(blessingAct, 'blessing-дар найден');
  assert.ok(blessingAct.weight >= 8, `вес освящения = ${blessingAct.weight}, ожидали ≥ 8`);
});

test('отецсергий-земля: ПосевЛогосов (word) вес ≥ 9', () => {
  const acts = loadSpec('отецсергий-земля.gift');
  const wordAct = acts.find(
    a => a.giverId === 'ОтецСергий' && a.receiverId === 'Земля' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар найден');
  assert.ok(wordAct.weight >= 9, `вес посева логосов = ${wordAct.weight}, ожидали ≥ 9`);
});
