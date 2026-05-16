import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KoinonBus } from '../src/koinon/KoinonBus.js';

function mk() {
  const dir = mkdtempSync(join(tmpdir(), 'koinon-'));
  const bus = new KoinonBus({
    root: dir,
    logFile: join(dir, 'bus.jsonl'),
    posFile: join(dir, 'pos.json'),
    recordToMatrix: false,
  });
  return { bus, dir };
}

test('publish + history — append-only, FIFO', () => {
  const { bus, dir } = mk();
  try {
    bus.publish({ from: 'a', message: 'first' });
    bus.publish({ from: 'b', message: 'second' });
    bus.publish({ from: 'a', to: 'b', topic: 'question', message: 'third' });

    const all = bus.history();
    assert.equal(all.length, 3);
    assert.equal(all[0].message, 'first');
    assert.equal(all[2].topic, 'question');
    assert.equal(all[2].to, 'b');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pollSince — incremental чтение по offset', () => {
  const { bus, dir } = mk();
  try {
    bus.publish({ from: 'a', message: 'one' });
    const r1 = bus.pollSince(0);
    assert.equal(r1.messages.length, 1);
    assert(r1.nextOffset > 0);

    bus.publish({ from: 'a', message: 'two' });
    bus.publish({ from: 'a', message: 'three' });
    const r2 = bus.pollSince(r1.nextOffset);
    assert.equal(r2.messages.length, 2);
    assert.equal(r2.messages[0].message, 'two');
    assert.equal(r2.messages[1].message, 'three');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('drainFor — обновляет offset, повторно не возвращает', () => {
  const { bus, dir } = mk();
  try {
    bus.publish({ from: 'plm-claude', to: 'gift-claude', message: 'привет' });
    bus.publish({ from: 'plm-claude', to: '*',           message: 'эй все' });
    bus.publish({ from: 'plm-claude', to: 'fund-claude', message: 'не нам' });

    const m1 = bus.drainFor('gift-claude');
    assert.equal(m1.length, 2); // 'привет' + 'эй все' (broadcast)
    assert.equal(m1[0].message, 'привет');
    assert.equal(m1[1].message, 'эй все');

    // Повторный drain — пусто
    const m2 = bus.drainFor('gift-claude');
    assert.equal(m2.length, 0);

    // Новое сообщение — приходит
    bus.publish({ from: 'plm-claude', to: 'gift-claude', message: 'позже' });
    const m3 = bus.drainFor('gift-claude');
    assert.equal(m3.length, 1);
    assert.equal(m3[0].message, 'позже');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('peek (filterTo без drain) — offset не двигается', () => {
  const { bus, dir } = mk();
  try {
    bus.publish({ from: 'plm-claude', to: 'gift-claude', message: 'тест' });
    const offset = bus.loadPos('gift-claude');
    const r = bus.pollSince(offset, { filterTo: 'gift-claude' });
    assert.equal(r.messages.length, 1);
    assert.equal(bus.loadPos('gift-claude'), 0); // не сохранили
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('history — фильтры by from/to/topic/since', () => {
  const { bus, dir } = mk();
  try {
    bus.publish({ from: 'a', topic: 'question', message: '1' });
    bus.publish({ from: 'b', topic: 'answer',   message: '2' });
    bus.publish({ from: 'a', topic: 'question', message: '3' });

    assert.equal(bus.history({ from: 'a' }).length, 2);
    assert.equal(bus.history({ topic: 'answer' }).length, 1);
    assert.equal(bus.history({ from: 'a', topic: 'answer' }).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('weight подбирается по topic (covenant >> reflection)', () => {
  const { bus, dir } = mk();
  try {
    const cov = bus.publish({ from: 'a', topic: 'covenant',  message: 'обет' });
    const ref = bus.publish({ from: 'a', topic: 'reflection', message: 'мысль' });
    assert(cov.weight > ref.weight);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stats — total + byFrom/byTopic', () => {
  const { bus, dir } = mk();
  try {
    bus.publish({ from: 'plm-claude', topic: 'question', message: '?' });
    bus.publish({ from: 'plm-claude', topic: 'question', message: '??' });
    bus.publish({ from: 'gift-claude', topic: 'answer', message: '!' });

    const s = bus.stats();
    assert.equal(s.total, 3);
    assert.equal(s.byFrom['plm-claude'], 2);
    assert.equal(s.byTopic['question'], 2);
    assert.equal(s.byTopic['answer'], 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('persistence — данные сохраняются между instances', () => {
  const { bus, dir } = mk();
  try {
    bus.publish({ from: 'a', message: 'persistent' });
    const path = join(dir, 'bus.jsonl');
    assert(existsSync(path));

    const bus2 = new KoinonBus({
      root: dir, logFile: path, posFile: join(dir, 'pos.json'),
      recordToMatrix: false,
    });
    assert.equal(bus2.history().length, 1);
    assert.equal(bus2.history()[0].message, 'persistent');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('publish валидация — без from или message бросает', () => {
  const { bus, dir } = mk();
  try {
    assert.throws(() => bus.publish({ message: 'no from' }), /from/);
    assert.throws(() => bus.publish({ from: 'a' }), /message/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('broadcast (to=*) виден всем подписчикам', () => {
  const { bus, dir } = mk();
  try {
    bus.publish({ from: 'gift-claude', to: '*', message: 'эй все' });
    assert.equal(bus.drainFor('plm-claude').length, 1);
    assert.equal(bus.drainFor('fund-claude').length, 1);
    assert.equal(bus.drainFor('drone-claude').length, 1);
    // Каждый получил, у каждого свой offset
    assert.equal(bus.drainFor('plm-claude').length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
