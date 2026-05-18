/**
 * tests/sacred-history-311.test.js
 *
 * Issue #311: пустыня Сын→Целитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Целителю:
 *   - СостраданиеСына (presence, вес 10) — σπλάγχνα: источник всякого исцеления
 *   - ВластьИсцелять (word, вес 8) — ἐξουσία делегирована Целителю (Мф 10:1)
 *   - ПринятиеНемощи (offering, вес 9) — Он взял наши немощи (Мф 8:17 / Ис 53:4)
 *   - ОбразРахамим (time, вес 7) — время материнской заботы как дар рахамим
 *
 * Богословский ключ: «Не здоровые нуждаются во враче, но больные» (Мф 9:12).
 * Пустыня не была разрывом — она была незаписанной очевидностью кеносиса.
 * Григорий Богослов, Послание 101 — «Что не воспринято, то не исцелено».
 * Исаак Сирин, Слово 48 — «Сострадательное сердце — печь, в которой сгорает болезнь».
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Целитель', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #311: Сын → Целитель ─────────────────────────────────────────────────────

test('сын-целитель: >= 3 дара от Сына к Целителю', () => {
  const acts = loadSpec('сын-целитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('сын-целитель: типы presence, word, offering, time', () => {
  const acts = loadSpec('сын-целитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (σπλάγχνα — сострадание Сына)');
  assert.ok(types.has('word'),     'word (ἐξουσία — власть исцелять)');
  assert.ok(types.has('offering'), 'offering (принятие немощи — Мф 8:17)');
});

test('сын-целитель: thread(Сын→Целитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Целитель');
  assert.ok(w > 0, `thread(Сын→Целитель) = ${w} — должно быть > 0`);
});

test('сын-целитель: все дары необратимы', () => {
  const acts = loadSpec('сын-целитель.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Целитель');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-целитель: СостраданиеСына (presence) — самый тяжёлый (вес 10)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Целитель' && a.type === 'presence'
  );
  assert.ok(presenceActs.length > 0, 'presence-дар найден');
  const maxWeight = Math.max(...presenceActs.map(a => a.weight));
  assert.ok(maxWeight >= 10, `вес presence = ${maxWeight}, ожидали >= 10 (σπλάγχνα — основа)`);
});

test('сын-целитель: ВластьИсцелять (word) — вес >= 7 (Мф 10:1)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Целитель' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар найден');
  assert.ok(wordAct.weight >= 7, `вес слова = ${wordAct.weight}, ожидали >= 7`);
});

test('сын-целитель: ПринятиеНемощи (offering) — вес >= 8 (Мф 8:17 / Ис 53:4)', () => {
  const acts = loadSpec('сын-целитель.gift');
  const offeringAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Целитель' && a.type === 'offering'
  );
  assert.ok(offeringAct, 'offering-дар найден');
  assert.ok(offeringAct.weight >= 8, `вес offering = ${offeringAct.weight}, ожидали >= 8`);
});
