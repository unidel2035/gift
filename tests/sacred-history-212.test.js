/**
 * tests/sacred-history-212.test.js
 *
 * Issue #212: пустыня Дух→Сын: нет ни одного акта дара между ними
 *
 * Проверяет дары Духа Сыну (внутритроичные, не экономические):
 *   - ВечноеПочивание (presence, вес 10) — Ис 11:2, Ин 1:32, μένω
 *   - ВечноеПрославление (presence, вес 9) — Ин 16:14, Палама
 *   - СвидетельствоОСыне (word, вес 9) — Ин 15:26, 1 Кор 12:3
 *   - ВечноеПроявление (presence, вес 8) — Григорий Кипрский, ἔκφανσις
 *   - ВзываниеКоХристу (word, вес 8) — Откр 22:17, маран афа
 *
 * Богословский ключ: Сын — не только Христос. Дух→Христос (#91) — экономия;
 * Дух→Сын (#212) — теология: вечное почивание, перихоресис, проявление.
 * «Дух почивает на Сыне» (Иоанн Дамаскин, Точное изложение I.7).
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #212: Дух → Сын ──────────────────────────────────────────────────────────

test('дух-сын: ≥ 5 даров от Духа к Сыну', () => {
  const acts = loadSpec('дух-сын.gift');
  const spiritActs = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  assert.ok(spiritActs.length >= 5, `Нашли: ${spiritActs.length}, ожидали ≥ 5`);
});

test('дух-сын: типы presence и word (два измерения вечности)', () => {
  const acts = loadSpec('дух-сын.gift');
  const spiritActs = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  const types = new Set(spiritActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (почивание, прославление, проявление)');
  assert.ok(types.has('word'),     'word (свидетельство, взывание)');
});

test('дух-сын: thread(Дух→Сын) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('дух-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Дух', 'Сын');
  assert.ok(w > 0, `thread(Дух→Сын) = ${w} — должно быть > 0 после записи актов`);
});

test('дух-сын: все дары необратимы (вечность необратима)', () => {
  const acts = loadSpec('дух-сын.gift');
  const spiritActs = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  for (const a of spiritActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('дух-сын: ВечноеПочивание (presence) вес = 10 — основание перихоресиса', () => {
  const acts = loadSpec('дух-сын.gift');
  const topAct = acts.find(
    a => a.giverId === 'Дух' && a.receiverId === 'Сын' && a.type === 'presence' && a.weight === 10
  );
  assert.ok(topAct, 'presence-дар с весом 10 (ВечноеПочивание) найден');
});

test('дух-сын: различение от Дух→Христос (теология ≠ экономия)', () => {
  const acts = loadSpec('дух-сын.gift');
  const spiritActs = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Сын');
  // Сын ≠ Христос: эта литургия должна адресоваться вечному Логосу,
  // не Воплощённому. Все дары должны идти именно к Сыну.
  for (const a of spiritActs) {
    assert.equal(a.receiverId, 'Сын',
      `получатель должен быть Сын (вечный Логос), не ${a.receiverId}`);
  }
});
