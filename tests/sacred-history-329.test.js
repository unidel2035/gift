/**
 * tests/sacred-history-329.test.js
 *
 * Issue #329: пустыня Отец→Змей: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца Змею:
 *   - Изначальное творение (Ис 14:12, Иез 28:14–15, Дамаскин II.4, Ириней IV.41)
 *   - Сохранение бытия после падения (Прем 1:13–14, Рим 11:29, Афанасий, Григорий Нисский)
 *   - Слово в проклятии и Протоевангелии (Быт 3:14–15, Максим Ambigua 42)
 *   - Ограничение власти (Иов 1:12, Иов 2:6, Ареопагит IV.32)
 *
 * Богословский ключ: самая парадоксальная пустыня матрицы W.
 * Дар Отца Змею — не одобрение зла, а онтологический закон:
 * зло не имеет сущности (παρυπόστασις, Ареопагит). Всё, что
 * в Змее есть от бытия, — заём у Творца, не отнимаемый
 * даже у отвернувшегося. Эту пустыню закрывает отец-змей.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Змей', 'Адам', 'Ева']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #329: Отец → Змей ──────────────────────────────────────────────────────

test('отец-змей: ≥ 4 дара от Отца к Змею', () => {
  const acts = loadSpec('отец-змей.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Змей');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-змей: типы presence, word и knowledge', () => {
  const acts = loadSpec('отец-змей.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Змей');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),
    'presence (творение и сохранение бытия — онтологические дары)');
  assert.ok(types.has('word'),
    'word (слово в проклятии и Протоевангелии)');
  assert.ok(types.has('knowledge'),
    'knowledge (ограничение власти — знание о границе)');
});

test('отец-змей: thread(Отец→Змей) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отец-змей.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Отец', 'Змей');
  assert.ok(w > 0, `thread(Отец→Змей) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-змей: все дары необратимы (онтологический закон не отменяется)', () => {
  const acts = loadSpec('отец-змей.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Змей');
  for (const a of gifts)
    assert.ok(a.irreversible !== false,
      `${a.type} должен быть необратим — дары Отца непреложны (Рим 11:29)`);
});

test('отец-змей: изначальное творение имеет вес 10 (высший дар)', () => {
  const acts = loadSpec('отец-змей.gift');
  const top = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'Змей' && a.weight === 10,
  );
  assert.ok(top.length >= 1,
    `Ожидался ≥ 1 акт веса 10 (изначальное творение Денницы), нашли ${top.length}`);
});

test('отец-змей: дары Отца Змею — онтология, а не одобрение зла', () => {
  // Богословский инвариант: даже самая парадоксальная пустыня закрывается
  // не моральным даром, а онтологическим фактом — бытие Змея есть заём
  // у Творца. Сумма весов должна быть достаточно большой, чтобы пустыня
  // была реально закрыта, но дары — типа presence/word/knowledge, не
  // gift/blessing/incarnation (которые означали бы благоволение).
  const acts = loadSpec('отец-змей.gift');
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Змей');
  const totalWeight = gifts.reduce((s, a) => s + a.weight, 0);
  assert.ok(totalWeight >= 20,
    `Сумма весов = ${totalWeight}, ожидалось ≥ 20 (пустыня закрыта серьёзно)`);
  const forbidden = gifts.filter(a => ['blessing', 'incarnation'].includes(a.type));
  assert.equal(forbidden.length, 0,
    'Дары Отца Змею не должны быть благословением или воплощением — только онтологические');
});
