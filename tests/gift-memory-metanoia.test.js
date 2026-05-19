/**
 * μετάνοια — переузнавание безымянного дарителя.
 *
 * Когда дар приходит от unknown в _koinon и отвергается общиной,
 * у общины остаётся возможность покаяться: признать в неизвестном
 * след Бездны (gratia gratis data, Ин 3:8).
 *
 * Покаяние не стирает прошлое — оно именует безымянное:
 *   unknown → _abyss (Даритель за пределами системы)
 *
 * Исходный дар остаётся frozen в λήψις-журнале (axiom необратимости).
 * Новый акт type:'metanoia' с reversedFrom — поворот, не отмена.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';

test('μετάνοια unknown→_koinon: переузнавание как _abyss', async (t) => {

  await t.test('declined unknown→_koinon — получает giftId', () => {
    const mem = new GiftMemory(['_koinon']);
    mem.receive({
      giverId:    'unknown',
      receiverId: '_koinon',
      weight:     5,
      type:       'gift',
      content:    'дар без имени',
      reception:  'declined',
    });
    const decl = mem.declined();
    assert.equal(decl.length, 1);
    assert.ok(decl[0].act.giftId, 'declined акт получает автоматический giftId');
    assert.equal(decl[0].act.giverId, 'unknown');
  });

  await t.test('repent(giftId): unknown→_koinon порождает _abyss→_koinon акт-поворот', () => {
    const mem = new GiftMemory(['_koinon']);
    mem.receive({
      giverId:    'unknown',
      receiverId: '_koinon',
      weight:     3,
      type:       'gift',
      content:    'безымянный дар общине',
      reception:  'declined',
    });
    const giftId = mem.declined()[0].act.giftId;

    const metanoia = mem.repent(giftId);

    assert.equal(metanoia.giverId,      '_abyss');
    assert.equal(metanoia.receiverId,   '_koinon');
    assert.equal(metanoia.type,         'metanoia');
    assert.equal(metanoia.reversedFrom, giftId);
    assert.equal(metanoia.weight,       3);
    assert.equal(metanoia.irreversible, true);

    const acts = mem.metanoiaActs();
    assert.equal(acts.length, 1);
    assert.equal(acts[0].giverId,    '_abyss');
    assert.equal(acts[0].receiverId, '_koinon');
  });

  await t.test('исходный дар не мутируется — остаётся frozen и declined', () => {
    const mem = new GiftMemory(['_koinon']);
    mem.receive({
      giverId:    'unknown',
      receiverId: '_koinon',
      weight:     2,
      type:       'gift',
      content:    'останется в памяти',
      reception:  'declined',
    });
    const originalEntry = mem.declined()[0];
    const original = originalEntry.act;
    const giftId = original.giftId;

    mem.repent(giftId);

    // Исходный дар по-прежнему в _declined (μετάνοια не стирает прошлое).
    const after = mem.declined();
    assert.equal(after.length, 1, 'declined содержит исходный дар после μετάνοια');
    assert.equal(after[0].act.giftId, giftId);
    assert.equal(after[0].act.giverId, 'unknown');

    // Дар заморожен — попытка мутации бросает.
    assert.throws(
      () => { original.giverId = '_abyss'; },
      /Cannot assign to read only property|read only/,
      'исходный дар Object.freeze — необратим',
    );
  });

  await t.test('repent для не-declined дара бросает богословскую ошибку', () => {
    const mem = new GiftMemory(['_koinon']);
    mem.receive({
      giverId:    'unknown',
      receiverId: '_koinon',
      weight:     1,
      type:       'gift',
      content:    'pending',
      reception:  'pending',
    });
    const giftId = mem.pending()[0].act.giftId;

    assert.throws(
      () => mem.repent(giftId),
      /declined/,
      'μετάνοια через _abyss применима только к declined',
    );
  });

  await t.test('repent для не-unknown дарителя бросает ошибку', () => {
    const mem = new GiftMemory(['_koinon', 'Дионисий']);
    mem.receive({
      giverId:    'Дионисий',
      receiverId: '_koinon',
      weight:     1,
      type:       'gift',
      content:    'известный даритель',
      reception:  'declined',
    });
    const giftId = mem.declined()[0].act.giftId;

    assert.throws(
      () => mem.repent(giftId),
      /unknown|чужой/,
      'нельзя каяться за чужой принятый дар',
    );
  });

  await t.test('repent для несуществующего giftId бросает ошибку', () => {
    const mem = new GiftMemory(['_koinon']);
    assert.throws(
      () => mem.repent('gift-nonexistent-xyz'),
      /не найден/,
    );
  });

  await t.test('repent для unknown но не в _koinon бросает ошибку', () => {
    const mem = new GiftMemory(['_koinon', 'Дионисий']);
    mem.receive({
      giverId:    'unknown',
      receiverId: 'Дионисий',
      weight:     1,
      type:       'gift',
      content:    'неизвестный к лицу, не к общине',
      reception:  'declined',
    });
    const giftId = mem.declined()[0].act.giftId;

    assert.throws(
      () => mem.repent(giftId),
      /_koinon/,
    );
  });

  await t.test('arity-dispatch: repent(giverId, receiverId) — прежний контракт сохранён', () => {
    const mem = new GiftMemory(['А', 'Б']);
    mem.receive({
      giverId: 'А', receiverId: 'Б', weight: 2,
      type: 'gift', content: '', reception: 'declined',
    });
    const accepted = mem._repentPair('А', 'Б');
    assert.equal(accepted, 1, 'парный repent принимает declined → W');
    assert.ok(mem.thread('А', 'Б').weight > 0);
  });

  await t.test('repent — gift:repented событие, если eventBus подключён', () => {
    const mem = new GiftMemory(['_koinon']);
    const events = [];
    mem._eventBus = { emit: (type, ev) => events.push({ type, ev }) };

    mem.receive({
      giverId:    'unknown',
      receiverId: '_koinon',
      weight:     7,
      type:       'gift',
      content:    'для шины',
      reception:  'declined',
    });
    const giftId = mem.declined()[0].act.giftId;
    mem.repent(giftId);

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'gift:repented');
    assert.equal(events[0].ev.giverId, '_abyss');
    assert.equal(events[0].ev.reversedFrom, giftId);
  });

  await t.test('snapshot сохраняет metanoiaActs', () => {
    const mem = new GiftMemory(['_koinon']);
    mem.receive({
      giverId:    'unknown',
      receiverId: '_koinon',
      weight:     4,
      type:       'gift',
      content:    'для снапшота',
      reception:  'declined',
    });
    const giftId = mem.declined()[0].act.giftId;
    mem.repent(giftId);

    const snap = mem.snapshot();
    assert.equal(snap.metanoiaActs.length, 1);
    assert.equal(snap.metanoiaActs[0].giverId,    '_abyss');
    assert.equal(snap.metanoiaActs[0].receiverId, '_koinon');

    const mem2 = GiftMemory.fromSnapshot(snap);
    assert.equal(mem2.metanoiaActs().length, 1);
    assert.equal(mem2.metanoiaActs()[0].reversedFrom, giftId);
  });
});
