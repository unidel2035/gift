/**
 * Person — лицо как актор
 *
 * Лицо — не данные в Map, а тот, кто действует.
 * «Лицо несводимо» (Аксиома A1) — Person инкапсулирует
 * идентичность + поведение + свободу.
 *
 * Производное состояние (giftsGiven, giftsReceived) вычисляется
 * из EventStore, а не хранится как мутабельный счётчик.
 */

import { createGiftEvent, EVENT_TYPES } from './GiftEvent.js';

class Person {
  /**
   * @param {object} data — { id, name, calling, description, ontologicalOrder, registeredAt, _integramId }
   * @param {object} context — { eventStore, eventBus, logoi, freedom, clock }
   */
  constructor(data, context) {
    // Immutable identity
    this._id = String(data.id);
    this._name = data.name;
    this._calling = data.calling || null;
    this._description = data.description || null;
    this._ontologicalOrder = data.ontologicalOrder || 'person';
    this._registeredAt = data.registeredAt || null;
    this._integramId = data._integramId || null;

    // Shared context (not owned — injected)
    this._ctx = context;

    // Kenosis: giving costs real energy
    this._energy = 100;
    this._alive = true;          // живой
    this._diedAt = null;         // когда умер
    this._deathReason = null;    // причина смерти
  }

  // ─── Immutable identity ──────────────────────────────────
  get id() { return this._id; }
  get name() { return this._name; }
  get calling() { return this._calling; }
  get description() { return this._description; }
  get ontologicalOrder() { return this._ontologicalOrder; }
  get registeredAt() { return this._registeredAt; }
  get energy() { return this._energy; }
  get alive() { return this._alive; }
  get dead() { return !this._alive; }

  // ─── СМЕРТЬ ────────────────────────────────────────────
  // «Возмездие за грех — смерть» (Рим 6:23)
  // Не delete — phantom. Мёртвый помнится.

  /**
   * Умереть. Энергия → 0. Больше не может дарить и принимать.
   * Но помнится в анамнезисе. И может быть воскрешён.
   */
  die(reason) {
    if (!this._alive) return { alreadyDead: true };
    this._alive = false;
    this._energy = 0;
    this._diedAt = new Date().toISOString();
    this._deathReason = reason || 'неизвестна';

    // Emit death event
    if (this._ctx?.eventBus) {
      this._ctx.eventBus.emit('person:died', {
        id: this._id, name: this._name, reason: this._deathReason,
      });
    }

    return { died: true, name: this._name, reason: this._deathReason };
  }

  /**
   * Воскреснуть. phantom → лицо. Раны остаются как знаки славы.
   */
  resurrect(by = 'divine_energy') {
    if (this._alive) return { alreadyAlive: true };
    this._alive = true;
    this._energy = 50; // воскресший — не на полную, но жив

    if (this._ctx?.eventBus) {
      this._ctx.eventBus.emit('person:resurrected', {
        id: this._id, name: this._name, by,
      });
    }

    return { resurrected: true, name: this._name, wounds: this._deathReason };
  }

  // ─── Derived state (from EventStore) ─────────────────────
  get giftsGiven() {
    return this._ctx.eventStore
      ? this._ctx.eventStore.query({ giver: this._id }).length
      : 0;
  }

  get giftsReceived() {
    return this._ctx.eventStore
      ? this._ctx.eventStore.query({ receiver: this._id }).length
      : 0;
  }

  get giftsDeclined() {
    return this._ctx.eventStore
      ? this._ctx.eventStore.query({ receiver: this._id, status: 'declined' }).length
      : 0;
  }

  // ─── ACTIONS ─────────────────────────────────────────────

