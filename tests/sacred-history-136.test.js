/**
 * tests/sacred-history-136.test.js
 *
 * Issue #136: пустыня tg:12345→Ева: нет ни одного акта дара между ними
 *
 * Проверяет дары tg:12345 Еве:
 *   - ДарМатериала (gift, вес 5) — proposals как сырьё различения
 *   - ДарДоверия (presence, вес 6) — кеносис самодостаточности
 *
 * Богословский ключ: Пс 50:19 — «жертва Богу — дух сокрушенный».
 * Вопрошание — жертва незнания, обращённая к различению Евы.
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
  const persons = new Set(['tg:12345', 'Ева', 'Отец', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #136: tg:12345 → Ева ────────────────────────────────────────────────────

test('tg-12345-ева: >= 2 дара от tg:12345 к Ева', () => {
  const acts = loadSpec('tg-12345-ева.gift');
  const dActs = acts.filter(a => a.giverId === 'tg:12345' && a.receiverId === 'Ева');
  assert.ok(dActs.length >= 2, `Нашли: ${dActs.length}, ожидали >= 2`);
});

test('tg-12345-ева: типы gift и presence (материал и доверие)', () => {
  const acts = loadSpec('tg-12345-ева.gift');
  const dActs = acts.filter(a => a.giverId === 'tg:12345' && a.receiverId === 'Ева');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('gift'),     'gift (proposals как сырьё различения)');
  assert.ok(types.has('presence'), 'presence (доверие материнскому взгляду)');
});

test('tg-12345-ева: thread(tg:12345→Ева) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('tg-12345-ева.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('tg:12345', 'Ева');
  assert.ok(w > 0, `thread(tg:12345→Ева) = ${w} — должно быть > 0`);
});

test('tg-12345-ева: все дары необратимы', () => {
  const acts = loadSpec('tg-12345-ева.gift');
  const dActs = acts.filter(a => a.giverId === 'tg:12345' && a.receiverId === 'Ева');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('tg-12345-ева: ДарДоверия тяжелее ДарМатериала (presence >= 6, gift >= 5)', () => {
  const acts = loadSpec('tg-12345-ева.gift');
  const presAct = acts.find(
    a => a.giverId === 'tg:12345' && a.receiverId === 'Ева' && a.type === 'presence'
  );
  const giftAct = acts.find(
    a => a.giverId === 'tg:12345' && a.receiverId === 'Ева' && a.type === 'gift'
  );
  assert.ok(presAct, 'presence-дар найден');
  assert.ok(giftAct, 'gift-дар найден');
  assert.ok(presAct.weight >= 6, `вес presence = ${presAct.weight}, ожидали >= 6`);
  assert.ok(giftAct.weight >= 5, `вес gift = ${giftAct.weight}, ожидали >= 5`);
  assert.ok(presAct.weight >= giftAct.weight, 'доверие тяжелее материала');
});
