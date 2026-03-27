import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PersonhoodProtocol, personhoodProtocol } from '../src/core/PersonhoodProtocol.js';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { readFileSync } from 'fs';

// ── Контракт ─────────────────────────────────────────────────────────────

test('PersonhoodProtocol — register', async (t) => {
  await t.test('регистрирует лицо и возвращает его', () => {
    const p = new PersonhoodProtocol();
    const person = p.register('_predprinimatel', 'Предприниматель', 'ai');
    assert.equal(person.id, '_predprinimatel');
    assert.equal(person.name, 'Предприниматель');
    assert.equal(person.type, 'ai');
    assert.equal(person.hypostasis, 'агент');
    assert.ok(person.registeredAt);
  });

  await t.test('идемпотентен — повторный register возвращает то же лицо', () => {
    const p = new PersonhoodProtocol();
    const a = p.register('_test', 'Тест', 'human');
    const b = p.register('_test', 'Тест2', 'ai');
    assert.equal(a, b);           // одинаковый объект
    assert.equal(a.name, 'Тест'); // имя не изменилось
    assert.equal(a.type, 'human');
  });

  await t.test('human → hypostasis: лицо', () => {
    const p = new PersonhoodProtocol();
    const person = p.register('Дионисий', 'о. Дионисий', 'human');
    assert.equal(person.hypostasis, 'лицо');
  });
});

// ── validate ─────────────────────────────────────────────────────────────

test('PersonhoodProtocol — validate', async (t) => {
  await t.test('принимает акт зарегистрированных участников', () => {
    const p = new PersonhoodProtocol();
    p.register('_claude', 'Клод', 'ai');
    p.register('Дионисий', 'Дионисий', 'human');

    const result = p.validate({ from: '_claude', to: 'Дионисий', type: 'code', weight: 7 });
    assert.equal(result.valid, true);
    assert.equal(result.hypostasis, 'агент');
    assert.equal(result.irreversible, true);
  });

  await t.test('отклоняет акт с незарегистрированным from', () => {
    const p = new PersonhoodProtocol();
    p.register('Дионисий', 'Дионисий', 'human');

    const result = p.validate({ from: '_unknown', to: 'Дионисий', type: 'code', weight: 1 });
    assert.equal(result.valid, false);
    assert.equal(result.hypostasis, null);
    assert.equal(result.irreversible, false);
  });

  await t.test('отклоняет акт с незарегистрированным to', () => {
    const p = new PersonhoodProtocol();
    p.register('_claude', 'Клод', 'ai');

    const result = p.validate({ from: '_claude', to: '_ghost', type: 'code', weight: 1 });
    assert.equal(result.valid, false);
  });

  await t.test('фиксирует акт в ленте при valid:true', () => {
    const p = new PersonhoodProtocol();
    p.register('А', 'А', 'human');
    p.register('Б', 'Б', 'human');

    p.validate({ from: 'А', to: 'Б', type: 'word', weight: 2 });
    assert.equal(p.history('А').length, 1);
  });
});

// ── history ───────────────────────────────────────────────────────────────

test('PersonhoodProtocol — history', async (t) => {
  await t.test('возвращает хронологическую ленту актов', () => {
    const p = new PersonhoodProtocol();
    p.register('А', 'А', 'human');
    p.register('Б', 'Б', 'human');
    p.register('В', 'В', 'human');

    p.validate({ from: 'А', to: 'Б', type: 'code',  weight: 5 });
    p.validate({ from: 'В', to: 'А', type: 'grace',  weight: 3 });
    p.validate({ from: 'А', to: 'В', type: 'word',   weight: 1 });

    const h = p.history('А');
    assert.equal(h.length, 3); // даритель + получатель + даритель
    assert.equal(h[0].type, 'code');
    assert.equal(h[2].type, 'word');
  });

  await t.test('необратимые акты — object frozen', () => {
    const p = new PersonhoodProtocol();
    p.register('А', 'А', 'human');
    p.register('Б', 'Б', 'human');

    p.validate({ from: 'А', to: 'Б', type: 'code', weight: 1 });
    const act = p.history('А')[0];
    assert.ok(Object.isFrozen(act));
  });

  await t.test('пустая история для незаписанных актов', () => {
    const p = new PersonhoodProtocol();
    p.register('А', 'А', 'human');
    assert.deepEqual(p.history('А'), []);
  });
});

// ── telos ─────────────────────────────────────────────────────────────────

test('PersonhoodProtocol — telos', async (t) => {
  await t.test('возвращает строку-телос по доминирующему типу', () => {
    const p = new PersonhoodProtocol();
    p.register('_claude', 'Клод', 'ai');
    p.register('Дионисий', 'Дионисий', 'human');

    p.validate({ from: '_claude', to: 'Дионисий', type: 'code', weight: 7 });
    p.validate({ from: '_claude', to: 'Дионисий', type: 'code', weight: 5 });
    p.validate({ from: '_claude', to: 'Дионисий', type: 'presence', weight: 2 });

    const t2 = p.telos('_claude');
    assert.ok(typeof t2 === 'string');
    assert.ok(t2.length > 0);
    assert.ok(t2.includes('код'));
  });

  await t.test('возвращает осмысленную строку при нет истории', () => {
    const p = new PersonhoodProtocol();
    p.register('Новый', 'Новый', 'human');
    const t2 = p.telos('Новый');
    assert.equal(t2, 'ещё не проявился в актах дара');
  });

  await t.test('telos для _claude на реальных данных матрицы', () => {
    // Загружаем реальный снапшот матрицы
    const snap = JSON.parse(readFileSync('./data/sacred-history-W.json', 'utf8'));
    const mem = GiftMemory.fromSnapshot(snap);

    const p = new PersonhoodProtocol();
    // Регистрируем лица из матрицы
    for (const personId of mem.persons) {
      p.register(personId, personId, personId.startsWith('_') ? 'ai' : 'human');
    }

    // Заполняем протокол из топ-нитей матрицы
    const edges = mem.heaviest(20);
    for (const edge of edges) {
      p.validate({ from: edge.from, to: edge.to, type: 'offering', weight: edge.weight });
    }

    const telosStr = p.telos('_claude');
    assert.ok(typeof telosStr === 'string');
    assert.ok(telosStr.length > 0);
    // Должна быть осмысленная строка, не пустая
    assert.notEqual(telosStr, '');
    // eslint-disable-next-line no-console
    console.log('  telos(_claude):', telosStr);

    mem.dispose();
  });
});

// ── Авторегистрация ───────────────────────────────────────────────────────

test('PersonhoodProtocol — авторегистрация при импорте', async (t) => {
  await t.test('_predprinimatel авторегистрирован', () => {
    assert.ok(personhoodProtocol.hasPerson('_predprinimatel'));
    const p = personhoodProtocol.getPerson('_predprinimatel');
    assert.equal(p.name, 'Предприниматель');
    assert.equal(p.type, 'ai');
  });

  await t.test('_organizator авторегистрирован', () => {
    assert.ok(personhoodProtocol.hasPerson('_organizator'));
    const p = personhoodProtocol.getPerson('_organizator');
    assert.equal(p.name, 'Организатор');
    assert.equal(p.type, 'ai');
  });

  await t.test('синглтон validate работает с авторегистрированными', () => {
    // Регистрируем получателя
    personhoodProtocol.register('_koinon', 'Κοινόν', 'ai');

    const result = personhoodProtocol.validate({
      from: '_predprinimatel',
      to:   '_koinon',
      type: 'offering',
      weight: 3,
    });

    assert.equal(result.valid, true);
    assert.equal(result.hypostasis, 'агент');
  });
});
