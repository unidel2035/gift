/**
 * Prosfora — Προσφορά (приношение)
 *
 * День 3 Шестоднева хозяйства: Земля (Плодоношение).
 * Земля производит — но не для себя.
 *
 * Приношение — акт, которым плод труда входит в поток дара.
 * Не «товар → продажа → деньги», а «труд → плод → приношение → община → нужда закрыта → евхаристия».
 *
 * estimatedCost — не цена (дар не имеет цены).
 * Это координационный сигнал: сколько материальных ресурсов нужно,
 * чтобы приношение стало возможным. Деньги — ирригация, estimatedCost — сколько воды нужно каналу.
 */

const PROSFORA_STATUS = Object.freeze({
  OFFERED: 'offered',
  RECEIVED: 'received',
  RETURNED_TO_EARTH: 'returned_to_earth', // Невостребовано — вернулось в круговорот
});

class Prosfora {
  /**
   * @param {object} context — { eventStore, eventBus, ledger }
   */
  constructor(context) {
    this._eventStore = context.eventStore;
    this._eventBus = context.eventBus;
    this._ledger = context.ledger;
    this._offerings = [];
    this._nextId = 1;
  }

  /**
   * Offer a prosfora — плод труда входит в поток.
   *
   * @param {object} data
   * @param {string} data.offerer — personId who brings
   * @param {string} data.content — what is brought (fruit of labor)
   * @param {string} data.logos — why (λόγος of the offering)
   * @param {string} [data.oikosFrom] — from which household
   * @param {string} [data.forWhom] — for whom (or null = for all)
   * @param {number} [data.estimatedCost] — coordination signal (not price!)
   * @param {number} [data.moneyUsed] — money spent creating this
   * @returns {object}
   */
  offer(data) {
    const prosfora = Object.freeze({
      id: String(this._nextId++),
      offerer: data.offerer,
      content: data.content,
      logos: data.logos || '',
      oikosFrom: data.oikosFrom || null,
      forWhom: data.forWhom || null,
      material: {
        estimatedCost: data.estimatedCost || null,
        moneyUsed: data.moneyUsed || null,
      },
      status: PROSFORA_STATUS.OFFERED,
      createdAt: new Date().toISOString(),
      receivedAt: null,
    });

    this._offerings.push(prosfora);

    // Record in accounting ledger if money was used
    if (data.moneyUsed && this._ledger) {
      this._ledger.record({
        from: data.offerer,
        to: 'prosfora',
        amount: data.moneyUsed,
        purpose: `Затраты на приношение: ${data.content}`,
        prosforaId: prosfora.id,
      });
    }

    // Emit event if bus available
    if (this._eventBus) {
      this._eventBus.emit('oikonomia:prosfora_offered', {
        _eventType: 'oikonomia:prosfora_offered',
        _timestamp: prosfora.createdAt,
        prosfora,
      });
    }

    return prosfora;
  }

  /**
   * Mark prosfora as received.
   * @param {string} prosforaId
   * @param {string} receiverId — who received it
   */
  receive(prosforaId, receiverId) {
    const idx = this._offerings.findIndex(p => p.id === prosforaId);
    if (idx < 0) return { error: 'Приношение не найдено' };

    const original = this._offerings[idx];
    if (original.status !== PROSFORA_STATUS.OFFERED) {
      return { error: `Приношение уже в статусе: ${original.status}` };
    }

    // Create new record (immutability)
    const received = Object.freeze({
      ...original,
      status: PROSFORA_STATUS.RECEIVED,
      receivedAt: new Date().toISOString(),
      receivedBy: receiverId,
    });
    this._offerings[idx] = received;

    if (this._eventBus) {
      this._eventBus.emit('oikonomia:prosfora_received', {
        _eventType: 'oikonomia:prosfora_received',
        _timestamp: received.receivedAt,
        prosfora: received,
      });
    }

    return received;
  }

  /**
   * List all offerings.
   * @param {object} [filter] — { offerer, status, forWhom }
   */
  list(filter = {}) {
    let result = [...this._offerings];
    if (filter.offerer) result = result.filter(p => p.offerer === filter.offerer);
    if (filter.status) result = result.filter(p => p.status === filter.status);
    if (filter.forWhom) result = result.filter(p => p.forWhom === filter.forWhom || p.forWhom === null);
    return result;
  }

  /**
   * Available offerings (not yet received).
   */
  available() {
    return this._offerings.filter(p => p.status === PROSFORA_STATUS.OFFERED);
  }

  /**
   * Match needs to offerings.
   * @param {object[]} needs — array of { content, personId }
   * @returns {object[]} — potential matches
   */
  matchNeeds(needs) {
    const available = this.available();
    const matches = [];

    for (const need of needs) {
      const matching = available.filter(p =>
        p.forWhom === null || p.forWhom === need.personId
      );
      if (matching.length > 0) {
        matches.push({
          need,
          potentialOfferings: matching.map(p => ({
            id: p.id, content: p.content, offerer: p.offerer
          })),
        });
      }
    }
    return matches;
  }

  getAll() { return [...this._offerings]; }

  toJSON() {
    return { offerings: this._offerings, nextId: this._nextId };
  }

  fromJSON(data) {
    if (!data) return;
    this._offerings = (data.offerings || []).map(p => Object.freeze({ ...p }));
    this._nextId = data.nextId || this._offerings.length + 1;
  }
}

export { Prosfora, PROSFORA_STATUS };
export default Prosfora;
