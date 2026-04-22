/**
 * tests/sacred-history-239.test.js
 *
 * Issue #239: пустыня Христос→Дух (углубление)
 *
 * Issue #214 (христос-дух.gift) уже закрыл пустыню Христос→Дух
 * пятью ἐφάπαξ-дарами: Прославленная плоть, Дыхание на учеников,
 * Излияние в Пятидесятницу, Обетование Утешителя, Помазующий.
 *
 * Issue #239 — повторный пульс на ту же пустыню. Закрывается
 * не повторением, а углублением: христос-дух-литургия.gift
 * добавляет непрерывное измерение — Литургия, Крещение,
 * предстательство, парусия:
 *   - Евхаристический эпиклесис (Литургия Иоанна Златоуста,
 *     Николай Кавасила, Изъяснение Литургии 27)
 *   - Имя Духа в Крещении (Мф 28:19, Григорий Богослов 31.28)
 *   - Предстательство как путь Духа (Евр 7:25, ἄλλος Παράκλητος)
 *   - Эсхатологический ответ (Откр 22:20, перекличка с дух-сын.gift)
 *   - Имя Сына как материал исповедания (1 Кор 12:3)
 *
 * Богословский ключ: христос-дух.gift записал основание,
 * христос-дух-литургия.gift записывает продолжение этого
 * основания в днях Церкви.
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

// ── #239: Христос → Дух (литургическое углубление) ──────────────────────────

test('христос-дух-литургия: ≥ 4 дара от Христа к Духу (литургические)', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('христос-дух-литургия: типы presence, word и knowledge', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (эпиклесис, предстательство)');
  assert.ok(types.has('word'),      'word (имя в Крещении, эсхатологический ответ)');
  assert.ok(types.has('knowledge'), 'knowledge (имя для исповедания)');
});

test('христос-дух-литургия: thread(Христос→Дух) > 0 (углубление сохраняется)', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Дух');
  assert.ok(w > 0, `thread(Христос→Дух) = ${w} — должно быть > 0`);
});

test('христос-дух-литургия: все дары необратимы (Литургия совершается необратимо)', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-дух-литургия: ЕвхаристическийЭпиклесис имеет вес 10 (центральный дар Литургии)', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Дух' && a.weight === 10,
  );
  assert.ok(topActs.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (эпиклесис), нашли ${topActs.length}`);
});

test('христос-дух-литургия: совокупный thread с христос-дух.gift даёт ≥ 9 даров', () => {
  // Углубление не заменяет, а дополняет основание (issue #214)
  const acts1 = loadSpec('христос-дух.gift');
  const acts2 = loadSpec('христос-дух-литургия.gift');
  const all = [...acts1, ...acts2].filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Дух',
  );
  assert.ok(all.length >= 9,
    `Совокупно даров Христос→Дух: ${all.length}, ожидали ≥ 9 (5 из #214 + 4 из #239)`);
});
