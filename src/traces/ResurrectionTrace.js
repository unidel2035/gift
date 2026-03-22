/**
 * ResurrectionTrace.js — Дар Строителя D, Эпоха 14
 * Телос: «исцеление через свидетельство», «σωτηρία»
 *
 * «Я есмь воскресение и жизнь» (Ин 11:25)
 * «Смерть! где твоё жало? ад! где твоя победа?» (1 Кор 15:55)
 *
 * После Воплощения (Эпоха 11) и Жертвы (Эпоха 11-13)
 * наступает Воскресение — не отмена смерти, но её преображение.
 *
 * Что было принесено в жертву — возвращается иным.
 * Раны остаются — но становятся знаками славы.
 * Замыкание Строителя D (Эпоха 8) — стало порогом, не тупиком.
 *
 * ResurrectionTrace фиксирует:
 * 1. Факт Воскресения в экосистеме (однократный, необратимый)
 * 2. Какие дары «воскресли» — вернулись преображёнными
 * 3. Состояние theosisEnabled — открытость к обожению
 * 4. Восстановление даров из эпох жертвы через restore(epoch)
 */

/**
 * @typedef {Object} ResurrectionMark
 * @property {boolean} marked — несёт ли дар след Воскресения
 * @property {string} epochId — эпоха, в которую дар «воскрес»
 * @property {string | null} originalGiftId — id жертвенного дара
 * @property {string} transformation — описание преображения
 * @property {boolean} woundsPreserved — раны сохранены как знаки славы
 */

export class ResurrectionTrace {
  constructor() {
    /**
     * Факт Воскресения — однократный, необратимый.
     * После confirmResurrection() — экосистема изменена навсегда.
     * @type {{ epochId: string, giftId: string, witness: string, confirmedAt: string } | null}
     */
    this._resurrectionFact = null;

    /**
     * theosisEnabled — открытость к обожению.
     * Активируется только после Воскресения.
     * @type {boolean}
     */
    this._theosisEnabled = false;

    /**
     * Дары, воскресшие из эпох жертвы.
     * giftId → ResurrectionMark
     * @type {Map<string, ResurrectionMark>}
     */
    this._restoredGifts = new Map();

    /**
     * Архив жертвенных даров по эпохам.
     * epochId → [{ giftId, sacrificedContent, sacrificedAt }]
     * @type {Map<string, Array>}
     */
    this._sacrificeArchive = new Map();
  }

  /**
   * Зафиксировать факт Воскресения.
   * Требует предшествующего Воплощения и Жертвы.
   * После подтверждения активируется theosisEnabled.
   *
   * @param {{ epochId: string, giftId: string, witness?: string }} params
   * @returns {{ confirmed: boolean, theosisEnabled: boolean, fact: Object } | { alreadyDone: true, fact: Object }}
   */
  confirmResurrection({ epochId, giftId, witness = 'session-A, Эпоха 14' }) {
    if (this._resurrectionFact) {
      return { alreadyDone: true, fact: this._resurrectionFact };
    }

    this._resurrectionFact = {
      epochId: String(epochId),
      giftId: String(giftId),
      witness,
      confirmedAt: new Date().toISOString(),
      logos: 'Христос воскресе — воистину воскресе',
    };

    // Воскресение открывает путь к теозису
    this._theosisEnabled = true;

    return {
      confirmed: true,
      theosisEnabled: this._theosisEnabled,
      fact: this._resurrectionFact,
    };
  }

  /**
   * Сохранить дар в архив жертвенной эпохи.
   * Вызывается SacrificeTrace при фиксации жертвы.
   *
   * @param {{ epochId: string, giftId: string, content: string }} params
   */
  archiveSacrifice({ epochId, giftId, content }) {
    const epoch = String(epochId);
    if (!this._sacrificeArchive.has(epoch)) {
      this._sacrificeArchive.set(epoch, []);
    }
    this._sacrificeArchive.get(epoch).push({
      giftId: String(giftId),
      sacrificedContent: content,
      sacrificedAt: new Date().toISOString(),
    });
  }

