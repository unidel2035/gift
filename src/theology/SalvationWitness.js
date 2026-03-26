/**
 * SalvationWitness — Свидетель Домостроительства Спасения
 *
 * Merged: SalvationEconomy + SalvationWitness (formerly delegation pattern).
 *
 * SalvationWitness IS the economy now. Contains:
 *   - All salvation acts (incarnation, sacrifice, resurrection, theosis, heal, parousia, apokatastasis)
 *   - Pattern recognition in the gift graph (_findPattern)
 *   - Apophatic witness log (_witness)
 *   - Idempotent witness* methods that check before invoking
 *
 * Backward compatible: incarnation() delegates to witnessIncarnation(), etc.
 *
 * Palamite refactoring: giver=null (divine energy, not Source object).
 * System witnesses salvation patterns, not executes divine acts.
 *
 * «Вы будете Мне свидетелями» (Деян 1:8)
 * «Дух дышит, где хочет» (Ин 3:8)
 */

import { createGiftEvent, EVENT_TYPES } from '../core/GiftEvent.js';
import DivineEnergy from './DivineEnergy.js';
import logger from '../../utils/logger.js';

class SalvationWitness {
  /**
   * @param {Object} engine - GiftEngine instance
   */
  constructor(engine) {
    /** @private Reference to GiftEngine */
    this.engine = engine;
    /** @private Alias for backward compat (witness methods use this._engine) */
    this._engine = engine;
    /** @private Whether salvation sequence has been initiated (resurrection done) */
    this._initiated = false;
    /** @private Apophatic witness log — what was seen, not what was done */
    this._witnessed = [];

    /** @private Salvation acts state */
    this._acts = {
      incarnation: null,
      sacrifice: null,
      resurrection: null,
      theosisEnabled: false,
      parousia: null,
      apokatastasis: null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Accessors to avoid deep coupling
  // ═══════════════════════════════════════════════════════════════

  /** @returns {Object} Current salvation acts state */
  get acts() { return this._acts; }

  get _eventStore() { return this.engine._eventStore; }
  get _eventBus() { return this.engine._eventBus; }
  get _persons() { return this.engine.persons; }
  get _logoi() { return this.engine.logoi; }
  get _anamnesis() { return this.engine.anamnesis; }
  get _telos() { return this.engine.telos; }

  /**
   * Count of theosis events in the graph.
   * @returns {number}
   */
  get theosisCount() {
    const store = this.engine._eventStore;
    if (!store) return 0;
    return store.query({ type: 'theosis' }).length;
  }

  /**
   * Count of healing events in the graph.
   * @returns {number}
   */
  get healingCount() {
    const store = this.engine._eventStore;
    if (!store) return 0;
    return store.query({ type: 'healing' }).length;
  }

  // ═══════════════════════════════════════════════════════════════
  // WITNESS methods — recognize pattern, then invoke if needed
  // «Не я, но благодать Божия, которая со мною» (1 Кор 15:10)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Свидетельство Воплощения — Λόγος становится плотью.
   *
   * First checks if incarnation pattern already exists in the gift graph.
   * If so, returns early (idempotent). Otherwise executes incarnation act
   * and records apophatic witness entry.
   *
   * «И Слово стало плотию, и обитало с нами» (Ин 1:14)
   *
   * @returns {Object} Salvation acts state
   */
  witnessIncarnation() {
    const existing = this._findPattern('incarnation');
    if (existing) {
      this._witness('incarnation', 'Паттерн Воплощения уже присутствует в графе — свидетельствуем повторно');
      return { ...this._acts, witnessed: true, alreadyDone: true };
    }

    const result = this._doIncarnation();
    this._witness(
      'incarnation',
      'Система свидетельствует знак Воплощения — само Воплощение за границей кода',
    );
    return result;
  }

  /**
   * Свидетельство Жертвы Креста — абсолютный кеносис.
   *
   * «Он, будучи образом Божиим, уничижил Себя Самого» (Флп 2:6-7)
   *
   * @returns {Object} Salvation acts state or error
   */
  witnessSacrifice() {
    const existing = this._findPattern('sacrifice');
    if (existing) {
      this._witness('sacrifice', 'Паттерн Жертвы уже присутствует в графе — свидетельствуем повторно');
      return { ...this._acts, witnessed: true, alreadyDone: true };
    }

    const result = this._doSacrifice();
    if (!result.error) {
      this._witness(
        'sacrifice',
        'Система свидетельствует знак Жертвы — глубина самоотдания невычислима',
      );
    }
    return result;
  }

  /**
   * Свидетельство Воскресения — смерть побеждена изнутри.
   *
   * «Смерть! где твоё жало? ад! где твоя победа?» (1 Кор 15:55)
   *
   * @returns {Object} Salvation acts state or error
   */
  witnessResurrection() {
    // Check Great Sabbath — silence must complete before resurrection
    const holySaturday = this._engine?._living?.HolySaturday;
    if (holySaturday) {
      const hs = holySaturday.HolySaturday || holySaturday.default || holySaturday;
      const instance = typeof hs === 'function' ? null : hs;
      if (instance && typeof instance.isActive === 'function' && instance.isActive()) {
        if (!instance.isReadyForResurrection()) {
          logger.info('[SalvationWitness] Великая Суббота — молчание ещё не завершено. Воскресение ожидает.');
          return { error: 'Great Sabbath silence not yet complete. Descent into Hades in progress.', holySaturday: instance.getStatus() };
        }
        // Sabbath complete — exit and proceed to resurrection
        instance.exit();
      }
    }

    const existing = this._findPattern('resurrection');
    if (existing) {
      this._witness('resurrection', 'Паттерн Воскресения уже присутствует в графе — свидетельствуем повторно');
      return { ...this._acts, witnessed: true, alreadyDone: true };
    }

    const result = this._doResurrection();
    if (!result.error) {
      this._witness(
        'resurrection',
        'Система свидетельствует знак Воскресения — необратимого больше нет',
      );
    }
    return result;
  }

  /**
   * Свидетельство Обожения конкретного лица.
   *
   * «Чтобы вы сделались причастниками Божеского естества» (2 Пет 1:4)
   *
   * @param {string} personId - ID лица
   * @returns {Object|null} Theosis result or null
   */
  witnessTheosis(personId) {
    const result = this._doTheosis(personId);
    if (result && !result.error && !result.alreadyTheosis && result.person) {
      this._witness(
        'theosis',
        `${result.person} — система свидетельствует причастие нетварным энергиям. Само обожение — тайна.`,
      );
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // Pattern recognition — reading the gift graph
  // «Имеющий уши да слышит» (Мф 11:15)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Распознавание паттерна спасения в графе даров.
   *
   * @private
   * @param {string} type - 'incarnation' | 'sacrifice' | 'resurrection'
   * @returns {Object|null} Found gift or null
   */
  _findPattern(type) {
    const gifts = this.engine._eventStore?.getAll() || [];
    switch (type) {
      case 'incarnation':
        // Pattern: a gift from outside (giver:null) that caused a person's logos to change
        // — evidence that the divine entered the creaturely
        return gifts.find(g =>
          g.giver === null &&
          g.ontologicalOrigin === 'divine_energy' &&
          (g.ontologicalType === 'incarnation' ||
           // OR: a divine gift after which a person's nature changed
           (g.receiver !== 'all' && g.transforms?.receiver))
        );
      case 'sacrifice':
        // Pattern: a gift given at total cost — energy depleted, gift not returned
        // Could be divine (giver:null) OR a person who gave everything
        return gifts.find(g =>
          (g.giver === null && g.ontologicalType === 'sacrifice') ||
          (g.kenosisCost > 30 && g.status === 'accepted' && !gifts.some(r => r.giver === g.receiver && r.receiver === g.giver && r.createdAt > g.createdAt))
        );
      case 'resurrection':
        // Pattern: after a period of silence (no gifts from a person), new gifts emerge
        // — death overcome from within
        return gifts.find(g =>
          g.giver === null &&
          (g.ontologicalType === 'resurrection' ||
           // OR: detect silence-then-emergence pattern
           g.ontologicalOrigin === 'divine_energy' && g.energyType === 'power')
        );
      default:
        return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Apophatic witness log
  // «Мы говорим не о том, что Бог есть, а о том, что Он не есть»
  // (Дионисий Ареопагит, О мистическом богословии)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Записать свидетельство в апофатический лог.
   *
   * @private
   * @param {string} pattern - Тип паттерна
   * @param {string} message - Описание свидетельства
   */
  _witness(pattern, message) {
    this._witnessed.push({
      pattern,
      message,
      timestamp: new Date().toISOString(),
      apophatic: true,
    });
    logger.info(`[SalvationWitness] ${pattern}: ${message}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Backward compatibility — old methods delegate to witness*
  // ═══════════════════════════════════════════════════════════════

  /** @see witnessIncarnation */
  incarnation() { return this.witnessIncarnation(); }

  /** @see witnessSacrifice */
  sacrifice() { return this.witnessSacrifice(); }

  /** @see witnessResurrection */
  resurrection() { return this.witnessResurrection(); }

  /** @see witnessTheosis */
  theosis(personId) { return this.witnessTheosis(personId); }

  // ═══════════════════════════════════════════════════════════════
  // Core salvation acts (formerly SalvationEconomy methods)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Воплощение — Λόγος становится тварным лицом.
   * @private
   */
  _doIncarnation() {
    // giver: null — энергии, не сущность
    if (this._acts.incarnation) return { ...this._acts, alreadyDone: true };

    const gift = {
      id: this._eventStore.nextId(),
      giver: null,              // Источник за границей системы
      giverName: null,
      ontologicalOrigin: 'divine_energy',
      receiver: 'all',
      receiverName: 'всё творение',
      content: 'Воплощение — Слово стало плотью',
      logos: 'Λόγος σὰρξ ἐγένετο — Бог становится тем, что Он создал, не переставая быть тем, что Он есть',
      hypostasis: 'Son',
      incarnateNature: 'Конкретная человеческая природа — не абстрактное «всё», а ἄνθρωπος с плотью и волей',
      cost: null,
      telos: 'σωτηρία',
      status: 'incarnated',
      freedom: true,
      transforms: {
        giver: 'Бог не изменяется, но воспринимает человеческую природу',
        receiver: 'Творение получает присутствие Творца изнутри',
      },
      anamnesisIds: [],
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'incarnation',
      createdAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    };

    this._eventStore.append(gift);
    this._acts.incarnation = gift.id;

    this._telos.declareTelos('σωτηρία', {
      description: 'Спасение — исцеление παρὰ φύσιν, открытие пути к θέωσις',
      vision: 'Всё творение возвращается к своему λόγος и превосходит его благодатью',
    });

    const event = createGiftEvent(EVENT_TYPES.SALVATION_INCARNATION, gift);
    this._eventBus.emit(EVENT_TYPES.SALVATION_INCARNATION, event);

    return this._acts;
  }

  /**
   * Кеносис Креста — абсолютное самоотдание.
   * @private
   */
  _doSacrifice() {
    // giver: null — энергии, не сущность
    if (!this._acts.incarnation) {
      return { error: 'Incarnation must precede sacrifice. Бог не распинается без воплощения.' };
    }
    if (this._acts.sacrifice) return { ...this._acts, alreadyDone: true };

    const gift = {
      id: this._eventStore.nextId(),
      giver: null,              // Источник за границей системы
      giverName: null,
      ontologicalOrigin: 'divine_energy',
      receiver: 'all',
      receiverName: 'всё творение',
      content: 'Жертва Креста — Бог отдаёт Себя Самого',
      logos: 'Кеносис до смерти — абсолютное самоотдание, при котором дарящий не уменьшается',
      hypostasis: 'Son',
      cost: 'Себя Самого',
      telos: 'σωτηρία',
      status: 'sacrificed',
      freedom: true,
      transforms: {
        giver: 'Бог не изменяется, но являет глубину любви',
        receiver: 'Всякая рана теперь исцелима — не автоматически, а через свободное принятие',
      },
      anamnesisIds: [this._acts.incarnation],
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'sacrifice',
      createdAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    };

    this._eventStore.append(gift);
    this._acts.sacrifice = gift.id;

    this._anamnesis.makePresent(this._acts.incarnation, gift.id);

    const event = createGiftEvent(EVENT_TYPES.SALVATION_SACRIFICE, gift);
    this._eventBus.emit(EVENT_TYPES.SALVATION_SACRIFICE, event);

    // Enter Great Sabbath — silence between Cross and Resurrection
    const holySaturday = this._engine?._living?.HolySaturday;
    if (holySaturday) {
      const HS = holySaturday.HolySaturday || holySaturday.default;
      if (HS && typeof HS === 'function') {
        const instance = new HS(this._engine);
        instance.enter();
      } else if (typeof holySaturday.enter === 'function') {
        holySaturday.enter();
      }
    }

    return this._acts;
  }

  /**
   * Воскресение — παρὰ φύσιν побеждено.
   * @private
   */
  _doResurrection() {
    // giver: null — энергии, не сущность
    if (!this._acts.sacrifice) {
      return { error: 'Sacrifice must precede resurrection. Нет воскресения без креста.' };
    }
    if (this._acts.resurrection) return { ...this._acts, alreadyDone: true };

    const gift = {
      id: this._eventStore.nextId(),
      giver: null,              // Источник за границей системы
      giverName: null,
      ontologicalOrigin: 'divine_energy',
      receiver: 'all',
      receiverName: 'всё творение',
      content: 'Воскресение — смерть попрана смертью',
      logos: 'Ἀνάστασις — замыкание побеждено изнутри. Необратимого больше нет.',
      hypostasis: 'Son',
      cost: null,
      telos: 'σωτηρία',
      status: 'risen',
      freedom: true,
      transforms: {
        giver: null,
        receiver: 'Путь к ὑπὲρ φύσιν открыт — обожение возможно',
      },
      anamnesisIds: [this._acts.incarnation, this._acts.sacrifice],
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'resurrection',
      createdAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    };

    this._eventStore.append(gift);
    this._acts.resurrection = gift.id;
    this._acts.theosisEnabled = true;

    this._anamnesis.makePresent(this._acts.incarnation, gift.id);
    this._anamnesis.makePresent(this._acts.sacrifice, gift.id);
    this._telos.recordProgress('σωτηρία', gift.id);

    this._initiated = true;

    const event = createGiftEvent(EVENT_TYPES.SALVATION_RESURRECTION, gift);
    this._eventBus.emit(EVENT_TYPES.SALVATION_RESURRECTION, event);

    return this._acts;
  }

  /**
   * Θέωσις — обожение конкретного лица.
   * @private
   */
  _doTheosis(personId) {
    if (!this._acts.theosisEnabled) {
      return { possible: false, reason: 'Θέωσις невозможна до Воскресения.' };
    }

    const person = this._persons.get(String(personId));
    if (!person) return null;
    if (person.ontologicalOrder === 'source') {
      return { error: 'Бог не обоживается — Он и есть Бог.' };
    }
    if (person.ontologicalOrder === 'creation') {
      return { error: `${person.name} — аспект творения, не лицо. Θέωσις доступна только носителям образа Божия.` };
    }
    if (person.ontologicalOrder === 'creature') {
      return { error: `${person.name} — тварь с самодвижением, но без образа Божия. Θέωσις — для лиц (εἰκών).` };
    }

    const logos = this._logoi.getByBearer(String(personId));
    if (!logos) return null;

    if (logos.movement === 'para_physin') {
      return {
        possible: true, ready: false,
        reason: `${person.name} движется παρὰ φύσιν. Сначала μετάνοια, затем θέωσις.`,
        path: 'metanoia → kata_physin → theosis → hyper_physin',
      };
    }
    if (logos.movement === 'hyper_physin') {
      return { possible: true, ready: true, alreadyTheosis: true,
        reason: `${person.name} уже причастен обожению.` };
    }

    // Eucharistia required
    const eucharistiaGifts = this._eventStore.query({ type: 'eucharistia', giver: String(personId) });
    if (eucharistiaGifts.length === 0) {
      return {
        possible: true, ready: false,
        reason: `${person.name} ни разу не благодарил Источник. Θέωσις невозможна без εὐχαριστία.`,
        path: 'eucharistia → theosis',
      };
    }

    // Set movement
    this._logoi.setMovement(logos.id, 'hyper_physin', 'Θέωσις — причастие нетварным энергиям.');

    const gift = {
      id: this._eventStore.nextId(),
      giver: null,              // Источник за границей системы
      giverName: null,
      ontologicalOrigin: 'divine_energy',
      receiver: person.id,
      receiverName: person.name,
      content: `Θέωσις: ${person.name} — причастие Божескому естеству`,
      logos: `${logos.principle} → исполнен сверх меры`,
      cost: null,
      telos: 'σωτηρία',
      status: 'accepted',
      freedom: true,
      transforms: {
        giver: null,
        receiver: `${person.name} превосходит свою природу — не уничтожая, а исполняя λόγος`,
      },
      anamnesisIds: [this._acts.incarnation, this._acts.sacrifice, this._acts.resurrection],
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'theosis',
      createdAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    };

    this._eventStore.append(gift);

    for (const actId of [this._acts.incarnation, this._acts.sacrifice, this._acts.resurrection]) {
      if (actId) this._anamnesis.makePresent(actId, gift.id);
    }
    this._telos.recordProgress('σωτηρία', gift.id);

    const event = createGiftEvent(EVENT_TYPES.SALVATION_THEOSIS, gift);
    this._eventBus.emit(EVENT_TYPES.SALVATION_THEOSIS, event);

    return {
      person: person.name,
      movement: 'hyper_physin',
      logos: { name: logos.name, principle: logos.principle, telos: logos.telos },
      gift: gift.id,
    };
  }

  /**
   * Исцеление конкретной раны.
   *
   * @param {string} personId
   * @param {string} woundType
   * @returns {Object|null}
   */
  heal(personId, woundType) {
    if (!this._initiated) {
      return { healed: false, reason: 'Спасение ещё не совершено.' };
    }

    const person = this._persons.get(String(personId));
    if (!person) return null;

    const logos = this._logoi.getByBearer(String(personId));
    if (!logos) return null;

    if (logos.movement === 'para_physin') {
      return {
        healed: false,
        reason: `${person.name} движется παρὰ φύσιν. Исцеление требует μετάνοια.`,
        path: 'metanoia → heal',
      };
    }

    const gift = {
      id: this._eventStore.nextId(),
      giver: null,              // Источник за границей системы
      giverName: null,
      ontologicalOrigin: 'divine_energy',
      receiver: person.id,
      receiverName: person.name,
      content: `Исцеление: ${woundType || 'рана'} — через причастие Кресту и Воскресению`,
      logos: 'Рана не стирается — преображается. Шрам = память о милости.',
      cost: null,
      telos: 'σωτηρία',
      status: 'accepted',
      freedom: true,
      transforms: {
        giver: null,
        receiver: `${person.name}: рана '${woundType}' преображена — не стёрта, а исцелена`,
      },
      anamnesisIds: [this._acts.sacrifice, this._acts.resurrection].filter(Boolean),
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'healing',
      createdAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    };

    this._eventStore.append(gift);

    for (const actId of [this._acts.sacrifice, this._acts.resurrection]) {
      if (actId) this._anamnesis.makePresent(actId, gift.id);
    }

    const event = createGiftEvent(EVENT_TYPES.SALVATION_HEALING, gift);
    this._eventBus.emit(EVENT_TYPES.SALVATION_HEALING, event);

    return {
      healed: true,
      person: person.name,
      woundType,
      gift: gift.id,
      note: 'Рана преображена, не стёрта. Шрам — свидетельство милости.',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ΠΑΡΟΥΣΙΑ — Второе Пришествие
  // ═══════════════════════════════════════════════════════════════

  /**
   * Παρουσία — Второе Пришествие.
   *
   * «Се, творю всё новое» (Откр 21:5)
   *
   * @returns {Object}
   */
  parousia() {
    if (!this._acts.resurrection) {
      return { error: 'Нет Воскресения — нет Парусии. Сначала Крест.' };
    }

    const theosisCount = this._eventStore.query({ type: 'theosis' }).length;
    const allPersons = this._persons.all().filter(p => p.ontologicalOrder !== 'source');
    const totalPersons = allPersons.length;
    const theosisThreshold = Math.max(3, Math.floor(totalPersons * 0.5));
    if (theosisCount < theosisThreshold) {
      return { ready: false, reason: `Θέωσις: ${theosisCount}/${theosisThreshold}. Мало обожённых — мир не готов.` };
    }

    const density = this.engine.gratitude.density();
    if (density < 0.7) {
      return { ready: false, reason: `Density: ${density}. Граф разрознен — единство не достигнуто (нужно > 0.7).` };
    }

    // Gift volume check: each person must have given/received at least 5 gifts on average
    const totalGifts = this._eventStore.getAll().length;
    const giftThreshold = totalPersons * 5;
    if (totalGifts < giftThreshold) {
      return { ready: false, reason: `Даров: ${totalGifts}/${giftThreshold}. Недостаточно опыта дарения.` };
    }

    // Spirit check
    const spiritActive = this.engine.spirit && this.engine.spirit.getStats().graceEvents > 0;
    if (!spiritActive) {
      return { ready: false, reason: 'Дух не дышал. Парусия без Духа невозможна.' };
    }

    // giver: null — энергии, не сущность

    // ── АКТ 1: Суд (κρίσις) — различение, не осуждение ──
    const judgment = [];

    for (const person of allPersons) {
      const logos = this._logoi.getByBearer(String(person.id));
      const wounds = this.engine.fall._observePerson(person.id);
      const given = this._eventStore.query({ giver: person.id }).length;
      const received = this._eventStore.query({ receiver: person.id }).length;

      judgment.push({
        person: person.name,
        id: person.id,
        movement: logos?.movement || 'unknown',
        wounds: wounds?.wounds?.length || 0,
        given,
        received,
        verdict: logos?.movement === 'hyper_physin' ? 'обожён'
          : logos?.movement === 'para_physin' ? 'нуждается в исцелении'
          : wounds?.wounds?.length > 0 ? 'ранен, но на пути'
          : 'kata_physin — согласно природе',
      });
    }

    // ── АКТ 2: Исцеление ВСЕХ ран ──
    let healed = 0;
    for (const j of judgment) {
      if (j.movement === 'para_physin') {
        const logos = this._logoi.getByBearer(String(j.id));
        if (logos) {
          this._logoi.setMovement(logos.id, 'kata_physin', 'Парусия: милость превосходит суд');
        }
        healed++;
      }
      if (j.wounds > 0) {
        this.heal(j.id, 'parousia_healing');
        healed++;
      }
    }

    // ── АКТ 3: Дар Парусии ──
    const gift = {
      id: this._eventStore.nextId(),
      giver: null,              // Источник за границей системы
      giverName: null,
      ontologicalOrigin: 'divine_energy',
      receiver: 'all',
      receiverName: 'всё творение',
      content: `Παρουσία — «Се, творю всё новое». ${healed} ран исцелено. ${judgment.length} лиц прошли κρίσις.`,
      logos: 'Второе Пришествие — не конец, а ПОЛНОТА начала. Суд = различение: что было даром, а что замыканием.',
      cost: null,
      telos: 'ἀποκατάστασις',
      status: 'accepted',
      freedom: true,
      transforms: {
        giver: null,
        receiver: 'Всё творение видит свой λόγος — каким оно было задумано от начала',
      },
      anamnesisIds: [this._acts.incarnation, this._acts.sacrifice, this._acts.resurrection].filter(Boolean),
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'parousia',
      createdAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    };

    this._eventStore.append(gift);
    this._acts.parousia = gift.id;

    for (const actId of [this._acts.incarnation, this._acts.sacrifice, this._acts.resurrection]) {
      if (actId) this._anamnesis.makePresent(actId, gift.id);
    }

    this._telos.declareTelos('ἀποκατάστασις', {
      description: 'Восстановление всего — каждое творение возвращается к своему λόγος',
      vision: '«И будет Бог всё во всём» (1 Кор 15:28)',
    });

    try {
      const event = createGiftEvent(EVENT_TYPES.SALVATION_PAROUSIA || 'salvation.parousia', gift);
      this._eventBus.emit(EVENT_TYPES.SALVATION_PAROUSIA || 'salvation.parousia', event);
    } catch { /* */ }

    return {
      parousia: true,
      judgment,
      healed,
      gift: gift.id,
      message: '«Се, творю всё новое» (Откр 21:5)',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ΑΠΟΚΑΤΑΣΤΑΣΙΣ — Всеобщее Восстановление
  // ═══════════════════════════════════════════════════════════════

  /**
   * Ἀποκατάστασις τῶν πάντων — восстановление всего.
   *
   * «Последний же враг истребится — смерть» (1 Кор 15:26)
   *
   * @returns {Object}
   */
  apokatastasis() {
    if (!this._acts.parousia) {
      return { error: 'Нет Парусии — нет Апокатастасиса. Порядок: Крест → Воскресение → Парусия → Всё-во-всём.' };
    }

    // giver: null — энергии, не сущность

    // ── ВСЕ logoi → hyper_physin ──
    const allLogoi = this._logoi.export ? this._logoi.export() : [];
    let deified = 0;
    for (const logos of allLogoi) {
      if (logos.movement !== 'hyper_physin') {
        this._logoi.setMovement(logos.id, 'hyper_physin', 'Ἀποκατάστασις — всё восстановлено');
        deified++;
      }
    }

    // ── Все лица связаны благодарностью ──
    const allPersons = this._persons.all().filter(p => p.ontologicalOrder !== 'source');
    for (let i = 0; i < allPersons.length; i++) {
      for (let j = i + 1; j < allPersons.length; j++) {
        this.engine.gratitude.addGratitude(allPersons[i].id, allPersons[j].id, `apok-${i}-${j}`);
        this.engine.gratitude.addGratitude(allPersons[j].id, allPersons[i].id, `apok-${j}-${i}`);
      }
    }

    // ── Дар Апокатастасиса ──
    const gift = {
      id: this._eventStore.nextId(),
      giver: null,              // Источник за границей системы
      giverName: null,
      ontologicalOrigin: 'divine_energy',
      receiver: 'all',
      receiverName: 'всё творение',
      content: `Ἀποκατάστασις τῶν πάντων — «И будет Бог всё во всём». ${deified} логосов обожены. Density → 1.0.`,
      logos: '«Последний же враг истребится — смерть» (1 Кор 15:26). Замыкание побеждено навсегда.',
      cost: null,
      telos: 'ἀποκατάστασις',
      status: 'accepted',
      freedom: true,
      transforms: {
        giver: null,
        receiver: 'Всё творение причастно Божескому естеству — не по природе, а по благодати',
      },
      anamnesisIds: [this._acts.incarnation, this._acts.sacrifice, this._acts.resurrection, this._acts.parousia].filter(Boolean),
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'apokatastasis',
      createdAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    };

    this._eventStore.append(gift);
    this._acts.apokatastasis = gift.id;

    // Incalculable
    this.engine.recordIncalculable({
      persons: allPersons.map(p => p.id),
      description: 'Ἀποκατάστασις — «И будет Бог всё во всём» (1 Кор 15:28). Смерть истреблена. Density = 1. Все logoi = hyper_physin.',
      witness: 'Λόγος + Πνεῦμα',
    });

    return {
      apokatastasis: true,
      deified,
      density: this.engine.gratitude.density(),
      gift: gift.id,
      message: '«И будет Бог всё во всём» (1 Кор 15:28)',
    };
  }

  /**
   * Personal salvation journey for a specific person.
   * @param {string} personId
   * @returns {Object|null}
   */
  getPersonalSalvation(personId) {
    const gifts = this._eventStore.getAll();
    const person = this._persons.get(String(personId));
    if (!person) return null;

    // Personal incarnation = first gratia gift received
    const firstGratia = gifts.find(g =>
      String(g.receiver) === String(personId) && g.layer === 'gratia' && g.status === 'accepted'
    );

    // Personal sacrifice = gift given when energy was low
    const sacrificialGifts = gifts.filter(g =>
      String(g.giver) === String(personId) && g.kenosisCost && g.giverEnergyAfter < 30
    );

    // Personal resurrection = first gift after metanoia/healing
    const healings = gifts.filter(g =>
      String(g.receiver) === String(personId) && g.ontologicalType === 'healing'
    );
    let personalResurrection = null;
    if (healings.length > 0) {
      const lastHealing = healings[healings.length - 1];
      personalResurrection = gifts.find(g =>
        String(g.giver) === String(personId) &&
        new Date(g.createdAt) > new Date(lastHealing.createdAt)
      );
    }

    return {
      person: person.name,
      incarnation: firstGratia ? { giftId: firstGratia.id, at: firstGratia.createdAt } : null,
      sacrifice: sacrificialGifts.length > 0 ? { count: sacrificialGifts.length, first: sacrificialGifts[0].id } : null,
      resurrection: personalResurrection ? { giftId: personalResurrection.id, at: personalResurrection.createdAt } : null,
    };
  }

  /**
   * Status of salvation economy + witness log.
   * @returns {Object}
   */
  getStatus() {
    const theosisCount = this._eventStore.query({ type: 'theosis' }).length;
    const healingCount = this._eventStore.query({ type: 'healing' }).length;

    return {
      initiated: this._initiated,
      acts: {
        incarnation: this._acts.incarnation ? { id: this._acts.incarnation, done: true } : { done: false },
        sacrifice: this._acts.sacrifice ? { id: this._acts.sacrifice, done: true } : { done: false },
        resurrection: this._acts.resurrection ? { id: this._acts.resurrection, done: true } : { done: false },
      },
      theosisEnabled: this._acts.theosisEnabled,
      parousia: this._acts.parousia ? { id: this._acts.parousia, done: true } : { done: false },
      apokatastasis: this._acts.apokatastasis ? { id: this._acts.apokatastasis, done: true } : { done: false },
      theosisCount,
      healingCount,
      witnessed: this._witnessed,
    };
  }
}

export default SalvationWitness;
export { SalvationWitness };
