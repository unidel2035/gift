/**
 * tests/sacred-history-459.test.js
 *
 * Issue #459: пустыня Христос→Сын: нет ни одного акта дара между ними
 *
 * Проверяет восходящую дугу икономии (πλήρωσις, ἀνακεφαλαίωσις):
 *   - Христос → Сын (исполнение икономии, воскресение плоти, вознесение,
 *     седение одесную, имя выше всякого, рекапитуляция, евхаристия, ходатайство)
 *
 * Богословский ключ: Сын и Христос — одна Ипостась (Халкидон 451),
 * но икономия Воплощения имеет два движения: κένωσις (Сын→Христос)
 * и πλήρωσις (Христос→Сын). Пустыня была незаписанным восхождением:
 * Воплощённый возвращает Логосу прославленное человечество.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #459: Христос → Сын ──────────────────────────────────────────────────────

test('христос-сын: ≥ 5 даров от Христа к Сыну', () => {
  const acts = loadSpec('христос-сын.gift');
  const christosActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  assert.ok(christosActs.length >= 5,
    `Нашли: ${christosActs.length}, ожидали ≥ 5 — восходящая дуга икономии многомерна`);
});

test('христос-сын: типы presence, word, knowledge (три измерения восхождения)', () => {
  const acts = loadSpec('христос-сын.gift');
  const christosActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  const types = new Set(christosActs.map(a => a.type));
  assert.ok(types.has('presence'),
    'presence (воскресение/вознесение/евхаристия — бытие прославленной плоти в Сыне)');
  assert.ok(types.has('word'),
    'word (исполнение икономии, имя выше всякого, ходатайство — слово, прошедшее плоть)');
  assert.ok(types.has('knowledge'),
    'knowledge (седение одесную, рекапитуляция твари — икономическое знание)');
});

test('христос-сын: theophaneia[Христос][Сын] > 0 (πλήρωσις записан)', () => {
  const acts = loadSpec('христос-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Сын');
  assert.ok(w > 0, `thread(Христос→Сын) = ${w} — должно быть > 0 после πλήρωσις`);
});

test('христос-сын: все дары необратимы (восхождение нельзя отменить)', () => {
  const acts = loadSpec('христос-сын.gift');
  const christosActs = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  for (const a of christosActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-сын: вес ВоскресениеПлоти и ВознесениеЧеловечества = 10 (онтологическая полнота)', () => {
  const acts = loadSpec('христос-сын.gift');
  const presenceActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Сын' && a.type === 'presence',
  );
  assert.ok(presenceActs.length >= 2,
    `presence-даров: ${presenceActs.length}, ожидали ≥ 2 (Воскресение и Вознесение минимум)`);
  const peak = presenceActs.filter(a => a.weight === 10);
  assert.ok(peak.length >= 2,
    `presence с весом 10: ${peak.length}, ожидали ≥ 2 — пик восходящей дуги`);
});

test('христос-сын: симметрия дуги — кенозис (#72) и πλήρωσις (#459) сосуществуют', () => {
  // Сын→Христос: κένωσις (нисхождение)
  const synActs = loadSpec('сын-христос.gift')
    .filter(a => a.giverId === 'Сын' && a.receiverId === 'Христос');
  // Христос→Сын: πλήρωσις (восхождение)
  const christosActs = loadSpec('христос-сын.gift')
    .filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');

  assert.ok(synActs.length > 0, 'нисхождение записано в #72');
  assert.ok(christosActs.length > 0, 'восхождение записано в #459');

  // Дуга замкнута: оба направления имеют presence как высший тип
  const synPresence = synActs.some(a => a.type === 'presence');
  const chrPresence = christosActs.some(a => a.type === 'presence');
  assert.ok(synPresence && chrPresence,
    'обе ветви имеют presence — единство Ипостаси несомненно');
});