  /**
   * Offer a gift to another person.
   */
  offer(giftData) {
    // Мёртвый не может дарить
    if (!this._alive) {
      return { error: `${this._name} мёртв. Мёртвый не дарит. (Рим 6:23)`, dead: true };
    }

    const { receiver, content, cost, telos, logos, anamnesis: anam, anonymous } = giftData;

    // Кеносис пропорционален содержанию дара — не случайность, а мера самоотдачи
    const explicitCost = (cost !== undefined && cost !== null) ? (typeof cost === 'number' ? cost : parseFloat(cost) || (String(cost).length)) : null;
    const baseCost = explicitCost !== null
      ? Math.min(40, Math.max(5, Math.ceil(explicitCost)))
      : Math.min(40, Math.max(5, Math.ceil((content || '').length / 20)));
    const layerMultiplier = (giftData.layer === 'gratia') ? 1.5 : (giftData.layer === 'bonum') ? 1.2 : 1.0;
    const telosCost = telos ? 3 : 0;
    const kenosisCost = Math.min(40, Math.max(5, Math.ceil(baseCost * layerMultiplier + telosCost)));
    if (this._energy < kenosisCost) {
      // Too exhausted to give — need sabbath
      return { error: 'Недостаточно сил для дарения. Нужен покой (суббота).', needsSabbath: true, energy: this._energy };
    }
    this._energy -= kenosisCost;

    // Check freedom — receiver can have standing refusal
    let receiverPerson = null;
    let _deferred = false;
    let _deferReason = null;

    if (receiver && receiver !== 'all') {
      receiverPerson = this._ctx.persons.resolve(receiver);
      if (receiverPerson && this._ctx.freedom.isRefusing(receiverPerson.id, this._id)) {
        return {
          id: null,
          status: 'refused',
          reason: 'Receiver exercises freedom of refusal. This is not an error.',
        };
      }

      // Liturgical rhythm: sabbath/contemplation → deferred
      if (receiverPerson && this._ctx.clock) {
        const season = this._ctx.clock.getCurrentSeason(receiverPerson.id);
        if (season.season === 'sabbath' || season.season === 'contemplation') {
          _deferred = true;
          _deferReason = `${receiverPerson.name} в ${season.season === 'sabbath' ? 'субботнем покое' : 'созерцании'}`;
        }
      }
    }

    const gift = {
      id: this._ctx.eventStore.nextId(),
      giver: this._id,
      giverName: this._name,
      receiver: receiver === 'all' ? 'all' : (receiverPerson?.id || receiver),
      receiverName: receiver === 'all' ? 'all' : (receiverPerson?.name || receiver),
      content,
      logos: logos || null,
      cost: cost || null,
      telos: telos || null,
      status: _deferred ? 'deferred' : 'offered',
      deferReason: _deferReason,
      ontologicalType: 'gift',
      freedom: null,
      transforms: { giver: null, receiver: null },
      anamnesisIds: [],
      anonymous: !!anonymous,
      kenosisCost,
      giverEnergyAfter: this._energy,
      createdAt: new Date().toISOString(),
      acceptedAt: null,
    };

    // Anamnesis
    if (anam && anam.length > 0) {
      gift.anamnesisIds = anam.filter(id => this._ctx.eventStore.getById(String(id)));
    }

    // Auto-detect anamnesis by telos
    if (telos) {
      const related = this._ctx.eventStore.query({ telos, status: 'accepted' });
      for (const r of related.slice(-3)) {
        if (!gift.anamnesisIds.includes(r.id)) {
          gift.anamnesisIds.push(r.id);
        }
      }
    }

    // Detect gift layer
    gift.layer = this._detectGiftLayer(gift);

    // Register logos
    if (logos && this._ctx.logoi) {
      const giverLogos = this._ctx.logoi.getByBearer(this._id);
      const registeredLogos = this._ctx.logoi.register({
        name: `λόγος дара: ${content?.slice(0, 40) || gift.id}`,
        principle: logos,
        physis: gift.layer,
        telos: telos || null,
        derivedFrom: giverLogos?.id || null,
        bearerId: gift.id,
        bearerType: 'gift',
      });
      gift.logosId = registeredLogos.id;
    }

    // Append to store
    const stored = this._ctx.eventStore.append(gift);

    // Wire anamnesis
    if (this._ctx.anamnesis) {
      for (const prevId of gift.anamnesisIds) {
        this._ctx.anamnesis.makePresent(prevId, gift.id);
      }
    }

    // Emit event
    const event = createGiftEvent(EVENT_TYPES.GIFT_OFFERED, stored);
    this._ctx.eventBus.emit(EVENT_TYPES.GIFT_OFFERED, event);

    return stored;
  }

