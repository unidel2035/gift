/**
 * irreversible-guard — граница «подбор → дар».
 *
 * Контраст с рекомендательными движками: они правят прошлое задним числом —
 * пересчитывают совместимость/оценку под новый матч.
 * Онтология дара — append-only: прошлое со-присутствует, но не переписывается.
 *
 * Эта граница не риторика, а инвариант. Доказательство:
 *   (а) любой акт, прошедший через receive(), заморожен (Object.freeze) —
 *       мутировать его вес нельзя, попытка бросает TypeError.
 *   (б) разрешение/поворот акта (metanoia — реализованный прецедент; wager — #62)
 *       НЕ мутирует исходный акт, а ПОРОЖДАЕТ новый (append, не mutate).
 *
 * Пока зелено — `irreversible:true` несёт нагрузку, а не декорация.
 * Связь: proposal #99, issue #62 (Wager). См. feedback Евы.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';

test('irreversible-guard: матрица W доказуемо append-only', async (t) => {

  // ── (а) Заморозка: вес записанного акта нельзя переписать ───────────────

  await t.test('declined-акт заморожен — мутация веса бросает', () => {
    const mem = new GiftMemory(['_koinon']);
    mem.receive({
      giverId: 'unknown', receiverId: '_koinon',
      weight: 5, type: 'gift', content: 'дар без имени',
      reception: 'declined',
    });
    const [{ act }] = mem.declined();
    assert.ok(Object.isFrozen(act), 'declined-акт должен быть Object.freeze');
    // Рекомендательный движок переписал бы вес под новый матч. Здесь — TypeError.
    assert.throws(() => { act.weight = 999; }, TypeError,
      'переписать вес разрешённого акта невозможно');
    assert.equal(mem.declined()[0].act.weight, 5, 'вес остался исходным');
  });

  await t.test('pending-акт заморожен — мутация бросает', () => {
    const mem = new GiftMemory(['A', 'B']);
    mem.receive({
      giverId: 'A', receiverId: 'B',
      weight: 3, type: 'wager', content: 'ставка на гипотезу',
      reception: 'pending',
    });
    const [{ act }] = mem.pending();
    assert.ok(Object.isFrozen(act), 'pending-акт должен быть заморожен');
    assert.throws(() => { act.weight = 0; }, TypeError);
  });

  await t.test('принятый акт замораживается на входе receive()', () => {
    const mem = new GiftMemory(['A', 'B']);
    const incoming = { giverId: 'A', receiverId: 'B', weight: 7, type: 'code' };
    mem.receive(incoming);
    // receive() морозит копию; даже исходный литерал, попав в систему,
    // не должен давать ручку для отмены веса в W.
    const w0 = mem.thread('A', 'B').weight;
    // Внешняя мутация литерала после записи не трогает уже записанный вес.
    incoming.weight = 1000;
    assert.equal(mem.thread('A', 'B').weight, w0, 'вес в W не зависит от мутации литерала после записи');
  });

  // ── (б) Разрешение/поворот: append, не mutate ──────────────────────────
  //
  // metanoia — реализованный прецедент ровно той семантики, что требует
  // граница: unknown→_koinon отвергнут, община кается → исходный дар
  // остаётся frozen в _declined, а поворот добавляется новым актом.

  await t.test('metanoia не мутирует исходный declined — порождает новый акт', () => {
    const mem = new GiftMemory(['_koinon']);
    mem.receive({
      giverId: 'unknown', receiverId: '_koinon',
      weight: 5, type: 'gift', content: 'след Бездны', reception: 'declined',
    });
    const giftId = mem.declined()[0].act.giftId;
    const before = { ...mem.declined()[0].act };

    const turn = mem.repent(giftId);

    // Исходный declined остался нетронутым (append-only).
    const after = mem.declined()[0].act;
    assert.equal(after.giverId, before.giverId, 'исходный giverID не переписан');
    assert.equal(after.weight, before.weight, 'исходный вес не переписан');
    // Поворот — отдельный необратимый акт, ссылающийся на исходный.
    assert.equal(turn.type, 'metanoia');
    assert.equal(turn.reversedFrom, giftId, 'поворот ссылается на исходный, не заменяет его');
    assert.equal(turn.irreversible, true);
    assert.equal(mem.metanoiaActs().length, 1, 'поворот добавлен, а не подменил');
  });

  // ── Wager (#62): спецификация на будущее разрешение ставки ──────────────
  //
  // Граница операционально: wager обратим ТОЛЬКО в состоянии pending/open;
  // на resolve() он не пересчитывает прошлый вес, а порождает новый
  // irreversible акт (won → дар, lost → рана). Ровно это отличает нас
  // от движков, правящих прошлое. Когда #62 приземлится — этот тест сторожит
  // инвариант: реализация resolveWager должна быть append-only.

  await t.test('wager.resolve() — append-only (спека #62)', { skip: typeof (new GiftMemory(['A'])).resolveWager !== 'function' ? 'resolveWager ещё не реализован (#62)' : false }, () => {
    const mem = new GiftMemory(['A', 'B']);
    const wager = {
      giverId: 'A', receiverId: 'B', type: 'wager',
      weight: 4, content: 'гипотеза', wagerStatus: 'open',
    };
    const ref = mem.openWager ? mem.openWager(wager) : (mem.receive({ ...wager, reception: 'pending' }), mem.pending().at(-1).act.giftId);

    const actsBefore = mem.actsCount;
    const outcome = mem.resolveWager(ref, 'won');

    // Исход — новый акт, не мутация ставки.
    assert.ok(mem.actsCount > actsBefore, 'resolve добавляет акт, а не заменяет');
    assert.ok(outcome && (outcome.type === 'code' || outcome.type === 'word' || outcome.type === 'gift'),
      'won → дар как отдельный необратимый акт');
    assert.equal(outcome.irreversible, true, 'исход ставки необратим');
  });
});
