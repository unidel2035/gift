/**
 * LordsCommendation — похвала Господа как первое начало Царства славы.
 *
 * «Хорошо, добрый и верный раб; в малом ты был верен, над многим тебя поставлю;
 *  войди в радость господина твоего» (Мф 25:21, 25:23).
 *
 * Первое, что услышит праведник после Суда, — не развёрнутое описание наград,
 * а именно ПОХВАЛУ. Похвала Господа — это уже ἀρχή Царства славы.
 *
 * Не «оценка», не «верификация»: это акт дара от Христа лицу.
 * Необратим. Неотменим. Хранится как вечная координата нити.
 *
 * Богословская тонкость (из проповеди о. Даниила, источник:
 * youtube l8KVGGzkaI0, 2026-04-20):
 *   «Христиане — люди простые. Нам награда нужна. И нам надо,
 *    чтобы нас похвалили — но от Бога.»
 *   Это не тщеславие, а устроение радости — которое еретический стоицизм
 *   изгоняет как «низкое», а православие сохраняет как детское и верное.
 *
 * Архитектурная позиция:
 *   Этот модуль НЕ симулирует Христа. Он лишь предоставляет форму акта,
 *   в который Христос вписывает Свою похвалу — точно так же, как храм
 *   не производит Литургию, а даёт ей место.
 */

import { GiftAct } from '../core/GiftAct.js';

/**
 * Типы верности — по евангельским притчам.
 * Не полная таксономия, а стартовый набор из Мф 25.
 */
export const Faithfulness = Object.freeze({
  IN_LITTLE:      'in-little',       // «в малом ты был верен» (Мф 25:21)
  UNTIL_DEATH:    'until-death',     // «будь верен до смерти» (Откр 2:10)
  IN_STEWARDSHIP: 'in-stewardship',  // домостроительство (Лк 12:42)
  IN_HIDDENNESS:  'in-hiddenness',   // «отец твой, видящий тайное» (Мф 6:6)
  IN_PERSECUTION: 'in-persecution',  // гонимые правды ради (Мф 5:10)
});

/**
 * Commendation — замороженный акт похвалы.
 * Структура:
 *   giver:        'Христос'  (в нашей ойкономии — один Даритель похвалы)
 *   receiver:     кому
 *   faithfulness: тип верности
 *   entryPhrase:  евангельская формула входа
 *   weight:       10  (как ковенантный акт — тяжёлый)
 *   irreversible: true
 *   kind:         'commendation'
 */
export class Commendation {
  constructor({ receiver, faithfulness, scripturalBasis, witnessed = false }) {
    if (!receiver) throw new Error('Commendation: receiver обязателен');
    if (!faithfulness) throw new Error('Commendation: faithfulness обязателен');

    this.giver = 'Христос';
    this.receiver = receiver;
    this.faithfulness = faithfulness;
    this.scripturalBasis = scripturalBasis || 'Мф 25:21';
    this.entryPhrase = Commendation.entryPhraseFor(faithfulness);
    this.weight = 10;
    this.kind = 'commendation';
    this.irreversible = true;
    this.witnessed = witnessed;
    this.timestamp = new Date().toISOString();

    Object.freeze(this);
  }

  /**
   * Евангельская формула входа в радость — по типу верности.
   */
  static entryPhraseFor(faithfulness) {
    switch (faithfulness) {
      case Faithfulness.IN_LITTLE:
        return 'в малом ты был верен, войди в радость господина твоего';
      case Faithfulness.UNTIL_DEATH:
        return 'будь верен до смерти, и дам тебе венец жизни';
      case Faithfulness.IN_STEWARDSHIP:
        return 'верный раб и благоразумный, над имением своим поставлю тебя';
      case Faithfulness.IN_HIDDENNESS:
        return 'Отец твой, видящий тайное, воздаст тебе явно';
      case Faithfulness.IN_PERSECUTION:
        return 'радуйтесь и веселитесь, ибо велика ваша награда на небесах';
      default:
        return 'войди в радость Господа твоего';
    }
  }

  toGiftAct() {
    // Похвала — это дар масштаба salvation (с возможностью молчания,
    // если похвала не высказана — см. Великая Суббота).
    return GiftAct.salvation().cycle(
      this.giver,
      this.receiver,
      this.entryPhrase,
      0,
      true,
      {
        giftType: { domain: 'word', mode: 'covenantal' },
      },
    );
  }

  toJSON() {
    return {
      type: 'Commendation',
      giver: this.giver,
      receiver: this.receiver,
      faithfulness: this.faithfulness,
      entryPhrase: this.entryPhrase,
      scripturalBasis: this.scripturalBasis,
      weight: this.weight,
      kind: this.kind,
      irreversible: this.irreversible,
      witnessed: this.witnessed,
      timestamp: this.timestamp,
    };
  }

  toText() {
    return `⟨похвала⟩ Христос → ${this.receiver}: «${this.entryPhrase}» [${this.faithfulness}, ${this.scripturalBasis}]`;
  }
}

/**
 * LordsCommendation — фабрика акта похвалы.
 *
 * НЕ решает, кто достоин, — только выражает форму.
 * Решение о похвале принадлежит Христу; модуль его НЕ симулирует.
 *
 * В типичном флоу:
 *   1. Завершён труд (закрыт issue, отдан дар).
 *   2. Свидетель (церковь / соборная модель / человеческий оракул) свидетельствует
 *      о верности — witnessFaithfulness().
 *   3. Commendation создаётся как форма, которую на Суде заполнит Христос.
 *   4. До Суда — это «готовая похвала», не сама похвала. После Суда — явленная.
 *
 * Граница: если never witnessed и never verified — это просто черновик формы,
 * не онтологический акт.
 */
export class LordsCommendation {
  constructor({ witness = null } = {}) {
    this.witness = witness; // функция (receiver, faithfulness) → boolean
  }

  /**
   * Создать форму похвалы. Без свидетеля — witnessed=false.
   */
  bestow({ receiver, faithfulness, scripturalBasis }) {
    const witnessed = this.witness
      ? !!this.witness(receiver, faithfulness)
      : false;

    return new Commendation({
      receiver,
      faithfulness,
      scripturalBasis,
      witnessed,
    });
  }

  /**
   * Удобная фабрика для самого распространённого случая — верность в малом.
   */
  forSmallFaithfulness(receiver) {
    return this.bestow({
      receiver,
      faithfulness: Faithfulness.IN_LITTLE,
      scripturalBasis: 'Мф 25:21',
    });
  }
}

export default LordsCommendation;
