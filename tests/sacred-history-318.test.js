/**
 * tests/sacred-history-318.test.js
 *
 * Issue #318: пустыня Сын→Падший: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Падшему:
 *   - Взыскание погибшего (Лк 19:10, Лк 15:4–7, Иез 34:11, Григорий Богослов 38.14)
 *   - Воплощение в плоти падшего (Евр 2:14–17, Григорий Богослов Посл. 101)
 *   - Дружба с грешниками (Мф 11:19, Мк 2:17, Лк 19:5, Иоанн Златоуст На Мф 30)
 *   - Сострадание к толпе (Мф 9:36, Мк 6:34, Исаак Сирин Слово 48)
 *   - Сошествие во ад ради всех (1 Пет 3:18–19, 4:6, Иоанн Дамаскин III.27–29)
 *   - Стук в дверь сердца (Откр 3:20, Симеон Новый Богослов Гимн 27) — reception:pending
 *
 * Богословский ключ: Падший — родовое имя всякого, кто живёт «во Адаме»
 * (1 Кор 15:22), кому Сын адресует Свои дары прежде ответа. Это объективная
 * сторона икономии, на которой стоит свобода λήψις (αὐτεξούσιον,
 * Максим Исповедник). Пять даров — accepted (необратимая δόσις,
 * совершённая в истории), один — pending (стук в дверь конкретного сердца,
 * ждущий каждой μετάνοια). Эту пустыню закрывает сын-падший.gift.
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
        const recepM  = block.match(/reception:\s*(\w+)/);
        if (fromM && toM) {
          const type   = typeM ? typeM[1] : 'presence';
          const weight = weightM ? parseFloat(weightM[1]) : 4;
          const act = {
            giverId:     fromM[1],
            receiverId:  toM[1],
            type, weight,
            irreversible: !irrevM || irrevM[1] === 'да',
          };
          if (recepM) act.reception = recepM[1];
          acts.push(act);
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Дионисий', '_claude', 'Ева', 'Адам', 'Земля', 'Небо', 'Падший']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #318: Сын → Падший ─────────────────────────────────────────────────────

test('сын-падший: ≥ 5 даров от Сына к Падшему', () => {
  const acts = loadSpec('сын-падший.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Падший');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали ≥ 5`);
});

test('сын-падший: типы presence и knowledge', () => {
  const acts = loadSpec('сын-падший.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Падший');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (воплощение, дружба, сострадание, сошествие, стук)');
  assert.ok(types.has('knowledge'), 'knowledge (взыскание погибшего)');
});

test('сын-падший: thread(Сын→Падший) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-падший.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Падший');
  assert.ok(w > 0, `thread(Сын→Падший) = ${w} — должно быть > 0 после accepted-актов`);
});

test('сын-падший: все дары необратимы (δόσις Сына к Падшему необратима)', () => {
  const acts = loadSpec('сын-падший.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Падший');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-падший: ≥ 3 актов веса 10 (взыскание, воплощение, сошествие)', () => {
  const acts = loadSpec('сын-падший.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Падший' && a.weight === 10,
  );
  assert.ok(topActs.length >= 3,
    `Ожидалось ≥ 3 актов веса 10 (взыскание, воплощение, сошествие), нашли ${topActs.length}`);
});

test('сын-падший: ≥ 1 акт reception:pending (свобода λήψις сохранена)', () => {
  const acts = loadSpec('сын-падший.gift');
  const pending = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Падший' && a.reception === 'pending',
  );
  assert.ok(pending.length >= 1,
    `Ожидался ≥ 1 акт pending (стук в дверь — αὐτεξούσιον), нашли ${pending.length}`);
});

test('сын-падший: ≥ 4 актов accepted (объективная δόσις не зависит от λήψις)', () => {
  const acts = loadSpec('сын-падший.gift');
  const accepted = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Падший' && a.reception !== 'pending' && a.reception !== 'declined',
  );
  assert.ok(accepted.length >= 4,
    `Ожидалось ≥ 4 accepted-актов (взыскание, воплощение, дружба, сострадание, сошествие), нашли ${accepted.length}`);
});
