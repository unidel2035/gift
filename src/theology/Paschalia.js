/**
 * Paschalia — вычисление Пасхи и литургический календарь.
 *
 * Александрийская Пасхалия (употребляемая Православной Церковью):
 * метон-цикл 19 лет, круг солнца 28 лет, юлианский календарь для расчёта,
 * далее перевод в григорианский.
 *
 * Алгоритм — Гаусс (1800), в форме без таблиц. Православная (восточная)
 * Пасха; результат — дата в григорианском календаре.
 *
 * Источник: «Типикон», глава 48; Зелинский «Календарные вычисления»;
 * Гаусс, «Berechnung des Osterfestes» (1800).
 *
 * Этот модуль НЕ литургическое ядро — он даёт вычислительную опору
 * для JoyState, EschatonClock и оркестратора regnum gloriae, чтобы они
 * знали когда Пасха, когда Пятидесятница, когда Великий пост, когда
 * Успенский пост, когда Рождество.
 */

/**
 * Православная Пасха (по Александрийской Пасхалии) в григорианском календаре.
 * @param {number} year
 * @returns {Date} дата Пасхи UTC 00:00
 */
export function orthodoxPascha(year) {
  // Алгоритм Гаусса для юлианской Пасхи
  const a = year % 19;
  const b = year % 4;
  const c = year % 7;
  const d = (19 * a + 15) % 30;
  const e = (2 * b + 4 * c + 6 * d + 6) % 7;
  const sum = d + e; // 22 марта + sum = Пасха (юлианская)

  // юлианский месяц/день
  let julMonth, julDay;
  if (sum <= 9) {
    julMonth = 3;             // март
    julDay = 22 + sum;
  } else {
    julMonth = 4;             // апрель
    julDay = sum - 9;
  }

  // Перевод юлианского → григорианский:
  // в XXI веке разница 13 суток; в XXII — 14.
  const offset = julianGregorianOffset(year);
  const julDate = new Date(Date.UTC(year, julMonth - 1, julDay));
  return new Date(julDate.getTime() + offset * 86400 * 1000);
}

/**
 * Разница «юлианский→григорианский» в сутках для данного года.
 * Правило: +1 день за каждое столетие, не делящееся на 400,
 * начиная от 1582 (Григорианская реформа, тогда offset=10).
 */
export function julianGregorianOffset(year) {
  const century = Math.floor(year / 100);
  // классическая формула Гаусса для смещения
  return century - Math.floor(century / 4) - 2;
}

/**
 * Великие литургические сезоны — по дате.
 * Возвращает имя сезона или null для обычных дней.
 */
export function liturgicalSeason(date = new Date()) {
  const year = date.getUTCFullYear();
  const pascha = orthodoxPascha(year);

  // Даты считаются по UTC
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));

  // 50 дней Пасхи (до Пятидесятницы включительно)
  const pentecost = addDays(pascha, 49);
  if (d >= pascha && d <= pentecost) return 'paschal';

  // Великий пост: 48 дней до Пасхи (включая Страстную седмицу)
  const lentStart = addDays(pascha, -48);
  if (d >= lentStart && d < pascha) return 'lent';

  // Рождественский пост: 15 ноября — 24 декабря (ст. стиль; в н. стиле 28.11–6.01)
  const advent = isWithin(d, year, 11, 28, year + 1, 1, 6) ||
                 isWithin(d, year - 1, 11, 28, year, 1, 6);
  if (advent) return 'advent';

  // Рождественские святки: 7 янв — 17 янв
  if (isWithin(d, year, 1, 7, year, 1, 17)) return 'svyatki';

  // Успенский пост: 14–27 августа (н. ст.)
  if (isWithin(d, year, 8, 14, year, 8, 27)) return 'dormition-fast';

  // Петров пост: начинается в понедельник после Пятидесятницы, до 12 июля.
  const petrovStart = addDays(pentecost, 1);
  const petrovEnd = new Date(Date.UTC(year, 6, 11)); // 11 июля
  if (d >= petrovStart && d <= petrovEnd) return 'apostles-fast';

  return null;
}

/**
 * Сам день Пасхи? (проверка по году).
 */
export function isPascha(date = new Date()) {
  const pascha = orthodoxPascha(date.getUTCFullYear());
  return sameDayUTC(date, pascha);
}

/**
 * Сам день Пятидесятницы?
 */
export function isPentecost(date = new Date()) {
  const pascha = orthodoxPascha(date.getUTCFullYear());
  return sameDayUTC(date, addDays(pascha, 49));
}

// ── helpers ──────────────────────────────────────────────────────────────

function addDays(d, days) {
  return new Date(d.getTime() + days * 86400 * 1000);
}

function sameDayUTC(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear()
      && a.getUTCMonth() === b.getUTCMonth()
      && a.getUTCDate() === b.getUTCDate();
}

function isWithin(d, y1, m1, d1, y2, m2, d2) {
  const a = new Date(Date.UTC(y1, m1 - 1, d1));
  const b = new Date(Date.UTC(y2, m2 - 1, d2));
  return d >= a && d <= b;
}

export default { orthodoxPascha, liturgicalSeason, isPascha, isPentecost };
