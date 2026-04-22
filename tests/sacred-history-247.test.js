/**
 * tests/sacred-history-247.test.js
 *
 * Issue #247: пустыня Адам→Сын: нет ни одного акта дара между ними
 *
 * Проверяет дары Адама Сыну (встречное движение твари к Творцу,
 * без которого Воплощение немыслимо):
 *   - Плоть и родословие (Лк 3:23–38, Евр 2:14, Афанасий, О воплощении 8)
 *   - Имя «Человек» — Сын Человеческий (Мк 2:10, Дан 7:13, Ириней III.22.3)
 *   - Ожидание во аду (Пс 138:8, 1 Пет 3:19, Анастасис, Ефрем Сирин)
 *   - Адам как τύπος будущего (Рим 5:14, Максим Ambigua 42)
 *   - Согласие на искупление (αὐτεξούσιον, Максим Исповедник)
 *
 * Богословский ключ: домостроительство Сына — нисхождение к Адаму
 * (Лк 3:38, «Адамов, Божий»). Но у нисхождения есть встречное
 * движение: Адам даёт Сыну плоть, имя, род, ожидание во аду.
 * Это не «заслуга» твари — это её дар: doxologia, ἀναγωγή
 * (Псевдо-Дионисий). Пустыня закрывается этим встречным потоком.
 *
 * Эту же пустыню впервые закрыл issue #230 (тот же файл
 * адам-сын.gift); #247 — повторное вопрошание DesertScanner
 * после нового пульса онтологии (22.04.2026), потребовавшее
 * подтверждения, что W[Адам][Сын] > 0.
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

// ── #247: Адам → Сын ────────────────────────────────────────────────────────

test('адам-сын: ≥ 4 дара от Адама к Сыну', () => {
  const acts = loadSpec('адам-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('адам-сын: типы offering, word, presence, knowledge', () => {
  const acts = loadSpec('адам-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('offering'),  'offering (плоть/родословие, согласие на искупление)');
  assert.ok(types.has('word'),      'word (имя «Сын Человеческий»)');
  assert.ok(types.has('presence'),  'presence (ожидание во аду)');
  assert.ok(types.has('knowledge'), 'knowledge (Адам как τύπος будущего)');
});

test('адам-сын: thread(Адам→Сын) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('адам-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Адам', 'Сын');
  assert.ok(w > 0, `thread(Адам→Сын) = ${w} — должно быть > 0 после записи актов`);
});

test('адам-сын: все дары необратимы (онтологическое приношение твари необратимо)', () => {
  const acts = loadSpec('адам-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Адам' && a.receiverId === 'Сын');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('адам-сын: ПлотьИРодословие имеет вес 10 (без него нет Воплощения)', () => {
  const acts = loadSpec('адам-сын.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Адам' && a.receiverId === 'Сын' && a.weight === 10,
  );
  assert.ok(topActs.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (плоть/родословие — условие Воплощения), нашли ${topActs.length}`);
});
