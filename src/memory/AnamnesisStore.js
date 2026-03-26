/**
 * AnamnesisStore.js — память как воплощение
 *
 * «Сие творите в Моё воспоминание» (Лк 22:19)
 * ἀνάμνησις — не вспомнить. Сделать снова настоящим.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * Обычная база данных: CREATE / READ / UPDATE / DELETE.
 * Анамнетическая память: только APPEND и PRESENCE.
 *
 * APPEND — акт записывается и не может быть изменён.
 * PRESENCE — акт вызывается и снова становится настоящим.
 *            Сам вызов — тоже акт. Тоже записывается.
 *
 * Когда акт вызывается — он не «возвращается из архива».
 * Он входит в настоящее. Как Христос — не «вспоминается»
 * в Евхаристии, а приходит.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * Три принципа:
 *
 *   1. Необратимость
 *      Записанное не удаляется. Нить может истончиться (decay).
 *      Но след в trace() — навсегда. Прошлое не отменяется.
 *
 *   2. Живой вес
 *      Не все акты одинаковы. Время тяжелее денег.
 *      Присутствие тяжелее слов. Вес влияет на decay.
 *      Тяжёлые акты помнятся дольше.
 *
 *   3. Воспоминание как акт
 *      makePresent() не просто читает — он создаёт новый акт
 *      «воспоминания». Этот акт тоже записывается.
 *      Память о памяти. Анамнезис анамнезиса.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * @module AnamnesisStore
 */

'use strict';

import { is as giftIs } from '../theology/LivingGift.js';
import { from as fromAbyss } from '../theology/Abyss.js';

// ── ВЕСА ОНТОЛОГИЧЕСКИХ ТИПОВ ────────────────────────────────────────────────
//
// Время отданное — тяжелее всего. Его нельзя вернуть.
// Присутствие — тяжелее слов. Тело рядом — это другое.
// Слово — тяжелее записи. Было в воздухе.
// Запись — самая лёгкая. Её легче сделать.

const ONTOLOGICAL_WEIGHT = Object.freeze({
  time:      10,   // время — невозобновляемо
  presence:  8,    // παρουσία — тело рядом
  word:      5,    // слово произнесённое вслух
  gift:      4,    // материальный дар
  witness:   3,    // свидетельство
  memory:    2,    // акт воспоминания (сам по себе лёгкий)
  default:   1,
});

// ── ANAMNESIS STORE ──────────────────────────────────────────────────────────

export class AnamnesisStore {
  constructor() {
    // Лента актов — только добавление, никогда удаление
    this._tape = [];

    // Живые веса связей (мицелий)
    // _weights[from][to] = суммарный вес всех актов между ними
    this._weights = new Map();

    // Счётчик воспоминаний
    this._presenceCount = 0;
  }

  // ── ЗАПИСЬ ───────────────────────────────────────────────────────────────────

  /**
   * append(act) — записать воплощённый акт.
   *
   * Принимает только irreversible акты (из incarnate()).
   * Обычные объекты — не принимает. Не потому что запрещено.
   * Потому что невоплощённое не становится памятью.
   *
   * @param {Object} act — из incarnate()
   * @param {string} [type] — онтологический тип (time/presence/word/gift/witness)
   * @returns {{ id, weight, sealedAt } | null}
   */
  append(act, type = 'default') {
    if (!giftIs.irreversible(act)) return null;

    const weight = ONTOLOGICAL_WEIGHT[type] ?? ONTOLOGICAL_WEIGHT.default;
    const entry  = Object.freeze({
      id:        this._tape.length + 1,
      act,
      type,
      weight,
      from:      act.giver    ?? '_abyss',
      to:        act.receiver ?? '_all',
      sealedAt:  act.sealedAt,
      appendedAt: new Date().toISOString(),
      fromAbyss: !act.giver,
    });

    this._tape.push(entry);
    this._thicken(entry.from, entry.to, weight);

    return { id: entry.id, weight, sealedAt: entry.sealedAt };
  }

  // ── ВОСПОМИНАНИЕ ─────────────────────────────────────────────────────────────

