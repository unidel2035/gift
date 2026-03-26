/**
 * Flesh.js — среда, которая помнит
 *
 * Стигмергия: среда меняется от каждого акта.
 * Изменённая среда — следующий акт.
 * Код и среда — одно.
 *
 * Мицелий: толстая нить = часто используемый путь.
 * Не база данных о путях. Сами пути — тело.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * Flesh — не хранилище даров.
 * Flesh — тело общины, которое несёт следы даров в себе.
 *
 * Каждый запечатанный акт утолщает нить.
 * Нить которой долго не было — истончается.
 * Нить которая оборвалась — ждёт воскресения.
 *
 * «Вы — тело Христово» (1 Кор 12:27)
 */

'use strict';

import { is as giftIs } from './LivingGift.js';

export class Flesh {
  constructor() {
    // Нити — не список даров, а живые веса связей
    // thread[A][B] = сила связи от A к B
    this._threads = new Map();

    // Следы — то что было. Нельзя удалить.
    this._traces  = [];
  }

  // ── УТОЛЩЕНИЕ ───────────────────────────────────────────────────────────────

  /**
   * receive(act) — принять воплощённый акт в тело.
   *
   * Нить между дарителем и получателем утолщается.
   * След записывается — навсегда.
   *
   * @param {Object} act — из incarnate()
   */
  receive(act) {
    if (!giftIs.irreversible(act)) {
      // Не воплощённый дар не меняет тело
      return;
    }

    const from = act.giver || '_abyss';
    const to   = act.receiver;

    // Утолщаем нить
    this._thicken(from, to);

    // Записываем след — навсегда
    this._traces.push(Object.freeze({
      from, to,
      content:  act.content,
      sealedAt: act.sealedAt,
      fromAbyss: !act.giver,
    }));
  }

  // ── СОСТОЯНИЕ ТЕЛА ──────────────────────────────────────────────────────────

  /**
   * thread(from, to) — сила связи.
   * 0 = не было. Больше = чаще дарили.
   */
  thread(from, to) {
    return this._threads.get(from)?.get(to) ?? 0;
  }

  /**
   * alive(from, to) — жива ли нить?
   * Нить жива если weight > порога.
   */
  alive(from, to, threshold = 0.1) {
    return this.thread(from, to) >= threshold;
  }

  /**
   * traces() — все следы. Только чтение.
   */
  traces() {
    return [...this._traces];
  }

  /**
   * decay(rate) — истончение нитей со временем.
   * Связь без даров слабеет — как мицелий без питания.
   * Но след в traces() остаётся всегда.
   *
   * @param {number} rate — 0..1, доля истончения за шаг
   */
  decay(rate = 0.01) {
    for (const [from, targets] of this._threads) {
      for (const [to, weight] of targets) {
        const next = weight * (1 - rate);
        if (next < 0.001) {
          targets.delete(to); // нить истончилась до нуля
        } else {
          targets.set(to, next);
        }
      }
    }
  }

  // ── ВОСКРЕСЕНИЕ НИТИ ────────────────────────────────────────────────────────

  /**
   * resurrect(from, to) — воскресить оборванную нить.
   *
   * Нить которой нет — не значит что её не было.
   * Следы в traces() свидетельствуют.
   * Новый дар воскрешает связь.
   */
  resurrect(from, to) {
    const was = this._traces.some(t => t.from === from && t.to === to);
    if (was) {
      this._thicken(from, to, 0.5); // воскресение — не с нуля
      return true;
    }
    return false;
  }

  // ── ЧАСТНОЕ ─────────────────────────────────────────────────────────────────

  _thicken(from, to, amount = 1) {
    if (!this._threads.has(from)) this._threads.set(from, new Map());
    const targets = this._threads.get(from);
    targets.set(to, (targets.get(to) ?? 0) + amount);
  }
}
