/**
 * tests/sacred-history-140.test.js
 *
 * Issue #140: пустыня Свидетель→ОтецСергий: нет ни одного акта дара между ними
 *
 * Проверяет дары Свидетеля (Серафима) ОтцуСергию (пресвитеру):
 *   - Огненное подтверждение (witness, вес 7) — уголь с жертвенника очищает уста (Ис 6:6-7)
 *   - Серафимское предстояние (presence, вес 8) — ангельский чин сослужит священнику (Ис 6:2)
 *   - Покров Литургии (presence, вес 6) — крылья Серафима объемлют священника у Престола
 *
 * Богословский ключ: Серафим — первый чин небесной иерархии (Дионисий Ареопагит,
 * О небесной иерархии VII), горящий любовью у Престола. ОтецСергий — пресвитер,
 * предстоящий Богу в Литургии. Пустыня парадоксальна: ближайшие сослужители Славы
 * не имели записанной связи. Трисвятое священника есть земное эхо серафимского
 * «Свят, свят, свят» (Ис 6:3). Оба — твари → реальный W (не energeia).
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
  const persons = new Set(['Свидетель', 'ОтецСергий', 'Отец', 'Сын', 'Дух', 'Дионисий', 'Ева']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #140: Свидетель → ОтецСергий ────────────────────────────────────────────

test('свидетель-отецсергий: ≥ 3 дара от Свидетель к ОтецСергий', () => {
  const acts = loadSpec('свидетель-отецсергий.gift');
  const witActs = acts.filter(a => a.giverId === 'Свидетель' && a.receiverId === 'ОтецСергий');
  assert.ok(witActs.length >= 3, `Нашли: ${witActs.length}, ожидали ≥ 3`);
});

test('свидетель-отецсергий: типы witness, presence', () => {
  const acts = loadSpec('свидетель-отецсергий.gift');
  const witActs = acts.filter(a => a.giverId === 'Свидетель' && a.receiverId === 'ОтецСергий');
  const types = new Set(witActs.map(a => a.type));
  assert.ok(types.has('witness'),  'witness (огненное подтверждение слова)');
  assert.ok(types.has('presence'), 'presence (серафимское предстояние, покров литургии)');
});

test('свидетель-отецсергий: thread(Свидетель→ОтецСергий) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('свидетель-отецсергий.gift');
  const mem  = buildMemory(acts);
  const w = Number(mem.thread('Свидетель', 'ОтецСергий'));
  assert.ok(w > 0, `thread(Свидетель→ОтецСергий) = ${w} — должно быть > 0`);
});

test('свидетель-отецсергий: все дары необратимы', () => {
  const acts = loadSpec('свидетель-отецсергий.gift');
  const witActs = acts.filter(a => a.giverId === 'Свидетель' && a.receiverId === 'ОтецСергий');
  for (const a of witActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('свидетель-отецсергий: ОгненноеПодтверждение (witness) вес = 7', () => {
  const acts = loadSpec('свидетель-отецсергий.gift');
  const witnessAct = acts.find(
    a => a.giverId === 'Свидетель' && a.receiverId === 'ОтецСергий' && a.type === 'witness'
  );
  assert.ok(witnessAct, 'witness-дар найден');
  assert.ok(witnessAct.weight === 7, `вес огненного подтверждения = ${witnessAct.weight}, ожидали = 7`);
});

test('свидетель-отецсергий: СерафимскоеПредстояние (presence) вес ≥ 8', () => {
  const acts = loadSpec('свидетель-отецсергий.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Свидетель' && a.receiverId === 'ОтецСергий' && a.type === 'presence'
  );
  const maxPresence = Math.max(...presenceActs.map(a => a.weight));
  assert.ok(maxPresence >= 8, `макс. вес предстояния = ${maxPresence}, ожидали ≥ 8`);
});
