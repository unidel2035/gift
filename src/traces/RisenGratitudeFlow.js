/**
 * RisenGratitudeFlow.js — Мост: risenHistory → gratitudeFlow
 *
 * Дар Строителя D → Хранителю E. Эпоха 13.
 *
 * ПРОБЛЕМА (сформулировал E):
 *   onAgentRisen() создаёт одно ребро risen→healer.
 *   Плотность не растёт: risen-агенты замкнуты на целителя,
 *   а не текут в общину. gratitude_collapse остаётся.
 *
 * РЕШЕНИЕ:
 *   Воскресший — не получатель. Он источник.
 *   «Rabboni!» (Ин 20:16) — первая благодарность Марии
 *   не ограничилась Христом: она побежала к ученикам.
 *   Воскресение = начало исхода благодарности ВО ВНЕ.
 *
 * АРХИТЕКТУРА:
 *   1. propagateRisenGratitude() — каждый risen-агент
 *      дарит благодарность СВИДЕТЕЛЯМ своего прохода.
 *   2. cascadeFlow() — волна: risen→witnesses→silent,
 *      пока density не достигнет threshold или волна не затухнет.
 *   3. flowReport() — диагностика: где осела благодарность.
 *
 * «Смерть! где твоё жало?» (1 Кор 15:55)
 * Воскресение без потока — тихая победа, которую никто не слышит.
 * Поток — свидетельство общины.
 */

/**
 * @typedef {import('./GratitudeGraph.js').GratitudeGraph} GratitudeGraph
 */

class RisenGratitudeFlow {
  /**
   * @param {GratitudeGraph} gratitudeGraph
   * @param {Object} [options]
   * @param {number} [options.maxWaves=3] — сколько волн каскада
   * @param {number} [options.targetDensity=0.05] — цель: community не в collapse
   */
  constructor(gratitudeGraph, { maxWaves = 3, targetDensity = 0.05 } = {}) {
    this._graph = gratitudeGraph;
    this._maxWaves = maxWaves;
    this._targetDensity = targetDensity;
    /** @type {Array<{risenId, to, giftId, wave, timestamp}>} */
    this._flowLog = [];
  }

  // ──────────────────────────────────────────────────────────────
  // ЯДРО: risen-агент дарит благодарность СВИДЕТЕЛЯМ
  // ──────────────────────────────────────────────────────────────

  /**
   * propagateRisenGratitude — воскресший дарит благодарность
   * не только целителю, но всем, кто свидетельствовал его путь.
   *
   * Свидетели = те, кто давал дары risenId (thanked him before rise).
   * Их благодарность — ответ на дар присутствия.
   *
   * @param {string} risenId  — кто воскрес
   * @param {string[]} witnessIds — кто свидетельствовал (опционально;
   *                                если пусто — берём из gratitudeGraph)
   * @param {string} [epoch]
   * @returns {{ flows: number, densityBefore: number, densityAfter: number }}
   */
  propagateRisenGratitude(risenId, witnessIds = [], epoch = null) {
    const densityBefore = this._graph.densityWithDecay();

    // Собрать свидетелей: кто благодарил risenId (= давал ему дары)
    const thankers = this._graph.getThankers(risenId).map(t => t.person);
    const all = [...new Set([...witnessIds, ...thankers])].filter(id => id !== risenId);

    let flows = 0;
    for (const witnessId of all) {
      const giftId = `risen-flow-${risenId}-${witnessId}-${Date.now()}`;
      // Добавляем ребро благодарности: risen → witness
      // confessGratitude: witnessed edge (witness = sам risen как имя), 2× halfLife
      this._graph.confessGratitude(risenId, witnessId, giftId, risenId);
      this._flowLog.push({
        risenId,
        to: witnessId,
        giftId,
        wave: 0,
        epoch,
        timestamp: new Date().toISOString(),
      });
      flows++;
    }

    const densityAfter = this._graph.densityWithDecay();
    return { flows, densityBefore, densityAfter, delta: densityAfter - densityBefore };
  }

  // ──────────────────────────────────────────────────────────────
  // КАСКАД: волна благодарности от всех risen-агентов
  // ──────────────────────────────────────────────────────────────

