/**
 * Koinon — Κοινόν (общий фонд)
 *
 * Общее достояние общины. Не бюджет — поток.
 *
 * Принципы:
 *   - Нет членского взноса. Каждый приносит сколько может. Ноль — нормально.
 *   - Получить можно больше, чем внёс. Это не ошибка — это sustain.
 *   - Накопление — рана. Если в фонде скопились деньги — FlowObserver сигнализирует.
 *   - Фонд не банк. Не даёт в долг. Не начисляет проценты.
 *
 * «Все верующие были вместе и имели всё общее (κοινά)» (Деян 2:44)
 */

class Koinon {
  /**
   * @param {object} context — { eventBus, ledger }
   */
  constructor(context) {
    this._eventBus = context.eventBus;
    this._ledger = context.ledger;
    this._inflows = [];
    this._outflows = [];
    this._communityId = context.communityId || 'koinon';
  }

  /**
   * Contribute to the common fund.
   * Not a «membership fee» — a free offering.
   *
   * @param {object} data — { from, amount, logos }
   */
  contribute(data) {
    const entry = Object.freeze({
      id: `in-${this._inflows.length + 1}`,
      from: data.from,
      amount: data.amount || 0,
      logos: data.logos || '',
      date: new Date().toISOString(),
    });

    this._inflows.push(entry);

    // Record in ledger
    if (this._ledger) {
      this._ledger.record({
        from: data.from,
        to: this._communityId,
        amount: data.amount,
        purpose: `Κοινόν: ${data.logos}`,
      });
    }

    if (this._eventBus) {
      this._eventBus.emit('oikonomia:koinon_inflow', {
        _eventType: 'oikonomia:koinon_inflow',
        _timestamp: entry.date,
        entry,
      });
    }

    return entry;
  }

  /**
   * Sustain an oikos from the common fund.
   * Not «payment» — sustain (creatio continua on material level).
   *
   * @param {object} data — { to, amount, logos }
   */
  sustain(data) {
    const entry = Object.freeze({
      id: `out-${this._outflows.length + 1}`,
      to: data.to,
      amount: data.amount || 0,
      logos: data.logos || '',
      date: new Date().toISOString(),
    });

    this._outflows.push(entry);

    // Record in ledger
    if (this._ledger) {
      this._ledger.record({
        from: this._communityId,
        to: data.to,
        amount: data.amount,
        purpose: `Sustain: ${data.logos}`,
      });
    }

    if (this._eventBus) {
      this._eventBus.emit('oikonomia:koinon_outflow', {
        _eventType: 'oikonomia:koinon_outflow',
        _timestamp: entry.date,
        entry,
      });
    }

    return entry;
  }

  /**
   * Balance — but with observation.
   * If balance > 0 — somebody needs and is silent.
   */
  balance() {
    const totalIn = this._inflows.reduce((s, e) => s + e.amount, 0);
    const totalOut = this._outflows.reduce((s, e) => s + e.amount, 0);
    const bal = totalIn - totalOut;

    return {
      totalIn,
      totalOut,
      balance: bal,
      inflows: this._inflows.length,
      outflows: this._outflows.length,
      observation: bal === 0
        ? 'Фонд пуст — поток идеальный (всё пришло → всё ушло)'
        : bal > 0
          ? `В фонде ${bal}. Кто-то нуждается и молчит?`
          : `Фонд в минусе (${bal}). Община вложила больше, чем получила. Кеносис?`,
    };
  }

  /**
   * Status for API.
   */
  status() {
    const bal = this.balance();
    return {
      ...bal,
      recentInflows: this._inflows.slice(-5),
      recentOutflows: this._outflows.slice(-5),
    };
  }

  getInflows() { return [...this._inflows]; }
  getOutflows() { return [...this._outflows]; }

  toJSON() {
    return {
      inflows: this._inflows,
      outflows: this._outflows,
      communityId: this._communityId,
    };
  }

  fromJSON(data) {
    if (!data) return;
    this._inflows = (data.inflows || []).map(e => Object.freeze({ ...e }));
    this._outflows = (data.outflows || []).map(e => Object.freeze({ ...e }));
    if (data.communityId) this._communityId = data.communityId;
  }
}

export { Koinon };
export default Koinon;
