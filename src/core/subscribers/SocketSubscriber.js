/**
 * SocketSubscriber — транслирует события в WebSocket
 *
 * Подписывается на шину и отправляет каждое событие
 * через socket.io в формате, совместимом с текущим фронтом.
 */

import { EVENT_TYPES } from '../GiftEvent.js';

// Map event type → socket event name
const TYPE_TO_SOCKET = {
  [EVENT_TYPES.CREATION_EX_NIHILO]:      'gift:created',
  [EVENT_TYPES.EUCHARISTIA]:              'gift:eucharistia',
  [EVENT_TYPES.GIFT_OFFERED]:             'gift:offered',
  [EVENT_TYPES.GIFT_ACCEPTED]:            'gift:accepted',
  [EVENT_TYPES.GIFT_DECLINED]:            'gift:declined',
  [EVENT_TYPES.FALL_RECORDED]:            'gift:fall',
  [EVENT_TYPES.METANOIA_COMPLETED]:       'gift:metanoia',
  [EVENT_TYPES.SALVATION_INCARNATION]:    'gift:incarnation',
  [EVENT_TYPES.SALVATION_SACRIFICE]:      'gift:sacrifice',
  [EVENT_TYPES.SALVATION_RESURRECTION]:   'gift:resurrection',
  [EVENT_TYPES.SALVATION_THEOSIS]:        'gift:theosis',
  [EVENT_TYPES.SALVATION_HEALING]:        'gift:healing',
  [EVENT_TYPES.INCALCULABLE]:             'gift:incalculable',
};

class SocketSubscriber {
  constructor(getIO) {
    this._getIO = getIO; // function that returns current io instance (may be null)
  }

  register(eventBus) {
    eventBus.on('*', (event) => this._handle(event));
  }

  _handle(event) {
    const io = this._getIO();
    if (!io) return;

    const type = event._eventType;
    if (!type) return;

    const socketEvent = TYPE_TO_SOCKET[type];
    if (!socketEvent) return;

    io.emit(socketEvent, event);
  }
}

export default SocketSubscriber;
