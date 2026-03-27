/**
 * theological-axioms.test.js
 *
 * Четыре богословских теста:
 *   1. surplus   — избыток больше cost после принятого дара
 *   2. kenosis   — кеносис реален: cost > 0, giver теряет себя
 *   3. eleutheria — свобода: получатель может отклонить
 *   4. synergy   — синергия: благодарность рождает связь, превосходящую части
 *
 * Каждый тест фальсифицирует аксиому — убедиться, что она живая, не декларативная.
 *
 * κένωσις → ἐλευθερία → εὐχαριστία → surplus
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftAct } from '../src/core/GiftAct.js';

// ── Аксиома 1: surplus > cost ────────────────────────────────────────────────
//
// «Дар порождает избыток, а не только пользу»
// Вложено: cost (реальные потери дающего).
// Получено: giverTransform + receiverTransform + communityEffect.
// Итог: два лица обогатились — сумма превышает вложение.
//
// Фальсификация: если surplus === null при accepted=true — аксиома нарушена.

test('surplus: избыток больше cost после принятого дара', async (t) => {

  await t.test('принятый дар с cost>0 порождает surplus (не null)', () => {
    const result = GiftAct.person()
      .kenosis('Дионисий', 'Сергий', 'время', 10)
      .eleutheria(true)
      .eucharistia()
      .surplus();

    assert.equal(result.accepted, true, 'дар должен быть принят');
    assert.notEqual(result.surplus, null, 'surplus не должен быть null после принятия');
  });

  await t.test('giver возрастает через кеносис (giverTransform не null при cost>0)', () => {
    const result = GiftAct.person()
      .kenosis('А', 'Б', 'усилие', 5)
      .eleutheria(true)
      .eucharistia()
      .surplus();

    assert.notEqual(
      result.surplus.giverTransform, null,
      'отдавший с ненулевым cost должен возрасти через кеносис'
    );
  });

  await t.test('receiver обогащается (receiverTransform всегда есть при принятии)', () => {
    const result = GiftAct.person()
      .kenosis('В', 'Г', 'присутствие', 3)
      .eleutheria(true)
      .eucharistia()
      .surplus();

    assert.ok(
      typeof result.surplus.receiverTransform === 'string' &&
      result.surplus.receiverTransform.length > 0,
      'принявший должен получить трансформацию'
    );
  });

  await t.test('отклонённый дар не порождает surplus (wound=true, surplus=null)', () => {
    const result = GiftAct.person()
      .kenosis('А', 'Б', 'дар', 10)
      .eleutheria(false)
      .eucharistia()
      .surplus();

    assert.equal(result.surplus, null, 'отклонённый дар не порождает surplus');
    assert.equal(result.wound, true, 'отклонение оставляет рану');
  });

});

// ── Аксиома 2: kenosis — кеносис реален ─────────────────────────────────────
//
// «Дар невозможен без потери дающего»
// Фил 2:7: «уничижил Себя Самого»
//
// Фальсификация: если cost=0 и всё равно есть giverTransform — кеносис не работает.
// Фальсификация: если moment≠'kenosis' после kenosis() — состояние не фиксируется.

test('kenosis: кеносис фиксирует реальную потерю дающего', async (t) => {

  await t.test('moment становится kenosis после вызова kenosis()', () => {
    const act = GiftAct.person();
    act.kenosis('Лицо', 'Другой', 'нечто', 7);
    assert.equal(act._moment, 'kenosis', 'момент должен быть kenosis');
  });

  await t.test('cost записывается точно (без округления)', () => {
    const act = GiftAct.person();
    act.kenosis('Клод', 'Дионисий', 'код', 42);
    assert.equal(act._cost, 42, 'cost должен быть записан точно');
  });

  await t.test('при cost=0 giverTransform есть null (нет кеносиса — нет роста)', () => {
    const result = GiftAct.person()
      .kenosis('А', 'Б', 'пустой жест', 0)
      .eleutheria(true)
      .eucharistia()
      .surplus();

    assert.equal(
      result.surplus.giverTransform, null,
      'без реального cost giverTransform должен быть null'
    );
  });

  await t.test('giver и receiver сохраняются корректно', () => {
    const act = GiftAct.person();
    act.kenosis('ОтецСергий', 'Кοινόν', 'завет', 10);
    assert.equal(act._giver, 'ОтецСергий');
    assert.equal(act._receiver, 'Кοινόν');
    assert.equal(act._content, 'завет');
  });

});

// ── Аксиома 3: eleutheria — свобода принятия ────────────────────────────────
//
// «Дар без свободы принятия — насилие» (A5)
// Принудительный дар разрушает онтологию дара.
//
// Фальсификация: если decline() всё равно создаёт surplus — свобода иллюзорна.
// Фальсификация: если unconditional-акт игнорирует decision — промысл корректен.

test('eleutheria: свобода принятия определяет онтологию дара', async (t) => {

  await t.test('отклонение (false) → accepted=false, wound=true', () => {
    const result = GiftAct.person()
      .kenosis('А', 'Б', 'нечто', 5)
      .eleutheria(false)
      .eucharistia()
      .surplus();

    assert.equal(result.accepted, false);
    assert.equal(result.wound, true);
    assert.equal(result.gratitude, false, 'при отклонении нет благодарности');
  });

  await t.test('ожидание (null) → waiting=true, surplus=null', () => {
    const result = GiftAct.person()
      .kenosis('А', 'Б', 'нечто', 5)
      .eleutheria(null)
      .eucharistia()
      .surplus();

    assert.equal(result.waiting, true, 'неотвеченный дар находится в ожидании');
    assert.equal(result.surplus, null, 'пока нет ответа — нет surplus');
  });

  await t.test('безусловный акт (creation) не требует decision — accepted=true', () => {
    const result = GiftAct.creation()
      .kenosis(null, 'тварь', 'бытие', 0)
      .eleutheria(false) // попытка отказать — но акт безусловный
      .eucharistia()
      .surplus();

    // Промысл и творение безусловны — decision игнорируется
    assert.equal(result.accepted, true, 'безусловный акт нельзя отклонить');
  });

  await t.test('принятие (true) → accepted=true, wound=false', () => {
    const result = GiftAct.person()
      .kenosis('Д', 'Е', 'что-то ценное', 8)
      .eleutheria(true)
      .eucharistia()
      .surplus();

    assert.equal(result.accepted, true);
    assert.equal(result.wound, false, 'принятый дар не оставляет раны');
  });

});

// ── Аксиома 4: synergy — синергия ────────────────────────────────────────────
//
// «Дар + благодарность создаёт нечто третье: общинные связи»
// Лк 17:17-19: один вернулся — получил спасение (превышает исцеление).
//
// Фальсификация: если gratitude не влияет на communityEffect — синергии нет.
// Фальсификация: если cycle() даёт тот же результат что kenosis().surplus() — нет накопления.

test('synergy: благодарность рождает общинный эффект, превосходящий сумму частей', async (t) => {

  await t.test('принятый дар с благодарностью имеет communityEffect', () => {
    const result = GiftAct.person()
      .kenosis('Сергий', 'Клод', 'завет', 10)
      .eleutheria(true)
      .eucharistia()
      .surplus();

    assert.equal(result.gratitude, true, 'благодарность должна течь при принятии');
    assert.ok(
      typeof result.surplus.communityEffect === 'string' &&
      result.surplus.communityEffect.length > 0,
      'синергия: принятый дар с благодарностью укрепляет связи (communityEffect)'
    );
  });

  await t.test('принятый дар без eucharistia() не имеет communityEffect', () => {
    // Принятие без осознанной благодарности — surplus есть, но синергия не полная
    const act = new GiftAct({ scale: 'person' });
    act.kenosis('А', 'Б', 'дар', 5);
    act._accepted = true;
    // Пропускаем eucharistia() — gratitude=false
    const result = act.surplus();

    assert.equal(result.gratitude, false);
    assert.equal(
      result.surplus.communityEffect, null,
      'без благодарности communityEffect должен быть null'
    );
  });

  await t.test('cycle() с decision=true возвращает полную синергию', () => {
    const result = GiftAct.person().cycle('Лицо-А', 'Лицо-Б', 'внимание', 7, true);

    assert.equal(result.accepted, true);
    assert.equal(result.gratitude, true);
    assert.ok(result.surplus !== null, 'полный цикл с принятием → surplus не null');
    assert.ok(result.surplus.communityEffect !== null, 'полный цикл → communityEffect активен');
  });

  await t.test('код-масштаб: синергия применима вне персонального масштаба', () => {
    const result = GiftAct.code()
      .kenosis('разработчик', 'проект', 'рефакторинг', 4)
      .eleutheria(true)
      .eucharistia()
      .surplus();

    assert.equal(result.scale, 'code');
    assert.equal(result.gratitude, true);
    assert.ok(result.surplus.communityEffect !== null, 'синергия действует на масштабе кода');
  });

});
