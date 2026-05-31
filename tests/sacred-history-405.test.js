/**
 * tests/sacred-history-405.test.js
 *
 * Issue #405: пустыня Отец→КогоТо: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Безымянному (КогоТо как онтологический горизонт):
 *   - ДарБытия (presence, вес 10) — «Сам дая всему жизнь и дыхание» (Деян 17:25)
 *   - ДарПризыва (word, вес 9) — «Я открылся не вопрошавшим обо Мне» (Ис 65:1)
 *   - ДарПредваряющейБлагодати (presence, вес 8) — «прежде нежели они воззовут» (Ис 65:24)
 *   - ДарИскания (knowledge, вес 7) — «дабы они искали Бога» (Деян 17:27)
 *
 * Богословский ключ: КогоТо — не лицо с биографией, а онтологический горизонт
 * всякого ещё-не-названного. Дары Отца текут к нему прежде имени, прежде
 * вопроса, прежде ответа. Это gratia praeveniens — предваряющая благодать,
 * касающаяся каждого, кого общине ещё предстоит назвать.
 * Уже существует пастырское измерение (ОтецСергий→КогоТо, #152, #167).
 * Здесь — тринитарное: Сам Источник даёт безымянному прежде пастыря.
 * Климент Александрийский, Строматы VI.17 — Бог-Воспитатель готовит язычников.
 * Иустин Философ, Апология I.46 — λόγος σπερματικός во всяком разумном.
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
  const persons = new Set(['Отец', 'КогоТо', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #405: Отец → КогоТо ────────────────────────────────────────────────────

test('отец-когото: >= 4 дара от Отца к КомуТо', () => {
  const acts = loadSpec('отец-когото.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  assert.ok(dActs.length >= 4, `Нашли: ${dActs.length}, ожидали >= 4`);
});

test('отец-когото: типы presence (×2), word, knowledge — бытие, призыв, благодать, искание', () => {
  const acts = loadSpec('отец-когото.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  const types = dActs.map(a => a.type);
  const presenceCount = types.filter(t => t === 'presence').length;
  assert.ok(presenceCount >= 2,
    `presence-даров: ${presenceCount} — ожидали >= 2 (ДарБытия + ДарПредваряющейБлагодати)`);
  assert.ok(types.includes('word'),      'word (ДарПризыва — Ис 65:1)');
  assert.ok(types.includes('knowledge'), 'knowledge (ДарИскания — Деян 17:27)');
});

test('отец-когото: thread(Отец→КогоТо) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-когото.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'КогоТо');
  assert.ok(w > 0, `thread(Отец→КогоТо) = ${w} — должно быть > 0`);
});

test('отец-когото: все дары необратимы', () => {
  const acts = loadSpec('отец-когото.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-когото: ДарБытия (presence) — вес >= 10 (Деян 17:25, онтологический фундамент)', () => {
  const acts = loadSpec('отец-когото.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  const presenceActs = dActs.filter(a => a.type === 'presence');
  const maxPresence = Math.max(...presenceActs.map(a => a.weight));
  assert.ok(maxPresence >= 10,
    `Главный presence-дар = ${maxPresence}, ожидали >= 10 (бытие — самое тяжёлое: «мы Им живём» Деян 17:28)`);
});

test('отец-когото: ДарПризыва (word) — вес >= 9 (Ис 65:1, зов прежде имени)', () => {
  const acts = loadSpec('отец-когото.gift');
  const wordAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'КогоТо' && a.type === 'word'
  );
  assert.ok(wordAct, 'word-дар (ДарПризыва) найден');
  assert.ok(wordAct.weight >= 9,
    `вес призыва = ${wordAct.weight}, ожидали >= 9 (Откр 22:17 — «жаждущий пусть приходит»)`);
});

test('отец-когото: ДарИскания (knowledge) — вес >= 7 (Деян 17:27, λόγος σπερματικός)', () => {
  const acts = loadSpec('отец-когото.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Отец' && a.receiverId === 'КогоТо' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар (ДарИскания) найден');
  assert.ok(knowledgeAct.weight >= 7,
    `вес искания = ${knowledgeAct.weight}, ожидали >= 7 (Ин 1:9 — «просвещает всякого человека»)`);
});

test('отец-когото: сумма весов даров Отца КомуТо >= 30 (полнота предваряющего дарения)', () => {
  const acts = loadSpec('отец-когото.gift');
  const dActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'КогоТо');
  const sum = dActs.reduce((s, a) => s + a.weight, 0);
  assert.ok(sum >= 30,
    `Σ весов = ${sum}, ожидали >= 30 (бытие+призыв+благодать+искание ≈ 10+9+8+7)`);
});
