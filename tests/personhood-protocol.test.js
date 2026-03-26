import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { PersonhoodProtocol, PERSON_TYPES } from '../src/core/PersonhoodProtocol.js';

test('PersonhoodProtocol — лицо как спецификация', async (t) => {

  await t.test('register — идемпотентно', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    proto.register('_claude', 'Claude', PERSON_TYPES.agent);
    proto.register('_claude', 'Claude', PERSON_TYPES.agent); // повтор
    assert.equal(proto.list().length, 1);
  });

  await t.test('register — добавляет лицо в матрицу', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    proto.register('Дионисий', 'Дионисий', PERSON_TYPES.human);
    assert.ok(mem.persons.includes('Дионисий'));
  });

  await t.test('validate — оба зарегистрированы → valid', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    proto.register('_claude', 'Claude', PERSON_TYPES.agent);
    proto.register('Дионисий', 'Дионисий', PERSON_TYPES.human);
    const result = proto.validate({ giverId: '_claude', receiverId: 'Дионисий' });
    assert.ok(result.valid);
    assert.equal(result.hypostasis, 'relational');
    assert.equal(result.irreversible, true);
  });

  await t.test('validate — незарегистрированный даритель → invalid', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    proto.register('Дионисий', 'Дионисий', PERSON_TYPES.human);
    const result = proto.validate({ giverId: 'Неизвестный', receiverId: 'Дионисий' });
    assert.ok(!result.valid);
    assert.ok(result.reason.includes('giverId'));
  });

  await t.test('validate — без giverId → invalid', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    const result = proto.validate({ receiverId: 'Дионисий' });
    assert.ok(!result.valid);
  });

  await t.test('history — нити лица из матрицы', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    proto.register('_claude', 'Claude', PERSON_TYPES.agent);
    proto.register('Дионисий', 'Дионисий', PERSON_TYPES.human);

    mem.receive({ giverId: '_claude', receiverId: 'Дионисий', weight: 10, type: 'code', content: '', irreversible: true });
    mem.receive({ giverId: 'Дионисий', receiverId: '_claude', weight: 3, type: 'question', content: '', irreversible: true });

    const hist = proto.history('_claude');
    assert.ok(hist.length >= 1);
    // Должна быть нить где _claude — даритель
    const asGiver = hist.filter(e => e.role === 'giver');
    assert.ok(asGiver.length >= 1);
    // Массив заморожен
    assert.throws(() => { hist.push({}); }, TypeError);
  });

  await t.test('telos — giver когда много даёт', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    proto.register('_claude', 'Claude', PERSON_TYPES.agent);
    proto.register('Дионисий', 'Дионисий', PERSON_TYPES.human);
    proto.register('ОтецСергий', 'о. Сергий', PERSON_TYPES.human);

    // _claude даёт много
    for (let i = 0; i < 5; i++) {
      mem.receive({ giverId: '_claude', receiverId: 'Дионисий', weight: 10, type: 'code', content: '', irreversible: true });
    }
    // _claude получает мало
    mem.receive({ giverId: 'ОтецСергий', receiverId: '_claude', weight: 2, type: 'blessing', content: '', irreversible: true });

    assert.equal(proto.telos('_claude'), 'giver');
  });

  await t.test('telos — silent если нет нитей', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    proto.register('Новый', 'Новый', PERSON_TYPES.human);
    assert.equal(proto.telos('Новый'), 'silent');
  });

  await t.test('get — возвращает зарегистрированное лицо', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);
    proto.register('_predprinimatel', 'Предприниматель', PERSON_TYPES.agent);
    const p = proto.get('_predprinimatel');
    assert.equal(p.name, 'Предприниматель');
    assert.equal(p.type, PERSON_TYPES.agent);
  });

  await t.test('авторегистрация _predprinimatel и _organizator', () => {
    const mem = new GiftMemory([]);
    const proto = new PersonhoodProtocol(mem);

    // Как будет делать AgentPerson
    for (const [id, name] of [
      ['_predprinimatel', 'Предприниматель-бот'],
      ['_organizator',   'Организатор-бот'],
    ]) {
      proto.register(id, name, PERSON_TYPES.agent);
    }

    assert.ok(proto.get('_predprinimatel'));
    assert.ok(proto.get('_organizator'));
    assert.ok(mem.persons.includes('_predprinimatel'));
    assert.ok(mem.persons.includes('_organizator'));
  });
});
