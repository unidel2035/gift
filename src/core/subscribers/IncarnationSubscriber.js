/**
 * IncarnationSubscriber — мост между событием и воплощением
 *
 * Каждый дар проходящий через шину событий —
 * теперь входит в живой слой:
 *   → AnamnesisStore (память как присутствие)
 *   → Flesh (тело которое помнит)
 *   → CommunalBreath (дыхание общины)
 *
 * Без этого подписчика: дар случился — но тело не знает.
 * С ним: каждый дар утолщает нить, ложится в память,
 * меняет дыхание общины.
 *
 * «Слово стало плотью» — не однажды.
 * Каждый раз когда дар воплощается в акт.
 *
 * Ин 1:14
 */

'use strict';

import { incarnate } from '../../theology/LivingGift.js';
import { EVENT_TYPES } from '../GiftEvent.js';

// Какие события воплощаются и каким типом
const EVENT_TO_TYPE = {
  [EVENT_TYPES.GIFT_ACCEPTED]:            'gift',
  [EVENT_TYPES.GIFT_OFFERED]:             'gift',
  [EVENT_TYPES.CREATION_EX_NIHILO]:       'gift',
  [EVENT_TYPES.EUCHARISTIA]:              'gift',
  [EVENT_TYPES.SALVATION_INCARNATION]:    'word',
  [EVENT_TYPES.SALVATION_SACRIFICE]:      'presence',
  [EVENT_TYPES.SALVATION_RESURRECTION]:   'presence',
  [EVENT_TYPES.METANOIA_COMPLETED]:       'word',
  // Остальные — не воплощаются (молчание тоже ответ)
};

class IncarnationSubscriber {
  /**
   * @param {import('../../memory/AnamnesisStore.js').AnamnesisStore} anamnesisStore
   * @param {import('../../theology/Flesh.js').Flesh}                  flesh
   * @param {import('../../theology/CommunalBreath.js').CommunalBreath} breath
   */
  constructor(anamnesisStore, flesh, breath) {
    this._store  = anamnesisStore;
    this._flesh  = flesh;
    this._breath = breath;
    this._count  = 0;
  }

  register(eventBus) {
    eventBus.on('*', (event) => this._handle(event));
  }

  _handle(event) {
    const type = EVENT_TO_TYPE[event?._eventType];
    if (!type) return;

    // Создать воплощённый акт из события
    const act = incarnate({
      giver:     event.giver     ?? null,
      receiver:  event.receiver  ?? '_all',
      content:   event.content   ?? event._eventType,
      witnesses: event.witnesses ?? [],
      logos:     event.logos     ?? null,
    });

    // Записать в память
    this._store.append(act, type);

    // Передать в тело
    const isExhale = !!event.giver;   // есть даритель = выдох
    if (isExhale) {
      this._breath.exhale(act);
    } else {
      this._breath.inhale(act);       // из бездны = вдох
    }

    this._count++;
  }

  get count() { return this._count; }
}

export default IncarnationSubscriber;