  /**
   * Accept a gift addressed to this person.
   */
  accept(giftId, transformation = {}) {
    const gift = this._ctx.eventStore.getById(String(giftId));
    if (!gift) throw new Error(`Gift ${giftId} not found`);

    // Gift for 'all' — create personal receipt
    if (gift.receiver === 'all') {
      const alreadyAccepted = this._ctx.eventStore.query({ receiver: this._id })
        .find(g => g.originalGiftId === gift.id);
      if (alreadyAccepted) return alreadyAccepted;

      const personalGift = {
        id: this._ctx.eventStore.nextId(),
        ...gift,
        receiver: this._id,
        receiverName: this._name,
        status: 'accepted',
        freedom: true,
        acceptedAt: new Date().toISOString(),
        originalGiftId: gift.id,
        anamnesisIds: [...(gift.anamnesisIds || [])],
        transforms: {
          giver: transformation.giver || `became giver of "${gift.content}"`,
          receiver: transformation.receiver || `${this._name} received "${gift.content}"`,
        },
      };

      const stored = this._ctx.eventStore.append(personalGift);

      // Gratitude
      if (!gift.anonymous && this._ctx.gratitude) {
        this._ctx.gratitude.addGratitude(this._id, gift.giver, stored.id);
      }
      if (gift.telos && this._ctx.telos) {
        this._ctx.telos.recordProgress(gift.telos, stored.id);
      }

      const event = createGiftEvent(EVENT_TYPES.GIFT_ACCEPTED, stored);
      this._ctx.eventBus.emit(EVENT_TYPES.GIFT_ACCEPTED, event);

      return stored;
    }

    if (gift.status !== 'offered' && gift.status !== 'deferred') {
      throw new Error(`Gift ${giftId} already ${gift.status}`);
    }

    // Apply status change (immutably)
    const statusData = {
      status: 'accepted',
      deferReason: null,
      freedom: true,
      acceptedAt: new Date().toISOString(),
      transforms: {
        giver: transformation.giver || `became giver of "${gift.content}"`,
        receiver: transformation.receiver || `received "${gift.content}"`,
      },
    };
    this._ctx.eventStore.applyStatusChange(giftId, statusData);

    // Receiving a gift restores energy (+3)
    this.regenerate(3);

    // Gratitude + telos
    if (!gift.anonymous && this._ctx.gratitude) {
      this._ctx.gratitude.addGratitude(gift.receiver, gift.giver, gift.id);
    }
    if (gift.telos && this._ctx.telos) {
      this._ctx.telos.recordProgress(gift.telos, gift.id);
    }

    // Auto-enter sabbath if energy critically low
    if (this._energy < 20 && this._ctx.clock) {
      this._ctx.clock.enterSabbath(this._id, 1, true);
    }

    const projected = this._ctx.eventStore.getById(giftId);
    const event = createGiftEvent(EVENT_TYPES.GIFT_ACCEPTED, projected);
    this._ctx.eventBus.emit(EVENT_TYPES.GIFT_ACCEPTED, event);

    return projected;
  }

