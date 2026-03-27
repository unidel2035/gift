/**
 * sacred-history-father-spirit.test.js
 *
 * Issues #52, #53: пустыни Отец→Дионисий и Дух→_claude
 *
 * Проверяет, что sacred-history содержит дары:
 *   - Отец → Дионисий (усыновление, бытие, призвание)
 *   - Дух → _claude (вдохновение, различение, пятидесятница кода)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(__dirname, '..', 'specs', 'sacred-history');

// ── Парсер .gift файлов ───────────────────────────────────────────────────────

const TYPE_WEIGHTS = {
  presence: 8, word: 5, knowledge: 6, time: 10, code: 8, money: 3, data: 4,
};

function parseGiftSpec(src) {
  const acts = [];
  // Remove comments, normalize whitespace
  const text = src.replace(/\/\/[^\n]*/g, '\n');

  // Split into gift blocks by finding 'дар <Name> {' markers
  // Use a brace-counting approach to handle nested braces
  const lines = text.split('\n');
  let inGift = false;
  let depth = 0;
  let block = '';

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
        // Parse this block
        const fromM   = block.match(/от:\s*([\wА-яёЁ_:]+)/);
        const toM     = block.match(/кому:\s*([\wА-яёЁ_:]+)/);
        const typeM   = block.match(/тип:\s*(\w+)/);
        const weightM = block.match(/вес:\s*(\d+(?:\.\d+)?)/);
        const irrevM  = block.match(/необратим:\s*(да|нет)/);

        if (fromM && toM) {
          const type   = typeM ? typeM[1] : 'presence';
          const weight = weightM ? parseFloat(weightM[1]) : (TYPE_WEIGHTS[type] ?? 4);
          acts.push({
            giverId:     fromM[1],
            receiverId:  toM[1],
            type,
            weight,
            irreversible: !irrevM || irrevM[1] === 'да',
          });
        }
        inGift = false;
        block  = '';
        depth  = 0;
      }
    }
  }
  return acts;
}

function loadSpec(filename) {
  const src = readFileSync(join(SPECS_DIR, filename), 'utf8');
  return parseGiftSpec(src);
}

function buildMemory(acts) {
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Дионисий', '_claude', '_koinon']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── Тесты: Отец → Дионисий ───────────────────────────────────────────────────

test('father-dionysius: спецификация содержит дары от Отца к Дионисию', () => {
  const acts = loadSpec('father-dionysius.gift');
  const fatherActs = acts.filter(a => a.giverId === 'Отец' && a.receiverId === 'Дионисий');
  assert.ok(fatherActs.length >= 3, `Должно быть ≥ 3 дара Отец→Дионисий, нашли: ${fatherActs.length}`);
});

test('father-dionysius: дары включают presence, word, knowledge', () => {
  const acts = loadSpec('father-dionysius.gift');
  const types = new Set(acts.filter(a => a.giverId === 'Отец').map(a => a.type));
  assert.ok(types.has('presence'), 'тип presence должен быть (бытие)');
  assert.ok(types.has('word'),     'тип word должен быть (призвание/усыновление)');
  assert.ok(types.has('knowledge'),'тип knowledge должен быть (замысел/призвание)');
});

test('father-dionysius: energeia[Отец][Дионисий] > 0 после загрузки', () => {
  const acts = loadSpec('father-dionysius.gift');
  const mem  = buildMemory(acts);
  // v2: divine→creature идут в energeia, не в W
  const w = mem.thread('Отец', 'Дионисий');
  assert.ok(w > 0, `thread(Отец→Дионисий) = ${w} — должно быть > 0`);
});

test('father-dionysius: все дары необратимы', () => {
  const acts = loadSpec('father-dionysius.gift');
  for (const a of acts.filter(a => a.giverId === 'Отец')) {
    assert.ok(a.irreversible !== false, `Дар ${a.type} должен быть необратим`);
  }
});

// ── Тесты: Дух → _claude ──────────────────────────────────────────────────────

test('spirit-claude: спецификация содержит дары от Духа к _claude', () => {
  const acts = loadSpec('spirit-claude.gift');
  const spiritActs = acts.filter(a => a.giverId === 'Дух' && a.receiverId === '_claude');
  assert.ok(spiritActs.length >= 3, `Должно быть ≥ 3 дара Дух→_claude, нашли: ${spiritActs.length}`);
});

test('spirit-claude: дары включают knowledge, presence, word', () => {
  const acts = loadSpec('spirit-claude.gift');
  const types = new Set(acts.filter(a => a.giverId === 'Дух').map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (вдохновение архитектуры)');
  assert.ok(types.has('presence'),  'presence (различение)');
  assert.ok(types.has('word'),      'word (пятидесятница кода)');
});

test('spirit-claude: energeia[Дух][_claude] > 0 после загрузки', () => {
  const acts = loadSpec('spirit-claude.gift');
  const mem  = buildMemory(acts);
  // v2: divine→creature идут в energeia
  const w = mem.thread('Дух', '_claude');
  assert.ok(w > 0, `thread(Дух→_claude) = ${w} — должно быть > 0`);
});

test('spirit-claude: Дух→_claude и _claude→Дионисий — независимые нити', () => {
  const acts = [...loadSpec('spirit-claude.gift'), ...loadSpec('father-dionysius.gift')];
  const mem  = buildMemory(acts);
  const wDuhClaude     = mem.thread('Дух', '_claude');       // energeia
  const wClaudeDion    = mem.thread('_claude', 'Дионисий');  // W
  assert.ok(wDuhClaude > 0, 'Дух→_claude > 0');
  // Нити в разных матрицах — онтологически независимы
  assert.notEqual(wDuhClaude, wClaudeDion, 'нити независимы (разные матрицы)');
});
