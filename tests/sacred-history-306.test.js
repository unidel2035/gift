/**
 * tests/sacred-history-306.test.js
 *
 * Issue #306: пустыня Сын→Строитель: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Строителю:
 *   - ПредвечныйАрхитектор (presence, вес 9) — Сын-Логос как ἁρμόζουσα при творении
 *   - КраеугольныйКамень (covenant, вес 8) — Христос как основание всякого здания
 *   - ВоплощённыйМастер (word, вес 7) — τέκτων, освятил строительный труд плотью
 *
 * Богословский ключ: «Всё чрез Него начало быть» (Ин 1:3).
 * Притч 8:30 (LXX): Премудрость-Сын — «ἁρμόζουσα» (мастер-строитель) при Отце.
 * Пустыня — не разрыв, а незаписанное первородство: Строитель созидает лучом Сына.
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
  const persons = new Set(['Сын', 'Строитель', 'Отец', 'Дух', '_claude', 'Дионисий']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #306: Сын → Строитель ──────────────────────────────────────────────────

test('сын-строитель: >= 3 дара от Сына к Строителю', () => {
  const acts = loadSpec('сын-строитель.gift');
  const fActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Строитель');
  assert.ok(fActs.length >= 3, `Нашли: ${fActs.length}, ожидали >= 3`);
});

test('сын-строитель: типы presence, covenant, word', () => {
  const acts = loadSpec('сын-строитель.gift');
  const fActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Строитель');
  const types = new Set(fActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (ПредвечныйАрхитектор — Сын-Логос как ἁρμόζουσα)');
  assert.ok(types.has('covenant'), 'covenant (КраеугольныйКамень — основание всякого здания)');
  assert.ok(types.has('word'),     'word (ВоплощённыйМастер — τέκτων, освятил труд плотью)');
});

test('сын-строитель: thread(Сын→Строитель) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-строитель.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Строитель');
  assert.ok(w > 0, `thread(Сын→Строитель) = ${w} — должно быть > 0`);
});

test('сын-строитель: все дары необратимы', () => {
  const acts = loadSpec('сын-строитель.gift');
  const fActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Строитель');
  for (const a of fActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-строитель: ПредвечныйАрхитектор (presence) — вес >= 9 (Притч 8, Ин 1:3)', () => {
  const acts = loadSpec('сын-строитель.gift');
  const act = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Строитель' && a.type === 'presence'
  );
  assert.ok(act, 'presence-дар (ПредвечныйАрхитектор) найден');
  assert.ok(act.weight >= 9,
    `вес архитектора = ${act.weight}, ожидали >= 9 (предвечный замысел)`);
});

test('сын-строитель: КраеугольныйКамень (covenant) — вес >= 7 (1 Кор 3:11)', () => {
  const acts = loadSpec('сын-строитель.gift');
  const act = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Строитель' && a.type === 'covenant'
  );
  assert.ok(act, 'covenant-дар (КраеугольныйКамень) найден');
  assert.ok(act.weight >= 7,
    `вес завета = ${act.weight}, ожидали >= 7 (закон основания)`);
});

test('сын-строитель: ВоплощённыйМастер (word) — вес >= 5 (Мк 6:3)', () => {
  const acts = loadSpec('сын-строитель.gift');
  const act = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Строитель' && a.type === 'word'
  );
  assert.ok(act, 'word-дар (ВоплощённыйМастер) найден');
  assert.ok(act.weight >= 5,
    `вес слова = ${act.weight}, ожидали >= 5 (τέκτων освятил труд)`);
});
