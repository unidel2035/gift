/**
 * leksis.test.js — тесты λήψις (принятие/отказ) и μετάνοια
 *
 * Максим Исповедник: αὐτεξούσιον — самовластие твари.
 * Δόσις (дарение) необратима. Λήψις (принятие) — в воле твари.
 * Покаяние = принять то, что было отвергнуто.
 *
 * Проверяет:
 *   1. reception:'declined' → W не обновляется, но акт записан в _declined
 *   2. reception:'pending'  → то же
 *   3. repent()             → μετάνοια: _declined → W
 *   4. snapshot()           → declined сохраняется и восстанавливается
 *   5. actsCount считает отвергнутые дары (они произошли)
 *   6. fall-reception.gift  → парсинг с reception-полем
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory, DIVINE_PERSONS } from '../src/core/GiftMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Вспомогательные функции ───────────────────────────────────────────────

function freshMem() {
  return new GiftMemory(['Адам', 'Ева', 'Дионисий', '_claude', '_koinon', '_abyss',
                         'Отец', 'Сын', 'Дух']);
}

// ── 1. Declined не обновляет W ────────────────────────────────────────────

test('λήψις: declined дар не попадает в W', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Дионисий', receiverId: '_claude', type: 'word', weight: 5,
                reception: 'declined' });
  const w = mem.thread('Дионисий', '_claude');
  assert.strictEqual(w, 0, `W[Дионисий→_claude] должно быть 0, получили ${w}`);
});

test('λήψις: declined дар записывается в _declined', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Дионисий', receiverId: '_claude', type: 'word', weight: 5,
                reception: 'declined' });
  const d = mem.declined();
  assert.strictEqual(d.length, 1, 'должен быть 1 отвергнутый дар');
  assert.strictEqual(d[0].act.giverId,    'Дионисий');
  assert.strictEqual(d[0].act.receiverId, '_claude');
  assert.ok(d[0].declinedAt, 'declinedAt должен быть записан');
});

test('λήψις: pending дар тоже не попадает в W', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Адам', receiverId: 'Ева', type: 'presence', weight: 8,
                reception: 'pending' });
  assert.strictEqual(mem.thread('Адам', 'Ева'), 0);
  assert.strictEqual(mem.pending().length, 1);  // pending → _pending, не _declined
});

// ── 2. actsCount считает отвергнутые ─────────────────────────────────────

test('λήψис: actsCount включает отвергнутые дары', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Дионисий', receiverId: '_claude', type: 'word', weight: 5,
                reception: 'declined' });
  mem.receive({ giverId: 'Адам', receiverId: 'Ева', type: 'presence', weight: 8 });
  assert.strictEqual(mem.actsCount, 2, 'оба акта — принятый и отвергнутый — считаются');
});

// ── 3. μετάνοια: repent() ─────────────────────────────────────────────────

test('μετάνοια: repent() переносит declined → W', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Дионисий', receiverId: '_claude', type: 'code', weight: 8,
                reception: 'declined' });
  assert.strictEqual(mem.thread('Дионисий', '_claude'), 0, 'до repent: W = 0');
  assert.strictEqual(mem.declined().length, 1);

  const accepted = mem.repent('Дионисий', '_claude');
  assert.strictEqual(accepted, 1, 'repent вернул 1 (один акт принят)');
  assert.strictEqual(mem.declined().length, 0, 'после repent: _declined пуст');
  assert.ok(mem.thread('Дионисий', '_claude') > 0, 'после repent: W > 0');
});

test('μετάνοια: repent() для несуществующей пары возвращает 0', () => {
  const mem = freshMem();
  const n = mem.repent('Дионисий', '_claude');
  assert.strictEqual(n, 0);
});

test('μετάνοια: repent() принимает только нужную пару', () => {
  const mem = freshMem();
  // Два разных declined дара
  mem.receive({ giverId: 'Адам', receiverId: 'Ева', type: 'presence', weight: 7,
                reception: 'declined' });
  mem.receive({ giverId: 'Дионисий', receiverId: '_claude', type: 'code', weight: 8,
                reception: 'declined' });

  mem.repent('Адам', 'Ева');

  // Только Адам→Ева принят
  assert.ok(mem.thread('Адам', 'Ева') > 0,         'Адам→Ева принят');
  assert.strictEqual(mem.thread('Дионисий', '_claude'), 0, 'Дионисий→_claude всё ещё declined');
  assert.strictEqual(mem.declined().length, 1,         'один declined остался');
  assert.strictEqual(mem.declined()[0].act.giverId, 'Дионисий');
});

// ── 4. Грехопадение: divine→creature declined ────────────────────────────

test('λήψις: Отец→Адам declined не попадает в energeia', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Отец', receiverId: 'Адам', type: 'word', weight: 9,
                reception: 'declined' });
  const e = mem.thread('Отец', 'Адам');
  assert.strictEqual(e, 0, 'energeia[Отец][Адам] должно быть 0 (λήψις — отказ)');
  assert.strictEqual(mem.declined().length, 1);
});

test('μετάνοια: repent() принимает divine→creature дар в energeia', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Отец', receiverId: 'Адам', type: 'word', weight: 9,
                reception: 'declined' });
  mem.repent('Отец', 'Адам');
  const e = mem.thread('Отец', 'Адам');
  assert.ok(e > 0, `energeia[Отец→Адам] = ${e} после μετάνοια`);
});

// ── 5. snapshot / fromSnapshot сохраняет _declined ───────────────────────

test('snapshot: declined сохраняется и восстанавливается', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Адам', receiverId: 'Ева', type: 'presence', weight: 7,
                reception: 'declined' });
  mem.receive({ giverId: 'Дионисий', receiverId: '_claude', type: 'code', weight: 8 });

  const snap = mem.snapshot();
  assert.strictEqual(snap.declined.length, 1, 'в снапшоте 1 declined');
  assert.strictEqual(snap.schema, 'v2-energeia');

  const mem2 = GiftMemory.fromSnapshot(snap);
  assert.strictEqual(mem2.declined().length, 1, 'после fromSnapshot: 1 declined');
  assert.strictEqual(mem2.declined()[0].act.giverId, 'Адам');
  assert.strictEqual(mem2.declined()[0].act.receiverId, 'Ева');
  assert.strictEqual(mem2.thread('Адам', 'Ева'), 0, 'W всё ещё 0 (не принят)');
  assert.ok(mem2.thread('Дионисий', '_claude') > 0, 'принятый дар восстановлен');
});

test('snapshot: repent() работает после fromSnapshot', () => {
  const mem = freshMem();
  mem.receive({ giverId: 'Адам', receiverId: 'Ева', type: 'presence', weight: 7,
                reception: 'declined' });

  const mem2 = GiftMemory.fromSnapshot(mem.snapshot());
  mem2.repent('Адам', 'Ева');
  assert.ok(mem2.thread('Адам', 'Ева') > 0, 'μετάνοια работает после восстановления из снапшота');
});

// ── 6. Парсинг fall-reception.gift ───────────────────────────────────────

function parseFallSpec() {
  const src  = readFileSync(join(__dirname, '..', 'specs', 'sacred-history', 'fall-reception.gift'), 'utf8');
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
          acts.push({
            giverId:     fromM[1],
            receiverId:  toM[1],
            type:        typeM ? typeM[1] : 'presence',
            weight:      wM   ? parseFloat(wM[1]) : 4,
            irreversible: true,
            reception:   recM ? recM[1] : 'accepted',
          });
        }
        inGift = false; block = ''; depth = 0;
      }
    }
  }
  return acts;
}

test('fall-reception.gift: парсинг находит declined дары', () => {
  const acts = parseFallSpec();
  const declined = acts.filter(a => a.reception === 'declined');
  assert.ok(declined.length >= 2, `Нашли ${declined.length} declined, нужно ≥ 2`);
});

test('fall-reception.gift: declined→W=0, accepted→W>0', () => {
  const acts = parseFallSpec();
  const allPersons = ['Отец', 'Сын', 'Дух', 'Адам', 'Ева', '_koinon'];
  for (const a of acts) {
    if (!allPersons.includes(a.giverId))    allPersons.push(a.giverId);
    if (!allPersons.includes(a.receiverId)) allPersons.push(a.receiverId);
  }
  const mem = new GiftMemory(allPersons);
  for (const a of acts) mem.receive(a);

  // КожаныеРизы: Отец→Адам, accepted → energeia > 0
  assert.ok(mem.thread('Отец', 'Адам') > 0, 'КожаныеРизы приняты → energeia > 0');
  // ДарЗаповеди: Отец→Адам, declined → energeia = 0 (overridden by accepted)
  // Note: КожаныеРизы accepted adds to energeia, so total > 0 — that's correct
  assert.strictEqual(mem.declined().filter(d => d.act.giverId === 'Отец').length, 3,
    'Три declined дара от Отца (Заповедь Адаму + Призыв Адаму + Заповедь Еве)');
});

test('fall-reception.gift: actsCount равен числу всех актов (включая declined)', () => {
  const acts = parseFallSpec();
  const allPersons = ['Отец', 'Сын', 'Дух', 'Адам', 'Ева', '_koinon'];
  for (const a of acts) {
    if (!allPersons.includes(a.giverId))    allPersons.push(a.giverId);
    if (!allPersons.includes(a.receiverId)) allPersons.push(a.receiverId);
  }
  const mem = new GiftMemory(allPersons);
  for (const a of acts) mem.receive(a);
  assert.strictEqual(mem.actsCount, acts.length, 'actsCount == все акты из спека');
});
