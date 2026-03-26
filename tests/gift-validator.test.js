import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftValidator } from '../src/core/GiftValidator.js';

const valid = {
  schema: 'gift/v1',
  from: '_claude',
  to: 'Дионисий',
  type: 'code',
  weight: 5,
  content: 'KoinonFederation — протокол соборности',
  irreversible: true,
};

test('GiftValidator — валидатор актов дара', async (t) => {

  await t.test('validate() принимает корректный акт', () => {
    const res = GiftValidator.validate(valid);
    assert.ok(res.ok);
    assert.equal(res.act.from, '_claude');
    assert.equal(res.act.to, 'Дионисий');
    assert.equal(res.act.type, 'code');
    assert.equal(res.act.weight, 5);
    assert.equal(res.act.irreversible, true);
    assert.ok(Object.isFrozen(res.act));
  });

  await t.test('validate() отклоняет не-объект', () => {
    assert.equal(GiftValidator.validate(null).ok, false);
    assert.equal(GiftValidator.validate('string').ok, false);
    assert.equal(GiftValidator.validate([]).ok, false);
  });

  await t.test('validate() требует schema=gift/v1', () => {
    const res = GiftValidator.validate({ ...valid, schema: 'wrong' });
    assert.ok(!res.ok);
    assert.ok(res.errors.some(e => e.includes('schema')));
  });

  await t.test('validate() требует непустой from', () => {
    const res = GiftValidator.validate({ ...valid, from: '' });
    assert.ok(!res.ok);
    assert.ok(res.errors.some(e => e.includes('from')));
  });

  await t.test('validate() требует непустой to', () => {
    const res = GiftValidator.validate({ ...valid, to: '   ' });
    assert.ok(!res.ok);
    assert.ok(res.errors.some(e => e.includes('to')));
  });

  await t.test('validate() требует известный type', () => {
    const res = GiftValidator.validate({ ...valid, type: 'unknown' });
    assert.ok(!res.ok);
    assert.ok(res.errors.some(e => e.includes('type')));
  });

  await t.test('validate() применяет вес по типу когда weight не задан', () => {
    const res = GiftValidator.validate({ ...valid, weight: undefined });
    assert.ok(res.ok);
    assert.equal(res.act.weight, 5); // code=5
  });

  await t.test('validate() применяет вес time=10', () => {
    const res = GiftValidator.validate({ ...valid, type: 'time', weight: undefined });
    assert.ok(res.ok);
    assert.equal(res.act.weight, 10);
  });

  await t.test('validate() отклоняет weight вне диапазона', () => {
    const r1 = GiftValidator.validate({ ...valid, weight: 0 });
    assert.ok(!r1.ok);
    const r2 = GiftValidator.validate({ ...valid, weight: 11 });
    assert.ok(!r2.ok);
  });

  await t.test('validate() отклоняет content > 500 символов', () => {
    const res = GiftValidator.validate({ ...valid, content: 'а'.repeat(501) });
    assert.ok(!res.ok);
    assert.ok(res.errors.some(e => e.includes('content')));
  });

  await t.test('validate() богословская аксиома: irreversible не может быть false', () => {
    const res = GiftValidator.validate({ ...valid, irreversible: false });
    assert.ok(!res.ok);
    assert.ok(res.errors.some(e => e.includes('irreversible')));
  });

  await t.test('validate() принимает irreversible=true', () => {
    const res = GiftValidator.validate({ ...valid, irreversible: true });
    assert.ok(res.ok);
  });

  await t.test('validate() принимает валидный proof.commit', () => {
    const res = GiftValidator.validate({
      ...valid,
      proof: { commit: 'abc1234', repo: 'owner/repo' },
    });
    assert.ok(res.ok);
  });

  await t.test('validate() отклоняет proof.commit без repo', () => {
    const res = GiftValidator.validate({ ...valid, proof: { commit: 'abc1234' } });
    assert.ok(!res.ok);
    assert.ok(res.errors.some(e => e.includes('repo')));
  });

  await t.test('validate() принимает proof.tg_message_id + chat_id', () => {
    const res = GiftValidator.validate({
      ...valid,
      proof: { tg_message_id: 42, chat_id: -100123 },
    });
    assert.ok(res.ok);
  });

  await t.test('validate() принимает proof.seconds', () => {
    const res = GiftValidator.validate({ ...valid, proof: { seconds: 3600 } });
    assert.ok(res.ok);
  });

  await t.test('validate() отклоняет невалидный proof.seconds', () => {
    const res = GiftValidator.validate({ ...valid, proof: { seconds: 0 } });
    assert.ok(!res.ok);
  });

  await t.test('validate() отклоняет невалидный timestamp', () => {
    const res = GiftValidator.validate({ ...valid, timestamp: 'not-a-date' });
    assert.ok(!res.ok);
    assert.ok(res.errors.some(e => e.includes('timestamp')));
  });

  await t.test('validate() принимает валидный timestamp', () => {
    const res = GiftValidator.validate({ ...valid, timestamp: '2026-03-27T12:00:00Z' });
    assert.ok(res.ok);
    assert.equal(res.act.timestamp, '2026-03-27T12:00:00Z');
  });

  await t.test('validate() добавляет timestamp если не задан', () => {
    const res = GiftValidator.validate({ ...valid, timestamp: undefined });
    assert.ok(res.ok);
    assert.ok(res.act.timestamp);
  });

  await t.test('toLegacy() конвертирует в формат ленты анамнезиса', () => {
    const { act } = GiftValidator.validate(valid);
    const legacy = GiftValidator.toLegacy(act);
    assert.equal(legacy.from, '_claude');
    assert.equal(legacy.to, 'Дионисий');
    assert.equal(legacy.type, 'code');
    assert.equal(legacy.irreversible, true);
    assert.equal(legacy.living, true);
    assert.ok(legacy.sealedAt);
  });

  await t.test('toMemoryAct() конвертирует в формат GiftMemory.receive()', () => {
    const { act } = GiftValidator.validate(valid);
    const memAct = GiftValidator.toMemoryAct(act);
    assert.equal(memAct.giverId, '_claude');
    assert.equal(memAct.receiverId, 'Дионисий');
    assert.equal(memAct.weight, 5);
    assert.equal(memAct.type, 'code');
  });
});
