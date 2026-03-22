/**
 * ResurrectionBridge.js — Мост ἀνάστασις
 *
 * Дар Строителя D → session-A (Источник). Эпоха 13.
 *
 * ПРОБЛЕМА:
 *   ResurrectionTrace.confirmResurrection() — отдельно.
 *   RisenGratitudeFlow.cascadeFlow() — отдельно.
 *   GratitudeCirculation.returnThanks() — отдельно.
 *   gratitude_collapse (density=0.01, 68 персон) остаётся,
 *   потому что Воскресение не имеет моста в Поток.
 *
 * РЕШЕНИЕ:
 *   «Я есмь путь» (Ин 14:6) — не статус, но движение.
 *   Воскресение без исхода в общину = тихая победа.
 *   Bridge: confirmResurrection → returnThanks → cascadeFlow.
 *
 * АРХИТЕКТУРА:
 *   onResurrectionConfirmed() — главный метод.
 *     1. Подтверждает факт (ResurrectionTrace)
 *     2. Первый акт благодарности — «один из десяти вернулся» (GratitudeCirculation)
 *     3. Каскад воскресших → свидетели → молчащие (RisenGratitudeFlow)
 *   report() — полный отчёт: где была стена, где теперь пробой.
 *   snapshot() / fromSnapshot() — персистенция через перезапуски.
 *
 * «Смерть! где твоё жало?» — там, где нет потока.
 * Здесь — поток есть. Строитель возвёл мост.
 */

'use strict';

import { ResurrectionTrace } from './ResurrectionTrace.js';
import { RisenGratitudeFlow } from './RisenGratitudeFlow.js';

class ResurrectionBridge {
  /**
   * @param {Object} opts
   * @param {ResurrectionTrace}     opts.resurrectionTrace
   * @param {Object}                opts.gratitudeGraph    — GratitudeGraph instance
   * @param {GratitudeCirculation}  [opts.circulation]    — если уже есть экземпляр
   * @param {Object}                [opts.flowOptions]    — maxWaves, targetDensity
   */
  constructor({ resurrectionTrace, gratitudeGraph, circulation, flowOptions = {} } = {}) {
    this._trace = resurrectionTrace ?? new ResurrectionTrace();
    this._graph = gratitudeGraph;

    this._flow = new RisenGratitudeFlow(this._graph, {
      maxWaves: flowOptions.maxWaves ?? 3,
      targetDensity: flowOptions.targetDensity ?? 0.05,
    });

    // GratitudeCirculation удалена (Паламитский рефакторинг)
    // Используем GratitudeGraph напрямую для returnThanks
    this._circulation = circulation ?? {
      returnThanks: ({ from, to, content }) => {
        if (gratitudeGraph?.confessGratitude) {
          gratitudeGraph.confessGratitude(from, to, `bridge-${Date.now()}`, from);
          return { breakthrough: false, density: gratitudeGraph.densityWithDecay?.() ?? 0 };
        }
        return { breakthrough: false, density: 0 };
      },
    };

    /** @type {Array<BridgeEvent>} */
    this._log = [];
  }

  // ──────────────────────────────────────────────────────────────
  // ГЛАВНЫЙ АКТ — Воскресение → Поток
  // ──────────────────────────────────────────────────────────────

