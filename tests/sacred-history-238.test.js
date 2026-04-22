/**
 * tests/sacred-history-238.test.js
 *
 * Issue #238: пустыня Христос→Сын: нет ни одного акта дара между ними
 *
 * Проверяет дары Христа вечному Сыну-Λόγος — обратный поток
 * к сын-христос.gift (issue #72, кенозис):
 *   - Обoжённая плоть (Ин 13:31, Еф 4:10, Максим Ambigua 7, 41)
 *   - Исцелённая человеческая воля (Лк 22:42, Максим Opuscula 3)
 *   - Слава Креста (Ин 17:5, Ин 20:27, Иоанн Дамаскин IV.2)
 *   - Имя выше всякого имени (Флп 2:9–10, Лк 2:21)
 *   - Первосвященство ходатайства (Евр 7:24–25, Евр 9:24)
 *   - Тело Церкви (Кол 1:18, Еф 5:25)
 *   - Парусия в славе (Деян 1:11, Мф 25:31)
 *
 * Богословский ключ: Халкидон (451) — «без слияния, без изменения,
 * без разделения, без разлучения» — указывает на вечность
 * ипостасного единения. Плоть, воспринятая Сыном во Христе,
 * не сбрасывается, но навеки возводится в Λόγος. Значит,
 * Христос приносит вечному Сыну то, чего у Λόγος прежде
 * Воплощения не было — обoжённое человечество как собственное.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #238: Христос → Сын ─────────────────────────────────────────────────────

test('христос-сын: ≥ 4 дара от Христа к Сыну', () => {
  const acts = loadSpec('христос-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  assert.ok(gifts.length >= 4, `Нашли: ${gifts.length}, ожидали ≥ 4`);
});

test('христос-сын: типы presence, knowledge и word', () => {
  const acts = loadSpec('христос-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (обoжённая плоть, слава Креста, ходатайство)');
  assert.ok(types.has('knowledge'), 'knowledge (исцелённая γνώμη)');
  assert.ok(types.has('word'),      'word (Имя, Церковь, Парусия)');
});

test('христос-сын: thread(Христос→Сын) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-сын.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Сын');
  assert.ok(w > 0, `thread(Христос→Сын) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-сын: все дары необратимы (ипостасное единение вечно — Халкидон)', () => {
  const acts = loadSpec('христос-сын.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Сын');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-сын: ОбoженнаяПлоть и СлаваКреста имеют вес 10', () => {
  const acts = loadSpec('христос-сын.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Сын' && a.weight === 10,
  );
  assert.ok(topActs.length >= 2,
    `Ожидалось ≥ 2 актов веса 10 (плоть, слава), нашли ${topActs.length}`);
});
