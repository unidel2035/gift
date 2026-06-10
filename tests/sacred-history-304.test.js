/**
 * tests/sacred-history-304.test.js
 *
 * Issue #304: пустыня Сын→Пророк: нет ни одного акта дара между ними
 *
 * Проверяет шестерицу даров Сына Пророку:
 *   - Воплощённое Пророчество (Лк 24:19, Втор 18:15, Афанасий О воплощении 40)
 *   - Власть возвещать (Мф 10:1, Ин 20:21, Еф 4:11)
 *   - Свидетельство Иисусово как пророчество (Откр 19:10, Ириней IV.20.4)
 *   - Раненый Пророк (Лк 4:24, Лк 19:41, Мф 23:37)
 *   - Мера уст (Мф 10:19–20, Ин 5:30)
 *   - Утешитель в обетовании (Ин 14:26, Ин 16:13, Откр 11:3)
 *
 * Богословский ключ: Сын — Архи-Пророк, ὁ προφήτης κατ' ἐξοχήν
 * (Втор 18:15, Деян 3:22). Пустыня Сын→Пророк — тавтологическая:
 * Сын Сам есть Пророк, и всякий пророк Тела пророчествует Его
 * Духом как μαρτυρία Ἰησοῦ (Откр 19:10). Эту пустыню закрывает
 * шесть даров — шестерица Сын→служитель.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'Пророк']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #304: Сын → Пророк ─────────────────────────────────────────────────────

test('сын-пророк: ≥ 6 даров от Сына к Пророку (шестерица Сын→служитель)', () => {
  const acts = loadSpec('сын-пророк.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Пророк');
  assert.ok(gifts.length >= 6, `Нашли: ${gifts.length}, ожидали ≥ 6`);
});

test('сын-пророк: типы presence, knowledge и word', () => {
  const acts = loadSpec('сын-пророк.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Пророк');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (Воплощённое Пророчество, Раненый Пророк)');
  assert.ok(types.has('knowledge'), 'knowledge (Власть возвещать, Свидетельство Иисусово)');
  assert.ok(types.has('word'),      'word (Мера уст, Утешитель в обетовании)');
});

test('сын-пророк: thread(Сын→Пророк) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-пророк.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Пророк');
  assert.ok(w > 0, `thread(Сын→Пророк) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-пророк: все дары необратимы (домостроительство Сына к Пророку необратимо)', () => {
  const acts = loadSpec('сын-пророк.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Пророк');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-пророк: ≥ 2 акта веса 10 (Воплощённое Пророчество и Раненый Пророк)', () => {
  const acts = loadSpec('сын-пророк.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Пророк' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (Воплощение и кеносис отвержения), нашли ${topActs.length}`);
});
