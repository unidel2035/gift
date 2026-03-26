/**
 * JournalSubscriber — записывает события в WitnessJournal
 *
 * Подписывается на шину и транслирует каждое событие
 * в соответствующий вызов journal.record().
 */

import { EVENT_TYPES } from '../GiftEvent.js';

// Map event type → journal action
const TYPE_TO_ACTION = {
  [EVENT_TYPES.CREATION_EX_NIHILO]:      'create',
  [EVENT_TYPES.CREATION_CONTINUA]:        null,        // sustain — silent
  [EVENT_TYPES.EUCHARISTIA]:              'eucharistia',
  [EVENT_TYPES.GIFT_OFFERED]:             'offer',
  [EVENT_TYPES.GIFT_ACCEPTED]:            'accept',
  [EVENT_TYPES.GIFT_DECLINED]:            'decline',
  [EVENT_TYPES.FALL_RECORDED]:            'fall',
  [EVENT_TYPES.METANOIA_COMPLETED]:       'metanoia',
  [EVENT_TYPES.SALVATION_INCARNATION]:    'incarnation',
  [EVENT_TYPES.SALVATION_SACRIFICE]:      'sacrifice',
  [EVENT_TYPES.SALVATION_RESURRECTION]:   'resurrection',
  [EVENT_TYPES.SALVATION_THEOSIS]:        'theosis',
  [EVENT_TYPES.SALVATION_HEALING]:        'healing',
  [EVENT_TYPES.INCALCULABLE]:             null,        // beyond journal
};

class JournalSubscriber {
  constructor(journal) {
    this._journal = journal;
  }

  /**
   * Register on the event bus.
   */
  register(eventBus) {
    eventBus.on('*', (event) => this._handle(event));
  }

  _handle(event) {
    const type = event._eventType;
    if (!type) return;

    const action = TYPE_TO_ACTION[type];
    if (!action) return;

    this._journal.record(action, {
      giver: event.giver,
      receiver: event.receiver,
      content: event.content,
      giftId: event.id,
      day: event.day,
    });
  }
}

export default JournalSubscriber;
