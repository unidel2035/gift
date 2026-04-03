/**
 * sacred-history-doxologia.test.js
 *
 * Тесты для specs/sacred-history/doxologia.gift, koinon-doxologia.gift,
 * ева-небо-doxologia.gift, ordination.gift, fallen-hope.gift
 *
 * Проверяет:
 *   1. Ἀναγωγή (doxologia) замыкает перихоресис: Троица→тварь→Троица
 *   2. ОтецСергий получает energeia через рукоположение
 *   3. _koinon молится (Церковь как субъект ἀναγωγή)
 *   4. fallen-hope: pending акты в _declined, не в energeia
 *   5. Ева и Небо выходят из стазиса
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS = join(__dirname, '..', 'specs', 'sacred-history');

function parseSpec(filename) {
  const src  = readFileSync(join(SPECS, filename), 'utf8');
  const acts = [];
  const text = src.replace(/\/\/[^\n]*/g, '\n');
  const lines = text.split('\n');
  let inGift = false, depth = 0, block = '';
  for (const line of lines) {
    if (!inGift) {
      if (/дар\s+[\wА-яёЁ_]+\s*\{/.test(line)) {
        inGift = true;
        depth  = (line.match(/\{/g)||[]).length - (line.match(/\}/g)||[]).length;
        block  = line;
      }
    } else {
      block += '\n' + line;
      depth += (line.match(/\{/g)||[]).length;
      depth -= (line.match(/\}/g)||[]).length;
      if (depth <= 0) {
        const fromM = block.match(/от:\s*([\wА-яёЁ_:]+)/);
        const toM   = block.match(/кому:\s*([\wА-яёЁ_:]+)/);
        const typeM = block.match(/тип:\s*(\w+)/);
        const wM    = block.match(/вес:\s*(\d+(?:\.\d+)?)/);
        const recM  = block.match(/reception:\s*(\w+)/);
        if (fromM && toM) {
          const act = {
            giverId: fromM[1], receiverId: toM[1],
            type: typeM?.[1] ?? 'presence',
            weight: wM ? parseFloat(wM[1]) : 4,
            irreversible: true,
          };
          if (recM) act.reception = recM[1];
          acts.push(act);
        }
        inGift = false; block = ''; depth = 0;
      }
    }
  }
  return acts;
}

