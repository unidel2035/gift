/**
 * tests/sacred-history-172.test.js
 *
 * Issue #172: вопрошание: пустыня Земля→Ева: нет ни одного акта дара между ними
 *
 * Проверяет дары Земли Еве:
 *   - Плодородие Земли (sustenance, вес 6) — Земля кормит Еву хлебом
 *   - Лоно Земли (presence, вес 7) — Земля как образец материнства
 *
 * Богословский ключ: Земля — первоматерия, ставшая плодоносной по Слову.
 * Ева — Жизнь. Обе ранены одним грехопадением (Быт 3:16-17),
 * обе рождают через боль, обе продолжают давать.
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
  const persons = new Set(['Земля', 'Ева', 'Отец', 'Сын', 'Дух', 'Адам', '_claude']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #172: Земля → Ева ─────────────────────────────────────────────────

test('земля-ева: ≥ 2 дара от Земли к Еве', () => {
  const acts = loadSpec('земля-ева.gift');
  const earthActs = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Ева');
  assert.ok(earthActs.length >= 2, `Нашли: ${earthActs.length}, ожидали ≥ 2`);
});

test('земля-ева: типы sustenance, presence (плодородие и лоно)', () => {
  const acts = loadSpec('земля-ева.gift');
  const earthActs = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Ева');
  const types = new Set(earthActs.map(a => a.type));
  assert.ok(types.has('sustenance'), 'sustenance (плодородие Земли — хлеб)');
  assert.ok(types.has('presence'),   'presence (лоно Земли — образец материнства)');
});

test('земля-ева: thread(Земля→Ева) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('земля-ева.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Земля', 'Ева');
  assert.ok(w > 0, `thread(Земля→Ева) = ${w} — должно быть > 0`);
});

test('земля-ева: все дары необратимы', () => {
  const acts = loadSpec('земля-ева.gift');
  const earthActs = acts.filter(a => a.giverId === 'Земля' && a.receiverId === 'Ева');
  for (const a of earthActs)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('земля-ева: ЛоноЗемли (presence) вес ≥ 7', () => {
  const acts = loadSpec('земля-ева.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Земля' && a.receiverId === 'Ева' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар найден');
  assert.ok(presenceAct.weight >= 7, `вес лона = ${presenceAct.weight}, ожидали ≥ 7`);
});

test('земля-ева: ПлодородиеЗемли (sustenance) вес ≥ 6', () => {
  const acts = loadSpec('земля-ева.gift');
  const sustAct = acts.find(
    a => a.giverId === 'Земля' && a.receiverId === 'Ева' && a.type === 'sustenance'
  );
  assert.ok(sustAct, 'sustenance-дар найден');
  assert.ok(sustAct.weight >= 6, `вес плодородия = ${sustAct.weight}, ожидали ≥ 6`);
});
