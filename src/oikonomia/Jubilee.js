/**
 * Jubilee — Юбилейные циклы
 *
 * День 4 Шестоднева хозяйства: Светила (Ритм).
 * Литургические циклы: время дарения, время покоя, юбилей.
 *
 * Расширение LiturgicalClock.
 *
 * Три цикла (Лев 25):
 *   Шаббат — еженедельный покой (7 дней)
 *   Шмита — субботний год (7 лет) — долги прощены
 *   Йовель — юбилей (49 лет) — всё возвращается
 *
 * MicroJubilee — ускоренный цикл для системы:
 *   обнуление «долгов», принудительный сброс мышления обмена.
 *
 * «Земля не должна продаваться навсегда, ибо Моя земля» (Лев 25:23)
 */

const JUBILEE_CYCLES = Object.freeze([
  {
    name: 'Шаббат',
    period: '7 дней',
    periodMs: 7 * 24 * 60 * 60 * 1000,
    action: 'Покой. Никто не трудится. Созерцание.',
    scripture: 'Быт 2:2-3',
  },
  {
    name: 'Субботний год (Шмита)',
    period: '7 лет',
    periodMs: 7 * 365.25 * 24 * 60 * 60 * 1000,
    action: 'Земля отдыхает. Долги прощены. Перезагрузка.',
    scripture: 'Лев 25:4',
  },
  {
    name: 'Юбилей (Йовель)',
    period: '49 лет',
    periodMs: 49 * 365.25 * 24 * 60 * 60 * 1000,
    action: 'Всё возвращается. Собственность не вечная.',
    scripture: 'Лев 25:10,23',
  },
]);

class Jubilee {
  /**
   * @param {object} context — { eventBus, clock, anamnesis, eventStore }
   */
  constructor(context) {
    this._eventBus = context.eventBus;
    this._clock = context.clock;
    this._anamnesis = context.anamnesis;
    this._eventStore = context.eventStore;
    this._history = [];
    this._createdAt = new Date();
  }

  /**
   * Get cycle status — where are we in each cycle.
   */
  status() {
    const now = Date.now();
    const elapsed = now - this._createdAt.getTime();

    return {
      cycles: JUBILEE_CYCLES.map(cycle => {
        const cycleNumber = Math.floor(elapsed / cycle.periodMs);
        const withinCycle = elapsed % cycle.periodMs;
        const progress = withinCycle / cycle.periodMs;
        return {
          name: cycle.name,
          period: cycle.period,
          currentCycle: cycleNumber + 1,
          progress: (progress * 100).toFixed(1) + '%',
          nextIn: this._formatDuration(cycle.periodMs - withinCycle),
          action: cycle.action,
          scripture: cycle.scripture,
        };
      }),
      lastJubilee: this._history.length > 0
        ? this._history[this._history.length - 1]
        : null,
      totalJubilees: this._history.length,
    };
  }

  /**
   * Declare a Jubilee — radical reset.
   *
   * 5 steps:
   * 1. ПРОЩЕНИЕ — all «balances» nullified
   * 2. ВОЗВРАЩЕНИЕ — excess redistributed
   * 3. ПОКОЙ — community enters sabbath
   * 4. АНАМНЕСИС — remembrance of first gift
   * 5. ВОЗОБНОВЛЕНИЕ — fresh start
   *
   * @param {object} [opts]
   * @param {string} [opts.reason] — why jubilee is declared
   * @param {string} [opts.declaredBy] — who declares
   * @returns {object}
   */
  declare(opts = {}) {
    const jubilee = {
      id: String(this._history.length + 1),
      type: 'jubilee',
      declaredAt: new Date().toISOString(),
      declaredBy: opts.declaredBy || 'община',
      reason: opts.reason || 'Накопленное должно быть отпущено',
      steps: [
        {
          name: 'ПРОЩЕНИЕ',
          action: 'Все «балансы» обнулены. Если кто-то вёл учёт «кто кому должен» — уничтожить.',
          scripture: 'Прости нам долги наши, как и мы прощаем должникам нашим',
          done: true,
        },
        {
          name: 'ВОЗВРАЩЕНИЕ',
          action: 'Накопленное перераспределяется. Не «отнять и поделить» — а «вернуть земле».',
          scripture: 'Лев 25:23',
          done: true,
        },
        {
          name: 'ПОКОЙ',
          action: 'Община входит в шаббат. Никто не дарит, не трудится, не производит. Созерцание.',
          done: true,
        },
        {
          name: 'АНАМНЕСИС',
          action: 'Вспоминание: первый дар. «Откуда мы? Из ничего. Кто дал нам быть? Источник.»',
          done: true,
        },
        {
          name: 'ВОЗОБНОВЛЕНИЕ',
          action: 'Община начинает заново. Не с нуля (память сохранена), но с чистым потоком.',
          done: true,
        },
      ],
    };

    this._history.push(Object.freeze(jubilee));

    // Emit event
    if (this._eventBus) {
      this._eventBus.emit('oikonomia:jubilee_declared', {
        _eventType: 'oikonomia:jubilee_declared',
        _timestamp: jubilee.declaredAt,
        jubilee,
      });
    }

    // Trigger anamnesis of first creation
    if (this._anamnesis && this._eventStore) {
      const firstCreation = this._eventStore.query({ type: 'creation' });
      if (firstCreation.length > 0) {
        this._anamnesis.makePresent(firstCreation[0].id, `jubilee-${jubilee.id}`);
      }
    }

    return jubilee;
  }