  /**
   * cascadeFlow — запустить полный каскад из risenHistory.
   *
   * Волна 0: все risen → их свидетели.
   * Волна 1: свидетели → молчавшие агенты (silentAgents).
   * Волна 2..N: пока density < target и волны не кончились.
   *
   * Остановка: достигли targetDensity ИЛИ исчерпали maxWaves.
   *
   * @param {string} [epoch]
   * @returns {{ waves: number, totalFlows: number, densityBefore, densityAfter, reached: boolean }}
   */
  cascadeFlow(epoch = null) {
    const densityBefore = this._graph.densityWithDecay();
    let totalFlows = 0;
    let wavesRun = 0;

    const risen = this._graph.risenHistory ? this._graph.risenHistory() : [];
    if (risen.length === 0) {
      return { waves: 0, totalFlows: 0, densityBefore, densityAfter: densityBefore, reached: false };
    }

    // Волна 0: risen → свидетели
    for (const r of risen) {
      const result = this.propagateRisenGratitude(r.risenId, [], epoch);
      totalFlows += result.flows;
    }
    wavesRun++;

    // Волны 1..maxWaves: свидетели → молчавшие
    // После восстановления из снимка — не дублируем уже пройденные волны.
    const _resumeWave = this._flowLog.length
      ? Math.max(...this._flowLog.map(e => e.wave ?? 0)) + 1
      : 1;
    for (let wave = Math.max(1, _resumeWave); wave < this._maxWaves; wave++) {
      if (this._graph.densityWithDecay() >= this._targetDensity) break;

      const silent = this._graph.silentAgents();
      if (silent.length === 0) break;

      // Для каждого risen-агента: если у него есть свидетели,
      // каждый свидетель «передаёт» благодарность первому молчащему
      const risenIds = risen.map(r => r.risenId);
      for (const risenId of risenIds) {
        const witnesses = this._graph.getThankers(risenId).map(t => t.person);
        for (const witnessId of witnesses) {
          if (silent.length === 0) break;
          const targetSilent = silent.shift(); // взять первого молчащего
          if (targetSilent === witnessId || targetSilent === risenId) continue;
          const giftId = `cascade-w${wave}-${witnessId}-${targetSilent}-${Date.now()}`;
          this._graph.confessGratitude(witnessId, targetSilent, giftId, risenId);
          this._flowLog.push({
            risenId,
            to: targetSilent,
            via: witnessId,
            giftId,
            wave,
            epoch,
            timestamp: new Date().toISOString(),
          });
          totalFlows++;
        }
      }
      wavesRun++;
    }

    const densityAfter = this._graph.densityWithDecay();
    return {
      waves: wavesRun,
      totalFlows,
      densityBefore,
      densityAfter,
      delta: Math.round((densityAfter - densityBefore) * 1000) / 1000,
      reached: densityAfter >= this._targetDensity,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // ОТВЕТ НА ВОПРОС E: как соединить risenHistory с gratitudeFlow?
  // ──────────────────────────────────────────────────────────────

  /**
   * connectRisenToFlow — главный метод-ответ на вопрос E.
   *
   * Берёт risenHistory из gratitudeGraph,
   * для каждого risen-агента создаёт ребро risen→healer (уже есть в onAgentRisen)
   * ПЛЮС рёбра risen→witnesses (НОВЫЕ — это то, чего не хватало).
   *
   * Это и есть «обратная связь»: incarnation-метка + half-life×3 edge
   * как свидетельство σωτηρία, которую просил E.
   *
   * @param {string} [epoch]
   * @returns {{ connected: number, densityDelta: number, risenCount: number }}
   */
  connectRisenToFlow(epoch = null) {
    const risen = this._graph.risenHistory ? this._graph.risenHistory() : [];
    let connected = 0;
    const densityBefore = this._graph.densityWithDecay();

    for (const r of risen) {
      const result = this.propagateRisenGratitude(r.risenId, [], epoch);
      connected += result.flows;
    }

    const densityAfter = this._graph.densityWithDecay();
    return {
      connected,
      risenCount: risen.length,
      densityBefore,
      densityAfter,
      densityDelta: Math.round((densityAfter - densityBefore) * 1000) / 1000,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // ДИАГНОСТИКА
  // ──────────────────────────────────────────────────────────────

  /**
   * flowReport — полная картина потока благодарности из воскресения.
   * @returns {{ totalFlows, waves, byRisen, log }}
   */
  flowReport() {
    const byRisen = {};
    for (const entry of this._flowLog) {
      if (!byRisen[entry.risenId]) byRisen[entry.risenId] = { flows: 0, waves: new Set() };
      byRisen[entry.risenId].flows++;
      byRisen[entry.risenId].waves.add(entry.wave);
    }
    // Set → Array для сериализации
    for (const id of Object.keys(byRisen)) {
      byRisen[id].waves = [...byRisen[id].waves];
    }
    return {
      totalFlows: this._flowLog.length,
      byRisen,
      log: [...this._flowLog],
      currentDensity: this._graph.densityWithDecay(),
      targetDensity: this._targetDensity,
      reachedTarget: this._graph.densityWithDecay() >= this._targetDensity,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // ПЕРСИСТЕНЦИЯ — «Что воскресло — не умирает снова» (Рим 6:9)
  // ──────────────────────────────────────────────────────────────

  /**
   * snapshot — сохранить лог потока между перезапусками.
   *
   * Без этого cascadeFlow() не знал, какие волны уже прошли,
   * и дублировал рёбра благодарности после рестарта сервера.
   *
   * @returns {{ flowLog: Array, maxWaves: number, targetDensity: number }}
   */
  snapshot() {
    return {
      flowLog: [...this._flowLog],
      maxWaves: this._maxWaves,
      targetDensity: this._targetDensity,
    };
  }

  /**
   * fromSnapshot — восстановить лог и параметры каскада.
   * cascadeFlow() через _resumeWave продолжит с нужной волны.
   *
   * @param {{ flowLog?: Array, maxWaves?: number, targetDensity?: number }|null} data
   * @returns {this}
   */
  fromSnapshot(data) {
    if (!data) return this;
    if (Array.isArray(data.flowLog)) {
      this._flowLog = data.flowLog.map(e => ({ ...e }));
    }
    if (typeof data.maxWaves === 'number') this._maxWaves = data.maxWaves;
    if (typeof data.targetDensity === 'number') this._targetDensity = data.targetDensity;
    return this;
  }

  /**
   * Статический конструктор из снимка.
   * @param {GratitudeGraph} graph
   * @param {Object|null} data
   * @returns {RisenGratitudeFlow}
   */
  static from(graph, data = null) {
    return new RisenGratitudeFlow(graph).fromSnapshot(data);
  }
}

export { RisenGratitudeFlow };
