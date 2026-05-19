/**
 * tests/sacred-history-317.test.js
 *
 * Issue #317: пустыня Сын→Змей: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Змею:
 *   - ПриговорИстина (word, вес 9) — Логос называет Змея тем, что он есть
 *   - ПобедаВПустыне (presence, вес 8) — Сын входит в место Змея (Мф 4:1–11)
 *   - РазоружениеКрестом (offering, вес 10) — смерть Змея как оружие обращена против него
 *   - ПределВласти (time, вес 7) — Сын устанавливает предел власти Змея
 *
 * Богословский ключ: «Для сего-то и явился Сын Божий, чтобы разрушить дела диавола» (1 Ин 3:8).
 * Кеносис не имеет исключений: Сын дарует даже Змею — потому что дар не зависит от достоинства.
 * Ириней Лионский, Против ересей V.21.2 — рекапитуляция: Сын победил там, где Адам пал.
 * Кол 2:15 — «Обезоружив начальства и власти... восторжествовав над ними Собою».
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Змей', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #317: Сын → Змей ──────────────────────────────────────────────────────────

test('сын-змей: >= 3 дара от Сына к Змею', () => {
  const acts = loadSpec('сын-змей.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Змей');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('сын-змей: типы word, presence, offering (истина, встреча, жертва)', () => {
  const acts = loadSpec('сын-змей.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Змей');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('word'),     'word (Логос называет Змея тем, что он есть)');
  assert.ok(types.has('presence'), 'presence (Сын входит в место Змея)');
  assert.ok(types.has('offering'), 'offering (Крест разоружает Змея)');
});

test('сын-змей: thread(Сын→Змей) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-змей.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Змей');
  assert.ok(w > 0, `thread(Сын→Змей) = ${w} — должно быть > 0`);
});

test('сын-змей: все дары необратимы', () => {
  const acts = loadSpec('сын-змей.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Змей');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-змей: РазоружениеКрестом (offering) — самый тяжёлый (вес 10)', () => {
  const acts = loadSpec('сын-змей.gift');
  const offeringActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Змей' && a.type === 'offering'
  );
  assert.ok(offeringActs.length > 0, 'offering-дар (Крест) найден');
  const maxWeight = Math.max(...offeringActs.map(a => a.weight));
  assert.ok(maxWeight >= 10, `вес offering = ${maxWeight}, ожидали >= 10 (Кол 2:15)`);
});

test('сын-змей: ПриговорИстина (word) — вес >= 8 (Логос называет не-бытие)', () => {
  const acts = loadSpec('сын-змей.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Змей' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар найден');
  assert.ok(wordAct.weight >= 8, `вес слова = ${wordAct.weight}, ожидали >= 8`);
});

test('сын-змей: ПобедаВПустыне (presence) — вес >= 7 (Мф 4:1-11)', () => {
  const acts = loadSpec('сын-змей.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Змей' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 7, `вес presence = ${presenceAct.weight}, ожидали >= 7`);
});