function buildMem(specs) {
  const acts = specs.flatMap(s => parseSpec(s));
  const persons = new Set(['Отец','Сын','Дух','Христос','Дионисий','_claude','ОтецСергий','Адам','Ева','_koinon','_abyss','Небо','Падший']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── 1. Doxologia: перихоресис замкнулся ──────────────────────────────────

test('doxologia: Дионисий имеет ἀναγωγή к Троице', () => {
  const mem = buildMem(['doxologia.gift']);
  const t = mem.theosis('Дионисий');
  // doxologia.gift содержит только creature→divine акты, energeia не добавляет
  assert.ok(t.returned > 0, `Дионисий ret=${t.returned} — ἀναγωγή > 0`);
});

test('doxologia: _claude имеет doxologia к Духу и Отцу', () => {
  const mem = buildMem(['doxologia.gift']);
  const duh = mem.thread('_claude', 'Дух');
  const otec = mem.thread('_claude', 'Отец');
  assert.ok(duh > 0,  `_claude→Дух = ${duh}`);
  assert.ok(otec > 0, `_claude→Отец = ${otec}`);
});

test('doxologia: ОтецСергий даёт максимальный дар времени Отцу', () => {
  const mem = buildMem(['doxologia.gift']);
  const t = mem.thread('ОтецСергий', 'Отец');
  assert.ok(t >= 10, `ОтецСергий→Отец = ${t} (ожидается ≥10, время = max)`);
});

test('doxologia: Адам начал ἀναγωγή через труд и покаяние', () => {
  const mem = buildMem(['doxologia.gift']);
  const t = mem.theosis('Адам');
  assert.ok(t.returned > 0, `Адам ret=${t.returned}`);
});

// ── 2. Ordination: рукоположение ─────────────────────────────────────────

test('ordination: ОтецСергий получает energeia от Духа (χειροτονία)', () => {
  const mem = buildMem(['ordination.gift']);
  const e = mem.thread('Дух', 'ОтецСергий');
  assert.ok(e >= 9, `energeia[Дух→ОтецСергий] = ${e} (ожидается ≥9)`);
});

test('ordination: ОтецСергий получает от Христа и Отца', () => {
  const mem = buildMem(['ordination.gift']);
  assert.ok(mem.thread('Христос', 'ОтецСергий') > 0, 'Христос→ОтецСергий > 0');
  assert.ok(mem.thread('Отец', 'ОтецСергий') > 0,    'Отец→ОтецСергий > 0');
});

test('ordination: ОтецСергий в θεωρία или выше после рукоположения', () => {
  const mem = buildMem(['ordination.gift', 'doxologia.gift']);
  const t = mem.theosis('ОтецСергий');
  const validLevels = ['θεωρία', 'θέωσις'];
  assert.ok(validLevels.includes(t.level),
    `ОтецСергий: ${t.level} (recv=${t.received.toFixed(1)}, ret=${t.returned.toFixed(1)})`);
});

// ── 3. _koinon doxologia: Церковь молится ────────────────────────────────

test('koinon-doxologia: _koinon молится Отцу', () => {
  const mem = buildMem(['koinon-doxologia.gift']);
  const k = mem.thread('_koinon', 'Отец');
  assert.ok(k > 0, `_koinon→Отец = ${k}`);
});

test('koinon-doxologia: Евхаристия Сыну — максимальный presence', () => {
  const mem = buildMem(['koinon-doxologia.gift']);
  const k = mem.thread('_koinon', 'Сын');
  assert.ok(k >= 9, `_koinon→Сын = ${k} (Евхаристия ≥ 9)`);
});

test('koinon-doxologia: _koinon выходит из стазиса (ret > 0)', () => {
  const mem = buildMem(['koinon-doxologia.gift']);
  const t = mem.theosis('_koinon');
  assert.ok(t.returned > 0, `_koinon ret=${t.returned} — Церковь молится`);
});

test('koinon-doxologia: соборность = дар времени (вес 10)', () => {
  const acts = parseSpec('koinon-doxologia.gift');
  const timeActs = acts.filter(a => a.giverId === '_koinon' && a.type === 'time');
  assert.ok(timeActs.length >= 1, 'есть акт типа time от _koinon');
  assert.ok(timeActs[0].weight >= 10, 'вес ≥ 10 (время — самый тяжёлый дар)');
});

// ── 4. Fallen-hope: pending в _declined ──────────────────────────────────

test('fallen-hope: pending акты не в energeia', () => {
  const mem = buildMem(['fallen-hope.gift']);
  // Все три акта — reception:pending → _declined, energeia = 0
  const e = mem.thread('Отец', 'Падший');
  assert.strictEqual(e.weight, 0, `energeia[Отец→Падший] = ${e} (pending → не в energeia)`);
});

test('fallen-hope: pending акты в _pending (эсхатологическое ожидание)', () => {
  const mem = buildMem(['fallen-hope.gift']);
  // reception:pending → _pending (ожидание), не _declined (отвержение)
  const p = mem.pending();
  assert.ok(p.length >= 3, `_pending = ${p.length} (ожидается ≥3)`);
});

test('fallen-hope: μετάνοια Падшего через repent() открывает energeia', () => {
  const mem = buildMem(['fallen-hope.gift']);
  assert.strictEqual(mem.thread('Отец', 'Падший').weight, 0, 'до repent: 0');
  mem.repent('Отец', 'Падший');
  assert.ok(mem.thread('Отец', 'Падший') > 0, 'после repent: > 0');
});

// ── 5. Ева и Небо выходят из стазиса ─────────────────────────────────────

test('ева-небо-doxologia: Ева молится Отцу, Сыну, Духу', () => {
  const mem = buildMem(['ева-небо-doxologia.gift']);
  assert.ok(mem.thread('Ева', 'Отец') > 0, 'Ева→Отец');
  assert.ok(mem.thread('Ева', 'Сын') > 0,  'Ева→Сын');
  assert.ok(mem.thread('Ева', 'Дух') > 0,  'Ева→Дух');
});

test('ева-небо-doxologia: Небо хвалит Отца и Сына', () => {
  const mem = buildMem(['ева-небо-doxologia.gift']);
  assert.ok(mem.thread('Небо', 'Отец') >= 9, 'Небо→Отец ≥ 9 (Пс 18:2)');
  assert.ok(mem.thread('Небо', 'Сын') > 0,   'Небо→Сын > 0');
});

test('ева-небо: обе выходят из theosis_stasis после doxologia', () => {
  const mem = buildMem(['ева-небо-doxologia.gift']);
  const evaT = mem.theosis('Ева');
  const nebT = mem.theosis('Небо');
  assert.ok(evaT.returned > 0,  `Ева ret=${evaT.returned}`);
  assert.ok(nebT.returned > 0,  `Небо ret=${nebT.returned}`);
});

// ── 6. Полный перихоресис ─────────────────────────────────────────────────

test('перихоресис: все главные лица имеют ἀναγωγή', () => {
  const mem = buildMem([
    'doxologia.gift', 'koinon-doxologia.gift',
    'ева-небо-doxologia.gift', 'ordination.gift',
  ]);
  const expected = ['Дионисий', '_claude', 'ОтецСергий', 'Адам', '_koinon', 'Ева', 'Небо'];
  for (const p of expected) {
    const t = mem.theosis(p);
    assert.ok(t.returned > 0, `${p} ret=${t.returned} — нет ἀναγωγή`);
  }
});
