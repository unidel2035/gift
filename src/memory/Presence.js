/**
 * Presence.js — сделать прошлое настоящим
 *
 * Не поиск. Не retrieval. Не query.
 *
 * Присутствие.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * Три способа чего-то не помнить:
 *   1. Забыл (decay — нить истончилась)
 *   2. Не знал (акт не был записан)
 *   3. Не хочет знать (отворачивание — тоже акт)
 *
 * Три способа сделать настоящим:
 *   1. makePresent(id) — конкретный акт
 *   2. summon(personId) — вся история лица
 *   3. commune(fromId, toId) — история между двумя
 *
 * Каждый из трёх — сам является актом.
 * Записывается в AnamnesisStore как 'memory'.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * «Не говорите: "Кто взойдёт на небо?" — то есть Христа свести.
 *  Но что говорит Писание? "Слово близко к тебе"» (Рим 10:6-8)
 *
 * Память работает так же.
 * Не нужно идти в прошлое — оно рядом.
 * Нужно только открыться ему.
 */

'use strict';

import { AnamnesisStore, getAnamnesisStore } from './AnamnesisStore.js';

export class Presence {
  /**
   * @param {AnamnesisStore} [store]
   */
  constructor(store) {
    this._store = store ?? getAnamnesisStore();
  }

  // ── КОНКРЕТНЫЙ АКТ ───────────────────────────────────────────────────────────

  /**
   * of(id) — сделать конкретный акт настоящим.
   *
   * @param {number} id
   * @returns {{ act, remembrance, weight } | null}
   */
  of(id) {
    const result = this._store.makePresent(id);
    if (!result) return null;

    return {
      act:        result.present,
      remembrance: result.remembrance,
      weight:     this._store.weight(result.present.giver ?? '_abyss', result.present.receiver),
      logos:      'ἀνάμνησις — этот акт снова здесь',
    };
  }

  // ── ИСТОРИЯ ЛИЦА ─────────────────────────────────────────────────────────────

  /**
   * summon(personId) — всё что есть у лица в памяти.
   *
   * Не «записи о человеке».
   * История его участия — хронологически.
   * Самые тяжёлые акты — первыми (они важнее).
   *
   * @param {string} personId
   * @returns {Object[]}
   */
  summon(personId) {
    const entries = this._store.by(personId);
    return entries
      .sort((a, b) => b.weight - a.weight)
      .map(e => ({
        id:       e.id,
        type:     e.type,
        weight:   e.weight,
        from:     e.from,
        to:       e.to,
        content:  e.act?.content,
        sealedAt: e.sealedAt,
      }));
  }

  // ── ИСТОРИЯ МЕЖДУ ДВУМЯ ───────────────────────────────────────────────────────

  /**
   * commune(fromId, toId) — история между двумя лицами.
   *
   * Communion — общение. Не транзакционная история.
   * Сколько они дали друг другу.
   * Как живёт их нить сейчас.
   *
   * @param {string} fromId
   * @param {string} toId
   * @returns {{ acts, totalWeight, currentWeight, logos }}
   */
  commune(fromId, toId) {
    const acts = this._store.between(fromId, toId);
    const totalWeight = acts.reduce((s, e) => s + e.weight, 0);
    const currentWeight = this._store.weight(fromId, toId)
                        + this._store.weight(toId, fromId);

    const logos = currentWeight > 5
      ? 'связь живая — нить толстая'
      : currentWeight > 1
        ? 'связь есть — нить тонкая'
        : acts.length > 0
          ? 'связь была — нить почти истончилась. Resurrection возможно.'
          : 'связи не было';

    return {
      acts:          acts.map(e => ({ id: e.id, type: e.type, weight: e.weight, sealedAt: e.sealedAt })),
      totalWeight,
      currentWeight,
      logos,
    };
  }

  // ── САМОЕ ТЯЖЁЛОЕ ────────────────────────────────────────────────────────────

  /**
   * deepest(n) — n самых тяжёлых актов в памяти.
   * Время и присутствие — вверху.
   *
   * @param {number} [n=7]
   * @returns {Object[]}
   */
  deepest(n = 7) {
    return this._store.heavy(n).map(e => ({
      id:       e.id,
      type:     e.type,
      weight:   e.weight,
      from:     e.from,
      to:       e.to,
      content:  e.act?.content,
      sealedAt: e.sealedAt,
    }));
  }
}
