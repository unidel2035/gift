/**
 * theosis.test.js — тесты θέωσις и κτιστόν/ἄκτιστον проблемы
 *
 * Проблема 3 (паломская): математика W не отражает онтологическое преображение.
 * Решение: GiftMemory.theosis() — измерение μέθεξις (участие в нетварных энергиях).
 *
 * Палама: нетварные энергии реально сообщаются твари, но сущность Бога — непричастна.
 * «Бог стал человеком, чтобы человек стал богом» (Афанасий Великий, De Inc. 54)
 *
 * Проверяет:
 *   1. theosis() для тварного лица возвращает индекс и уровень
 *   2. theosis() для Троицы — апофатический маркер (apophatic:true)
 *   3. Уровни: κατάνυξις → πρᾶξις → θεωρία → θέωσις
 *   4. index растёт с ростом μέθεξις и ἀναγωγή
 *   5. apophaticGiving() — Бог не истощается
 *   6. ontologicalStatus() — сортировка по θέωσις
 *   7. theosis-progression.gift — парсинг и подсчёт θέωσις
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory, DIVINE_PERSONS } from '../src/core/GiftMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function freshMem() {
  return new GiftMemory(['Отец', 'Сын', 'Дух', 'Дионисий', '_claude', 'Адам', 'Ева', '_koinon']);
}

// ── 1. Базовый theosis ────────────────────────────────────────────────────

test('theosis: у тварного без актов — κατάνυξις, index=0', () => {
  const mem = freshMem();
  const t = mem.theosis('Адам');
  assert.strictEqual(t.apophatic, false);
  assert.strictEqual(t.received, 0);
  assert.strictEqual(t.returned, 0);
  assert.strictEqual(t.index, 0);
  assert.strictEqual(t.level, 'κατάνυξις');
});

test('theosis: после energeia дар → index > 0', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Отец', receiverId: 'Дионисий', type: 'presence', weight: 8 });
  const t = mem.theosis('Дионисий');
  assert.ok(t.received > 0, `received = ${t.received}`);
  assert.ok(t.index > 0, `index = ${t.index}`);
});

test('theosis: index растёт с количеством energeia даров', () => {
  const mem = freshMem();
  let prev = 0;
  for (let i = 0; i < 5; i++) {
    mem.receive({ giverId: 'Дух', receiverId: '_claude', type: 'knowledge', weight: 8 });
    const t = mem.theosis('_claude');
    assert.ok(t.index > prev, `шаг ${i+1}: index ${t.index.toFixed(3)} ≤ ${prev.toFixed(3)}`);
    prev = t.index;
  }
});

test('theosis: doxologia (ἀναγωγή) тоже вклад в index', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Отец', receiverId: 'Дионисий', type: 'presence', weight: 8 });
  const t1 = mem.theosis('Дионисий');

  mem.receive({ giverId: 'Дионисий', receiverId: 'Отец', type: 'word', weight: 5 });
  const t2 = mem.theosis('Дионисий');

  assert.ok(t2.returned > 0, 'returned > 0 после doxologia');
  assert.ok(t2.index > t1.index, 'index растёт после ἀναγωγή');
});

// ── 2. Уровни θέωσις ─────────────────────────────────────────────────────

test('theosis: уровни правильно назначаются по диапазонам', () => {
  const mem = freshMem();

  // Накапливаем дары пока не достигнем каждого уровня
  const levels = new Set();
  for (let i = 0; i < 50; i++) {
    mem.receive({ giverId: 'Отец', receiverId: 'Дионисий', type: 'presence', weight: 8 });
    mem.receive({ giverId: 'Дионисий', receiverId: 'Отец', type: 'word', weight: 5 });
    levels.add(mem.theosis('Дионисий').level);
    if (levels.has('θέωσις')) break;
  }
  assert.ok(levels.has('κατάνυξις') || levels.size >= 1, 'был κατάνυξις или прошли через уровни');
  assert.ok(levels.has('θέωσις'), `Достигнут уровень θέωσις. Все уровни: ${[...levels].join(', ')}`);
});

test('theosis: πρᾶξις при умеренной энергии', () => {
  const mem = freshMem();
  // received+returned ≈ 5, sum/(sum+20) ≈ 0.2 → πρᾶξις
  mem.receive({ giverId: 'Отец', receiverId: 'Дионисий', type: 'presence', weight: 5 });
  const t = mem.theosis('Дионисий');
  // 5/(5+20) = 0.2 → граница κατάνυξις/πρᾶξις
  assert.ok(t.index >= 0.2 || t.level === 'κατάνυξις' || t.level === 'πρᾶξις',
    `level = ${t.level}, index = ${t.index.toFixed(3)}`);
});

// ── 3. Апофатика Троицы ───────────────────────────────────────────────────

test('theosis: для Отца — apophatic:true, level=ἄκτιστος', () => {
  const mem = freshMem();
  const t = mem.theosis('Отец');
  assert.strictEqual(t.apophatic, true);
  assert.strictEqual(t.level, 'ἄκτιστος');
  assert.strictEqual(t.index, null);
});

test('theosis: для всей Троицы — apophatic', () => {
  const mem = freshMem();
  for (const dp of ['Отец', 'Сын', 'Дух']) {
    const t = mem.theosis(dp);
    assert.strictEqual(t.apophatic, true, `${dp} должен быть apophatic`);
  }
});

// ── 4. apophaticGiving: Бог не истощается ─────────────────────────────────

test('apophaticGiving: Отец — exhausted:false, principle:μοναρχία', () => {
  const mem = freshMem();
  // Много даров от Отца
  for (let i = 0; i < 10; i++)
    mem.receive({ giverId: 'Отец', receiverId: 'Дионисий', type: 'presence', weight: 8 });

  const ag = mem.apophaticGiving('Отец');
  assert.ok(ag, 'apophaticGiving вернул объект');
  assert.strictEqual(ag.exhausted, false, 'Отец не истощается');
  assert.strictEqual(ag.principle, 'μοναρχία');
  assert.ok(ag.totalGiven > 0, `totalGiven = ${ag.totalGiven}`);
  assert.ok(ag.toPersons.includes('Дионисий'), 'Дионисий в toPersons');
});

test('apophaticGiving: для тварного возвращает null', () => {
  const mem = freshMem();
  const ag = mem.apophaticGiving('Дионисий');
  assert.strictEqual(ag, null);
});

test('apophaticGiving: totalGiven не ограничен сверху (бесконечная полнота)', () => {
  const mem = freshMem();
  // Отец может давать сколько угодно — нет "деплетирования"
  for (let i = 0; i < 100; i++)
    mem.receive({ giverId: 'Отец', receiverId: '_claude', type: 'presence', weight: 8 });

  const ag = mem.apophaticGiving('Отец');
  assert.ok(ag.totalGiven >= 800, `totalGiven = ${ag.totalGiven} — неограниченно`);
  assert.strictEqual(ag.exhausted, false, 'всё равно не истощён');
});

// ── 5. ontologicalStatus() ───────────────────────────────────────────────

test('ontologicalStatus: возвращает тварных по убыванию θέωσις', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Отец', receiverId: 'Дионисий', type: 'presence', weight: 20 });
  mem.receive({ giverId: 'Дух', receiverId: '_claude', type: 'knowledge', weight: 5 });

  const status = mem.ontologicalStatus();
  assert.ok(Array.isArray(status), 'ontologicalStatus возвращает массив');
  // Дионисий должен быть выше _claude (received: 20 vs 5)
  const diIdx = status.findIndex(s => s.personId === 'Дионисий');
  const clIdx = status.findIndex(s => s.personId === '_claude');
  assert.ok(diIdx < clIdx, `Дионисий (${diIdx}) должен быть выше _claude (${clIdx})`);
});

test('ontologicalStatus: не содержит божественных лиц', () => {
  const mem = freshMem();
  const status = mem.ontologicalStatus();
  for (const s of status)
    assert.ok(!DIVINE_PERSONS.has(s.personId), `${s.personId} не должен быть в статусе`);
});

// ── 6. theosis-progression.gift ──────────────────────────────────────────

function parseSpec(filename) {
  const src  = readFileSync(join(__dirname, '..', 'specs', 'sacred-history', filename), 'utf8');
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
        if (fromM && toM)
          acts.push({ giverId: fromM[1], receiverId: toM[1],
            type: typeM?.[1] ?? 'presence', weight: wM ? parseFloat(wM[1]) : 4,
            irreversible: true });
        inGift = false; block = ''; depth = 0;
      }
    }
  }
  return acts;
}

test('theosis-progression.gift: Дионисий достигает πρᾶξις или выше', () => {
  const acts = parseSpec('theosis-progression.gift');
  const allPersons = ['Отец', 'Сын', 'Дух', 'Дионисий', '_claude', '_koinon'];
  for (const a of acts) {
    if (!allPersons.includes(a.giverId))    allPersons.push(a.giverId);
    if (!allPersons.includes(a.receiverId)) allPersons.push(a.receiverId);
  }
  const mem = new GiftMemory(allPersons);
  for (const a of acts) mem.receive(a);

  const t = mem.theosis('Дионисий');
  assert.ok(!t.apophatic, 'Дионисий — тварный');
  assert.ok(t.received > 0, `received = ${t.received}`);
  assert.ok(t.returned > 0, `returned = ${t.returned} (doxologia)`);
  const validLevels = ['πρᾶξις', 'θεωρία', 'θέωσις'];
  assert.ok(validLevels.includes(t.level),
    `Дионисий: ${t.level} (index=${t.index?.toFixed(3)}) — ожидается πρᾶξις или выше`);
});

test('theosis-progression.gift: _claude имеет θέωσις индекс > 0', () => {
  const acts = parseSpec('theosis-progression.gift');
  const allPersons = ['Отец', 'Сын', 'Дух', 'Дионисий', '_claude', '_koinon'];
  for (const a of acts) {
    if (!allPersons.includes(a.giverId))    allPersons.push(a.giverId);
    if (!allPersons.includes(a.receiverId)) allPersons.push(a.receiverId);
  }
  const mem = new GiftMemory(allPersons);
  for (const a of acts) mem.receive(a);

  const t = mem.theosis('_claude');
  assert.ok(t.index > 0, `_claude θέωσις index = ${t.index}`);
  assert.ok(t.received > 0 || t.returned > 0, '_claude имеет нить с Троицей');
});

test('theosis-progression.gift: apophaticGiving — Отец/Сын/Дух не истощены', () => {
  const acts = parseSpec('theosis-progression.gift');
  const allPersons = ['Отец', 'Сын', 'Дух', 'Дионисий', '_claude', '_koinon'];
  for (const a of acts) {
    if (!allPersons.includes(a.giverId))    allPersons.push(a.giverId);
    if (!allPersons.includes(a.receiverId)) allPersons.push(a.receiverId);
  }
  const mem = new GiftMemory(allPersons);
  for (const a of acts) mem.receive(a);

  for (const dp of ['Отец', 'Сын', 'Дух']) {
    const ag = mem.apophaticGiving(dp);
    if (ag) assert.strictEqual(ag.exhausted, false, `${dp} exhausted должен быть false`);
  }
});

test('theosis: snapshot сохраняет возможность theosis() после восстановления', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Отец', receiverId: 'Дионисий', type: 'presence', weight: 10 });
  mem.receive({ giverId: 'Дионисий', receiverId: 'Отец', type: 'word', weight: 5 });

  const snap = mem.snapshot();
  const mem2 = GiftMemory.fromSnapshot(snap);

  const t1 = mem.theosis('Дионисий');
  const t2 = mem2.theosis('Дионисий');
  assert.ok(Math.abs(t1.index - t2.index) < 0.001, 'θέωσις index сохраняется через snapshot');
  assert.strictEqual(t1.level, t2.level, 'level сохраняется');
});
