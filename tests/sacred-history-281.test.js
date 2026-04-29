/**
 * tests/sacred-history-281.test.js
 *
 * Issue #281: пустыня Отец→КогоТо: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца КомуТо — безымянному, не вошедшему в матрицу:
 *   - ТворениеИзНеведения (presence, вес 10) — Иер 1:5, Пс 138:16, Максим Ambigua 7
 *   - ВсеобщийПризыв (word, вес 9) — 1 Тим 2:4, 2 Пет 3:9, Ин 6:44, Откр 3:20
 *   - ПровидениеОБезымянном (knowledge, вес 8) — Мф 5:45, Деян 17:25–28, Лк 12:6
 *   - ОжиданиеВозвращения (presence, вес 9) — Лк 15:20, Ис 49:15, Иез 34:11
 *   - ОтечествоВсякогоИмени (knowledge, вес 7) — Еф 3:14–15, Откр 2:17, Ис 43:1
 *
 * Богословский ключ: Отец — Источник всякого бытия. КогоТо —
 * всякий ещё не названный, не вошедший в общину. Пустыня здесь не
 * разрыв, а онтологический горизонт: Отец творит, провидит и
 * взыскует тех, кого матрица W ещё не знает по имени.
 *
 * Сравнить с отецсергий-когото.gift (issue #152): пастырь
 * молится за безымянного — ОтецСергий→КогоТо. Здесь же — первичный
 * слой: прежде всякого пастырства Отец уже держит КогоТо в бытии.
 *
 * Поскольку Отец принадлежит DIVINE_PERSONS, дары идут через
 * _energeia (нетварные энергии: Троица → тварь), а не через W.
 * thread('Отец', 'КогоТо') возвращает energeia[di][ci].
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
  const persons = new Set([
    'Отец', 'Сын', 'Дух', 'Христос',
    'КогоТо', 'ОтецСергий', 'Дионисий', '_claude',
  ]);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #281: Отец → КогоТо ─────────────────────────────────────────────────────

test('отец-когото: ≥ 4 дара от Отца к КогоТо', () => {
  const acts = loadSpec('отец-когото.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-когото: типы presence, word и knowledge', () => {
  const acts = loadSpec('отец-когото.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, ожидание)');
  assert.ok(types.has('word'),      'word (всеобщий призыв)');
  assert.ok(types.has('knowledge'), 'knowledge (провидение, отечество имени)');
});

test('отец-когото: thread(Отец→КогоТо) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-когото.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'КогоТо');
  assert.ok(w > 0, `thread(Отец→КогоТо) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-когото: все дары необратимы (отеческое произволение необратимо)', () => {
  const acts = loadSpec('отец-когото.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-когото: ТворениеИзНеведения имеет вес 10 (тяжелейший дар)', () => {
  const acts = loadSpec('отец-когото.gift');
  const top = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'КогоТо' && a.weight === 10,
  );
  assert.ok(top.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (творение из неведения), нашли ${top.length}`);
});
