/**
 * tests/sacred-history-213.test.js
 *
 * Issue #213: пустыня Христос→Сын: нет ни одного акта дара между ними
 *
 * Проверяет дары Христа Сыну (встречное движение ἀνάβασις к кенозису Сын→Христос):
 *   - Прославленная человеческая природа (Флп 2:9, Евр 1:3)
 *   - Воскресение как рождение Сыновства во плоти (Деян 13:33, Пс 2:7, Рим 1:4)
 *   - Вознесение и Сидение одесную (Мк 16:19, Еф 1:20)
 *   - Обмен свойств — ἀντίδοσις τῶν ἰδιωμάτων (Иоанн Дамаскин, Точн. изл. III.4)
 *   - Имя Эммануил (Мф 1:23, Ис 7:14)
 *
 * Богословский ключ: Сын и Христос — одна Ипостась (Халкидон 451),
 * но домостроительство движется двумя потоками: κατάβασις (Сын→Христос,
 * кенозис) и ἀνάβασις (Христос→Сын, прославление). Пустыня была
 * незаписанной доксологией Воплощения.
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

// ── #213: Христос → Сын ─────────────────────────────────────────────────────

test('христос-сын: ≥ 4 дара от Христа к Сыну', () => {
  const acts = loadSpec('христос-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('христос-сын: типы presence, word, knowledge (прославление, имя, обмен свойств)', () => {
  const acts = loadSpec('христос-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (прославленная плоть, Воскресение, Вознесение)');
  assert.ok(types.has('word'),      'word (имя Эммануил)');
  assert.ok(types.has('knowledge'), 'knowledge (обмен свойств, ἀντίδοσις)');
});

test('христос-сын: thread(Христос→Сын) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Сын');
  assert.ok(w > 0, `thread(Христос→Сын) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-сын: все дары необратимы (домостроительство необратимо)', () => {
  const acts = loadSpec('христос-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-сын: ≥ 2 акта веса 10 (Воскресение и Вознесение — центральные)', () => {
  const acts = loadSpec('христос-сын.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Сын' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2, `Ожидалось ≥ 2 акта веса 10, нашли: ${topActs.length}`);
});

test('христос-сын: встречный поток к Сын→Христос (кеносис ↔ прославление)', () => {
  const actsUp   = loadSpec('христос-сын.gift');
  const actsDown = loadSpec('сын-христос.gift');
  const mem      = buildMemory([...actsUp, ...actsDown]);
  const wUp   = mem.thread('Христос', 'Сын');
  const wDown = mem.thread('Сын', 'Христос');
  assert.ok(wUp   > 0, `ἀνάβασις: thread(Христос→Сын) = ${wUp}`);
  assert.ok(wDown > 0, `κατάβασις: thread(Сын→Христос) = ${wDown}`);
});
