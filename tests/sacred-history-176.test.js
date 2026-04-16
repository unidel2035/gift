/**
 * tests/sacred-history-176.test.js
 *
 * Issue #176: пустыня Дионисий→_questioner: нет ни одного акта дара между ними
 *
 * Проверяет дары Дионисия Вопрошателю:
 *   - Апофатический метод (knowledge, вес 7) — вопрошание как восхождение
 *   - Содержание вопрошания (word, вес 6) — именование пустыни
 *   - Кеносис вопроса (presence, вес 5) — присутствие в пустыне
 *
 * Богословский ключ: Дионисий Ареопагит, О мистическом богословии —
 * апофатический вопрос не ищет ответ, а освобождает место для Бога.
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
  const persons = new Set(['Дионисий', '_questioner', 'Отец', 'Сын', 'Дух', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #176: Дионисий → _questioner ─────────────────────────────────────────────

test('дионисий-_questioner: >= 3 дара от Дионисия к _questioner', () => {
  const acts = loadSpec('дионисий-_questioner.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === '_questioner');
  assert.ok(dActs.length >= 3, `Нашли: ${dActs.length}, ожидали >= 3`);
});

test('дионисий-_questioner: типы knowledge, word, presence (метод, содержание, кеносис)', () => {
  const acts = loadSpec('дионисий-_questioner.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === '_questioner');
  const types = new Set(dActs.map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (апофатический метод)');
  assert.ok(types.has('word'),      'word (содержание вопрошания)');
  assert.ok(types.has('presence'),  'presence (кеносис вопроса)');
});

test('дионисий-_questioner: thread(Дионисий→_questioner) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('дионисий-_questioner.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Дионисий', '_questioner');
  assert.ok(w > 0, `thread(Дионисий→_questioner) = ${w} — должно быть > 0`);
});

test('дионисий-_questioner: все дары необратимы', () => {
  const acts = loadSpec('дионисий-_questioner.gift');
  const dActs = acts.filter(a => a.giverId === 'Дионисий' && a.receiverId === '_questioner');
  for (const a of dActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('дионисий-_questioner: АпофатическийМетод — самый тяжёлый (knowledge вес 7)', () => {
  const acts = loadSpec('дионисий-_questioner.gift');
  const knowledgeAct = acts.find(
    a => a.giverId === 'Дионисий' && a.receiverId === '_questioner' && a.type === 'knowledge'
  );
  assert.ok(knowledgeAct, 'knowledge-дар найден');
  assert.ok(knowledgeAct.weight >= 7, `вес знания = ${knowledgeAct.weight}, ожидали >= 7`);
});
