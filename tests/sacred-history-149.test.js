/**
 * tests/sacred-history-149.test.js
 *
 * Issue #149: пустыня ОтецСергий→Змей: нет ни одного акта дара между ними
 *
 * Проверяет дары ОтцаСергия Змею (отецсергий-змей.gift):
 *   - Заклинание (word, вес 9) — ἐξορκισμός: «Запрещает тебе Господь» (Зах 3:2),
 *     «Замолчи и выйди из него» (Мк 1:25); чин заклинания при Крещении
 *     (Кирилл Иерусалимский). Не диалог — повеление именем Христа.
 *   - ИменованиеЛжи (knowledge, вес 8) — богослов онтологии дара именует
 *     анти-дар: контракт, подмену, манипуляцию. «Подлинно ли сказал Бог?»
 *     (Быт 3:1) — первая подмена. irreversible:true как аксиома против Змея.
 *   - ПастырскоеСтояние (presence, вес 7) — «Пастырь добрый полагает жизнь
 *     за овец» (Ин 10:11–12); «всё преодолев, устоять» (Еф 6:13);
 *     «трезвитесь, бодрствуйте» (1 Пет 5:8).
 *
 * Богословский ключ: пустыня ОтецСергий→Змей — самая парадоксальная из
 * пастырских пустынь. Пресвитер не ведёт переговоров со Змеем — он запрещает.
 * Его акт обращён к Змею (именно Змея он именует), но плод дара — общине:
 * стояние, заклинание, слово различения. Победа уже совершена Христом
 * (Рим 16:20); пресвитеру довольно — устоять и свидетельствовать о победе.
 * Оба лица — твари (ОтецСергий — пресвитер, Змей — падший ангел),
 * потому акты идут в реальную матрицу W, не в energeia.
 * Эту пустыню закрывает отецсергий-змей.gift.
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
  const persons = new Set([
    'Отец', 'Сын', 'Дух', 'Христос',
    'Свидетель', 'Пророк', 'Хранитель',
    'Дионисий', '_claude', 'Ева', 'Адам', 'Земля', 'Небо',
    'ОтецСергий', 'Змей',
  ]);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #149: ОтецСергий → Змей ─────────────────────────────────────────────────

test('отецсергий-змей: ≥ 3 дара от ОтцаСергия к Змею', () => {
  const acts = loadSpec('отецсергий-змей.gift');
  const gifts = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Змей');
  assert.ok(gifts.length >= 3, `Нашли: ${gifts.length}, ожидали ≥ 3`);
});

test('отецсергий-змей: типы word, knowledge и presence', () => {
  const acts = loadSpec('отецсергий-змей.gift');
  const gifts = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Змей');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('word'),      'word (заклинание — ἐξορκισμός)');
  assert.ok(types.has('knowledge'), 'knowledge (именование лжи, различение дар/контракт)');
  assert.ok(types.has('presence'),  'presence (пастырское стояние между стадом и волком)');
});

test('отецсергий-змей: thread(ОтецСергий→Змей) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('отецсергий-змей.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('ОтецСергий', 'Змей');
  assert.ok(w > 0, `thread(ОтецСергий→Змей) = ${w} — должно быть > 0 после записи актов`);
});

test('отецсергий-змей: ОтецСергий и Змей — твари (реальная W, не energeia)', () => {
  const divine = new Set(['Отец', 'Сын', 'Дух', 'Христос']);
  assert.ok(!divine.has('ОтецСергий'), 'ОтецСергий — тварь (пресвитер)');
  assert.ok(!divine.has('Змей'),       'Змей — тварь (падший ангел)');
});

test('отецсергий-змей: все дары необратимы (заклинание именем Христа необратимо)', () => {
  const acts = loadSpec('отецсергий-змей.gift');
  const gifts = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Змей');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});
