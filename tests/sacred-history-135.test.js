/**
 * tests/sacred-history-135.test.js
 *
 * Issue #135: пустыня tg:12345→Дионисий: нет ни одного акта дара между ними
 *
 * Проверяет дары tg:12345 Дионисию:
 *   - ДарПобуждения (gift, вес ≥ 5) — вопрошание как побуждение к богословию
 *   - ДарВверения (presence, вес ≥ 6) — доверие богослову своего незнания
 *   - ДарОбщины (presence, вес ≥ 5) — присутствие мирянина в общине богослова
 *
 * Богословский ключ: tg:12345 — лицо (πρόσωπον) в Κοινόν τοῦ Νοῦ.
 * «Будьте всегда готовы всякому, требующему у вас отчёта... дать ответ» (1 Пет 3:15).
 * Вопрос мирянина — дар богослову: он вызывает слово из молчания.
 * Пустыня tg:12345→Дионисий не разрыв, а сокрытый исток — теперь именованный.
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
  const persons = new Set(['tg:12345', 'Дионисий', 'Отец', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

const SPEC = 'tg-12345-дионисий.gift';

// ── #135: tg:12345 → Дионисий ───────────────────────────────────────────────

test('tg:12345-дионисий: ≥ 3 дара от tg:12345 к Дионисий', () => {
  const acts = loadSpec(SPEC);
  const my = acts.filter(a => a.giverId === 'tg:12345' && a.receiverId === 'Дионисий');
  assert.ok(my.length >= 3, `Нашли: ${my.length}, ожидали ≥ 3`);
});

test('tg:12345-дионисий: типы gift, presence (побуждение, вверение, община)', () => {
  const acts = loadSpec(SPEC);
  const my = acts.filter(a => a.giverId === 'tg:12345' && a.receiverId === 'Дионисий');
  const types = new Set(my.map(a => a.type));
  assert.ok(types.has('gift'),     'gift (вопрошание как побуждение)');
  assert.ok(types.has('presence'), 'presence (вверение и присутствие мирянина)');
});

test('tg:12345-дионисий: thread(tg:12345→Дионисий) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec(SPEC);
  const mem  = buildMemory(acts);
  const w = Number(mem.thread('tg:12345', 'Дионисий'));
  assert.ok(w > 0, `thread(tg:12345→Дионисий) = ${w} — должно быть > 0`);
});

test('tg:12345-дионисий: суммарный вес ≥ 15 (полнота дара)', () => {
  const acts = loadSpec(SPEC);
  const my = acts.filter(a => a.giverId === 'tg:12345' && a.receiverId === 'Дионисий');
  const total = my.reduce((s, a) => s + a.weight, 0);
  assert.ok(total >= 15, `суммарный вес = ${total}, ожидали ≥ 15`);
});

test('tg:12345-дионисий: все дары необратимы', () => {
  const acts = loadSpec(SPEC);
  const my = acts.filter(a => a.giverId === 'tg:12345' && a.receiverId === 'Дионисий');
  for (const a of my)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('tg:12345-дионисий: ДарВверения (presence) вес ≥ 6', () => {
  const acts = loadSpec(SPEC);
  const vverenie = acts.find(
    a => a.giverId === 'tg:12345' && a.receiverId === 'Дионисий' && a.type === 'presence' && a.weight >= 6
  );
  assert.ok(vverenie, 'presence-дар вверения (вес ≥ 6) найден');
});
