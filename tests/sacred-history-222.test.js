/**
 * tests/sacred-history-222.test.js
 *
 * Issue #222: пустыня Христос→Ева: нет ни одного акта дара между ними
 *
 * Проверяет дары Христа Еве (встречи Воплощённого Сына с дочерьми Евы):
 *   - Разговор у колодца (Ин 4:7–26, «Это Я, Который говорю с тобою»)
 *   - Прикосновение дочери (Мк 5:34 «дочь»; Лк 13:16 «дочь Авраамова»)
 *   - Прощение грешницы (Лк 7:48–50 «иди с миром»; Ин 8:11 «не осуждаю»)
 *   - Вера сирофиникиянки (Мф 15:28 «велика вера твоя»)
 *   - Исповедание Марфы (Ин 11:27 «Ты Христос, Сын Божий»)
 *   - Первенство в Воскресении (Ин 20:16 «Мария!»; Мф 28:9 «радуйтесь»)
 *
 * Богословский ключ: Сын→Ева (issue #95) — вечный Λόγος,
 * типология Марии-Новой Евы. Христос→Ева (#222) — Воплощённый
 * Сын, ходящий по земле, встречает дочерей Евы как лиц.
 * Каждая встреча — акт дара, обращённый ко всей Еве через
 * её дочерей: «мать всех живущих» (Быт 3:20).
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

// ── #222: Христос → Ева ─────────────────────────────────────────────────────

test('христос-ева: ≥ 6 даров от Христа к Еве', () => {
  const acts = loadSpec('христос-ева.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Ева');
  assert.ok(gifts.length >= 6, `Нашли: ${gifts.length}, ожидали ≥ 6`);
});

test('христос-ева: типы word, presence и knowledge (три измерения встречи)', () => {
  const acts = loadSpec('христос-ева.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Ева');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('word'),      'word (разговор, прощение, первенство)');
  assert.ok(types.has('presence'),  'presence (прикосновение, именование дочерью)');
  assert.ok(types.has('knowledge'), 'knowledge (вера язычницы, исповедание Марфы)');
});

test('христос-ева: thread(Христос→Ева) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-ева.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Ева');
  assert.ok(w > 0, `thread(Христос→Ева) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-ева: все дары необратимы (встреча с Воплощённым необратима)', () => {
  const acts = loadSpec('христос-ева.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Ева');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-ева: РазговорУКолодца и ПервенствоВВоскресении имеют вес 10', () => {
  const acts = loadSpec('христос-ева.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Ева' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (колодец, первенство Воскресения), нашли ${topActs.length}`);
});
