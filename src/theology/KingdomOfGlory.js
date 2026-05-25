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

  // ── W_slava: тензор явленности ──────────────────────────────────────
  //
  // W_slava — не замена W. Это второе прочтение каждого акта:
  // «как он виден перед Лицом Христа».
  //
  // Структура: { manifestedness: { persona: { act, seenAs, manifestedAt } }, witnesses }
  // Каждая commendation и crown записывается как проявление в W_slava.
  //
  // W хранит вес. W_slava хранит явленность.
  // Совесть = разница между W и W_slava.

  /**
   * Записать акт в тензор явленности (W_slava).
   * @param {string} persona — лицо
   * @param {string} actType — 'commendation' | 'crown' | 'conscience' | 'joy'
   * @param {object} payload — данные акта
   * @param {string} slavaPath — путь к W_slava.json
   */
  async manifestInSlava(persona, actType, payload, slavaPath) {
    const { readFile, writeFile } = await import('node:fs/promises');
    let slava;
    try {
      slava = JSON.parse(await readFile(slavaPath, 'utf8'));
    } catch {
      slava = { _comment: 'W_slava — тензор явленности', manifestedness: {}, witnesses: [] };
    }

    if (!slava.manifestedness[persona]) {
      slava.manifestedness[persona] = [];
    }

    const entry = {
      type: actType,
      payload: typeof payload.toJSON === 'function' ? payload.toJSON() : payload,
      manifestedAt: new Date().toISOString(),
      seenAs: this._seenAs(actType, payload),
    };

    slava.manifestedness[persona].push(entry);
    slava.lastUpdated = new Date().toISOString();
    slava.witnesses.push({
      persona,
      actType,
      at: entry.manifestedAt,
    });

    await writeFile(slavaPath, JSON.stringify(slava, null, 2), 'utf8');
    return entry;
  }

  /**
   * Как акт виден перед Лицом — краткая формула явленности.
   */
  _seenAs(actType, payload) {
    switch (actType) {
      case 'commendation':
        return `похвала: ${payload.entryPhrase || payload.faithfulness || 'в малом верен'}`;
      case 'crown':
        return `венец: ${payload.type || 'vita'}`;
      case 'conscience':
        return `совесть: ${payload.summary || 'нить открыта'}`;
      case 'joy':
        return `радость: ${payload.mode || 'предвкушение'}`;
      default:
        return `${actType}: явлен`;
    }
  }

  /**
   * Прочитать книгу совести лица и записать в W_slava.
   * @param {string} persona
   * @param {Array} acts — акты из W
   * @param {string} slavaPath — путь к W_slava.json
   */
  async openAndManifestConscience(persona, acts, slavaPath) {
    const book = await BookOfConscience.open(persona, acts);
    await this.manifestInSlava(persona, 'conscience', {
      summary: `${book.entries?.length || 0} записей`,
      totalWeight: book.entries?.reduce((s, e) => s + (e.weight || 0), 0) || 0,
    }, slavaPath);
    return book;
  }

  /**
   * Похвала + запись в W_slava.
   */
  async commendAndManifest({ receiver, faithfulness, scripturalBasis, slavaPath }) {
    const c = this.commend({ receiver, faithfulness, scripturalBasis });
    if (slavaPath) {
      await this.manifestInSlava(receiver, 'commendation', c, slavaPath);
    }
    return c;
  }

  /**
   * Венец + запись в W_slava.
   */
  async crownAndManifest({ type, receiver, witnessedBy, slavaPath }) {
    const crown = this.crownOf({ type, receiver, witnessedBy });
    if (slavaPath) {
      await this.manifestInSlava(receiver, 'crown', crown, slavaPath);
    }
    return crown;
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