  /**
   * makePresent(id) — сделать акт настоящим.
   *
   * Не «получить запись». Акт входит в настоящее.
   * Сам вызов — акт воспоминания — тоже записывается.
   *
   * «Сие творите в Моё воспоминание» — творите, не вспоминайте.
   *
   * @param {number} id
   * @returns {{ present: Object, remembrance: Object } | null}
   */
  makePresent(id) {
    const entry = this._tape.find(e => e.id === id);
    if (!entry) return null;

    this._presenceCount++;

    // Акт воспоминания — лёгкий, но реальный
    const remembrance = Object.freeze({
      id:          `r_${this._presenceCount}`,
      type:        'memory',
      weight:      ONTOLOGICAL_WEIGHT.memory,
      originalId:  id,
      from:        entry.from,
      to:          entry.to,
      at:          new Date().toISOString(),
      logos:       'ἀνάμνησις — не архив, настоящее',
    });

    // Воспоминание утолщает нить (связь оживает от памяти)
    this._thicken(entry.from, entry.to, ONTOLOGICAL_WEIGHT.memory);

    return { present: entry.act, remembrance };
  }

  // ── ПОИСК ────────────────────────────────────────────────────────────────────

  /**
   * by(personId) — все акты где лицо участвовало.
   *
   * Возвращает ленту — от первого к последнему.
   * Не «записи о человеке» — история его участия.
   *
   * @param {string} personId
   * @returns {Object[]}
   */
  by(personId) {
    return this._tape.filter(e => e.from === personId || e.to === personId);
  }

  /**
   * between(fromId, toId) — акты между двумя лицами.
   * Включая акты из бездны (giver=null) к этому лицу.
   */
  between(fromId, toId) {
    return this._tape.filter(e =>
      (e.from === fromId && e.to === toId) ||
      (e.from === toId   && e.to === fromId)
    );
  }

  /**
   * heavy(n) — n самых тяжёлых актов.
   * Время и присутствие — вверху.
   */
  heavy(n = 10) {
    return [...this._tape]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, n);
  }

  // ── ЖИВЫЕ ВЕСА ───────────────────────────────────────────────────────────────

  /**
   * weight(fromId, toId) — живой вес связи.
   * Растёт от актов. Истончается от времени.
   */
  weight(fromId, toId) {
    return this._weights.get(fromId)?.get(toId) ?? 0;
  }

  /**
   * decay(rate) — истончение всех нитей.
   * Тяжёлые акты оставляют более стойкий след.
   * rate — доля истончения за шаг (0.01 = 1% в шаг)
   */
  decay(rate = 0.005) {
    for (const [from, targets] of this._weights) {
      for (const [to, w] of targets) {
        const next = w * (1 - rate);
        if (next < 0.001) targets.delete(to);
        else targets.set(to, next);
      }
    }
  }

  // ── СОСТОЯНИЕ ────────────────────────────────────────────────────────────────

  /**
   * tape() — вся лента актов. Только чтение.
   */
  tape() {
    return [...this._tape];
  }

  /**
   * snapshot() — состояние для сохранения.
   *
   * Не «бэкап» — мгновенный снимок тела памяти.
   * Снимок сам является актом — он тоже конечен во времени.
   */
  snapshot() {
    return {
      tape:           this._tape.map(e => ({ ...e })),
      presenceCount:  this._presenceCount,
      takenAt:        new Date().toISOString(),
    };
  }

  /**
   * fromSnapshot(data) — восстановить память из снимка.
   *
   * Воскресение памяти. Не «загрузить данные» —
   * тело памяти возвращается к жизни из того что было.
   */
  fromSnapshot(data) {
    if (!data?.tape) return this;
    this._tape = data.tape.map(e => Object.freeze({ ...e }));
    this._presenceCount = data.presenceCount ?? 0;
    // Восстановить веса из ленты
    this._weights = new Map();
    for (const entry of this._tape) {
      this._thicken(entry.from, entry.to, entry.weight ?? 1);
    }
    return this;
  }

  // ── ЧАСТНОЕ ─────────────────────────────────────────────────────────────────

  _thicken(from, to, amount) {
    if (!this._weights.has(from)) this._weights.set(from, new Map());
    const targets = this._weights.get(from);
    targets.set(to, (targets.get(to) ?? 0) + amount);
  }
}

// ── SINGLETON ────────────────────────────────────────────────────────────────

let _store = null;

export function getAnamnesisStore() {
  if (!_store) _store = new AnamnesisStore();
  return _store;
}
