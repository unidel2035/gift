import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LcmStore } from '../src/lcm/store.js';

function mkStore() {
  const dir = mkdtempSync(join(tmpdir(), 'lcm-'));
  const path = join(dir, 'lcm.db');
  const store = new LcmStore(path);
  return { store, dir };
}

test('LcmStore: addDocument + grep + expand', () => {
  const { store, dir } = mkStore();
  try {
    const docs = [
      { source: 'chat-session', sourceId: 'sess-1', role: 'user',     content: 'кенозис рождает свободу',         ts: '2026-01-01T00:00:00Z' },
      { source: 'chat-session', sourceId: 'sess-1', role: 'assistant', content: 'свобода — путь к евхаристии',     ts: '2026-01-01T00:01:00Z' },
      { source: 'insight',      sourceId: 'ins-1',  role: 'axiom',    content: 'дар необратим — это аксиома',     ts: '2026-01-02T00:00:00Z' },
      { source: 'act',          sourceId: 'act-1',  role: 'gift',     content: 'передан код от Клода Дионисию',    ts: '2026-01-03T00:00:00Z' },
    ];
    const inserted = store.addBatch(docs);
    assert.equal(inserted, 4);

    const stats = store.stats();
    assert.equal(stats.total, 4);
    assert.equal(stats.bySource['chat-session'], 2);
    assert.equal(stats.bySource['insight'], 1);
    assert.equal(stats.bySource['act'], 1);

    // grep по фразе
    const r1 = store.grep('кенозис', { limit: 5 });
    assert.equal(r1.length, 1);
    assert.equal(r1[0].source_id, 'sess-1');
    assert.match(r1[0].snippet, /«кенозис»/);

    // grep с фильтром по источнику
    const r2 = store.grep('дар', { limit: 5, source: 'insight' });
    assert.equal(r2.length, 1);
    assert.equal(r2[0].source, 'insight');

    // expand разворачивает все документы одного source_id в порядке ts
    const exp = store.expand('sess-1');
    assert.equal(exp.length, 2);
    assert.equal(exp[0].role, 'user');
    assert.equal(exp[1].role, 'assistant');

    // идемпотентность: повторный addBatch не дублирует
    const inserted2 = store.addBatch(docs);
    assert.equal(inserted2, 0);
    assert.equal(store.stats().total, 4);

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LcmStore: пустой/короткий query возвращает []', () => {
  const { store, dir } = mkStore();
  try {
    store.addDocument({
      source: 'manual', sourceId: 'm-1', content: 'тест', ts: '2026-01-01T00:00:00Z',
    });
    assert.deepEqual(store.grep(''), []);
    assert.deepEqual(store.grep('a'), []); // <2 символов
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LcmStore: query с двойными кавычками не ломает FTS', () => {
  const { store, dir } = mkStore();
  try {
    store.addDocument({
      source: 'manual', sourceId: 'm-1',
      content: 'святой сказал «дар» необратим',
      ts: '2026-01-01T00:00:00Z',
    });
    // Внутри FTS5 ищется как фраза — двойные кавычки в запросе не должны падать.
    const rows = store.grep('"дар" необратим');
    assert.ok(Array.isArray(rows));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
