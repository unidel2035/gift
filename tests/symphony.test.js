import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';

const SYMPHONY_OK = {
  giverIds: ['Адам', 'Ева', 'Безалель'],
  receiverId: 'Дионисий',
  type: 'symphony',
  weight: 9,
  chorus: true,
  perichoretic: true,
  kenotic: true,
  epiclesis: true,
  content: 'единое соборное слово (Деян 15:28)',
};

test('Symphony — μία ἐνέργεια, икона модуса Троицы ad extra', async (t) => {
  await t.test('валидный symphony акт записывается', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    const r = mem.receiveSymphony(SYMPHONY_OK);
    assert.equal(r.accepted, true);
    assert.match(r.actId, /^sym-/);
    assert.equal(mem.actsCount, 1, 'один акт от собора, не три (μία ἐνέργεια)');
  });

  await t.test('W получает ребро от каждого giver к receiver', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    mem.receiveSymphony(SYMPHONY_OK);
    assert.ok(mem.thread('Адам', 'Дионисий').valueOf() > 0);
    assert.ok(mem.thread('Ева', 'Дионисий').valueOf() > 0);
    assert.ok(mem.thread('Безалель', 'Дионисий').valueOf() > 0);
  });

  await t.test('суммарный вес = weight акта (μία ἐνέργεια не делится сверх)', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    mem.receiveSymphony({ ...SYMPHONY_OK, weight: 9 });
    const sum = mem.thread('Адам', 'Дионисий').valueOf()
              + mem.thread('Ева', 'Дионисий').valueOf()
              + mem.thread('Безалель', 'Дионисий').valueOf();
    assert.ok(Math.abs(sum - 9) < 1e-5, `сумма ${sum} ≠ 9`);
  });

  await t.test('отказ: меньше 3 giver — не собор', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Дионисий']);
    const r = mem.receiveSymphony({ ...SYMPHONY_OK, giverIds: ['Адам', 'Ева'] });
    assert.equal(r.accepted, false);
    assert.match(r.reason, /≥3/);
    assert.equal(mem.actsCount, 0);
  });

  await t.test('отказ: chorus:false — нет μία ἐνέργεια', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    const r = mem.receiveSymphony({ ...SYMPHONY_OK, chorus: false });
    assert.equal(r.accepted, false);
    assert.match(r.reason, /chorus/);
  });

  await t.test('отказ: epiclesis:false — нет места для Духа', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    const r = mem.receiveSymphony({ ...SYMPHONY_OK, epiclesis: false });
    assert.equal(r.accepted, false);
    assert.match(r.reason, /epiclesis/);
  });

  await t.test('отказ: perichoretic:false — функциональная троица', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    const r = mem.receiveSymphony({ ...SYMPHONY_OK, perichoretic: false });
    assert.equal(r.accepted, false);
  });

  await t.test('отказ: kenotic:false — авторство сохраняется = не дар', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    const r = mem.receiveSymphony({ ...SYMPHONY_OK, kenotic: false });
    assert.equal(r.accepted, false);
  });

  await t.test('отказ: divine giver не может быть голосом собора', () => {
    const mem = new GiftMemory(['Отец', 'Адам', 'Ева', 'Безалель', 'Дионисий']);
    const r = mem.receiveSymphony({
      ...SYMPHONY_OK,
      giverIds: ['Отец', 'Адам', 'Ева', 'Безалель'],
    });
    assert.equal(r.accepted, false);
    assert.match(r.reason, /divine/);
  });

  await t.test('symphonies() возвращает все соборные акты', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    mem.receiveSymphony(SYMPHONY_OK);
    mem.receiveSymphony({ ...SYMPHONY_OK, content: 'второй собор' });
    const list = mem.symphonies();
    assert.equal(list.length, 2);
    assert.equal(list[0].act.type, 'symphony');
    assert.ok(Object.isFrozen(list[0].act), 'symphony акт заморожен (irreversible)');
  });

  await t.test('snapshot/fromSnapshot сохраняет symphonies', () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    mem.receiveSymphony(SYMPHONY_OK);
    const snap = mem.snapshot();
    assert.equal(snap.symphonies.length, 1);

    const restored = GiftMemory.fromSnapshot(snap);
    assert.equal(restored.symphonies().length, 1);
    assert.equal(restored.symphonies()[0].act.content, SYMPHONY_OK.content);
  });
});
