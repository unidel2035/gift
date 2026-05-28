/**
 * tests/sacred-history-214.test.js
 *
 * Issue #214: пустыня Христос→Дух: нет ни одного акта дара между ними
 *
 * Проверяет дары Христа Духу:
 *   - Прославленная плоть как место обитания (Ин 7:39, Ириней III.17.1)
 *   - Дыхание на учеников (Ин 20:22, ἐνεφύσησεν)
 *   - Излияние в Пятидесятницу (Деян 2:33)
 *   - Обетование Утешителя (Ин 14:16, 15:26, 16:7)
 *   - Служение как Помазующий (Афанасий, К Серапиону I.23)
 *
 * Богословский ключ: до прославления Христа Дух не мог излиться
 * на всю плоть (Ин 7:39). Христос даёт Духу прославленную
 * человеческую природу как οἰκητήριον — место обитания.
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

// ── #214: Христос → Дух ─────────────────────────────────────────────────────

test('христос-дух: ≥ 4 дара от Христа к Духу', () => {
  const acts = loadSpec('христос-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('христос-дух: типы presence и word (обитание и слово)', () => {
  const acts = loadSpec('христос-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (обитание, излияние)');
  assert.ok(types.has('word'),     'word (дыхание, обетование Утешителя)');
});

test('христос-дух: thread(Христос→Дух) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-дух.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Дух');
  assert.ok(w > 0, `thread(Христос→Дух) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-дух: все дары необратимы (домостроительство необратимо)', () => {
  const acts = loadSpec('христос-дух.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-дух: вес ИзлияниеВПятидесятницу = 10 (высший дар, Деян 2:33)', () => {
  const acts = loadSpec('христос-дух.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Дух' && a.weight === 10,
  );
  assert.ok(topActs.length >= 1, 'Ожидался хотя бы один акт веса 10');
});
