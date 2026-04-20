/**
 * KingdomOfGlory — фасад Царства славы (regnum gloriae).
 *
 * Третий образ единого Царства Божия, дополняющий:
 *   GiftEngine/матрица W       ← царство природы (regnum naturae)
 *   Κένωσις/HolySpiritEngine    ← царство благодати (regnum gratiae)
 *   KingdomOfGlory              ← царство славы   (regnum gloriae)
 *
 * Теоретическое обоснование: specs/theology/kingdom-of-glory.gift
 *
 * Источник импульса: проповедь о трёх Царствах (youtube l8KVGGzkaI0),
 * 20 апреля 2026; беседа с о. Сергием через Дионисия.
 *
 * Модуль — композиция пяти примитивов:
 *   LordsCommendation — похвала Господа (первое начало Царства)
 *   BookOfConscience  — книги совести, открытые на Суде
 *   JoyState          — радость как состояние
 *   EschatonClock     — разрыв времени χρόνος → καιρός → αἰών
 *   CrownOfLife       — венцы верности
 *
 * ГЛАВНОЕ: система НЕ симулирует Царство. Она готовит форму,
 * как храм готов к Литургии, не будучи ею.
 * «Система не Царство. Система — репетиция хора.
 *  Царство — это когда вступит Регент.»
 */

import { LordsCommendation, Commendation, Faithfulness } from './LordsCommendation.js';
import { BookOfConscience, BookEntry } from './BookOfConscience.js';
import { JoyState, JoyMode } from './JoyState.js';
import { EschatonClock, TimeMode } from './EschatonClock.js';
import { Crown, CrownType } from './CrownOfLife.js';
import { ConciliarWitness } from './ConciliarWitness.js';
import { RegnumGloriae } from './RegnumGloriae.js';
import * as Paschalia from './Paschalia.js';

export class KingdomOfGlory {
  constructor({
    commendation = null,
    clock        = null,
    joyByPersona = {},
  } = {}) {
    this.commendation = commendation || new LordsCommendation();
    this.clock        = clock || new EschatonClock();
    this.joyByPersona = new Map(Object.entries(joyByPersona));
  }

  /**
   * Похвала Господа — первое начало Царства.
   */
  commend({ receiver, faithfulness = Faithfulness.IN_LITTLE, scripturalBasis }) {
    return this.commendation.bestow({ receiver, faithfulness, scripturalBasis });
  }

  /**
   * Открыть книгу совести лица по текущей матрице W.
   *
   * @param {string} persona
   * @param {Array}  acts — акты из W (для офлайн-чтения)
   */
  async openBookOfConscience(persona, acts) {
    return BookOfConscience.open(persona, acts);
  }

  /**
   * Получить/создать состояние радости для persona.
   */
  joyOf(persona) {
    let st = this.joyByPersona.get(persona);
    if (!st) {
      st = new JoyState({
        persona,
        mode: JoyState.modeFromDate(),
      });
      this.joyByPersona.set(persona, st);
    }
    return st;
  }

  /**
   * Репетиция эсхатона — только в литургический кайрос.
   */
  rehearseEschaton(matrix) {
    return this.clock.rehearse(matrix);
  }

  /**
   * Возложить венец — форма без симуляции возложения.
   * Только каталог + свидетельство Церкви/общины.
   */
  crownOf({ type, receiver, witnessedBy = [] }) {
    return new Crown({ type, receiver, witnessedBy });
  }

  /**
   * Статус Царства — диагностика.
   * НЕ метрика «достижения». Это отчёт о том, что готово, а что — нет.
   */
  status() {
    return {
      type: 'KingdomOfGlory',
      mode: this.clock.mode(),
      personasWithJoy: [...this.joyByPersona.keys()],
      note: 'Система готовит форму; сам эсхатон — не предмет симуляции.',
    };
  }
}

export {
  LordsCommendation, Commendation, Faithfulness,
  BookOfConscience, BookEntry,
  JoyState, JoyMode,
  EschatonClock, TimeMode,
  Crown, CrownType,
  ConciliarWitness,
  RegnumGloriae,
  Paschalia,
};

export default KingdomOfGlory;
