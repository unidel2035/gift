import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftLedger, getGiftLedger } from '../src/core/GiftLedger.js';

test('GiftLedger — append-only реестр даров', async (t) => {

  await t.test('append возвращает замороженную запись', () => {
    const ledger = new GiftLedger();
    const e = ledger.append({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5, proof: 'тест' });
    assert.ok(Object.isFrozen(e));
    assert.equal(e.from, '_claude');
    assert.equal(e.to, 'Дионисий');
    assert.equal(e.type, 'code');
    assert.equal(e.weight, 5);
    assert.ok(e.timestamp);
    assert.equal(e.id, 1);
  });

  await t.test('append-only: записи нельзя мутировать', () => {
    const ledger = new GiftLedger();
    const e = ledger.append({ from: 'А', to: 'Б', type: 'gift', weight: 3 });
    assert.throws(() => { e.weight = 999; });
  });

  await t.test('монотонный id: каждая запись получает уникальный id', () => {
    const ledger = new GiftLedger();
    const e1 = ledger.append({ from: 'А', to: 'Б', type: 'time', weight: 10 });
    const e2 = ledger.append({ from: 'Б', to: 'В', type: 'code', weight: 3 });
    assert.equal(e1.id, 1);
    assert.equal(e2.id, 2);
    assert.equal(ledger.size, 2);
  });

  await t.test('all() возвращает все акты с communityImpact', () => {
    const ledger = new GiftLedger();
    ledger.append({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    ledger.append({ from: 'ОтецСергий', to: '_claude', type: 'covenant', weight: 10 });
    const all = ledger.all();
    assert.equal(all.length, 2);
    assert.ok(typeof all[0].communityImpact === 'number');
    assert.ok(all[0].communityImpact >= 0);
  });

  await t.test('communityImpact растёт для _koinon (broadcast)', () => {
    const ledger = new GiftLedger();
    const ts = new Date(Date.now() - 48 * 3_600_000).toISOString(); // 2 дня назад
    ledger.append({ from: '_claude', to: '_koinon', type: 'presence', weight: 4, timestamp: ts });
    const [e] = ledger.all();
    // receivers=3, timeFactor≥2 → impact ≥ 4×3×2 = 24
    assert.ok(e.communityImpact >= 24);
  });

  await t.test('to может быть массивом', () => {
    const ledger = new GiftLedger();
    const e = ledger.append({ from: 'А', to: ['Б', 'В', 'Г'], type: 'gift', weight: 2 });
    assert.ok(Array.isArray(e.to));
    assert.equal(e.to.length, 3);
    assert.ok(Object.isFrozen(e.to));
  });

  await t.test('toJSON содержит все акты', () => {
    const ledger = new GiftLedger();
    ledger.append({ from: 'А', to: 'Б', type: 'code', weight: 1 });
    const json = JSON.parse(ledger.toJSON());
    assert.ok(Array.isArray(json.ledger));
    assert.equal(json.ledger.length, 1);
    assert.ok(json.exportedAt);
  });

  await t.test('toCSV содержит заголовок и строки', () => {
    const ledger = new GiftLedger();
    ledger.append({ from: 'А', to: 'Б', type: 'code', weight: 7, proof: 'доказательство' });
    const csv = ledger.toCSV();
    assert.ok(csv.startsWith('id,from,to,type,weight,proof,timestamp,communityImpact'));
    assert.ok(csv.includes('доказательство'));
    assert.ok(csv.includes('"А"'));
  });

  await t.test('toRSS содержит валидный RSS', () => {
    const ledger = new GiftLedger();
    ledger.append({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5, proof: 'рефлексия' });
    const rss = ledger.toRSS({ title: 'Тест', link: 'http://test', description: 'Тест' });
    assert.ok(rss.includes('<?xml'));
    assert.ok(rss.includes('<rss'));
    assert.ok(rss.includes('<item>'));
    assert.ok(rss.includes('_claude'));
    assert.ok(rss.includes('рефлексия'));
  });

  await t.test('toRSS экранирует спецсимволы XML', () => {
    const ledger = new GiftLedger();
    ledger.append({ from: 'А&Б', to: '<В>', type: 'gift', weight: 1, proof: 'x"y' });
    const rss = ledger.toRSS();
    assert.ok(!rss.includes('А&Б')); // должен быть &amp;
    assert.ok(rss.includes('&amp;'));
    assert.ok(rss.includes('&lt;'));
  });

  await t.test('getGiftLedger() возвращает синглтон', () => {
    const a = getGiftLedger();
    const b = getGiftLedger();
    assert.equal(a, b);
  });

});
