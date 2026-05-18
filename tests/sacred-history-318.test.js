/**
 * tests/sacred-history-318.test.js
 *
 * Issue #318: пустыня Сын→Падший: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Падшему:
 *   - ПоискПадшего (presence, вес 10) — онтологическая миссия: Сын выходит навстречу
 *   - СловоПути (word, вес 9) — Логос открывает путь там, где его не было
 *   - ПрисутствиеВПустыне (presence, вес 8) — Сын в месте Падшего (Мф 4:1–11)
 *   - ВремяПокаяния (time, вес 8) — отсрочка суда как дар λήψις
 *
 * Богословский ключ: «Сын Человеческий пришёл взыскать и спасти погибшее» (Лк 19:10).
 * Пустыня не была разрывом — она была незаписанным средоточием кеносиса.
 * Ириней Лионский, Против ересей III.19.1 — рекапитуляция: Сын проходит путь падшего.
 * Исаак Сирин, Слово 58 — «Любовь не позволяет Богу оставить падшего».
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Падший', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #318: Сын → Падший ──────────────────────────────────────────────────────

test('сын-падший: >= 3 дара от Сына к Падшему', () => {
  const acts = loadSpec('сын-падший.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Падший');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('сын-падший: типы presence, word, time (поиск, слово, время)', () => {
  const acts = loadSpec('сын-падший.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Падший');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('presence'), 'presence (Сын выходит навстречу)');
  assert.ok(types.has('word'),     'word (Логос открывает путь)');
  assert.ok(types.has('time'),     'time (отсрочка суда как дар)');
});

test('сын-падший: thread(Сын→Падший) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-падший.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Падший');
  assert.ok(w > 0, `thread(Сын→Падший) = ${w} — должно быть > 0`);
});

test('сын-падший: все дары необратимы', () => {
  const acts = loadSpec('сын-падший.gift');
  const dActs = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Падший');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-падший: ПоискПадшего (presence) — самый тяжёлый (вес 10)', () => {
  const acts = loadSpec('сын-падший.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Падший' && a.type === 'presence'
  );
  assert.ok(presenceActs.length > 0, 'presence-дар найден');
  const maxWeight = Math.max(...presenceActs.map(a => a.weight));
  assert.ok(maxWeight >= 10, `вес presence = ${maxWeight}, ожидали >= 10 (онтологическая миссия)`);
});

test('сын-падший: СловоПути (word) — вес >= 8 (Логос открывает путь)', () => {
  const acts = loadSpec('сын-падший.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Падший' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар найден');
  assert.ok(wordAct.weight >= 8, `вес слова = ${wordAct.weight}, ожидали >= 8`);
});

test('сын-падший: ВремяПокаяния (time) — вес >= 7 (2 Пет 3:9)', () => {
  const acts = loadSpec('сын-падший.gift');
  const timeAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Падший' && a.type === 'time'
  );
  assert.ok(timeAct, 'time-дар найден');
  assert.ok(timeAct.weight >= 7, `вес времени = ${timeAct.weight}, ожидали >= 7`);
});
