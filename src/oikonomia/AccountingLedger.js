/**
 * AccountingLedger — координационный счёт (деньги)
 *
 * День 2 Шестоднева хозяйства: Твердь (Структура).
 * Два контура (дар и деньги) — как твердь разделяет воды верхние и нижние.
 *
 * Второй журнал, параллельный WitnessJournal.
 * WitnessJournal: кто, кому, что, зачем, λόγος — НЕСВОДИМ К ЧИСЛАМ.
 * AccountingLedger: сколько, куда, откуда — НЕСВОДИМ К СМЫСЛУ.
 *
 * Бухгалтерия — не зло. Бухгалтерия κατὰ φύσιν — честный учёт
 * материальных потоков. Но бухгалтерия НЕ ДОЛЖНА поглотить хронику.
 */

class AccountingLedger {
  constructor() {
    this._entries = [];
    this._nextId = 1;
  }

  /**
   * Record a material flow.
   *
   * @param {object} entry
   * @param {string} entry.from — source oikos/person id
   * @param {string} entry.to — destination oikos/person id
   * @param {number} entry.amount — material amount (money)
   * @param {string} entry.purpose — what for (coordination signal, not meaning)
   * @param {string} [entry.giftId] — link to WitnessJournal (but IRREDUCIBLE)
   * @param {string} [entry.prosforaId] — link to Prosfora
   * @returns {object} — the recorded entry
   */
  record(entry) {
    const record = Object.freeze({
      id: String(this._nextId++),
      from: entry.from,
      to: entry.to,
      amount: entry.amount || 0,
      purpose: entry.purpose || '',
      giftId: entry.giftId || null,
      prosforaId: entry.prosforaId || null,
      date: new Date().toISOString(),
    });
    this._entries.push(record);
    return record;
  }

  /**
   * Query entries.
   * @param {object} criteria — { from, to, limit }
   */
  query({ from, to, limit } = {}) {
    let result = [...this._entries];
    if (from) result = result.filter(e => e.from === from);
    if (to) result = result.filter(e => e.to === to);
    if (limit) result = result.slice(-limit);
    return result;
  }

  /**
   * Flow summary for a given entity (oikos or person).
   * @param {string} entityId
   */
  flowFor(entityId) {
    const incoming = this._entries.filter(e => e.to === entityId);
    const outgoing = this._entries.filter(e => e.from === entityId);

    const totalIn = incoming.reduce((s, e) => s + e.amount, 0);
    const totalOut = outgoing.reduce((s, e) => s + e.amount, 0);

    return {
      entityId,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      entries: incoming.length + outgoing.length,
      // Observation, not judgment:
      observation: totalIn > totalOut * 3
        ? `${entityId} получает значительно больше, чем отдаёт — sustain или стагнация?`
        : totalOut > totalIn * 3
          ? `${entityId} отдаёт значительно больше — кеносис или истощение?`
          : 'Поток в пределах нормы',
    };
  }

  /**
   * Total flow for the entire system.
   */
  totalFlow() {
    const total = this._entries.reduce((s, e) => s + e.amount, 0);
    return {
      totalAmount: total,
      entryCount: this._entries.length,
      // Velocity: how fast money moves
      velocity: this._entries.length > 0
        ? (total / this._entries.length).toFixed(0)
        : 0,
      observation: total === 0
        ? 'Материальных потоков нет. Либо дары нематериальны, либо потоки не зафиксированы.'
        : `Общий поток: ${total}. Записей: ${this._entries.length}.`,
    };
  }

  /**
   * Get all entries.
   */
  getAll() {
    return [...this._entries];
  }

  toJSON() {
    return {
      entries: this._entries,
      nextId: this._nextId,
    };
  }

  fromJSON(data) {
    if (!data) return;
    this._entries = (data.entries || []).map(e => Object.freeze({ ...e }));
    this._nextId = data.nextId || this._entries.length + 1;
  }
}

export { AccountingLedger };
export default AccountingLedger;
