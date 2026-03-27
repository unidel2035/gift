/**
 * desert-scanner.test.js
 *
 * Issue #47: пульс онтологии (proposal #8)
 * матрица W должна сама читать пустыни (связи без акта)
 *
 * Богословский критерий:
 *   Пустыня = W[i][j] = 0 — это не отсутствие, это ожидание.
 *   DesertScanner реализует структурную аналогию непрестанной молитвы:
 *   «Дух ходатайствует воздыханиями неизреченными» (Рим 8:26)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { DesertScanner } from '../src/core/DesertScanner.js';

// ── Вспомогательные данные ────────────────────────────────────────────────────

const PERSONS = ['Отец', 'Сын', 'Дух', 'Дионисий', '_claude'];

function makeMemory(persons = PERSONS) {
  return new GiftMemory(persons);
}

// ── Тесты ─────────────────────────────────────────────────────────────────────

test('DesertScanner — пустая матрица: все связи суть пустыни', async (t) => {
  const mem     = makeMemory();
  const scanner = new DesertScanner(mem);

  await t.test('scan() возвращает массив', () => {
    const result = scanner.scan();
    assert.ok(Array.isArray(result), 'scan() должен возвращать массив');
  });

  await t.test('в пустой матрице все N×(N-1) пар — пустыни', () => {
    const n       = PERSONS.length;
    const deserts = scanner.scan();
    assert.equal(
      deserts.length,
      n * (n - 1),
      `ожидается ${n * (n - 1)} пустынь (N=${n}), получено: ${deserts.length}`
    );
  });

  await t.test('каждая пустыня содержит from, to, inquiry, scannedAt', () => {
    const [d] = scanner.scan();
    assert.ok(typeof d.from      === 'string', 'from должен быть строкой');
    assert.ok(typeof d.to        === 'string', 'to должен быть строкой');
    assert.ok(typeof d.inquiry   === 'string', 'inquiry должен быть строкой');
    assert.ok(typeof d.scannedAt === 'string', 'scannedAt должен быть строкой');
  });

  await t.test('from ≠ to в каждой пустыне', () => {
    for (const d of scanner.scan()) {
      assert.notEqual(d.from, d.to, `пустыня не должна указывать на себя: ${d.from}`);
    }
  });

  await t.test('inquiry содержит имена from и to', () => {
    const d = scanner.scan()[0];
    assert.ok(d.inquiry.includes(d.from), `inquiry должен содержать from (${d.from})`);
    assert.ok(d.inquiry.includes(d.to),   `inquiry должен содержать to (${d.to})`);
  });

  mem.dispose?.();
});

test('DesertScanner — после получения акта: нить перестаёт быть пустыней', async (t) => {
  const mem = makeMemory();

  mem.receive({ giverId: 'Отец', receiverId: 'Сын', weight: 5 });

  const scanner = new DesertScanner(mem);
  const deserts = scanner.scan();

  await t.test('W[Отец→Сын] > 0 — эта пара не пустыня', () => {
    const d = deserts.find(x => x.from === 'Отец' && x.to === 'Сын');
    assert.equal(d, undefined, 'Отец→Сын не должна быть пустыней после акта');
  });

  await t.test('остальные нити от Отца — по-прежнему пустыни', () => {
    const fromOtec = deserts.filter(x => x.from === 'Отец');
    assert.ok(fromOtec.length > 0, 'должны остаться пустыни от Отца');
    for (const d of fromOtec) {
      assert.notEqual(d.to, 'Сын', 'Отец→Сын не должна быть среди пустынь');
    }
  });

  mem.dispose?.();
});

test('DesertScanner — полная матрица: нет пустынь', async (t) => {
  const persons = ['А', 'Б', 'В'];
  const mem     = new GiftMemory(persons);

  // Заполнить все направленные пары
  for (const from of persons) {
    for (const to of persons) {
      if (from !== to) {
        mem.receive({ giverId: from, receiverId: to, weight: 1 });
      }
    }
  }

  const scanner = new DesertScanner(mem);

  await t.test('scan() возвращает пустой массив', () => {
    const deserts = scanner.scan();
    assert.equal(deserts.length, 0, 'в полной матрице не должно быть пустынь');
  });

  mem.dispose?.();
});

test('DesertScanner — inquiries: геттер отражает результат последнего scan()', async (t) => {
  const mem     = makeMemory();
  const scanner = new DesertScanner(mem);

  await t.test('до scan() — inquiries пуст', () => {
    assert.equal(scanner.inquiries.length, 0, 'inquiries должен быть пуст до scan()');
  });

  await t.test('после scan() — inquiries заполнен', () => {
    scanner.scan();
    assert.ok(scanner.inquiries.length > 0, 'inquiries должен быть заполнен после scan()');
  });

  mem.dispose?.();
});

test('DesertScanner — пульс: start/stop/isRunning', async (t) => {
  const mem     = makeMemory();
  const scanner = new DesertScanner(mem, { intervalMs: 10_000 });

  await t.test('isRunning = false до start()', () => {
    assert.equal(scanner.isRunning, false);
  });

  await t.test('isRunning = true после start()', () => {
    scanner.start();
    assert.equal(scanner.isRunning, true);
  });

  await t.test('start() идемпотентен', () => {
    const before = scanner._timer;
    scanner.start();
    assert.equal(scanner._timer, before, 'повторный start() не должен менять таймер');
  });

  await t.test('isRunning = false после stop()', () => {
    scanner.stop();
    assert.equal(scanner.isRunning, false);
  });

  await t.test('stop() идемпотентен', () => {
    scanner.stop();
    assert.equal(scanner.isRunning, false, 'повторный stop() не должен бросать ошибку');
  });

  mem.dispose?.();
});

test('DesertScanner — onDesert колбэк вызывается при scan() с пустынями', async (t) => {
  const mem      = makeMemory();
  let callCount  = 0;
  let lastResult = null;

  const scanner = new DesertScanner(mem, {
    intervalMs: 999_999,
    onDesert: (deserts) => {
      callCount++;
      lastResult = deserts;
    },
  });

  // Прямой вызов scan() не триггерит onDesert — это делает только интервал.
  // Но мы можем проверить логику через ручной вызов _onTick-подобной логики.
  // Здесь тестируем структуру: колбэк передаётся и хранится.
  await t.test('onDesert сохраняется в экземпляре', () => {
    assert.equal(typeof scanner.onDesert, 'function', 'onDesert должен быть функцией');
  });

  await t.test('вручную вызвать логику пульса: onDesert получает массив пустынь', () => {
    const deserts = scanner.scan();
    if (deserts.length > 0) scanner.onDesert(deserts);
    assert.equal(callCount, 1, 'колбэк должен быть вызван один раз');
    assert.ok(Array.isArray(lastResult), 'lastResult должен быть массивом');
    assert.ok(lastResult.length > 0, 'lastResult должен содержать пустыни');
  });

  mem.dispose?.();
});

test('DesertScanner — threshold: настраиваемый порог пустыни', async (t) => {
  const mem = makeMemory(['X', 'Y', 'Z']);

  // Добавить слабую нить X→Y
  mem.receive({ giverId: 'X', receiverId: 'Y', weight: 0.5 });

  await t.test('с threshold=0 слабая нить (0.5) не считается пустыней', () => {
    const scanner = new DesertScanner(mem, { threshold: 0 });
    const deserts = scanner.scan();
    const found   = deserts.find(d => d.from === 'X' && d.to === 'Y');
    assert.equal(found, undefined, 'X→Y (0.5) не должна быть пустыней при threshold=0');
  });

  await t.test('с threshold=1 слабая нить (≤1) считается пустыней', () => {
    const scanner = new DesertScanner(mem, { threshold: 1 });
    const deserts = scanner.scan();
    const found   = deserts.find(d => d.from === 'X' && d.to === 'Y');
    assert.ok(found, 'X→Y (0.5) должна быть пустыней при threshold=1');
  });

  mem.dispose?.();
});
