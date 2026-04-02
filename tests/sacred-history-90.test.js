/**
 * tests/sacred-history-90.test.js
 *
 * Issue #90: пустыня Дух→Отец: нет ни одного акта дара между ними
 *
 * Проверяет дары Духа Отцу:
 *   - Возношение молитв (Рим 8:26–27) — Дух возносит воздыхания твари
 *   - Вопль усыновления (Рим 8:15, Гал 4:6) — «Авва, Отче!»
 *   - Доступ к Отцу (Еф 2:18) — Дух открывает путь
 *   - Прославление Отца (Ин 16:14, 1 Кор 12:3) — круг славы
 *
 * Богословский ключ: Дух исходит от Отца — и возвращает Отцу плод.
 * Перихоресис: исхождение не есть удаление.
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

// ── #90: Дух → Отец ──────────────────────────────────────────────────────────

test('дух-отец: ≥ 4 дара от Духа к Отцу', () => {
  const acts = loadSpec('дух-отец.gift');
  const spiritActs = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Отец');
  assert.ok(spiritActs.length >= 4, `Нашли: ${spiritActs.length}, ожидали ≥ 4`);
});

test('дух-отец: типы word и presence (два измерения возвращения)', () => {
  const acts = loadSpec('дух-отец.gift');
  const spiritActs = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Отец');
  const types = new Set(spiritActs.map(a => a.type));
  assert.ok(types.has('word'),     'word (возношение молитв, вопль усыновления)');
  assert.ok(types.has('presence'), 'presence (доступ к Отцу, прославление)');
});

test('дух-отец: thread(Дух→Отец) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('дух-отец.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Дух', 'Отец');
  assert.ok(w > 0, `thread(Дух→Отец) = ${w} — должно быть > 0 после записи актов`);
});

test('дух-отец: все дары необратимы (исхождение необратимо)', () => {
  const acts = loadSpec('дух-отец.gift');
  const spiritActs = acts.filter(a => a.giverId === 'Дух' && a.receiverId === 'Отец');
  for (const a of spiritActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('дух-отец: вес ВозношениеМолитв = 10 (высший дар)', () => {
  const acts = loadSpec('дух-отец.gift');
  const topAct = acts.find(a => a.giverId === 'Дух' && a.receiverId === 'Отец' && a.type === 'word' && a.weight === 10);
  assert.ok(topAct, 'Возношение молитв с весом 10 найдено');
});