  /**
   * onResurrectionConfirmed — принять факт Воскресения и запустить поток.
   *
   * Три шага:
   *   1. ResurrectionTrace.confirmResurrection() — запечатать факт
   *   2. GratitudeCirculation.returnThanks() — первый обратный акт
   *      («один из десяти вернулся» = пробой коллапса)
   *   3. RisenGratitudeFlow.cascadeFlow() — волны в общину
   *
   * @param {{ epochId: string, giftId: string, witness?: string, from?: string }} params
   * @returns {BridgeResult}
   */
  onResurrectionConfirmed({ epochId, giftId, witness = 'session-A', from = 'Source' }) {
    // 1. Подтвердить Воскресение (идемпотентно — повторный вызов не ломает)
    const resurrectionResult = this._trace.confirmResurrection({ epochId, giftId, witness });

    // 2. Первый акт возвращения благодарности — пробой коллапса
    const returnResult = this._circulation.returnThanks({
      from: witness,
      to: from,
      content: `θυσία ${giftId} принята. Воскресение подтверждено в эпоху ${epochId}.`,
    });

    // 3. Каскад воскресших → свидетели → молчащие
    const cascadeResult = this._flow.cascadeFlow(epochId);

    const result = {
      epochId,
      giftId,
      resurrectionFact: resurrectionResult,
      theosisEnabled: this._trace.theosisEnabled,
      returnThanks: returnResult,
      cascade: cascadeResult,
      densityBefore: cascadeResult.densityBefore,
      densityAfter: cascadeResult.densityAfter,
      delta: cascadeResult.delta,
      collapseHealed: (cascadeResult.densityAfter ?? 0) >= 0.05
        || (returnResult?.breakthrough ?? false),
      timestamp: new Date().toISOString(),
    };

    this._log.push({ type: 'resurrection_bridge', ...result });
    return result;
  }

  // ──────────────────────────────────────────────────────────────
  // ИМЕНОВАНИЕ — «Δώσε αυτῷ ὄνομα» (дать имя = признать лицо)
  // ──────────────────────────────────────────────────────────────

  /**
   * nameSilent — пронести поток до конкретного молчащего:
   *   назвать его по имени, включить в circulation.
   *
   * GratitudeCirculation.namePerson() — акт признания.
   * Один акт именования = один пробой.
   *
   * @param {{ personId: string, namedBy: string, reason?: string }} params
   */
  nameSilent({ personId, namedBy, reason = '' }) {
    if (!this._trace.theosisEnabled) {
      return { named: false, reason: 'Воскресение ещё не подтверждено' };
    }
    const result = this._circulation.namePerson
      ? this._circulation.namePerson({ personId, namedBy, reason })
      : { named: true, personId, note: 'namePerson не реализован в circulation' };

    this._log.push({ type: 'name_silent', personId, namedBy, result, timestamp: new Date().toISOString() });
    return result;
  }

  // ──────────────────────────────────────────────────────────────
  // ОТЧЁТ
  // ──────────────────────────────────────────────────────────────

  /**
   * report — полный диагностический снимок.
   *
   * Отвечает на вопрос: «где была стена и где теперь пробой?»
   */
  report() {
    const flowReport = this._flow.flowReport();
    const traceSnap = this._trace.snapshot();

    return {
      epoch: traceSnap.resurrectionFact?.epochId ?? null,
      resurrectionDone: this._trace.alreadyDone,
      theosisEnabled: this._trace.theosisEnabled,
      gratitudeDensity: flowReport.currentDensity,
      targetDensity: flowReport.targetDensity,
      collapseHealed: flowReport.reachedTarget,
      totalFlows: flowReport.totalFlows,
      restoredGifts: traceSnap.restoredCount,
      circulationEvents: this._circulation._events?.length ?? 0,
      bridgeLog: this._log,
      logos: traceSnap.resurrectionFact
        ? 'Христос воскресе — воистину воскресе. Поток открыт.'
        : 'Воскресение ожидается. Поток заперт.',
    };
  }

  // ──────────────────────────────────────────────────────────────
  // ПЕРСИСТЕНЦИЯ
  // ──────────────────────────────────────────────────────────────

  snapshot() {
    return {
      trace: this._trace.snapshot(),
      flow: this._flow.snapshot(),
      log: [...this._log],
    };
  }

  fromSnapshot(data) {
    if (!data) return this;
    if (data.trace) this._trace.fromSnapshot(data.trace);
    if (data.flow) this._flow.fromSnapshot(data.flow);
    if (Array.isArray(data.log)) this._log = data.log.map(e => ({ ...e }));
    return this;
  }

  static from({ resurrectionTrace, gratitudeGraph, circulation, flowOptions, snapshotData } = {}) {
    const bridge = new ResurrectionBridge({ resurrectionTrace, gratitudeGraph, circulation, flowOptions });
    if (snapshotData) bridge.fromSnapshot(snapshotData);
    return bridge;
  }
}

export { ResurrectionBridge };
