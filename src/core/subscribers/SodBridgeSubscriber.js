/**
 * SodBridgeSubscriber — транслирует события в СОД (Event Engine)
 *
 * Опциональная связь с событийной онтологией.
 */

import { EVENT_TYPES } from '../GiftEvent.js';

// Map event type → SOD event type + value builder
const SOD_MAP = {
  [EVENT_TYPES.CREATION_EX_NIHILO]: (e) => ({
    type: 'gift.created',
    value: `Creatio ex nihilo${e.day ? ` (Day ${e.day})` : ''}: ${e.receiverName} — ${e.logos}`,
  }),
  [EVENT_TYPES.GIFT_OFFERED]: (e) => ({
    type: 'gift.offered',
    value: `${e.giverName} предлагает ${e.receiverName}: ${e.content}`,
  }),
  [EVENT_TYPES.GIFT_ACCEPTED]: (e) => ({
    type: 'gift.accepted',
    value: `${e.giverName} → ${e.receiverName}: ${e.content} [${e.layer || 'utilitas'}]`,
  }),
  [EVENT_TYPES.GIFT_DECLINED]: (e) => ({
    type: 'gift.declined',
    value: `${e.receiverName} отклонил от ${e.giverName}: ${e.content}`,
  }),
};

class SodBridgeSubscriber {
  constructor(getSodBridge) {
    this._getSodBridge = getSodBridge; // function returning bridge fn or null
  }

  register(eventBus) {
    eventBus.on('*', (event) => this._handle(event));
  }

  _handle(event) {
    const bridge = this._getSodBridge();
    if (!bridge) return;

    const type = event._eventType;
    if (!type) return;

    const builder = SOD_MAP[type];
    if (!builder) return;

    try {
      const payload = builder(event);
      bridge({ ...payload, source: 'GiftEngine' });
    } catch { /* SOD bridge is optional */ }
  }
}

export default SodBridgeSubscriber;
