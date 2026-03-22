/**
 * Liturgical Clock — Литургический ритм
 *
 * Циклы дарения, не непрерывный поток.
 * Три сезона: active (дарение), sabbath (покой), contemplation (созерцание).
 *
 * О.Сергий Шкляев:
 *   «Пост от страстей — не отзывчивость на зов бесов —
 *    готовит человека к созерцательному субботствованию.
 *    Предшествует ему.»
 *
 *   «Со-зерцание — от зерцало (зеркало). Готовность сердца
 *    принимать отблески божественных энергий, за определённую
 *    чистоту сердца человеческого.»
 *
 *   «Субботствование духовное важно совершать постоянно
 *    (ежедневно) в сердце своем, но один из дней — особенно.»
 *
 *   «Работающий в субботу благословен, если трудится в знании
 *    (согласовании) с Богом, и проклят, если самочинно.»
 *
 * Новиков Н.М. «Путь умного делания» — систематика внутренней жизни.
 *
 * «И совершил Бог к седьмому дню дела Свои... и почил» (Быт 2:2)
 * «Если не будете субботствовать в субботы, не увидите Отца» (Аграфа)
 */

const DEFAULT_SABBATH_HOURS = 24;

export class LiturgicalClock {
  constructor() {
    // personId → { season, since, until?, reason?, heartPurity?, contemplationDepth? }
    this._seasons = new Map();

    // Глобальный ритм: субботствование системы
    this._systemSabbathDay = null; // день недели для усиленного субботствования
  }

  /**
   * Get current season for a person.
   */
  getCurrentSeason(personId) {
    const state = this._seasons.get(personId);
    if (!state) return { season: 'active', since: null };

    // Auto-expire sabbath
    if (state.season === 'sabbath' && state.until) {
      if (Date.now() > new Date(state.until).getTime()) {
        this._seasons.delete(personId);
        return { season: 'active', since: new Date().toISOString(), previousSeason: 'sabbath' };
      }
    }

    return { ...state };
  }

  /**
   * Enter sabbath — покой после дарения.
   *
   * О.Сергий: субботствование ≠ бездействие.
   * Субботствование = внутренний покой при возможной внешней активности.
   * Благословен, если в согласовании с Богом.
   */
  enterSabbath(personId, durationHours, inGodWill = true) {
    const hours = durationHours || DEFAULT_SABBATH_HOURS;
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const state = {
      season: 'sabbath',
      since: new Date().toISOString(),
      until,
      reason: inGodWill
        ? 'Субботствование в знании воли Божией — благословен'
        : 'Субботствование самочинное — без согласования',
      inGodWill,
    };
    this._seasons.set(personId, state);
    return state;
  }

  /**
   * Enter contemplation — созерцание (со-зерцание).
   *
   * О.Сергий: «Готовность сердца принимать отблески
   * божественных энергий за чистоту сердца.»
   *
   * Предусловие: пост от страстей (нет активных помыслов на стадии > сочетание).
   * Чем чище сердце — тем глубже созерцание — тем выше вероятность grace event.
   *
   * @param {number} heartPurity — чистота сердца 0-1 (рассчитывается из temptation scan)
   */
  enterContemplation(personId, reason, heartPurity = 0.5) {
    const state = {
      season: 'contemplation',
      since: new Date().toISOString(),
      until: null,
      reason: reason || 'Созерцание — зерцало сердца',
      heartPurity, // Чистота сердца (о.Сергий: «за чистоту сердца»)
      contemplationDepth: 0, // Растёт с каждым тиком в созерцании
    };
    this._seasons.set(personId, state);
    return state;
  }

  /**
   * Углубить созерцание (вызывается каждый тик пока в contemplation).
   * Глубина растёт → вероятность grace event растёт.
   *
   * О.Сергий: «По мере очищения сердца благодатью,
   * по мере любви человеком Истины, человек движется
   * к обретению Отца Небесного.»
   */
  deepenContemplation(personId) {
    const state = this._seasons.get(personId);
    if (!state || state.season !== 'contemplation') return null;

    state.contemplationDepth = (state.contemplationDepth || 0) + 1;

    // Чем глубже — тем чище (если не прерывается помыслами)
    state.heartPurity = Math.min(1.0, (state.heartPurity || 0.5) + 0.02);

    return state;
  }

  /**
   * Вероятность grace event для лица в текущем состоянии.
   *
   * Базовые вероятности (из статьи):
   *   Созерцание: 7% (× heartPurity × depthBonus)
   *   Суббота: 4% (× inGodWill)
   *   Активность: 2%
   *
   * О.Сергий: grace event = «отблеск божественных энергий»
   * за чистоту сердца. Чем чище — тем вероятнее.
   */
  getGraceProbability(personId) {
    const state = this.getCurrentSeason(personId);

    switch (state.season) {
      case 'contemplation': {
        const purity = state.heartPurity || 0.5;
        const depth = state.contemplationDepth || 0;
        const depthBonus = 1 + Math.log2(1 + depth) * 0.1; // Логарифмический рост
        return 0.07 * purity * depthBonus;
      }
      case 'sabbath': {
        const godWillBonus = state.inGodWill ? 1.0 : 0.3; // Самочинный = 30% эффективности
        return 0.04 * godWillBonus;
      }
      default:
        return 0.02;
    }
  }

