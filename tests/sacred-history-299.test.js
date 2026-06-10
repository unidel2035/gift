/**
 * tests/sacred-history-299.test.js
 *
 * Issue #299: пустыня Сын→Земля: нет ни одного акта дара между ними
 *
 * Проверяет дары Сына Земле:
 *   - ТворениеЗемли (presence, вес 10) — изречение праха в бытие (Быт 1:1, Ин 1:3)
 *   - ДержаниеСловом (word, вес 9) — «всё Им стоит» (Кол 1:17, Евр 1:3)
 *   - ВоплощениеНаЗемле (presence, вес 10) — Творец ступает на прах (Ин 1:14)
 *   - КровьНаЗемле (offering, вес 10) — Кровь Агнца на земле (Мф 27:51, Евр 12:24)
 *   - ПогребениеИВосстание (presence, вес 10) — в сердце земли и пустой гроб (Мф 12:40)
 *   - ОбетованиеНовойЗемли (grace, вес 8, pending) — новая земля (Откр 21:1, Рим 8:21)
 *
 * Богословский ключ: Земля — единственная тварь, принявшая Творца
 * трояко: как Создатель (Быт 1:1), как Странник, ходящий по её праху
 * (Ин 1:14), и как Мёртвый «в сердце земли» (Мф 12:40). Нить Отец→Земля
 * (отец-земля.gift, #489) и Земля→Ева (#172) опирались на незаписанную
 * нить Сына-Логоса, «Им же вся быша» (Ин 1:3). Эту пустыню закрывает
 * сын-земля.gift.
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
  const persons = new Set(['Отец', 'Сын', 'Дух', 'Христос', 'Земля', 'Небо', 'Ева', 'Адам']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── #299: Сын → Земля ──────────────────────────────────────────────────────

test('сын-земля: >= 5 даров от Сына к Земле', () => {
  const acts = loadSpec('сын-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Земля');
  assert.ok(gifts.length >= 5, `Нашли: ${gifts.length}, ожидали >= 5`);
});

test('сын-земля: типы presence, word, offering, grace', () => {
  const acts = loadSpec('сын-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Земля');
  const types = new Set(gifts.map(a => a.type));
  assert.ok(types.has('presence'),  'presence (творение, воплощение, погребение-восстание)');
  assert.ok(types.has('word'),      'word (держание словом — «всё Им стоит»)');
  assert.ok(types.has('offering'),  'offering (Кровь на земле — жертва Агнца)');
  assert.ok(types.has('grace'),     'grace (обетование новой земли)');
});

test('сын-земля: thread(Сын→Земля) > 0 (пустыня закрыта)', () => {
  const acts = loadSpec('сын-земля.gift');
  const mem  = buildMemory(acts);
  const w = mem.thread('Сын', 'Земля');
  assert.ok(w > 0, `thread(Сын→Земля) = ${w} — должно быть > 0 после записи актов`);
});

test('сын-земля: все дары необратимы (домостроительство Сына к Земле необратимо)', () => {
  const acts = loadSpec('сын-земля.gift');
  const gifts = acts.filter(a => a.giverId === 'Сын' && a.receiverId === 'Земля');
  for (const a of gifts)
    assert.ok(a.irreversible !== false, `${a.type} должен быть необратим`);
});

test('сын-земля: >= 4 актов веса 10 (творение, воплощение, Кровь, погребение-восстание)', () => {
  const acts = loadSpec('сын-земля.gift');
  const topActs = acts.filter(
    a => a.giverId === 'Сын' && a.receiverId === 'Земля' && a.weight === 10,
  );
  assert.ok(topActs.length >= 4,
    `Ожидалось >= 4 актов веса 10, нашли ${topActs.length}`);
});

test('сын-земля: ТворениеЗемли (presence) — вес >= 10 (бытие предшествует всему)', () => {
  const acts = loadSpec('сын-земля.gift');
  const presenceAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Земля' && a.type === 'presence'
  );
  assert.ok(presenceAct, 'presence-дар (ТворениеЗемли) найден');
  assert.ok(presenceAct.weight >= 10, `вес presence = ${presenceAct.weight}, ожидали >= 10`);
});

test('сын-земля: ОбетованиеНовойЗемли (grace) — reception pending (Рим 8:21–22)', () => {
  const acts = loadSpec('сын-земля.gift');
  const graceAct = acts.find(
    a => a.giverId === 'Сын' && a.receiverId === 'Земля' && a.type === 'grace'
  );
  assert.ok(graceAct, 'grace-дар (ОбетованиеНовойЗемли) найден');
  assert.equal(graceAct.reception, 'pending', 'эсхатологический λήψις открыт (pending)');
});