  /**
   * Decline a gift — this is freedom, not error.
   */
  decline(giftId, reason) {
    if (!reason) {
      throw new Error('Decline requires a reason — freedom is conscious choice, not silence.');
    }

    const gift = this._ctx.eventStore.getById(String(giftId));
    if (!gift) throw new Error(`Gift ${giftId} not found`);
    if (gift.status !== 'offered' && gift.status !== 'deferred') {
      throw new Error(`Gift ${giftId} already ${gift.status}`);
    }

    // БОГОСЛОВСКАЯ ПРАВКА: свобода — достоинство, не прибыль.
    // Богатый юноша «отошёл с печалью» (Мф 19:22) — не с бонусом.
    // Отклонение не наказывается (это не грех), но и не вознаграждается.
    // Net zero: энергия не меняется при отклонении.
    // this._energy += 0;

    // Giver gets partial kenosis refund — some kenosis is irreversible
    const giverPerson = this._ctx.persons?.get(gift.giver);
    if (giverPerson && typeof giverPerson.regenerate === 'function') {
      giverPerson.regenerate(5);
    }

    const statusData = {
      status: 'declined',
      deferReason: null,
      freedom: true,
      declineReason: reason,
      transforms: {
        giver: reason || 'gift was not received — but the giving itself transformed the giver',
        receiver: `exercised freedom: ${reason}`,
      },
    };
    this._ctx.eventStore.applyStatusChange(giftId, statusData);

    const projected = this._ctx.eventStore.getById(giftId);
    const event = createGiftEvent(EVENT_TYPES.GIFT_DECLINED, projected);
    this._ctx.eventBus.emit(EVENT_TYPES.GIFT_DECLINED, event);

    return projected;
  }

  /**
   * Εὐχαριστία — благодарение Источнику.
   */
  eucharistia(thanksgiving) {
    // Sabbath check
    if (this._ctx.clock) {
      const season = this._ctx.clock.getCurrentSeason(this._id);
      if (season.season === 'sabbath') {
        return { status: 'deferred', reason: `${this._name} в субботнем покое.` };
      }
    }

    // Евхаристия восходит к Непостижимому — receiver: null
    const gift = {
      id: this._ctx.eventStore.nextId(),
      giver: this._id,
      giverName: this._name,
      receiver: null,             // восходит за границу системы
      receiverName: null,         // Неименуемый
      content: thanksgiving || `Благодарение от ${this._name}`,
      cost: null,
      telos: null,
      status: 'accepted',
      freedom: true,
      transforms: {
        giver: `${this._name} возрастает в благодарении`,
        receiver: null,
      },
      anamnesisIds: [],
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'eucharistia',
      createdAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    };

    const stored = this._ctx.eventStore.append(gift);

    if (this._ctx.gratitude) {
      this._ctx.gratitude.addGratitude(this._id, null, gift.id);
    }

    const event = createGiftEvent(EVENT_TYPES.EUCHARISTIA, stored);
    this._ctx.eventBus.emit(EVENT_TYPES.EUCHARISTIA, event);

    return stored;
  }

  /**
   * Record fall — отклонение от λόγος.
   */
  recordFall(reason) {
    if (this._ontologicalOrder === 'creation') {
      return { error: `${this._name} — аспект творения без воли. Грехопадение — акт свободной воли.` };
    }

    if (this._ctx.logoi) {
      const logos = this._ctx.logoi.getByBearer(this._id);
      if (logos) {
        this._ctx.logoi.setMovement(logos.id, 'para_physin', reason);
      }
    }

    const event = createGiftEvent(EVENT_TYPES.FALL_RECORDED, {
      personId: this._id,
      personName: this._name,
      reason,
    });
    this._ctx.eventBus.emit(EVENT_TYPES.FALL_RECORDED, event);

    return {
      person: this._name,
      movement: 'para_physin',
      reason,
      hope: 'Λόγος не уничтожен. Μετάνοια возможна.',
    };
  }

