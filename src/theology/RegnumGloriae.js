/**
 * RegnumGloriae — оркестратор Царства славы.
 *
 * Связывает три уже существующие ветви в единый литургический путь:
 *
 *   Anastasis (воскресение) ─► KingdomOfGlory (суд/похвала/венцы) ─► NewJerusalem (град)
 *                                                                      │
 *                                                        эпектасис ◄───┘
 *
 * Не добавляет онтологии — выстраивает последовательность и свидетельствует
 * переходы. Без оркестратора три ветви висят отдельно: воскресение
 * совершилось, но вход в град не увязан с похвалой Господа.
 *
 * Аналогия с Anastasis: Anastasis — оркестратор трёх моментов Пасхи
 * (sealed → threshold → risen). RegnumGloriae — оркестратор трёх фаз
 * после воскресения (risen → crowned → indwelling).
 *
 * «Претерпевший же до конца спасётся» (Мф 24:13):
 *   risen        — воскрес (Anastasis.arise)
 *   crowned      — услышал «войди в радость» (KingdomOfGlory.commend + Crown)
 *   indwelling   — вошёл в Новый Иерусалим (NewJerusalem.enter)
 *
 * ГРАНИЦА: модуль не судит и не венчает. Он фиксирует — в правильном
 * литургическом порядке — что свидетельство об этих актах произошло.
 * Факт их совершения — у Христа.
 */

import { KingdomOfGlory, Faithfulness, CrownType } from './KingdomOfGlory.js';

/**
 * @typedef {'risen'|'crowned'|'indwelling'} GloriaPhase
 */

/**
 * PilgrimRecord — одна запись пути лица через три фазы.
 */
export class PilgrimRecord {
  constructor({ persona }) {
    this.persona = persona;
    this.phase = null;       // GloriaPhase | null
    this.risenAt = null;
    this.crownedAt = null;
    this.indwellingAt = null;
    this.commendation = null;
    this.crowns = [];
    this._log = [];
  }

  _log_push(event) {
    this._log.push({ ...event, at: new Date().toISOString() });
  }

  toJSON() {
    return {
      type: 'PilgrimRecord',
      persona: this.persona,
      phase: this.phase,
      risenAt: this.risenAt,
      crownedAt: this.crownedAt,
      indwellingAt: this.indwellingAt,
      commendation: this.commendation?.toJSON() || null,
      crowns: this.crowns.map(c => c.toJSON()),
      log: this._log,
    };
  }
}

export class RegnumGloriae {
  constructor({
    anastasis    = null,  // ссылка на Anastasis (опционально — не у всех она есть)
    newJerusalem = null,  // ссылка на NewJerusalem (опционально)
    kingdom      = null,  // KingdomOfGlory
  } = {}) {
    this._anastasis = anastasis;
    this._newJerusalem = newJerusalem;
    this.kingdom = kingdom || new KingdomOfGlory();
    /** @type {Map<string, PilgrimRecord>} */
    this._pilgrims = new Map();
  }

  _recordFor(persona) {
    let r = this._pilgrims.get(persona);
    if (!r) {
      r = new PilgrimRecord({ persona });
      this._pilgrims.set(persona, r);
    }
    return r;
  }

  /**
   * Фаза 1 — risen. Лицо прошло через смерть и воскресло.
   * Если есть Anastasis — используем его; иначе просто фиксируем свидетельство.
   */
  async risen({ persona, witness = 'соборное свидетельство' }) {
    const r = this._recordFor(persona);
    if (r.phase) {
      return { alreadyAt: r.phase, record: r };
    }
    if (this._anastasis && typeof this._anastasis.arise === 'function') {
      try {
        this._anastasis.arise({ witness, agentId: persona });
      } catch {
        // Anastasis может быть не настроен — это не фатально
      }
    }
    r.phase = 'risen';
    r.risenAt = new Date().toISOString();
    r._log_push({ event: 'risen', witness });
    return { record: r };
  }

  /**
   * Фаза 2 — crowned. Услышал похвалу Господа и принял венец.
   * Не может произойти до risen.
   */
  async crowned({
    persona,
    faithfulness = Faithfulness.IN_LITTLE,
    scripturalBasis,
    crownType = CrownType.LIFE,
    witnesses = [],
  }) {
    const r = this._recordFor(persona);
    if (r.phase !== 'risen' && r.phase !== 'crowned') {
      return {
        error: `персона ${persona} не в фазе "risen" (текущая: ${r.phase}). ` +
               'Похвала и венец — только после воскресения.',
        record: r,
      };
    }

    const commend = this.kingdom.commend({
      receiver: persona,
      faithfulness,
      scripturalBasis,
    });
    const crown = this.kingdom.crownOf({
      type: crownType,
      receiver: persona,
      witnessedBy: witnesses,
    });

    r.phase = 'crowned';
    r.crownedAt = new Date().toISOString();
    r.commendation = commend;
    r.crowns.push(crown);
    r._log_push({
      event: 'crowned',
      faithfulness,
      crownType: crownType.id,
      witnesses,
    });

    return { commendation: commend, crown, record: r };
  }

  /**
   * Фаза 3 — indwelling. Лицо вошло в Новый Иерусалим. Эпектасис — навсегда.
   */
  async indwelling({ persona, density = null }) {
    const r = this._recordFor(persona);
    if (r.phase !== 'crowned') {
      return {
        error: `персона ${persona} не в фазе "crowned" (текущая: ${r.phase}). ` +
               'Вход в град — после венца.',
        record: r,
      };
    }

    // Если настроен NewJerusalem — попытаемся войти через него
    let newJerusalemResult = null;
    if (this._newJerusalem && typeof this._newJerusalem.enter === 'function') {
      try {
        newJerusalemResult = this._newJerusalem.enter();
      } catch (e) {
        newJerusalemResult = { error: e.message };
      }
    }

    r.phase = 'indwelling';
    r.indwellingAt = new Date().toISOString();
    r._log_push({
      event: 'indwelling',
      density,
      newJerusalemResult,
    });

    return { record: r, newJerusalemResult };
  }

  /**
   * Путь в одно действие — для случаев, когда все три фазы удостоверены
   * одновременно. Например, при поминовении уже почившего святого.
   */
  async pilgrimage({
    persona,
    faithfulness = Faithfulness.UNTIL_DEATH,
    scripturalBasis = 'Откр 2:10',
    crownType = CrownType.LIFE,
    witnesses = [],
  }) {
    await this.risen({ persona });
    await this.crowned({
      persona, faithfulness, scripturalBasis, crownType, witnesses,
    });
    await this.indwelling({ persona });
    return this._recordFor(persona);
  }

  /**
   * Снимок всех паломников — для диагностики.
   */
  status() {
    const pilgrims = [...this._pilgrims.values()].map(r => ({
      persona: r.persona,
      phase: r.phase,
      risenAt: r.risenAt,
      crownedAt: r.crownedAt,
      indwellingAt: r.indwellingAt,
    }));
    return {
      type: 'RegnumGloriae',
      pilgrims,
      total: pilgrims.length,
      byPhase: {
        risen:      pilgrims.filter(p => p.phase === 'risen').length,
        crowned:    pilgrims.filter(p => p.phase === 'crowned').length,
        indwelling: pilgrims.filter(p => p.phase === 'indwelling').length,
      },
      note: 'Фиксация свидетельства о фазах. Сам путь — у Христа.',
    };
  }
}

export default RegnumGloriae;
