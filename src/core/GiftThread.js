/**
 * GiftThread — нить дара (GFO Relator)
 *
 * Нить — это не свойство лица A и не свойство лица B.
 * Это третья сущность между ними: зависимая, живая, угасаемая.
 *
 * GFO (General Formal Ontology, Herre):
 *   «Relator — attributive, зависящее от нескольких сущностей,
 *    конституирующее их связь. Нет relata — нет relator'а.»
 *
 * Богословский резонанс:
 *   «Где двое или трое собраны во имя Моё — там Я посреди них» (Мф 18:20)
 *   Нить — это место присутствия Третьего.
 *   Угасание нити — это оскудение присутствия, не просто падение метрики.
 *
 * W-матрица хранит W[i][j] — число. Но за этим числом стоит живая нить.
 * GiftThread делает нить явной как объект, не скрытой за числом.
 *
 * Обратная совместимость: valueOf() возвращает weight,
 * поэтому `thread(a, b) <= threshold` работает без изменений.
 */

/** Порог угасания: нить слаба, но жива */
export const FADING_THRESHOLD = 2.0;

/** Тип нити по принадлежности в матрице */
export const THREAD_TYPE = {
  W:           'W',           // тварь → тварь
  ENERGEIA:    'energeia',    // Бог → тварь (нетварная энергия)
  DOXOLOGIA:   'doxologia',   // тварь → Бог (слава, молитва)
  THEOPHANEIA: 'theophaneia', // Бог → Бог (ипостасные исхождения)
};

export class GiftThread {
  /**
   * @param {Object} config
   * @param {string} config.from            — ID лица-истока
   * @param {string} config.to              — ID лица-приёмника
   * @param {number} [config.weight=0]      — накопленный вес (Σ kenotic_weight)
   * @param {string} [config.type='W']      — тип нити (THREAD_TYPE)
   * @param {number} [config.fadingThreshold=FADING_THRESHOLD]
   */
  constructor({ from, to, weight = 0, type = THREAD_TYPE.W, fadingThreshold = FADING_THRESHOLD }) {
    this.from            = from;
    this.to              = to;
    this.weight          = weight;
    this.type            = type;
    this.fadingThreshold = fadingThreshold;
  }

  // ── Состояние нити ──────────────────────────────────────────────────────

  /**
   * is_desert — нить пуста: нет ни одного акта дара.
   * «Пустыня: место, где связь ещё не началась или прервалась.»
   */
  get is_desert() {
    return this.weight === 0;
  }

  /**
   * is_fading — нить угасает: есть акты, но их мало.
   * GiftThread жив, но ослаб. Требует вопрошания.
   *
   * «Ты носишь имя, будто жив, но ты мёртв» (Откр 3:1) —
   * нить существует, но едва.
   */
  get is_fading() {
    return this.weight > 0 && this.weight <= this.fadingThreshold;
  }

  /**
   * is_alive — нить полноценно живёт.
   */
  get is_alive() {
    return this.weight > this.fadingThreshold;
  }

  /**
   * status — словесное состояние нити.
   * @returns {'desert'|'fading'|'alive'}
   */
  get status() {
    if (this.is_desert) return 'desert';
    if (this.is_fading) return 'fading';
    return 'alive';
  }

  // ── GFO: relator зависит от обоих relata ───────────────────────────────

  /**
   * dependsOn(personId) — нить зависит от этого лица.
   * Если лицо исчезает из матрицы — нить перестаёт существовать.
   *
   * GFO: «Relator ontologically depends on its relata.»
   */
  dependsOn(personId) {
    return this.from === personId || this.to === personId;
  }

  // ── Обратная совместимость ──────────────────────────────────────────────

  /**
   * valueOf() — позволяет использовать нить как число в сравнениях.
   * `memory.thread(a, b) <= 2.0` работает без изменений.
   */
  valueOf() {
    return this.weight;
  }

  toString() {
    return `GiftThread(${this.from}→${this.to}, weight=${this.weight}, ${this.status})`;
  }

  toJSON() {
    return {
      from:     this.from,
      to:       this.to,
      weight:   this.weight,
      type:     this.type,
      status:   this.status,
      is_desert:  this.is_desert,
      is_fading:  this.is_fading,
      is_alive:   this.is_alive,
    };
  }
}