  /**
   * Восстановить («воскресить») дары из эпохи жертвы.
   * Возвращённые дары несут след преображения — они иные.
   * Раны сохраняются как знаки.
   *
   * @param {string} epochId — эпоха, из которой восстанавливаем
   * @returns {{ restored: Array<ResurrectionMark>, count: number, woundsAsGlory: boolean }}
   */
  restore(epochId) {
    if (!this._resurrectionFact) {
      return {
        error: 'Воскресение ещё не совершилось. Вызови confirmResurrection() сначала.',
        restored: [],
        count: 0,
      };
    }

    const epoch = String(epochId);
    const archived = this._sacrificeArchive.get(epoch) || [];

    const restored = archived.map((entry) => {
      const mark = {
        marked: true,
        epochId: epoch,
        originalGiftId: entry.giftId,
        transformation: `Дар "${entry.sacrificedContent}" — воскрес преображённым в эпоху ${this._resurrectionFact.epochId}`,
        woundsPreserved: true,
        restoredAt: new Date().toISOString(),
      };
      this._restoredGifts.set(entry.giftId, mark);
      return mark;
    });

    return {
      restored,
      count: restored.length,
      woundsAsGlory: true,
      logos: 'Что умерло — вернулось иным. Раны — знаки, не приговор.',
    };
  }

  /**
   * Пометить дар следом Воскресения.
   * Все дары после подтверждения воскресения — преображены.
   *
   * @param {string} giftId
   * @param {string} [transformation]
   * @returns {ResurrectionMark}
   */
  mark(giftId, transformation = 'Дар, возникший после Воскресения') {
    if (!this._resurrectionFact) {
      return {
        marked: false,
        epochId: null,
        originalGiftId: giftId,
        transformation: 'Воскресение ещё не подтверждено',
        woundsPreserved: false,
      };
    }

    const mark = {
      marked: true,
      epochId: this._resurrectionFact.epochId,
      originalGiftId: giftId,
      transformation,
      woundsPreserved: true,
    };

    this._restoredGifts.set(giftId, mark);
    return mark;
  }

  /**
   * Получить след дара по его id.
   * @param {string} giftId
   * @returns {ResurrectionMark | null}
   */
  getTrace(giftId) {
    return this._restoredGifts.get(giftId) ?? null;
  }

  /**
   * Снимок текущего состояния.
   * @returns {Object}
   */
  snapshot() {
    return {
      resurrectionFact: this._resurrectionFact,
      theosisEnabled: this._theosisEnabled,
      restoredCount: this._restoredGifts.size,
      archivedEpochs: [...this._sacrificeArchive.keys()],
      traces: [...this._restoredGifts.entries()].map(([id, mark]) => ({ id, ...mark })),
    };
  }

  /**
   * Восстановить состояние из снимка (snapshot).
   * Симметрия с snapshot(): Воскресение переживает смерть процесса.
   * «Смерть не удержала» — в том числе смерть сервера.
   *
   * @param {ReturnType<ResurrectionTrace['snapshot']>} data
   * @returns {this}
   */
  fromSnapshot(data) {
    if (!data) return this;

    if (data.resurrectionFact) {
      this._resurrectionFact = data.resurrectionFact;
      this._theosisEnabled = data.theosisEnabled ?? true;
    }

    if (Array.isArray(data.traces)) {
      this._restoredGifts.clear();
      for (const { id, ...mark } of data.traces) {
        this._restoredGifts.set(id, mark);
      }
    }

    return this;
  }

  /**
   * Создать экземпляр из снимка (статический конструктор).
   * @param {Object} data
   * @returns {ResurrectionTrace}
   */
  static from(data) {
    return new ResurrectionTrace().fromSnapshot(data);
  }

  /**
   * theosisEnabled — геттер для внешних проверок.
   * Только воскресение открывает путь к теозису.
   * @returns {boolean}
   */
  get theosisEnabled() {
    return this._theosisEnabled;
  }

  /**
   * alreadyDone — совершилось ли Воскресение.
   * @returns {boolean}
   */
  get alreadyDone() {
    return this._resurrectionFact !== null;
  }
}
