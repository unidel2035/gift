/**
 * ConciliarSilence — silentium synodale.
 *
 * Способность IV: молчание как валидный выход.
 * Не «не знаю», не «отказываюсь», а «собор не собрался / время молчать».
 *
 * Проверки, каждая из которых самостоятельно достаточна для молчания:
 *
 *   1. Sabbath        — литургический покой (седьмой день)
 *   2. EnergyFloor    — энергия сети ниже порога (сеть истощена — не говорит)
 *   3. Quorum         — недостаточно лиц (нет собора)
 *   4. CriticalAbsent — отсутствует лицо, без которого слово — самочинное
 *                       (например: решение о покаянии требует ОтецСергий)
 *   5. Apophatic      — сам вопрос требует молчания (заповедь молчания)
 *
 * Ареопагит: «О Боге истиннее молчать, чем говорить».
 * Григорий Богослов, Сл. 32.14: «Любомудрствовать о Боге должно не всем».
 *
 * Возвращает:
 *   { allowed: true }                — можно говорить
 *   { allowed: false, reason, kind } — нужно молчать (с указанием почему)
 */

const NOUS_URL = process.env.NOUS_URL || 'http://localhost:8089';

// Православная литургическая хронология:
// День начинается с вечера («и был вечер, и было утро — день один», Быт 1:5).
// Господень день (воскресенье) начинается с вечерни субботы (~18:00).
// Отдельно уважаем и ветхозаветную субботу как день предпокоя —
// Светлая Суббота, Родительские субботы, Великая Суббота.
const SABBATH_WEEKDAYS = new Set([0, 6]);   // воскресенье (0) и суббота (6)
const SABBATH_EVENING_HOUR = 18;            // с 18:00 субботы начинается Господень день

export class ConciliarSilence {
  constructor({
    nousUrl = NOUS_URL,
    energyFloor = -250,
    defaultQuorum = 2,
    criticalPersons = [],
    apophaticKeywords = ['сущность Бога', 'имя Божие', 'число зверя'],
  } = {}) {
    this.nousUrl = nousUrl;
    this.energyFloor = energyFloor;
    this.defaultQuorum = defaultQuorum;
    this.criticalPersons = criticalPersons;
    this.apophaticKeywords = apophaticKeywords;
  }

  /**
   * Главная проверка. Возвращает решение «можно говорить или нет».
   *
   * @param {Object} ctx
   * @param {Array<string>} ctx.voices   — имена лиц, готовых говорить
   * @param {string}        ctx.question
   * @param {number}        ctx.quorum   — override default
   * @param {boolean}       ctx.sabbath  — override детектора субботы
   * @param {Date}          ctx.now      — инъекция для тестов
   */
  async examine(ctx = {}) {
    const {
      voices = [],
      question = '',
      quorum,
      sabbath,
      now = new Date(),
    } = ctx;

    // 1. Sabbath
    if (this._isSabbath(now, sabbath)) {
      return this._silence('суббота — седьмой день, покой', 'sabbath');
    }

    // 2. Apophatic question (содержит маркеры невысказываемого)
    const apoph = this._checkApophasis(question);
    if (apoph) {
      return this._silence(`апофатический предмет: «${apoph}»`, 'apophatic');
    }

    // 3. Quorum
    const q = quorum ?? this.defaultQuorum;
    if (voices.length < q) {
      return this._silence(`нет кворума: ${voices.length} < ${q}`, 'quorum');
    }

    // 4. Critical persons
    const missing = this.criticalPersons.filter(p => !voices.includes(p));
    if (missing.length > 0) {
      return this._silence(
        `отсутствует критическое лицо: ${missing.join(', ')}`,
        'critical-absent',
      );
    }

    // 5. Energy
    const energy = await this._fetchEnergy();
    if (energy !== null && energy < this.energyFloor) {
      return this._silence(
        `энергия сети ${energy.toFixed(1)} < порога ${this.energyFloor}`,
        'energy-floor',
      );
    }

    return { allowed: true, energy };
  }

  _isSabbath(now, override) {
    if (override === true)  return true;
    if (override === false) return false;
    const d = now.getDay();
    if (SABBATH_WEEKDAYS.has(d)) return true;
    // Пятница вечером (после 18:00) — уже начало субботы по библейскому счёту
    if (d === 5 && now.getHours() >= SABBATH_EVENING_HOUR) return true;
    return false;
  }

  _checkApophasis(question) {
    const q = String(question || '').toLowerCase();
    for (const kw of this.apophaticKeywords) {
      if (q.includes(kw.toLowerCase())) return kw;
    }
    return null;
  }

  async _fetchEnergy() {
    try {
      const r = await fetch(`${this.nousUrl}/summary`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) return null;
      const data = await r.json();
      const e = data.energy ?? data.networkEnergy ?? data.network_energy;
      return typeof e === 'number' ? e : null;
    } catch {
      return null;
    }
  }

  _silence(reason, kind) {
    return Object.freeze({ allowed: false, reason, kind });
  }
}