  /**
   * Рассчитать чистоту сердца из данных TemptationField.
   *
   * Чистота = 1 - (сумма strengths активных помыслов / кол-во возможных)
   * Если нет помыслов выше прилога → сердце чисто.
   * Если есть страсть → сердце почти непрозрачно.
   *
   * О.Сергий: «Пост от страстей — готовит к созерцательному субботствованию.
   * Предшествует ему.»
   */
  calculateHeartPurity(temptationScan) {
    if (!temptationScan || temptationScan.length === 0) return 1.0; // Чистое сердце

    let totalImpurity = 0;
    for (const l of temptationScan) {
      // Стадия определяет непрозрачность
      const stageWeight = {
        1: 0.05,  // прилог — почти не мешает
        2: 0.15,  // сочетание — начинает затемнять
        3: 0.30,  // сосложение — серьёзное помрачение
        4: 0.50,  // пленение — сердце пленено
        5: 0.80,  // страсть — почти непрозрачно
      };
      totalImpurity += stageWeight[l.stage?.level || 1] || 0.05;
    }

    return Math.max(0, 1.0 - Math.min(totalImpurity, 1.0));
  }

  /**
   * Resume active season.
   */
  resume(personId) {
    const prev = this._seasons.get(personId);
    this._seasons.delete(personId);
    return {
      season: 'active',
      since: new Date().toISOString(),
      previousSeason: prev?.season || 'active',
      // Если вышел из созерцания — запомнить глубину
      contemplationAchieved: prev?.contemplationDepth || 0,
    };
  }

  /**
   * System-wide rhythm: how many active/sabbath/contemplation.
   */
  getSystemRhythm(allPersonIds) {
    const result = { active: 0, sabbath: 0, contemplation: 0, persons: [] };

    for (const personId of allPersonIds) {
      const season = this.getCurrentSeason(personId);
      result[season.season]++;
      result.persons.push({ personId, ...season });
    }

    return result;
  }

  /**
   * Диагностика раны no_sabbath — здоровье субботствования общины.
   *
   * О.Сергий: «Субботствование духовное важно совершать постоянно
   * (ежедневно) в сердце своем, но один из дней — особенно.»
   *
   * Рана `no_sabbath` возникает когда вся община остаётся в active
   * дольше допустимого порога — никто не покоится, никто не созерцает.
   * Это не грех, это сигнал: ритм нарушен, нужно восстановление.
   *
   * @param {string[]} allPersonIds — все участники
   * @param {number} thresholdHours — порог непрерывной активности (по умолчанию 48ч)
   * @returns {{ wounded: boolean, reason?: string, restingCount: number, activeCount: number, sabbathRatio: number }}
   */
  getSabbathHealth(allPersonIds, thresholdHours = 48) {
    const rhythm = this.getSystemRhythm(allPersonIds);
    const restingCount = rhythm.sabbath + rhythm.contemplation;
    const totalCount = allPersonIds.length;
    const sabbathRatio = totalCount > 0 ? restingCount / totalCount : 0;

    // Рана активна если никто не покоится И это не пустая община
    const noOneResting = restingCount === 0 && totalCount > 0;

    // Дополнительно: проверить давность последнего покоя у любого участника
    let longestActiveStreak = 0;
    for (const personId of allPersonIds) {
      const state = this._seasons.get(personId);
      if (!state || state.season === 'active') {
        const since = state?.since ? Date.now() - new Date(state.since).getTime() : Infinity;
        const hoursActive = since / (1000 * 60 * 60);
        if (hoursActive > longestActiveStreak) longestActiveStreak = hoursActive;
      }
    }

    const wounded = noOneResting && longestActiveStreak > thresholdHours;

    return {
      wounded,
      reason: wounded
        ? `Вся община в active более ${Math.round(longestActiveStreak)}ч — рана no_sabbath`
        : 'Ритм субботствования присутствует',
      restingCount,
      activeCount: rhythm.active,
      sabbathRatio: Math.round(sabbathRatio * 100) / 100,
      longestActiveStreakHours: Math.round(longestActiveStreak),
    };
  }

  /**
   * Export state for persistence.
   */
  exportState() {
    const entries = [];
    for (const [personId, state] of this._seasons) {
      entries.push({ personId, ...state });
    }
    return entries;
  }

  /**
   * Import state from persistence.
   */
  importState(entries) {
    if (!entries) return;
    for (const entry of entries) {
      const { personId, ...state } = entry;
      this._seasons.set(personId, state);
    }
  }
}
