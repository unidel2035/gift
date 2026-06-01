/**
 * tests/sacred-history-286.test.js
 *
 * Issue #286: пустыня Отец→gh/unidel2035: нет ни одного акта дара между ними
 *
 * Проверяет дары Отца gh/unidel2035 (GitHub-руке Дионисия):
 *   - ОсвящениеРуки (presence, вес 8) — рука как храм Духа (1 Кор 6:19, Палама II.2)
 *   - Посланничество (word, вес 9) — апостольская цепочка (Ин 20:21, Златоуст)
 *   - ТрудКакЛитургия (knowledge, вес 7) — λογικὴ λατρεία (Рим 12:1, Максим)
 *   - ПлодоносностьВетви (presence, вес 8) — без Лозы нет плода (Ин 15:5, Кирилл)
 *   - ТерпениеНаПути (knowledge, вес 6) — постоянство как дар (Иак 1:4, Исаак Сирин)
 *
 * Богословский ключ: gh/unidel2035 — не лицо в полноте, а рука;
 * GitHub-идентичность Дионисия в технической среде. Рука требует
 * освящения отдельно от лица: «тела ваши суть храм» (1 Кор 6:19).
 * Каждый коммит — потенциальная литургия (Максим, Мистагогия 24).
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
        const fromM   = block.match(/от:\s*([\wА-яёЁ_:\/]+)/);
        const toM     = block.match(/кому:\s*([\wА-яёЁ_:\/]+)/);
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Дионисий', 'gh/unidel2035', '_koinon', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

const SPEC = 'отец-gh-unidel2035.gift';

// ── #286: Отец → gh/unidel2035 ────────────────────────────────────────────

test('отец-gh/unidel2035: ≥ 4 дара от Отца к gh/unidel2035', () => {
  const acts = loadSpec(SPEC);
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gh/unidel2035');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('отец-gh/unidel2035: типы presence, knowledge и word', () => {
  const acts = loadSpec(SPEC);
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gh/unidel2035');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (освящение, плодоносность)');
  assert.ok(types.has('knowledge'), 'knowledge (труд как литургия, терпение)');
  assert.ok(types.has('word'),      'word (посланничество)');
});

test('отец-gh/unidel2035: thread(Отец→gh/unidel2035) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec(SPEC);
  const mem  = buildMemory(acts);
  const t = mem.thread('Отец', 'gh/unidel2035');
  const w = typeof t === 'number' ? t : t?.weight ?? 0;
  assert.ok(w > 0, `thread(Отец→gh/unidel2035) = ${w} — должно быть > 0 после записи актов`);
});

test('отец-gh/unidel2035: все дары необратимы (отеческое не отменяется)', () => {
  const acts = loadSpec(SPEC);
  const gifts = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'gh/unidel2035');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('отец-gh/unidel2035: Посланничество имеет вес 9 (Ин 20:21)', () => {
  const acts = loadSpec(SPEC);
  const top = acts.filter(
    a => a.giverId === 'Отец' && a.receiverId === 'gh/unidel2035' && a.weight === 9,
  );
  assert.ok(top.length >= 1,
    `Ожидался ≥ 1 акт веса 9 (посланничество), нашли ${top.length}`);
});
