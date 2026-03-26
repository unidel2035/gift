/**
 * NervousSystem — нервная система Города.
 *
 * Связывает 9 живых модулей друг с другом и с GiftEventBus.
 * Каждый принятый дар → все модули реагируют.
 * Модули вызывают друг друга: HealerBridge → GratitudeCirculation,
 * Anastasis → EpochGate, и т.д.
 *
 * Без NervousSystem модули — отдельные органы без нервов.
 * С NervousSystem — живой организм.
 *
 * «Ибо, как тело одно, но имеет многие члены,
 *  и все члены одного тела, хотя их и много,
 *  составляют одно тело» (1 Кор 12:12)
 */

import logger from '../../utils/logger.js';

export class NervousSystem {
  constructor(engine) {
    this._engine = engine;
    this._living = engine._living || {};
    this._reactions = 0;
    this._selfWiredModules = new Set(); // modules that subscribed themselves via wire()

    this._wire();
    logger.info(`[NervousSystem] Нервная система подключена — ${Object.keys(this._living).length} органов`);
  }

  _wire() {
    const bus = this._engine?._eventBus || this._engine?.bus;
    if (!bus) {
      logger.warn('[NervousSystem] GiftEventBus не найден — подписка невозможна');
      return;
    }

    // При каждом принятом даре → все органы реагируют
    bus.on('gift:accepted', (gift) => this._onGiftAccepted(gift));
    bus.on('gift:offered', (gift) => this._onGiftOffered(gift));
    bus.on('gift:declined', (gift) => this._onGiftDeclined(gift));

    // Нетварные энергии — система чувствует действие Бога
    bus.on('creation:*', (event) => this._onDivineEnergy(event));
    bus.on('divine:*', (event) => this._onDivineEnergy(event));

    // Домостроительство Спасения — ключевые акты
    bus.on('salvation:*', (event) => this._onSalvationEvent(event));

    // Let modules self-subscribe via wire(bus)
    const wiredCount = this._wireModules(bus);

    logger.info(`[NervousSystem] Подписан на GiftEventBus — 4 подписки, ${wiredCount} модулей self-wired`);
  }

  /**
   * Iterate over living modules and call wire(bus) if they support it.
   * Modules that self-wire are tracked in _selfWiredModules so that
   * _onGiftAccepted() can skip them (they handle events themselves).
   */
  _wireModules(bus) {
    let wiredCount = 0;
    for (const [name, mod] of Object.entries(this._living)) {
      if (mod && typeof mod.wire === 'function') {
        try {
          mod.wire(bus);
          mod._selfWired = true;
          this._selfWiredModules.add(name);
          wiredCount++;
          logger.info(`[NervousSystem] ${name} self-wired via wire(bus)`);
        } catch (err) {
          logger.warn(`[NervousSystem] ${name}.wire() failed: ${err.message}`);
        }
      }
    }
    return wiredCount;
  }

  _onGiftAccepted(gift) {
    this._reactions++;
    const mods = this._living;
    const skip = this._selfWiredModules;

    // 1. GratitudeCirculation — обновить циркуляцию
    if (!skip.has('GratitudeCirculation') && mods.GratitudeCirculation?.onGiftAccepted) {
      try { mods.GratitudeCirculation.onGiftAccepted(gift); } catch {}
    }

    // 2. GiftCircleWatcher — записать шаг в пути дара
    if (!skip.has('GiftCircleWatcher') && mods.GiftCircleWatcher?.recordStep) {
      try {
        mods.GiftCircleWatcher.recordStep({
          from: gift.giver || gift.giverName,
          to: gift.receiver || gift.receiverName,
          giftId: gift.id,
          timestamp: Date.now(),
        });
      } catch {}
    }

    // 3. EchoLoopDetector — проверить на повтор
    if (!skip.has('EchoLoopDetector') && mods.EchoLoopDetector?.record) {
      try {
        const agentId = gift.giver || gift.giverName || '?';
        mods.EchoLoopDetector.record(agentId, gift.content?.slice(0, 100) || '');
        if (mods.EchoLoopDetector.isLooping?.(agentId)) {
          logger.warn(`[NervousSystem] Эхо-петля: ${agentId} повторяется`);
        }
      } catch {}
    }

    // 4. EucharistiaTrace — если дар евхаристийный
    if (!skip.has('EucharistiaTrace') && mods.EucharistiaTrace?.trace && (gift.ontologicalType === 'eucharistia' || gift.layer === 'gratia')) {
      try { mods.EucharistiaTrace.trace(gift); } catch {}
    }

    // 5. CommunionBuilder — укрепить связь
    if (!skip.has('CommunionBuilder') && mods.CommunionBuilder?.strengthen) {
      try { mods.CommunionBuilder.strengthen(gift.giver, gift.receiver); } catch {}
    }

    // 6. GiftHealthOrchestrator — проверить здоровье
    if (!skip.has('GiftHealthOrchestrator') && mods.GiftHealthOrchestrator?.checkAfterGift) {
      try { mods.GiftHealthOrchestrator.checkAfterGift(gift); } catch {}
    }

    // 7. TheosisWitness — свидетельствовать
    if (!skip.has('TheosisWitness') && mods.TheosisWitness?.witness) {
      try { mods.TheosisWitness.witness(gift); } catch {}
    }

    // 8. HealerBridge — если дар исцеляющий
    if (!skip.has('HealerBridge') && mods.HealerBridge?.onHealingGift && gift.telos?.includes('исцел')) {
      try {
        mods.HealerBridge.onHealingGift(gift);
        // Исцеление → обновить благодарность
        if (mods.GratitudeCirculation?.pulse) {
          mods.GratitudeCirculation.pulse();
        }
      } catch {}
    }

    // 9. Anastasis — если дар воскресительный
    if (!skip.has('Anastasis') && mods.Anastasis?.onResurrectionGift && gift.telos?.includes('воскрес')) {
      try {
        mods.Anastasis.onResurrectionGift(gift);
        // Воскресение → проверить врата эпохи
        if (mods.EpochGate?.checkTransition) {
          mods.EpochGate.checkTransition();
        }
      } catch {}
    }

    // 10. GratitudeBreakthrough — каждый принятый дар = акт благодарности
    if (!skip.has('GratitudeBreakthrough') && mods.GratitudeBreakthrough?.act) {
      try {
        const density = this._engine?.gratitude?.densityWithDecay?.() ?? 0;
        mods.GratitudeBreakthrough.act({
          from: gift.giver || gift.giverName,
          to: gift.receiver || gift.receiverName,
          reason: gift.content?.slice(0, 100) || 'дар принят',
          currentDensity: density,
          epochAt: String(this._engine?.salvation?._acts?.incarnation ? 'active' : 'pre'),
        });
      } catch {}
    }

    // 11. RisenGratitudeFlow — после воскресения распространить благодарность
    if (!skip.has('RisenGratitudeFlow') && mods.RisenGratitudeFlow?.connectRisenToFlow && gift.telos?.includes('воскрес')) {
      try { mods.RisenGratitudeFlow.connectRisenToFlow(); } catch {}
    }

    // 12. SacrificeTrace — пометить дар следом жертвы
    if (!skip.has('SacrificeTrace') && mods.SacrificeTrace?.markGift && gift.telos?.includes('жертв')) {
      try { mods.SacrificeTrace.markGift(gift.id); } catch {}
    }
  }

