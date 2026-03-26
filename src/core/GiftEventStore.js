/**
 * GiftEventStore — append-only хранилище событий с индексами
 *
 * Заменяет `_gifts = []` в GiftEngine.
 * Дары — неизменяемые записи. Статус (accepted/declined) —
 * отдельное событие с correlationId к оригиналу.
 *
 * O(1) доступ по id, O(k) запросы через индексы.
 */

class GiftEventStore {
  constructor() {
    this._events = [];              // Append-only
    this._byId = new Map();         // id → event
    this._byGiver = new Map();      // personId → event[]
    this._byReceiver = new Map();   // personId → event[]
    this._byTelos = new Map();      // telos → event[]
    this._byType = new Map();       // ontologicalType → event[]
    this._byStatus = new Map();     // status → event[]
    this._nextId = 1;

    // Status projections: id → latest status event (for accept/decline)
    this._statusOverrides = new Map(); // giftId → { status, acceptedAt, ... }
  }

  /**
   * Monotonic ID counter.
   */
  nextId() {
    return String(this._nextId++);
  }

  /**
   * Set next ID (for restoring from persistence).
   */
  setNextId(n) {
    if (n > this._nextId) this._nextId = n;
  }

  /**
   * Append an event. Immutable once appended.
   * Updates all indices.
   */
  append(event) {
    // Freeze to enforce immutability
    const frozen = Object.isFrozen(event) ? event : Object.freeze({ ...event });
    this._events.push(frozen);
    this._indexEvent(frozen);

    // Track max ID
    const num = parseInt(frozen.id);
    if (!isNaN(num) && num >= this._nextId) this._nextId = num + 1;

    return frozen;
  }

  /**
   * Apply a status change (accept/decline) without mutating the original.
   * Creates a projection overlay.
   */
  applyStatusChange(giftId, statusData) {
    this._statusOverrides.set(String(giftId), Object.freeze({ ...statusData }));
    // Update status index
    const original = this._byId.get(String(giftId));
    if (original) {
      // Remove from old status index
      const oldStatus = original.status;
      const oldList = this._byStatus.get(oldStatus);
      if (oldList) {
        const idx = oldList.indexOf(original);
        if (idx >= 0) oldList.splice(idx, 1);
      }
      // Add to new status index
      this._addToIndex(this._byStatus, statusData.status, original);
    }
  }

  /**
   * Get event by ID. Returns projected view (merged with status override).
   */
  getById(id) {
    const event = this._byId.get(String(id));
    if (!event) return null;
    const override = this._statusOverrides.get(String(id));
    if (override) {
      // Return projected view — original + status overlay
      return Object.freeze({ ...event, ...override });
    }
    return event;
  }

  /**
   * Query events by criteria. Returns projected views.
   *
   * @param {object} criteria — { status, giver, receiver, telos, type, limit }
   * @returns {object[]}
   */
  query({ status, giver, receiver, telos, type, limit, includeDead } = {}) {
    let candidates = null;

    // Pick the smallest index to start with
    if (type) {
      candidates = this._byType.get(type) || [];
    } else if (giver) {
      candidates = this._byGiver.get(String(giver)) || [];
    } else if (receiver) {
      candidates = this._byReceiver.get(String(receiver)) || [];
    } else if (telos) {
      candidates = this._byTelos.get(telos) || [];
    } else if (status) {
      candidates = this._byStatus.get(status) || [];
    } else {
      candidates = this._events;
    }

    let result = [...candidates];

    // Apply remaining filters
    if (status && !(!type && !giver && !receiver && !telos)) {
      result = result.filter(e => this._getStatus(e) === status);
    }
    if (giver && candidates !== this._byGiver.get(String(giver))) {
      result = result.filter(e => e.giver === String(giver) || e.giverName === giver);
    }
    if (receiver && candidates !== this._byReceiver.get(String(receiver))) {
      result = result.filter(e => e.receiver === String(receiver) || e.receiverName === receiver);
    }
    if (telos && candidates !== this._byTelos.get(telos)) {
      result = result.filter(e => e.telos === telos);
    }
    if (type && candidates !== this._byType.get(type)) {
      result = result.filter(e => e.ontologicalType === type);
    }

    // Apply projections
    result = result.map(e => {
      const override = this._statusOverrides.get(String(e.id));
      return override ? Object.freeze({ ...e, ...override }) : e;
    });

    // Exclude dead gifts by default
    if (!includeDead) {
      result = result.filter(e => e.status !== 'dead');
    }

    if (limit) {
      return result.slice(-limit).reverse();
    }
    return result;
  }

  /**
   * Get all events (projected). For backward compatibility with _gifts array.
   */
  getAll() {
    return this._events.map(e => {
      const override = this._statusOverrides.get(String(e.id));
      return override ? Object.freeze({ ...e, ...override }) : e;
    });
  }

  /**
   * Total count.
   */
  get length() {
    return this._events.length;
  }

  /**
   * Get effective status of an event.
   */
  _getStatus(event) {
    const override = this._statusOverrides.get(String(event.id));
    return override ? override.status : event.status;
  }

  /**
   * Index an event into all relevant maps.
   */
  _indexEvent(event) {
    if (event.id) this._byId.set(String(event.id), event);
    if (event.giver) this._addToIndex(this._byGiver, String(event.giver), event);
    if (event.receiver && event.receiver !== 'all') {
      this._addToIndex(this._byReceiver, String(event.receiver), event);
    }
    if (event.telos) this._addToIndex(this._byTelos, event.telos, event);
    if (event.ontologicalType) this._addToIndex(this._byType, event.ontologicalType, event);
    if (event.status) this._addToIndex(this._byStatus, event.status, event);
  }

  _addToIndex(map, key, event) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
  }

  /**
   * Gift death — «Если зерно не умрёт, останется одно» (Ин 12:24)
   *
   * Gift doesn't disappear — it transforms into seed for new gifts.
   * A dead gift can no longer be accepted/declined but its anamnesis lives.
   */
  die(giftId, reason) {
    const gift = this.getById(String(giftId));
    if (!gift) return null;

    // Don't actually remove — mark as dead via status override
    this.applyStatusChange(String(giftId), {
      status: 'dead',
      diedAt: new Date().toISOString(),
      deathReason: reason,
      seed: true, // Can be referenced by new gifts through anamnesis
    });

    return this.getById(String(giftId));
  }

  /**
   * Serialization for persistence.
   */
  toJSON() {
    return {
      events: this._events,
      statusOverrides: Object.fromEntries(this._statusOverrides),
      nextId: this._nextId,
    };
  }

  /**
   * Restore from serialized state.
   */
  fromJSON(data) {
    if (!data) return;
    this._events = [];
    this._byId.clear();
    this._byGiver.clear();
    this._byReceiver.clear();
    this._byTelos.clear();
    this._byType.clear();
    this._byStatus.clear();
    this._statusOverrides.clear();

    if (data.nextId) this._nextId = data.nextId;

    // Re-append all events (rebuilds indices)
    for (const e of (data.events || [])) {
      this.append(e);
    }

    // Restore status overrides
    if (data.statusOverrides) {
      for (const [id, override] of Object.entries(data.statusOverrides)) {
        this.applyStatusChange(id, override);
      }
    }
  }
}

export default GiftEventStore;
