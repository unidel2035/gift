/**
 * FlowObserver — наблюдатель потока
 *
 * Дар — не событие, а поток.
 * PatternObserver наблюдает акты. FlowObserver наблюдает течение.
 *
 * ПОТОК (ῥοή): дары текут, деньги текут, нужда высказана
 * ЗАСТОЙ (στάσις): накопление без передачи, потребление без благодарения, замкнутые пары
 *
 * Ключевые наблюдения — не score, а проза.
 */

class FlowObserver {
  /**
   * @param {object} context — { eventStore, eventBus, gratitude, ledger, oikoi, exchangeGuard }
   */
  constructor(context) {
    this._eventStore = context.eventStore;
    this._eventBus = context.eventBus;
    this._gratitude = context.gratitude;
    this._ledger = context.ledger;
    this._oikoi = context.oikoi;
    this._exchangeGuard = context.exchangeGuard;
  }

  /**
   * Full flow observation.
   */
  observe() {
    return {
      flowRate: this._observeFlowRate(),
      flowDirection: this._observeFlowDirection(),
      stagnation: this._observeStagnation(),
      cycles: this._observeCycles(),
      verticalAxis: this._observeVerticalAxis(),
      exchangeAlerts: this._exchangeGuard ? this._exchangeGuard.getAlerts().slice(-10) : [],
      moneyFlow: this._observeMoneyFlow(),
      needsFlow: this._observeNeedsFlow(),
    };
  }

  /**
   * Flow rate — gifts per time unit.
   */
  _observeFlowRate() {
    const allGifts = this._eventStore.getAll();
    if (allGifts.length === 0) return { observation: 'Даров пока нет.' };

    const first = new Date(allGifts[0].createdAt).getTime();
    const last = new Date(allGifts[allGifts.length - 1].createdAt).getTime();
    const daysSpan = Math.max(1, (last - first) / (24 * 60 * 60 * 1000));
    const rate = allGifts.length / daysSpan;

    return {
      totalGifts: allGifts.length,
      daysSpan: daysSpan.toFixed(1),
      giftsPerDay: rate.toFixed(1),
      observation: rate > 5 ? 'Поток активен — дары текут обильно'
        : rate > 1 ? 'Поток умеренный — дары текут'
        : rate > 0.1 ? 'Поток слабый — дары текут медленно'
        : 'Поток почти остановился',
    };
  }

  /**
   * Flow direction — are gifts flowing evenly or pooling?
   */
  _observeFlowDirection() {
    const giverCounts = new Map();
    const receiverCounts = new Map();

    for (const gift of this._eventStore.getAll()) {
      if (gift.giver) giverCounts.set(gift.giver, (giverCounts.get(gift.giver) || 0) + 1);
      if (gift.receiver && gift.receiver !== 'all') {
        receiverCounts.set(gift.receiver, (receiverCounts.get(gift.receiver) || 0) + 1);
      }
    }

    // Find concentration
    const maxGiver = this._findMax(giverCounts);
    const maxReceiver = this._findMax(receiverCounts);

    const giverConcentration = giverCounts.size > 0
      ? maxGiver.count / Array.from(giverCounts.values()).reduce((s, v) => s + v, 0) : 0;
    const receiverConcentration = receiverCounts.size > 0
      ? maxReceiver.count / Array.from(receiverCounts.values()).reduce((s, v) => s + v, 0) : 0;

    const observations = [];
    if (giverConcentration > 0.6) {
      observations.push(`Один дарящий (${maxGiver.key}) даёт >60% всех даров — хозяйство зависит от него`);
    }
    if (receiverConcentration > 0.6) {
      observations.push(`Один получающий (${maxReceiver.key}) получает >60% — дары стекаются в одну точку`);
    }
    if (observations.length === 0) {
      observations.push('Поток распределён равномерно');
    }

    return {
      uniqueGivers: giverCounts.size,
      uniqueReceivers: receiverCounts.size,
      giverConcentration: (giverConcentration * 100).toFixed(0) + '%',
      receiverConcentration: (receiverConcentration * 100).toFixed(0) + '%',
      observations,
    };
  }