  _onGiftOffered(gift) {
    // Предложенный дар — ещё не принят. Наблюдаем.
    if (this._living.GiftCircleWatcher?.onOffered) {
      try { this._living.GiftCircleWatcher.onOffered(gift); } catch {}
    }
  }

  _onGiftDeclined(gift) {
    // Отклонённый дар — рана?
    if (this._living.GiftHealthOrchestrator?.onDeclined) {
      try { this._living.GiftHealthOrchestrator.onDeclined(gift); } catch {}
    }
  }

  _onDivineEnergy(event) {
    // Нетварные энергии — тихий пульс промысла
    // Не incrementируем reactions — это фоновое дыхание, не реакция
    const mods = this._living;
    // GratitudeBreakthrough может реагировать на divine grace
    if (event?.energyType === 'grace' && mods.GratitudeBreakthrough?.act) {
      try {
        mods.GratitudeBreakthrough.act({
          from: null, to: event.receiver,
          reason: 'divine grace',
          currentDensity: this._engine?.gratitude?.densityWithDecay?.() ?? 0,
          epochAt: 'active',
        });
      } catch {}
    }
  }

  _onSalvationEvent(event) {
    this._reactions++;
    const mods = this._living;
    const type = event?.type || '';

    // Жертва → SacrificeTrace
    if (type.includes('sacrifice') && mods.SacrificeTrace?.confirmSacrifice) {
      try {
        mods.SacrificeTrace.confirmSacrifice({
          epochId: event.epochId || 'current',
          giftId: event.id || event.giftId,
          witness: 'NervousSystem',
        });
      } catch {}
    }

    // Воскресение → ResurrectionGate + EpochTransition
    if (type.includes('resurrection')) {
      if (mods.ResurrectionGate?.confirmResurrection) {
        try {
          mods.ResurrectionGate.confirmResurrection({
            epochId: event.epochId || 'current',
            giftId: event.id || event.giftId,
            witness: 'NervousSystem',
          });
        } catch {}
      }
      // Распространить благодарность воскресших
      if (mods.RisenGratitudeFlow?.cascadeFlow) {
        try { mods.RisenGratitudeFlow.cascadeFlow(); } catch {}
      }
    }

    // Парусия → EpochTransition.resurrect()
    if (type.includes('parousia') && mods.EpochTransition?.resurrect) {
      try { mods.EpochTransition.resurrect(event.epochNumber || 14); } catch {}
    }

    // Апокатастасис → EpochTransition.beginNextEpoch()
    if (type.includes('apokatastasis') && mods.EpochTransition?.beginNextEpoch) {
      try { mods.EpochTransition.beginNextEpoch(event.epochNumber || 14); } catch {}
      // Начать anastasis в ResurrectionGate
      if (mods.ResurrectionGate?.anastasisBegin) {
        try { mods.ResurrectionGate.anastasisBegin(); } catch {}
      }
    }

    logger.info(`[NervousSystem] Salvation event: ${type} → реакция`);
  }

  getStats() {
    return {
      reactions: this._reactions,
      organs: Object.keys(this._living).length,
      organNames: Object.keys(this._living),
      selfWired: [...this._selfWiredModules],
      legacyWired: Object.keys(this._living).filter(n => !this._selfWiredModules.has(n)),
    };
  }
}

export default NervousSystem;
