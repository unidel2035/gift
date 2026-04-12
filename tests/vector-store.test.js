import { test } from 'node:test';
import assert from 'node:assert/strict';
import SQLiteVectorStore from '../src/kag/SQLiteVectorStore.js';
import { tmpdir } from 'os';
import { join } from 'path';

const TMP_DB = join(tmpdir(), `gift-test-${Date.now()}.db`);

// Проверяем доступность до запуска тестов (native module может отсутствовать в WSL2)
const _probe = new SQLiteVectorStore(TMP_DB);
const SKIP = !_probe.isAvailable();

test('SQLiteVectorStore — хранение и поиск', { skip: SKIP ? 'better-sqlite3 native module недоступен' : false }, async (t) => {
  const store = new SQLiteVectorStore(TMP_DB);

  if (!store.isAvailable()) {
    t.skip('better-sqlite3 native module недоступен (WSL2/platform)');
    return;
  }

  await t.test('isAvailable — открывается', () => {
    assert.ok(store.isAvailable());
  });

  await t.test('store + count', () => {
    const vec = Array.from({ length: 768 }, (_, i) => Math.sin(i));
    store.store('test-1', vec, { cat: 'theology', path: 'specs/theology/test.gift', preview: 'тест' });
    assert.equal(store.count(), 1);
  });

  await t.test('search — находит по косинусному сходству', () => {
    const vec = Array.from({ length: 768 }, (_, i) => Math.sin(i));
    const results = store.search(vec, 1, {});
    assert.equal(results.length, 1);
    assert.ok(results[0].similarity > 0.99); // тот же вектор
  });

  await t.test('search с boost — score умножается', () => {
    // Вектор похожий на query, но не идентичный
    const vec2 = Array.from({ length: 768 }, (_, i) => Math.sin(i) * 0.5 + 0.01);
    store.store('test-2', vec2, { cat: 'axioms', path: 'specs/axioms/test.gift', preview: 'аксиома' });

    const query = Array.from({ length: 768 }, (_, i) => Math.sin(i));
    // Без буста test-1 (идентичный вектор) первый
    const noBoost = store.search(query, 2, {});
    assert.equal(noBoost[0].id, 'test-1');

    // score = similarity * boost — проверяем что score > similarity
    const withBoost = store.search(query, 2, { axioms: 5.0 });
    const axiomResult = withBoost.find(r => r.id === 'test-2');
    assert.ok(axiomResult.score > axiomResult.similarity, 'boost должен увеличивать score');
  });

  await t.test('delete', () => {
    store.delete('test-1');
    store.delete('test-2');
    assert.equal(store.count(), 0);
  });

  store.close();
});