  /**
   * Stagnation — where gifts or money stopped flowing.
   */
  _observeStagnation() {
    const stagnation = [];
    const now = Date.now();
    const STAGNATION_DAYS = 30;

    // Check persons who received but never gave
    const receiverSet = new Set();
    const giverSet = new Set();
    for (const gift of this._eventStore.getAll()) {
      if (gift.giver) giverSet.add(gift.giver);
      if (gift.receiver && gift.receiver !== 'all') receiverSet.add(gift.receiver);
    }

    for (const r of receiverSet) {
      if (!giverSet.has(r) && r !== '0' && r !== null) { // Exclude divine energy
        stagnation.push({
          entityId: r,
          type: 'receives_only',
          text: `${r} получает, но ни разу не дарил — потребление без передачи`,
        });
      }
    }

    // Check money stagnation via ledger
    if (this._ledger) {
      const flow = this._ledger.totalFlow();
      if (flow.totalAmount === 0 && this._eventStore.length > 5) {
        stagnation.push({
          type: 'no_money_flow',
          text: 'Материальные потоки не зафиксированы — либо дары нематериальны, либо потоки не записаны',
        });
      }
    }

    return stagnation;
  }

  /**
   * Perichoretic cycles — triadic gift flows.
   */
  _observeCycles() {
    if (!this._gratitude || !this._gratitude.findCycles) {
      return { observation: 'GratitudeGraph не подключен' };
    }

    const cycles = this._gratitude.findCycles ? this._gratitude.findCycles(3) : [];
    return {
      triads: cycles.filter(c => c.length >= 3),
      dyads: cycles.filter(c => c.length === 2),
      observation: cycles.filter(c => c.length >= 3).length > 0
        ? 'Перихоретические циклы обнаружены — дары текут по кругу через третьего'
        : 'Перихоресис не обнаружен — дары замкнуты в парах или не текут',
    };
  }

  /**
   * Vertical axis — is there eucharistia?
   */
  _observeVerticalAxis() {
    const eucharistia = this._eventStore.query({ type: 'eucharistia' });
    const totalGifts = this._eventStore.length;

    const ratio = totalGifts > 0 ? eucharistia.length / totalGifts : 0;

    return {
      eucharistiaCount: eucharistia.length,
      totalGifts,
      ratio: (ratio * 100).toFixed(0) + '%',
      observation: eucharistia.length === 0
        ? 'Εὐχαριστία отсутствует — вертикальная ось оборвана. Хозяйство рискует замкнуться.'
        : ratio > 0.3
          ? 'Вертикальная ось сильная — благодарение Источнику регулярное'
          : 'Εὐχαριστία есть, но редка. Наблюдать.',
    };
  }

  /**
   * Money flow observation.
   */
  _observeMoneyFlow() {
    if (!this._ledger) return { observation: 'AccountingLedger не подключен' };
    return this._ledger.totalFlow();
  }

  /**
   * Needs flow — are needs expressed and fulfilled?
   */
  _observeNeedsFlow() {
    if (!this._oikoi) return { observation: 'OikosRegistry не подключен' };

    const unmet = this._oikoi.unmetNeeds ? this._oikoi.unmetNeeds() : [];
    return {
      unmetNeeds: unmet.length,
      needs: unmet.slice(0, 5),
      observation: unmet.length === 0
        ? 'Все нужды закрыты — или никто не высказал нужду (гордыня? closure?)'
        : `${unmet.length} нужд не закрыты — общине есть куда дарить`,
    };
  }

  _findMax(map) {
    let maxKey = null, maxCount = 0;
    for (const [k, v] of map) {
      if (v > maxCount) { maxKey = k; maxCount = v; }
    }
    return { key: maxKey, count: maxCount };
  }
}

export { FlowObserver };
export default FlowObserver;