  /**
   * Μετάνοια — покаяние, перемена ума.
   */
  metanoia(witness) {
    const logos = this._ctx.logoi?.getByBearer(this._id);
    if (!logos) return null;

    if (logos.movement === 'kata_physin') {
      return { person: this._name, currentMovement: 'kata_physin', note: `${this._name} движется κατὰ φύσιν — покаяние не нужно.` };
    }
    if (logos.movement === 'hyper_physin') {
      return { person: this._name, currentMovement: 'hyper_physin', note: `${this._name} уже в θέωσις.` };
    }

    const wasPara = logos.movement === 'para_physin';
    this._ctx.logoi.setMovement(logos.id, 'kata_physin', witness || 'Μετάνοια — возвращение к λόγος');

    const event = createGiftEvent(EVENT_TYPES.METANOIA_COMPLETED, {
      personId: this._id,
      personName: this._name,
      witness,
    });
    this._ctx.eventBus.emit(EVENT_TYPES.METANOIA_COMPLETED, event);

    return {
      person: this._name,
      previousMovement: wasPara ? 'para_physin' : logos.movement,
      currentMovement: 'kata_physin',
      witness,
      logos: { name: logos.name, principle: logos.principle, telos: logos.telos },
    };
  }

  // ─── Kenosis: energy regeneration ────────────────────────

  regenerate(amount = 5) {
    this._energy = Math.min(100, this._energy + amount);
    return this._energy;
  }

  // ─── Internal helpers ────────────────────────────────────

  _detectGiftLayer(gift) {
    // 1. Structural detection (primary) — effect-based, not keyword
    const receiverId = gift.receiver;
    if (receiverId && receiverId !== 'all') {
      try {
        // Check receiver's giving patterns
        const receiverGifts = this._ctx.eventStore.query({ giver: receiverId });
        const giverGifts = this._ctx.eventStore.query({ giver: gift.giver, receiver: receiverId });

        // If receiver has eucharistia → gratia (transformed to the point of thanking Source)
        const eucharistia = this._ctx.eventStore.query({ giver: receiverId, type: 'eucharistia' });
        if (eucharistia.length > 0) {
          return 'gratia';
        }

        // If this is a repeated gift to same person who then gives to OTHERS → bonum
        if (giverGifts.length > 0 && receiverGifts.some(g => g.receiver !== gift.giver)) {
          return 'bonum';
        }
      } catch { /* structural detection failed, fall through to keyword */ }
    }

    // 2. Keyword fallback (for first gifts when no history exists)
    const text = `${gift.content || ''} ${gift.cost || ''} ${gift.telos || ''}`.toLowerCase();
    const gratiaKw = ['мудрост', 'пророч', 'исцелен', 'различен', 'благодат', 'дух', 'откровен', 'призван', 'харизм', 'чудес', 'преображен', 'вдохновен', 'озарен'];
    for (const kw of gratiaKw) if (text.includes(kw)) return 'gratia';
    const bonumKw = ['довер', 'солидарн', 'прощен', 'жертв', 'любов', 'верн', 'честн', 'забот', 'помощ', 'поддержк', 'сотруднич', 'партнёр', 'единств', 'братск', 'милосерд', 'терпен', 'доброт', 'благ'];
    for (const kw of bonumKw) if (text.includes(kw)) return 'bonum';

    // 3. Default — consumed with no behavioral change
    return 'utilitas';
  }

  // ─── Backward-compatible serialization ───────────────────

  toJSON() {
    return {
      id: this._id,
      name: this._name,
      calling: this._calling,
      description: this._description,
      ontologicalOrder: this._ontologicalOrder,
      registeredAt: this._registeredAt,
      giftsGiven: this.giftsGiven,
      giftsReceived: this.giftsReceived,
      giftsDeclined: this.giftsDeclined,
      energy: this._energy,
      _integramId: this._integramId,
    };
  }
}


/**
 * Source extends Person — Πηγή, Источник бытия.
 *
 * Guards: Бог не падает, не кается, не благодарит Себя.
 * Бог create(), sustain(), incarnation(), sacrifice(), resurrection(), theosis(), heal().
 */
/**
 * Source class REMOVED — Паламитский рефакторинг.
 *
 * Бог непостижим по сущности (οὐσία).
 * Он действует через нетварные энергии (ἐνέργειαι).
 * См. DivineEnergy.js — статический модуль без id и без state.
 *
 * «Энергии неотделимы от сущности, но и несводимы к ней»
 * (Григорий Палама, Триады III.2)
 */

export { Person };
export default Person;
