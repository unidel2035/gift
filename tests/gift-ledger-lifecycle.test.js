import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftLedger } from '../src/core/GiftLedger.js';
import { FreedomGuard } from '../src/theology/FreedomGuard.js';

test('GiftLedger — lifecycle: offered → accepted/declined → recorded', async (t) => {

  await t.test('offer() создаёт pending offer с status offered', () => {
    const ledger = new GiftLedger();
    const o = ledger.offer({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    assert.ok(o.offerId);
    assert.equal(o.status, 'offered');
    assert.equal(o.from, '_claude');
    assert.equal(o.to, 'Дионисий');
    assert.ok(Object.isFrozen(o));
  });

  await t.test('offer() не пишет в историю (all() пустой)', () => {
    const ledger = new GiftLedger();
    ledger.offer({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    assert.equal(ledger.all().length, 0);
    assert.equal(ledger.size, 0);
  });

  await t.test('pendingOffers() возвращает ожидающие предложения', () => {
    const ledger = new GiftLedger();
    ledger.offer({ from: 'А', to: 'Б', type: 'time', weight: 10 });
    ledger.offer({ from: 'В', to: 'Г', type: 'code', weight: 3 });
    assert.equal(ledger.pendingOffers().length, 2);
  });

  await t.test('accept() записывает дар в историю', () => {
    const ledger = new GiftLedger();
    const o = ledger.offer({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    const entry = ledger.accept(o.offerId);
    assert.equal(ledger.size, 1);
    assert.equal(entry.from, '_claude');
    assert.equal(entry.to, 'Дионисий');
    assert.ok(Object.isFrozen(entry));
  });

  await t.test('accept() удаляет из pending', () => {
    const ledger = new GiftLedger();
    const o = ledger.offer({ from: 'А', to: 'Б', type: 'gift', weight: 1 });
    ledger.accept(o.offerId);
    assert.equal(ledger.pendingOffers().length, 0);
  });

  await t.test('decline() не пишет в историю', () => {
    const ledger = new GiftLedger();
    const o = ledger.offer({ from: '_claude', to: 'Дионисий', type: 'time', weight: 7 });
    ledger.decline(o.offerId, 'Нет времени');
    assert.equal(ledger.size, 0);
    assert.equal(ledger.all().length, 0);
  });

  await t.test('decline() записывает в declinedOffers()', () => {
    const ledger = new GiftLedger();
    const o = ledger.offer({ from: 'А', to: 'Б', type: 'code', weight: 3 });
    const d = ledger.decline(o.offerId, 'Свобода');
    assert.equal(d.status, 'declined');
    assert.equal(d.reason, 'Свобода');
    assert.ok(d.declinedAt);
    assert.ok(Object.isFrozen(d));
    assert.equal(ledger.declinedOffers().length, 1);
  });

  await t.test('decline() без причины — допустимо (свобода не требует объяснений)', () => {
    const ledger = new GiftLedger();
    const o = ledger.offer({ from: 'А', to: 'Б', type: 'gift', weight: 2 });
    const d = ledger.decline(o.offerId);
    assert.ok(d.reason.length > 0); // дефолтная причина
    assert.equal(d.status, 'declined');
  });

  await t.test('accept() на несуществующий offerId бросает ошибку', () => {
    const ledger = new GiftLedger();
    assert.throws(() => ledger.accept('offer-999'), /not found/);
  });

  await t.test('decline() на несуществующий offerId бросает ошибку', () => {
    const ledger = new GiftLedger();
    assert.throws(() => ledger.decline('offer-999'), /not found/);
  });

  await t.test('accept() нельзя вызвать дважды для одного offer', () => {
    const ledger = new GiftLedger();
    const o = ledger.offer({ from: 'А', to: 'Б', type: 'code', weight: 1 });
    ledger.accept(o.offerId);
    assert.throws(() => ledger.accept(o.offerId), /not found/);
  });

  await t.test('FreedomGuard: accept() блокирует запись если получатель отказывается', () => {
    const freedom = new FreedomGuard();
    const ledger = new GiftLedger(freedom);

    freedom.refuse('Дионисий', '_claude', 'Нет');

    const o = ledger.offer({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    assert.throws(() => ledger.accept(o.offerId), /FreedomGuard/);
    assert.equal(ledger.size, 0); // в историю не попало
  });

  await t.test('FreedomGuard: accept() блокирует если получатель недоступен', () => {
    const freedom = new FreedomGuard();
    const ledger = new GiftLedger(freedom);

    freedom.markUnavailable('Дионисий', 'суббота');

    const o = ledger.offer({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    assert.throws(() => ledger.accept(o.offerId), /FreedomGuard/);
    assert.equal(ledger.size, 0);
  });

  await t.test('FreedomGuard: accept() проходит после снятия отказа', () => {
    const freedom = new FreedomGuard();
    const ledger = new GiftLedger(freedom);

    freedom.refuse('Дионисий', '_claude', 'Нет');
    const o = ledger.offer({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    assert.throws(() => ledger.accept(o.offerId), /FreedomGuard/);

    // Дионисий открывается
    freedom.openTo('Дионисий', '_claude');
    const o2 = ledger.offer({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    const entry = ledger.accept(o2.offerId);
    assert.equal(ledger.size, 1);
    assert.equal(entry.to, 'Дионисий');
  });

  await t.test('FreedomGuard: accept() записывает акт свободного принятия', () => {
    const freedom = new FreedomGuard();
    const ledger = new GiftLedger(freedom);

    const o = ledger.offer({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    ledger.accept(o.offerId);

    const history = freedom.getRefusalHistory('Дионисий');
    // Нет отказов — это принятие
    assert.equal(history.length, 0);
    // Но acceptanceHistory должна содержать запись
    const exported = freedom.export();
    assert.equal(exported.acceptanceHistory.length, 1);
    assert.equal(exported.acceptanceHistory[0].person, 'Дионисий');
    assert.equal(exported.acceptanceHistory[0].from, '_claude');
  });

  await t.test('без FreedomGuard — accept() работает свободно', () => {
    const ledger = new GiftLedger(); // no FreedomGuard
    const o = ledger.offer({ from: 'А', to: 'Б', type: 'gift', weight: 3 });
    const entry = ledger.accept(o.offerId);
    assert.equal(ledger.size, 1);
    assert.equal(entry.from, 'А');
  });

  await t.test('полный lifecycle: offer → accept + decline — правильный счёт', () => {
    const ledger = new GiftLedger();
    const o1 = ledger.offer({ from: 'А', to: 'Б', type: 'code', weight: 5 });
    const o2 = ledger.offer({ from: 'В', to: 'Г', type: 'time', weight: 10 });
    const o3 = ledger.offer({ from: 'Д', to: 'Е', type: 'presence', weight: 2 });

    ledger.accept(o1.offerId);
    ledger.decline(o2.offerId, 'Нет сил');
    ledger.accept(o3.offerId);

    assert.equal(ledger.size, 2);            // только принятые в истории
    assert.equal(ledger.pendingOffers().length, 0);
    assert.equal(ledger.declinedOffers().length, 1);
    assert.equal(ledger.all().length, 2);
  });

});
