import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KoinonFederation } from '../src/core/KoinonFederation.js';
import { GiftMemory } from '../src/core/GiftMemory.js';

function makeMemory(persons = ['_claude', '_koinon', 'Дионисий']) {
  return new GiftMemory(persons);
}

test('KoinonFederation — соборная федерация Κοινόνов', async (t) => {

  await t.test('descriptor() возвращает дескриптор узла', () => {
    const mem = makeMemory();
    const fed = new KoinonFederation('koinon-dion', mem, { url: 'http://localhost:3000' });
    const desc = fed.descriptor();
    assert.equal(desc.id, 'koinon-dion');
    assert.equal(desc.url, 'http://localhost:3000');
    assert.equal(desc.protocol, 'koinon-federation/1.0');
    assert.ok(Array.isArray(desc.persons));
  });

  await t.test('acceptHandshake() сохраняет соседа и возвращает свой дескриптор', () => {
    const mem = makeMemory();
    const fed = new KoinonFederation('koinon-dion', mem);
    const incoming = {
      id: 'koinon-b',
      url: 'http://peer:4000',
      n: 3,
      actsCount: 10,
      persons: ['Иоанн', 'Мария'],
      protocol: 'koinon-federation/1.0',
    };
    const reply = fed.acceptHandshake(incoming);
    assert.equal(reply.id, 'koinon-dion');
    assert.ok(fed.hasPeer('koinon-b'));
    assert.equal(fed.peerCount(), 1);
  });

  await t.test('acceptHandshake() выбрасывает при отсутствии id', () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    assert.throws(() => fed.acceptHandshake({ url: 'http://x' }), /Нет id/);
  });

  await t.test('peers() возвращает список без внутренних полей', () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    fed.acceptHandshake({ id: 'peer-1', n: 1, actsCount: 5, persons: [], protocol: '1.0' });
    const peers = fed.peers();
    assert.equal(peers.length, 1);
    assert.equal(peers[0].id, 'peer-1');
    assert.ok(!('_peers' in peers[0]));
  });

  await t.test('removePeer() удаляет соседа', () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    fed.acceptHandshake({ id: 'tmp', n: 0, actsCount: 0, persons: [] });
    assert.ok(fed.hasPeer('tmp'));
    fed.removePeer('tmp');
    assert.ok(!fed.hasPeer('tmp'));
  });

  await t.test('parseAddr() корректно разбирает адрес', () => {
    assert.deepEqual(KoinonFederation.parseAddr('koinon-a/_claude'), { koinon: 'koinon-a', person: '_claude' });
    assert.deepEqual(KoinonFederation.parseAddr('Дионисий'), { koinon: null, person: 'Дионисий' });
    assert.deepEqual(KoinonFederation.parseAddr(''), { koinon: null, person: null });
    assert.deepEqual(KoinonFederation.parseAddr(null), { koinon: null, person: null });
  });

  await t.test('federatedId() собирает межобщинный адрес', () => {
    assert.equal(KoinonFederation.federatedId('koinon-a', '_claude'), 'koinon-a/_claude');
  });

  await t.test('localPersonId() разрешает адреса', () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    // Свой — возвращает person-часть
    assert.equal(fed.localPersonId('koinon-dion/_claude'), '_claude');
    // Без koinon — person как есть
    assert.equal(fed.localPersonId('Дионисий'), 'Дионисий');
    // Чужой — полный federated id
    assert.equal(fed.localPersonId('koinon-b/Мария'), 'koinon-b/Мария');
  });

  await t.test('giveAcross() записывает локальный акт в матрицу', async () => {
    const mem = makeMemory(['_claude', '_koinon', 'Дионисий']);
    const fed = new KoinonFederation('koinon-dion', mem);
    const before = mem.actsCount;
    await fed.giveAcross({ from: '_claude', to: 'Дионисий', weight: 5, type: 'code' });
    assert.equal(mem.actsCount, before + 1);
  });

  await t.test('giveAcross() логирует межобщинный акт', async () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    await fed.giveAcross({ from: 'koinon-dion/_claude', to: 'koinon-b/Мария', weight: 3, type: 'word' });
    const acts = fed.interCommunityActs();
    assert.equal(acts.length, 1);
    assert.ok(acts[0].ts);
  });

  await t.test('receiveFromPeer() добавляет акт от соседа в матрицу', () => {
    const mem = makeMemory(['_claude', '_koinon', 'Дионисий']);
    const fed = new KoinonFederation('koinon-dion', mem);
    const before = mem.actsCount;
    const res = fed.receiveFromPeer({
      from: 'koinon-b/Иоанн',
      to: 'koinon-dion/Дионисий',
      weight: 4,
      type: 'inter-community',
      _fedFrom: 'koinon-b',
    });
    assert.ok(res.ok);
    assert.equal(mem.actsCount, before + 1);
  });

  await t.test('matrixSnapshot() содержит koinonId', () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    const snap = fed.matrixSnapshot();
    assert.equal(snap.koinonId, 'koinon-dion');
    assert.ok(Array.isArray(snap.persons));
    assert.ok(Array.isArray(snap.W));
  });

  await t.test('computeGlobalTensor() возвращает локальный снапшот при отсутствии соседей', async () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    const tensor = await fed.computeGlobalTensor();
    assert.equal(tensor.global, false);
    assert.equal(tensor.nodes, 1);
    assert.deepEqual(tensor.nodesIds, ['koinon-dion']);
  });

  await t.test('paschaDate() возвращает правильную дату Пасхи', () => {
    // Православная Пасха 2026 — 12 апреля
    const d = KoinonFederation.paschaDate(2026);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 3);   // 0-based: 3 = апрель
    assert.equal(d.getDate(), 12);
  });

  await t.test('isPascha() распознаёт Пасху', () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    const pascha2026 = new Date(2026, 3, 12); // 12 апреля 2026
    assert.ok(fed.isPascha(pascha2026));
    assert.ok(!fed.isPascha(new Date(2026, 3, 13)));
  });

  await t.test('onPascha() возвращает paschaDate, multiplier и Христос воскресе', async () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory(), { paschaMultiplier: 7 });
    const res = await fed.onPascha(2026);
    assert.equal(res.year, 2026);
    assert.equal(res.multiplier, 7);
    assert.ok(res.paschaDate);
    assert.ok(res.message.includes('Χριστὸς ἀνέστη'));
    assert.ok(res.globalTensor);
  });

  await t.test('interCommunityActs() возвращает последние N актов', async () => {
    const fed = new KoinonFederation('koinon-dion', makeMemory());
    for (let i = 0; i < 10; i++) {
      await fed.giveAcross({ from: '_claude', to: `person-${i}`, weight: 1, type: 'word' });
    }
    assert.equal(fed.interCommunityActs(5).length, 5);
    assert.equal(fed.interCommunityActs().length, 10);
  });
});
