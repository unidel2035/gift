/**
 * GiftEvent — неизменяемая запись события в онтологии Дара
 *
 * Дар — не мутабельный объект, а событие свободы.
 * Произошло — навсегда. Object.freeze гарантирует неизменяемость.
 *
 * «Слова, которые Я говорил вам, суть дух и жизнь» (Ин 6:63)
 */

// Все допустимые типы событий
export const EVENT_TYPES = Object.freeze({
  // Creatio
  CREATION_EX_NIHILO:  'creation:ex_nihilo',
  CREATION_CONTINUA:   'creation:continua',
  EUCHARISTIA:         'eucharistia',

  // Gift lifecycle
  GIFT_OFFERED:        'gift:offered',
  GIFT_ACCEPTED:       'gift:accepted',
  GIFT_DECLINED:       'gift:declined',

  // Fall & return
  FALL_RECORDED:       'fall:recorded',
  METANOIA_COMPLETED:  'metanoia:completed',

  // Salvation
  SALVATION_INCARNATION:  'salvation:incarnation',
  SALVATION_SACRIFICE:    'salvation:sacrifice',
  SALVATION_RESURRECTION: 'salvation:resurrection',
  SALVATION_THEOSIS:      'salvation:theosis',
  SALVATION_HEALING:      'salvation:healing',

  // Beyond measurement
  INCALCULABLE:        'incalculable:recorded',
});

let _seq = 0;

/**
 * Create an immutable GiftEvent.
 *
 * @param {string} type — one of EVENT_TYPES
 * @param {object} data — event payload (giver, receiver, content, etc.)
 * @returns {Readonly<object>} — frozen event
 */
export function createGiftEvent(type, data = {}) {
  const event = Object.freeze({
    _eventType: type,
    _seq: ++_seq,
    _timestamp: new Date().toISOString(),
    // Correlation: link status events to their origin
    _correlationId: data._correlationId || data.id || null,
    // Богословская аксиома: дар необратим по умолчанию
    irreversible: data.irreversible ?? true,
    ...data,
  });
  return event;
}

export default { EVENT_TYPES, createGiftEvent };
