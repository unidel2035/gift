/**
 * PersistenceSubscriber — сохраняет события в Integram через GiftStore
 *
 * save() для новых событий, update() для изменений статуса.
 */

import { EVENT_TYPES } from '../GiftEvent.js';

// Events that create new gift records
const SAVE_EVENTS = new Set([
  EVENT_TYPES.CREATION_EX_NIHILO,
  EVENT_TYPES.CREATION_CONTINUA,
  EVENT_TYPES.EUCHARISTIA,
  EVENT_TYPES.GIFT_OFFERED,
  EVENT_TYPES.SALVATION_INCARNATION,
  EVENT_TYPES.SALVATION_SACRIFICE,
  EVENT_TYPES.SALVATION_RESURRECTION,
  EVENT_TYPES.SALVATION_THEOSIS,
  EVENT_TYPES.SALVATION_HEALING,
]);

// Events that update existing gift records
const UPDATE_EVENTS = new Set([
  EVENT_TYPES.GIFT_ACCEPTED,
  EVENT_TYPES.GIFT_DECLINED,
]);

class PersistenceSubscriber {
  constructor(store) {
    this._store = store;
  }

  register(eventBus) {
    eventBus.on('*', (event) => this._handle(event));
  }

  _handle(event) {
    const type = event._eventType;
    if (!type) return;

    if (SAVE_EVENTS.has(type)) {
      this._store.save(event).catch(() => {});
    } else if (UPDATE_EVENTS.has(type)) {
      this._store.update(event).catch(() => {});
    }
  }
}

export default PersistenceSubscriber;
