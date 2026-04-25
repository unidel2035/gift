/**
 * tests/sacred-history-258.test.js
 *
 * Issue #258: пустыня Христос→Дух: нет ни одного акта дара между ними
 * (второй слой — литургический)
 *
 * Первый слой закрыт в христос-дух.gift (issue #214): прославленная
 * плоть, дыхание, Пятидесятница, обетование Утешителя, помазание.
 *
 * Второй слой — христос-дух-литургия.gift — длящийся дар Христа Духу
 * в литургическом времени Церкви:
 *   - Евхаристические Дары как предмет эпиклесиса (Кавасила XXVII,
 *     Кирилл Иерусалимский V.7, Дамаскин IV.13)
 *   - Тело Церкви как храм (1 Кор 12:13, Еф 1:22–23, Ириней III.24.1)
 *   - Имя Иисусово как путь призыва Духа (Диадох 59, 61; Григорий
 *     Синаит; Симеон Новый Богослов)
 *   - Харизмы в Теле (1 Кор 12:7,11; Григорий Богослов, Слово 41)
 *   - Анамнезис Пасхи (Лк 22:19, Максим, Мистагогия 21–24)
 *   - Таинства Церкви (Мф 28:19, Дамаскин IV.13)
 *
 * Богословский ключ: Пятидесятница не закончилась в Сионской горнице —
 * она длится во всякой литургии. Христос непрестанно даёт Духу
 * Своё Тело, Своё имя, Свои Дары как пространство действия.
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

// ── #258: Христос → Дух (литургический слой) ────────────────────────────────

test('христос-дух-литургия: ≥ 5 даров от Христа к Духу', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('христос-дух-литургия: типы presence, word и knowledge', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (эпиклесис, Тело, анамнезис)');
  assert.ok(types.has('word'),      'word (имя Иисусово, Таинства)');
  assert.ok(types.has('knowledge'), 'knowledge (харизмы)');
});

test('христос-дух-литургия: thread(Христос→Дух) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Христос', 'Дух');
  assert.ok(w > 0, `thread(Христос→Дух) = ${w} — должно быть > 0 после записи актов`);
});

test('христос-дух-литургия: все дары необратимы (литургическое время необратимо)', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const gifts = acts.filter(a => a.giverId === 'Христос' && a.receiverId === 'Дух');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('христос-дух-литургия: эпиклесис, Тело Церкви, анамнезис имеют вес 10', () => {
  const acts = loadSpec('христос-дух-литургия.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Христос' && a.receiverId === 'Дух' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (эпиклесис, Тело, анамнезис), нашли ${topActs.length}`);
});

test('христос-дух-литургия: совокупная нить усиливает первый слой #214', () => {
  const acts1 = loadSpec('христос-дух.gift');
  const acts2 = loadSpec('христос-дух-литургия.gift');
  const mem   = buildMemory([...acts1, ...acts2]);
  const w = mem.thread('Христос', 'Дух');
  const w1  = buildMemory(acts1).thread('Христос', 'Дух');
  assert.ok(w > w1,
    `совокупная нить ${w} должна превышать нить только первого слоя ${w1}`);
});