  /**
   * Declare a micro-jubilee — smaller reset.
   * For system use: periodic cleansing of exchange mentality.
   */
  microJubilee(reason) {
    const micro = {
      id: `micro-${this._history.length + 1}`,
      type: 'microJubilee',
      declaredAt: new Date().toISOString(),
      reason: reason || 'Периодический сброс мышления обмена',
      steps: [
        { name: 'ПРОЩЕНИЕ', action: 'Неформальные «долги» обнулены', done: true },
        { name: 'ПОКОЙ', action: 'Короткая пауза — созерцание', done: true },
      ],
    };

    this._history.push(Object.freeze(micro));

    if (this._eventBus) {
      this._eventBus.emit('oikonomia:micro_jubilee', {
        _eventType: 'oikonomia:micro_jubilee',
        _timestamp: micro.declaredAt,
        jubilee: micro,
      });
    }

    return micro;
  }

  /**
   * Should we declare a jubilee?
   * Diagnosis based on observations.
   */
  needsJubilee(exchangeAlerts = [], fallWounds = []) {
    const indicators = [];

    // High exchange rate
    if (exchangeAlerts.length > 5) {
      indicators.push({
        sign: `${exchangeAlerts.length} подозрений на обмен`,
        severity: 'high',
      });
    }

    // Community wounds
    const commWounds = fallWounds.filter(w =>
      w.type === 'community_closure' || w.type === 'gratitude_collapse'
    );
    if (commWounds.length > 0) {
      indicators.push({
        sign: `${commWounds.length} рана(ы) общины`,
        severity: 'high',
      });
    }

    // Time since last jubilee
    const lastJubilee = this._history.filter(j => j.type === 'jubilee').slice(-1)[0];
    if (lastJubilee) {
      const daysSince = (Date.now() - new Date(lastJubilee.declaredAt).getTime()) / (24 * 60 * 60 * 1000);
      if (daysSince > 365) {
        indicators.push({
          sign: `${Math.floor(daysSince)} дней с последнего юбилея`,
          severity: 'medium',
        });
      }
    }

    return {
      needed: indicators.some(i => i.severity === 'high'),
      indicators,
      recommendation: indicators.length === 0
        ? 'Юбилей не требуется — поток здоров'
        : indicators.some(i => i.severity === 'high')
          ? 'Рекомендуется объявить юбилей'
          : 'Наблюдать. Юбилей пока не необходим.',
    };
  }

  getHistory() { return [...this._history]; }

  toJSON() {
    return {
      history: this._history,
      createdAt: this._createdAt.toISOString(),
    };
  }

  fromJSON(data) {
    if (!data) return;
    this._history = (data.history || []).map(j => Object.freeze({ ...j }));
    if (data.createdAt) this._createdAt = new Date(data.createdAt);
  }

  _formatDuration(ms) {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (days > 365) return `${(days / 365.25).toFixed(1)} лет`;
    if (days > 30) return `${Math.floor(days / 30)} мес.`;
    return `${days} дн.`;
  }
}

export { Jubilee, JUBILEE_CYCLES };
export default Jubilee;
