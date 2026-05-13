/**
 * LiturgicalCalendar — кайрос, не хронос.
 *
 * Мыслебродильня не работает по запросу. У вина свои сроки:
 * сбор урожая, ферментация, дегустация, винтаж. Для нашей онтологии
 * литургический ритм:
 *
 *   ПОНЕДЕЛЬНИК     — Σύναξις (synaxis): сбор идей за прошедшую неделю
 *                     (Adam-сканер собирает из desert + pulse).
 *   ЧЕТВЕРГ         — Δοκιμασία (dokimasia): дегустация —
 *                     SymphonyOrchestrator с эпиклезой.
 *   ПОСЛЕДНИЙ ДЕНЬ  — Vintage: διάκρισις по плодам, обновление винтажа.
 *   МЕСЯЦА            (если месяц >28 дней — последний понедельник).
 *
 * Богословская логика дней:
 *   Понедельник — день начала творения (Быт 1:3 «и был свет»). Сбор.
 *   Четверг     — день Тайной Вечери, установления Евхаристии. Собор.
 *   Конец месяца — Suzdal-style: подведение итогов перед новым началом.
 *
 * Это не cron. Это литургика. Если день сорван (праздник, болезнь),
 * не «догоняем» — переносим на следующий цикл. Кайрос ≠ хронос.
 *
 * Использование:
 *   const cal = new LiturgicalCalendar();
 *   cal.today();             // { kairos: 'synaxis'|'dokimasia'|'vintage'|null, day, why }
 *   cal.next('dokimasia');   // следующая дата дегустации
 *   cal.shouldRun(action);   // true если сегодня день этого литургического действия
 */

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export const KAIROS = {
  SYNAXIS:    'synaxis',
  DOKIMASIA:  'dokimasia',
  VINTAGE:    'vintage',
  ORDINARY:   'ordinary',
};

export class LiturgicalCalendar {
  constructor({ now = null, vintageDay = 'last' } = {}) {
    // now — для тестирования. По умолчанию текущее время.
    this._nowFn = now ?? (() => new Date());
    // vintageDay — 'last' (последний день месяца) или 'last-monday'.
    this.vintageDay = vintageDay;
  }

  now() { return this._nowFn(); }

  /**
   * Что сегодня в литургическом календаре?
   * @returns {{ kairos: string, day: string, date: string, why: string }}
   */
  today() {
    const now = this.now();
    const dow = now.getDay();
    const dayName = DAYS[dow];
    const isLast = this._isLastDayOfMonth(now);

    // Vintage побеждает над недельным циклом — это конец месяца.
    if (isLast) {
      return {
        kairos: KAIROS.VINTAGE,
        day:    dayName,
        date:   now.toISOString().slice(0, 10),
        why:    'последний день месяца — διάκρισις по плодам, обновление винтажа',
      };
    }

    if (dow === 1) {
      return {
        kairos: KAIROS.SYNAXIS,
        day:    dayName,
        date:   now.toISOString().slice(0, 10),
        why:    'понедельник — день начала творения (Быт 1:3); σύναξις, сбор идей',
      };
    }

    if (dow === 4) {
      return {
        kairos: KAIROS.DOKIMASIA,
        day:    dayName,
        date:   now.toISOString().slice(0, 10),
        why:    'четверг — день Тайной Вечери; δοκιμασία, дегустация собором',
      };
    }

    return {
      kairos: KAIROS.ORDINARY,
      day:    dayName,
      date:   now.toISOString().slice(0, 10),
      why:    'обычный день — ферментация в бочке (ὑπομονή)',
    };
  }

  /**
   * Должно ли действие запуститься сейчас?
   * Соблюдает кайрос, не хронос: если день литургический, но действие
   * уже было сегодня — false (не дублировать).
   *
   * @param {string} kairos — KAIROS.SYNAXIS | DOKIMASIA | VINTAGE
   * @param {Date|string} [lastRun] — когда запускалось последний раз
   */
  shouldRun(kairos, lastRun = null) {
    const t = this.today();
    if (t.kairos !== kairos) return false;
    if (!lastRun) return true;
    const lastDay = (typeof lastRun === 'string' ? new Date(lastRun) : lastRun)
      .toISOString().slice(0, 10);
    return lastDay !== t.date;
  }

  /**
   * Следующая дата заданного литургического дня.
   * @returns {Date}
   */
  next(kairos) {
    const now = this.now();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let offset = 1; offset <= 60; offset++) {
      const d = new Date(start);
      d.setDate(d.getDate() + offset);
      const dow = d.getDay();
      const isLast = this._isLastDayOfMonth(d);

      if (kairos === KAIROS.VINTAGE && isLast)        return d;
      if (kairos === KAIROS.SYNAXIS && dow === 1 && !isLast)   return d;
      if (kairos === KAIROS.DOKIMASIA && dow === 4 && !isLast) return d;
    }
    throw new Error(`LiturgicalCalendar.next: kairos '${kairos}' не найден в 60 днях`);
  }

  _isLastDayOfMonth(d) {
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    return next.getMonth() !== d.getMonth();
  }

  /**
   * Полный годовой план — для UI/планировщика.
   * @returns {Array<{date, kairos, day, why}>}
   */
  yearAhead(fromDate = null) {
    const start = fromDate ? new Date(fromDate) : this.now();
    const events = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const cal = new LiturgicalCalendar({ now: () => d });
      const t = cal.today();
      if (t.kairos !== KAIROS.ORDINARY) events.push(t);
    }
    return events;
  }
}

export default LiturgicalCalendar;
