/**
 * store.test.js — тесты GiftLocalStore
 *
 * Запуск: node --test packages/gift-protocol/test/store.test.js
 * (Node.js ≥ 18 встроенный тест-раннер)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { GiftLocalStore } from '../index.js';

// ── Фикстуры ─────────────────────────────────────────────────────────────────

let tmpDir;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gift-store-test-'));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function filePath(name) {
  return join(tmpDir, `${name}.json`);
}

const VALID_ACT = Object.freeze({
  schema: 'gift/v1',
  from: 'Alice',
  to: 'Bob',
  type: 'code',
  content: 'implemented gift-dao CLI',
  irreversible: true,
});

// ── Тесты give() ─────────────────────────────────────────────────────────────

describe('GiftLocalStore.give()', () => {
  test('принимает валидный акт и возвращает { ok: true, act }', async () => {
    const store = new GiftLocalStore(filePath('give-valid'));
    const result = await store.give(VALID_ACT);
    assert.equal(result.ok, true);
    assert.equal(result.act.from, 'Alice');
    assert.equal(result.act.to, 'Bob');
    assert.equal(result.act.type, 'code');
    assert.equal(result.act.irreversible, true);
    assert.ok(result.act.timestamp);
  });

  test('отклоняет акт без from', async () => {
    const store = new GiftLocalStore(filePath('give-no-from'));
    const result = await store.give({ schema: 'gift/v1', to: 'Bob', type: 'code', irreversible: true });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('from')));
  });

  test('отклоняет неизвестный тип', async () => {
    const store = new GiftLocalStore(filePath('give-bad-type'));
    const result = await store.give({ schema: 'gift/v1', from: 'A', to: 'B', type: 'bitcoin', irreversible: true });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('type')));
  });

  test('дар необратим — irreversible:false отклоняется', async () => {
    const store = new GiftLocalStore(filePath('give-reversible'));
    const result = await store.give({ schema: 'gift/v1', from: 'A', to: 'B', type: 'word', irreversible: false });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('irreversible')));
  });

  test('записывает в файл (append-only)', async () => {
    const fp = filePath('give-persist');
    const store1 = new GiftLocalStore(fp);
    await store1.give(VALID_ACT);

    // Второй store читает тот же файл
    const store2 = new GiftLocalStore(fp);
    const s = await store2.summary();
    assert.equal(s.actsCount, 1);
  });

  test('несколько актов накапливаются в W-матрице', async () => {
    const store = new GiftLocalStore(filePath('give-multi'));
    await store.give({ schema: 'gift/v1', from: 'A', to: 'B', type: 'code', irreversible: true });
    await store.give({ schema: 'gift/v1', from: 'A', to: 'B', type: 'word', irreversible: true });
    await store.give({ schema: 'gift/v1', from: 'C', to: 'A', type: 'time', irreversible: true });

    const s = await store.summary();
    assert.equal(s.actsCount, 3);

    const ab = s.topThreads.find(t => t.from === 'A' && t.to === 'B');
    assert.ok(ab, 'Нить A→B должна быть в топе');
    // code=5 + word=4 = 9
    assert.equal(ab.weight, 9);
  });
});

// ── Тесты summary() ──────────────────────────────────────────────────────────

describe('GiftLocalStore.summary()', () => {
  test('пустой store: actsCount=0, persons=[], topThreads=[]', async () => {
    const store = new GiftLocalStore(filePath('summary-empty'));
    const s = await store.summary();
    assert.equal(s.actsCount, 0);
    assert.deepEqual(s.persons, []);
    assert.deepEqual(s.topThreads, []);
  });

  test('topThreads отсортированы по убыванию веса', async () => {
    const store = new GiftLocalStore(filePath('summary-sort'));
    // time=10, code=5
    await store.give({ schema: 'gift/v1', from: 'X', to: 'Y', type: 'code', irreversible: true });
    await store.give({ schema: 'gift/v1', from: 'X', to: 'Z', type: 'time', irreversible: true });

    const s = await store.summary();
    assert.equal(s.topThreads[0].weight, 10); // time
    assert.equal(s.topThreads[1].weight, 5);  // code
  });

  test('topN ограничивает количество нитей', async () => {
    const store = new GiftLocalStore(filePath('summary-topn'), { topN: 2 });
    const types = ['code', 'word', 'time'];
    for (const type of types) {
      await store.give({ schema: 'gift/v1', from: 'A', to: type, type, irreversible: true });
    }

    const s = await store.summary();
    assert.ok(s.topThreads.length <= 2);
  });

  test('persons включает и дарителей, и получателей', async () => {
    const store = new GiftLocalStore(filePath('summary-persons'));
    await store.give({ schema: 'gift/v1', from: 'Giver', to: 'Receiver', type: 'grace', irreversible: true });

    const s = await store.summary();
    assert.ok(s.persons.includes('Giver'));
    assert.ok(s.persons.includes('Receiver'));
  });
});

// ── Тесты report() ───────────────────────────────────────────────────────────

describe('GiftLocalStore.report()', () => {
  test('возвращает Markdown-строку с заголовком', async () => {
    const store = new GiftLocalStore(filePath('report-basic'));
    await store.give(VALID_ACT);
    const md = await store.report();

    assert.ok(typeof md === 'string');
    assert.ok(md.includes('# Gift Protocol'));
    assert.ok(md.includes('Acts recorded'));
    assert.ok(md.includes('Alice'));
    assert.ok(md.includes('Bob'));
  });

  test('пустой store: содержит "(no acts recorded yet)"', async () => {
    const store = new GiftLocalStore(filePath('report-empty'));
    const md = await store.report();
    assert.ok(md.includes('no acts recorded yet'));
  });

  test('содержит нити с весами', async () => {
    const store = new GiftLocalStore(filePath('report-threads'));
    await store.give({ schema: 'gift/v1', from: 'X', to: 'Y', type: 'time', irreversible: true });
    const md = await store.report();
    assert.ok(md.includes('X'));
    assert.ok(md.includes('Y'));
    assert.ok(md.includes('10.0')); // time weight
  });
});

// ── Тест: персистентность между сессиями ─────────────────────────────────────

describe('Персистентность между экземплярами', () => {
  test('данные сохраняются и читаются новым экземпляром', async () => {
    const fp = filePath('persist-sessions');

    const store1 = new GiftLocalStore(fp);
    await store1.give({ schema: 'gift/v1', from: 'A', to: 'B', type: 'code', irreversible: true });
    await store1.give({ schema: 'gift/v1', from: 'C', to: 'D', type: 'time', irreversible: true });

    const store2 = new GiftLocalStore(fp);
    const s = await store2.summary();

    assert.equal(s.actsCount, 2);
    assert.ok(s.persons.includes('A'));
    assert.ok(s.persons.includes('D'));

    const cd = s.topThreads.find(t => t.from === 'C' && t.to === 'D');
    assert.ok(cd);
    assert.equal(cd.weight, 10); // time
  });
});
