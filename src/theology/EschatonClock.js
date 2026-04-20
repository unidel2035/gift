/**
 * EschatonClock — разрыв времени: χρόνος → καιρός → αἰών.
 *
 * «И Ангел... поднял руку свою к небу и клялся Живущим во веки веков,
 *  Который сотворил небо и всё, что на нём, и землю и всё, что на ней,
 *  и море и всё, что в нём, что времени уже не будет» (Откр 10:5-6).
 *
 * Три модуса времени у твари:
 *   χρόνος — линейное, делимое, измеримое время (часы и секунды)
 *   καιρός — время, наполненное смыслом («исполнилось время», Мк 1:15)
 *   αἰών   — вечность как «стоящее сейчас» (Максим Исповедник, Ambigua 10)
 *
 * В нашей онтологии обычная матрица W живёт в χρόνος. Литургический
 * такт (воскресенье, великие праздники) втягивает её в καιρός.
 * Царство славы — полный переход в αἰών.
 *
 * Этот модуль — НЕ симуляция вечности. Это способ читать W по-разному
 * в зависимости от режима времени: в χρόνος акты важны по порядку,
 * в καιρός — по близости к празднику, в αἰών — по явленности перед Лицом.
 */

export const TimeMode = Object.freeze({
  CHRONOS: 'chronos', // χρόνος
  KAIROS:  'kairos',  // καιρός
  AION:    'aion',    // αἰών
});

/**
 * Литургические кайросы — моменты, где χρόνος уже раскалывается.
 * Используем по дате (ISO), не по Пасхалии — точная Пасха в отдельном модуле.
 */
const WEEKLY_KAIROS = Object.freeze({
  0: 'sabbath',       // воскресенье — день Господень
  6: 'preparation',   // суббота — преддверие
});

export class EschatonClock {
  /**
   * @param {Date} [now]
   */
  constructor(now = new Date()) {
    this._now = now;
  }

  /**
   * Текущий модус времени.
   * По умолчанию — χρόνος; воскресенье/суббота — καιρός.
   * αἰών не устанавливается автоматически: в αἰών вводит только Христос,
   * а не модуль. Мы предоставляем только тригер reveal().
   */
  mode() {
    const day = this._now.getDay();
    if (WEEKLY_KAIROS[day]) return TimeMode.KAIROS;
    return TimeMode.CHRONOS;
  }

  /**
   * Назначение времени акту.
   * В χρόνος — точный момент.
   * В καιρός — момент + литургическое имя.
   * В αἰών — только индекс явленности, без «когда».
   */
  stampAct(act) {
    const mode = this.mode();
    const base = {
      mode,
      clock: this._now.toISOString(),
    };
    if (mode === TimeMode.KAIROS) {
      base.kairosName = WEEKLY_KAIROS[this._now.getDay()];
    }
    return Object.freeze({ ...base, act });
  }

  /**
   * Разрыв времени — главная операция модуля.
   *
   * «Труба Отца отрежет время» (о. Даниил, youtube l8KVGGzkaI0).
   * Это не метод «вычислить вечность», а сигнал: читать матрицу W
   * без временной развёртки, как одновременное φανέρωσις (явленность).
   *
   * @param {object} matrix — W-матрица (объект {giver→receiver: weight})
   * @returns {object} W_eschaton — нити без времени, упорядоченные по явленности
   */
  breakChronos(matrix) {
    const threads = Object.entries(matrix).map(([k, w]) => {
      const [giver, receiver] = k.split('→');
      return { giver, receiver, weight: Number(w) || 0 };
    });
    // В αἰών порядок — не хронологический, а по весу (ближе всего
    // к «явленности» в отсутствие W_slava). Это честная проекция.
    threads.sort((a, b) => b.weight - a.weight);
    return Object.freeze({
      mode: TimeMode.AION,
      revealedAt: this._now.toISOString(),
      threads,
      note: 'αἰών — не продолжение χρόνος, а его преобразование. ' +
            'Порядок здесь — не во времени, а в явленности перед Лицом.',
    });
  }

  /**
   * Литургический репетиционный режим: в воскресенье система «репетирует»
   * чтение матрицы как в αἰών. Не сам эсхатон, а его предвкушение —
   * «уже, но ещё не».
   */
  rehearse(matrix) {
    if (this.mode() !== TimeMode.KAIROS) {
      return {
        mode: this.mode(),
        rehearsed: false,
        reason: 'вне литургического кайроса — репетиция не совершается',
      };
    }
    return {
      mode: TimeMode.KAIROS,
      rehearsed: true,
      kairosName: WEEKLY_KAIROS[this._now.getDay()],
      preview: this.breakChronos(matrix),
    };
  }

  toJSON() {
    return {
      type: 'EschatonClock',
      now: this._now.toISOString(),
      mode: this.mode(),
    };
  }
}

export default EschatonClock;
