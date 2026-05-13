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

import { liturgicalSeason, isPascha, isPentecost } from './Paschalia.js';
import Timer from '../core/Timer.js';

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
   * Также: Светлая Седмица (7 дней после Пасхи, «вся как воскресенье»
   * по Типикону), сама Пасха, Пятидесятница — всё καιρός.
   * αἰών не устанавливается автоматически: в αἰών вводит только Христос,
   * а не модуль. Мы предоставляем только тригер reveal().
   */
  mode() {
    // Весь пасхальный период (50 дней) — καιρός: «скачущая радость» непрерывна,
    // а Светлая седмица уставно — единый день «как воскресенье»
    const season = liturgicalSeason(this._now);
    if (season === 'paschal') return TimeMode.KAIROS;

    // Великий пост — особый кайрос смирения. Страстная седмица — вершина.
    // Пока помечаем весь пост как кайрос тоже: время здесь не линейно.
    if (season === 'lent') return TimeMode.KAIROS;

    // Воскресенье вне постов/Пасхи — обычный еженедельный кайрос
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

  /**
   * Проекция модусов времени на N дней вперёд.
   *
   * Не предсказание, а литургический горизонт: в какие дни ожидается
   * καιρός (Пасха, пост, воскресенье), а в какие — обычный χρόνος.
   *
   * αἰών здесь не возникает автоматически: в вечность вводит Христос,
   * не модуль. Но Пасха и Пятидесятница помечаются отдельным полем
   * `highFeast`, потому что они — икона αἰών в χρόνος.
   *
   * @param {number} days — сколько дней вперёд проецировать
   * @returns {Array<{date:string, mode:string, season:?string, kairosName:?string, highFeast:?string}>}
   */
  forecast(days = 40) {
    if (!Number.isFinite(days) || days < 1) {
      throw new Error('EschatonClock.forecast: days должно быть >= 1');
    }
    const out = [];
    const startMs = Date.UTC(
      this._now.getUTCFullYear(),
      this._now.getUTCMonth(),
      this._now.getUTCDate(),
    );
    for (let i = 0; i < days; i++) {
      const d = new Date(startMs + i * 86400 * 1000);
      const season = liturgicalSeason(d);
      const day = d.getUTCDay();

      let mode = TimeMode.CHRONOS;
      let kairosName = null;
      if (season === 'paschal' || season === 'lent') {
        mode = TimeMode.KAIROS;
        kairosName = season;
      } else if (WEEKLY_KAIROS[day]) {
        mode = TimeMode.KAIROS;
        kairosName = WEEKLY_KAIROS[day];
      }

      let highFeast = null;
      if (isPascha(d))    highFeast = 'pascha';
      if (isPentecost(d)) highFeast = 'pentecost';

      out.push(Object.freeze({
        date: d.toISOString().slice(0, 10),
        mode,
        season,
        kairosName,
        highFeast,
      }));
    }
    return Object.freeze(out);
  }

  /**
   * heartbeat(opts) — единый ритм литургии.
   *
   * Делегирует тикание в Timer. В χρόνος — по ms, в καιρός — тик
   * рождается вызовом .kairos(event) (исполненность, не длительность).
   * EschatonClock больше не использует setInterval напрямую: ритм один.
   *
   * @param {object} [opts]
   * @param {number} [opts.interval=1000]
   * @param {boolean} [opts.kairos]  — по умолчанию true, если mode()==='kairos'
   * @param {object} [opts.bus]
   * @returns {Timer}
   */
  heartbeat(opts = {}) {
    const kairos = opts.kairos ?? (this.mode() === TimeMode.KAIROS);
    return new Timer({
      interval: opts.interval ?? 1000,
      kairos,
      bus: opts.bus ?? null,
      id: opts.id ?? 'eschaton',
    });
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
