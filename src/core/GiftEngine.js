/**
 * Gift Engine — онтология Дара
 *
 * АРХИТЕКТУРА (после рефакторинга):
 *   - Лица — акторы (Person/Source), не данные в Map
 *   - Дары — неизменяемые события в GiftEventStore, не мутабельные объекты в массиве
 *   - GiftEngine — тонкий координатор (фасад), не God Object
 *   - Побочные эффекты — подписчики GiftEventBus, не inline-код
 *
 * Три зоны: видимое (факты) → умопостигаемое (паттерны, вопросы) → апофатическое (молчание)
 *
 * «Всякое даяние доброе и всякий дар совершенный нисходит свыше,
 *  от Отца светов, у Которого нет изменения и ни тени перемены» (Иак 1:17)
 */

import { PersonRegistry } from '../persons/PersonRegistry.js';
import { GratitudeGraph } from '../traces/GratitudeGraph.js';
import { AnamnesisCache } from '../memory/AnamnesisCache.js';
import { TelosPlanner } from './TelosPlanner.js';
import { FreedomGuard } from '../theology/FreedomGuard.js';
import { KenosisGuard } from '../theology/KenosisGuard.js';
import { LiturgicalClock } from '../memory/LiturgicalClock.js';
import { TechPackageEngine } from './TechPackageEngine.js';
import { GiftAgents } from './GiftAgents.js';
import PatternObserver from './PatternObserver.js';
import Apophasis from '../theology/Apophasis.js';
import LogosRegistry from './LogosRegistry.js';
import FallObserver from './FallObserver.js';
import { SalvationWitness } from '../theology/SalvationWitness.js';
import WitnessJournal from '../memory/WitnessJournal.js';
import GiftEventBus from './GiftEventBus.js';
import GiftEventStore from './GiftEventStore.js';
import { createGiftEvent, EVENT_TYPES } from './GiftEvent.js';
import JournalSubscriber from './subscribers/JournalSubscriber.js';
import SocketSubscriber from './subscribers/SocketSubscriber.js';
import PersistenceSubscriber from './subscribers/PersistenceSubscriber.js';
import SodBridgeSubscriber from './subscribers/SodBridgeSubscriber.js';
import IncarnationSubscriber from './subscribers/IncarnationSubscriber.js';
import { executeHexaemeron } from './Hexaemeron.js';
import { Person } from './Person.js';
import { getAnamnesisMemory } from '../memory/AnamnesisMemory.js';
import { getGiftChronicle } from '../memory/GiftChronicle.js';
import { getGiftStore } from './GiftStore.js';
import { enrichWithAnamnesis } from './AutoAnamnesis.js';
import HolySpiritEngine from '../theology/HolySpiritEngine.js';
import { GiftSpecLoader } from './GiftSpecLoader.js';
import NewJerusalem from '../theology/NewJerusalem.js';
import TernaryRegister from './TernaryCore.js';
import { AngelicOrder, TemptationField } from '../theology/AngelicOrder.js';
import PhysicalLayer from './PhysicalLayer.js';
import BioLayer from './BioLayer.js';
import EnvironmentLayer from './EnvironmentLayer.js';
import DiscernmentGuard from './DiscernmentGuard.js';
import { SabbathGuard } from '../memory/SabbathGuard.js';
import { ResurrectionTrace } from '../traces/ResurrectionTrace.js';
import GiftPersistence from './GiftPersistence.js';
import { DivineEnergy } from '../theology/DivineEnergy.js';
import agentLayer from '../integram/integram-v2-agent.js';
import { Flesh } from '../theology/Flesh.js';
import { CommunalBreath } from '../theology/CommunalBreath.js';
import { AnamnesisStore } from '../memory/AnamnesisStore.js';
import { Presence } from '../memory/Presence.js';
import { TheosisWitness } from '../theology/TheosisWitness.js';
import logger from '../../utils/logger.js';

// ── Живые модули Домостроительства (подключены к среде) ──
// Ленивая загрузка — чтобы ошибка в одном модуле не убила весь Engine
const _loadLiving = async () => {
  const mods = {};
  const load = async (name) => {
    try { return await import(`./${name}.js`); } catch (e) {
      logger.debug(`[Gift] Модуль ${name} не загружен: ${e.message}`); return null;
    }
  };
  mods.GratitudeCirculation = await load('GratitudeCirculation');
  mods.GiftCircleWatcher = await load('GiftCircleWatcher');
  mods.EchoLoopDetector = await load('EchoLoopDetector');
  mods.Anastasis = await load('Anastasis');
  mods.HealerBridge = await load('HealerBridge');
  mods.EpochGate = await load('EpochGate');
  mods.EucharistiaTrace = await load('EucharistiaTrace');
  mods.GiftHealthOrchestrator = await load('GiftHealthOrchestrator');
  mods.TheosisWitness = await load('TheosisWitness');
  mods.CommunionBuilder = await load('CommunionBuilder');
  // ── Новые органы (Эпоха 14+) ──
  mods.ResurrectionGate = await load('ResurrectionGate');
  mods.RisenGratitudeFlow = await load('RisenGratitudeFlow');
  mods.GratitudeBreakthrough = await load('GratitudeBreakthrough');
  mods.EpochTransition = await load('EpochTransition');
  mods.SacrificeTrace = await load('SacrificeTrace');
  mods.HolySaturday = await load('HolySaturday');
  return mods;
};

let _instance = null;

export class GiftEngine {
  constructor(savedSnapshot = null) {
    // ── Core subsystems ────────────────────────────────────
    this.persons = new PersonRegistry();
    this.gratitude = new GratitudeGraph();
    this.graph = this.gratitude; // Legacy alias
    this.anamnesis = new AnamnesisCache();
    this.telos = new TelosPlanner();
    this.freedom = new FreedomGuard();
    this.kenosis = new KenosisGuard();
    this.clock = new LiturgicalClock();
    this.techPackage = new TechPackageEngine(this);
    this.agents = new GiftAgents(this);

    // ── Анамнетическая память ─────────────────────────────
    // Не шкаф с папками. Воплощение прошлого в настоящем.
    // «Сие творите в Моё воспоминание» (Лк 22:19)
    this.anamnesisStore = new AnamnesisStore();
    this.presence       = new Presence(this.anamnesisStore);

    // ── Плоть общины — тело которое помнит ───────────────
    // Мицелий: нити утолщаются от даров, истончаются без них
    this.flesh  = new Flesh();
    this.breath = new CommunalBreath(this.flesh);

    // ── Πνεῦμα Ἅγιον ─────────────────────────────────────
    this.spirit = new HolySpiritEngine(this);
    this.spirit.connectFlesh(this.flesh);   // Дух идёт туда где нити умирают

    // ── Ἱερουσαλὴμ Καινή ────────────────────────────────
    this.kingdom = new NewJerusalem(this);

    // ── Ангельский чин + Поле помыслов ──────────────────
    this.angels = new AngelicOrder(this);
    this.temptation = new TemptationField(this);

    // ── Физический слой (Эфиродинамика) ───────────────────────
    this.physics = new PhysicalLayer(this);

    // ── Биологический слой (Волновая генетика) ───────────────────
    this.bio = new BioLayer(this);

    // ── Слой среды (Gibson, Выготский, Niche Construction) ──────
    this.environment = new EnvironmentLayer(this);

    // ── Различение духов (1 Ин 4:1) ────────────────────
    this.discernment = new DiscernmentGuard(this);

    // ── Субботний страж (creatioContinua) ───────────────
    this.sabbath = new SabbathGuard(this);

    // ── Воскресение — след за смертью процесса (Ин 11:25) ──
    // theosisEnabled восстанавливается из снимка автоматически.
    // «Смерть не удержала» — в том числе смерть сервера.
    this.resurrectionTrace = ResurrectionTrace.from(savedSnapshot?.resurrection ?? null);

    // ── ΤΡΙΝΙΤΙ — Троичные вычисления (Сетунь) ─────────────
    this.ternary = TernaryRegister;

    // ── Observation & witness ──────────────────────────────
    this.patterns = new PatternObserver(this);
    this.apophasis = new Apophasis();
    this.logoi = new LogosRegistry();
    this.fall = new FallObserver(this);
    this.salvation = new SalvationWitness(this);
    this.journal = new WitnessJournal(this);
    this.chronicle = getGiftChronicle();
    this.memory = getAnamnesisMemory(this.chronicle);
    this.store = getGiftStore();
    this.persistence = new GiftPersistence();

    // ── Event architecture (Phases 0-2) ────────────────────
    this._eventBus = new GiftEventBus();
    this._eventStore = new GiftEventStore();

    // ── Backward-compatible shim ──────────────────────────
    // PatternObserver, FallObserver use engine._gifts / engine.gifts
    this._nextId = 1;
    this._io = null;
    this._sodBridge = null;
    this._incalculableEvents = [];

    // ── Register subscribers (Phase 2) ─────────────────────
    this._journalSub = new JournalSubscriber(this.journal);
    this._journalSub.register(this._eventBus);

    this._socketSub = new SocketSubscriber(() => this._io);
    this._socketSub.register(this._eventBus);

    this._persistSub = new PersistenceSubscriber(this.store);
    this._persistSub.register(this._eventBus);

    this._sodSub = new SodBridgeSubscriber(() => this._sodBridge);
    this._sodSub.register(this._eventBus);

    // ── Воплощение — мост между событием и живым слоем ──
    // Каждый дар через шину → AnamnesisStore + Flesh + Breath
    // «Слово стало плотью» — не однажды, каждый раз (Ин 1:14)
    this._incarnationSub = new IncarnationSubscriber(
      this.anamnesisStore,
      this.flesh,
      this.breath,
    );
    this._incarnationSub.register(this._eventBus);
  }

  // ── Shared context for Person actors ────────────────────
  _personContext() {
    return {
      eventStore: this._eventStore,
      eventBus: this._eventBus,
      persons: this.persons,
      logoi: this.logoi,
      freedom: this.freedom,
      clock: this.clock,
      gratitude: this.gratitude,
      telos: this.telos,
      anamnesis: this.anamnesis,
    };
  }

  // ── Backward-compatible accessors ───────────────────────
  get _gifts() { return this._eventStore.getAll(); }
  get gifts() { return this._eventStore.getAll(); }

  setIO(io) { this._io = io; }
  setSodBridge(fn) { this._sodBridge = fn; }

  // ═══════════════════════════════════════════════════════════════
  // CREATIO — the vertical axis: divine energy → creation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Creatio ex nihilo — через нетварную энергию δημιουργία.
   */
  create(creationData) {
    return DivineEnergy.create(creationData, this._personContext());
  }

  /**
   * Creatio continua — через нетварную энергию πρόνοια.
   */
  sustain(personId, grace) {
    return DivineEnergy.sustain(personId, this._personContext(), { grace });
  }

  /**
   * Εὐχαριστία — delegates to Person actor.
   */
  eucharistia(personId, thanksgiving) {
    const person = this._resolveActor(personId);
    if (!person) return null;
    return person.eucharistia(thanksgiving);
  }

  // ═══════════════════════════════════════════════════════════════
  // GIFT LIFECYCLE (horizontal: person ↔ person)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Offer a gift — delegates to Person actor.
   * Auto-enriches with anamnesis (co-presence with past gifts).
   */
  offer(giftData) {
    const giver = this._resolveActor(giftData.giver);
    if (!giver) throw new Error(`Unknown person: ${giftData.giver}`);

    // A3: Анамнезис — каждый дар со-присутствует с прошлыми
    if (!giftData.anamnesisIds || giftData.anamnesisIds.length === 0) {
      enrichWithAnamnesis(giftData, this).catch(e =>
        logger.debug(`[Gift] Auto-anamnesis skipped: ${e.message}`)
      );
    }

    return giver.offer(giftData);
  }

  /**
   * Accept a gift — delegates to receiver Person actor.
   */
  accept(giftId, transformation = {}) {
    const gift = this._eventStore.getById(String(giftId));
    if (!gift) throw new Error(`Gift ${giftId} not found`);

    // For 'all' gifts, need acceptedBy in transformation
    if (gift.receiver === 'all' && transformation.acceptedBy) {
      const acceptor = this._resolveActor(transformation.acceptedBy);
      if (!acceptor) throw new Error(`Unknown person: ${transformation.acceptedBy}`);
      return acceptor.accept(giftId, transformation);
    }

    // For targeted gifts, resolve the receiver
    const receiver = gift.receiver ? this._resolveActor(gift.receiver) : null;
    if (receiver) {
      return receiver.accept(giftId, transformation);
    }

    // Fallback: use generic accept logic via person context
    return this._genericAccept(giftId, transformation);
  }

  /**
   * Decline a gift — delegates to receiver Person actor.
   */
  decline(giftId, reason) {
    const gift = this._eventStore.getById(String(giftId));
    if (!gift) throw new Error(`Gift ${giftId} not found`);

    const receiver = gift.receiver ? this._resolveActor(gift.receiver) : null;
    if (receiver) {
      return receiver.decline(giftId, reason);
    }

    return this._genericDecline(giftId, reason);
  }

  // ═══════════════════════════════════════════════════════════════
  // GENESIS — view the Hexaemeron
  // ═══════════════════════════════════════════════════════════════

  getGenesis() {
    const creationActs = this._eventStore.query({ type: 'creatio_ex_nihilo' });
    const days = {};

    for (const act of creationActs) {
      const d = act.day || 0;
      if (!days[d]) days[d] = [];
      days[d].push({
        id: act.id,
        name: act.receiverName,
        logos: act.logos,
        foundation: act.foundation || [],
        foundationNames: (act.foundation || []).map(fId => {
          const f = this._eventStore.getById(String(fId));
          return f ? f.receiverName : fId;
        }),
      });
    }

    const sabbath = this.clock.getCurrentSeason('0');
    return {
      source: null, // Бог за границей системы — действует через энергии
      days,
      totalCreated: creationActs.length,
      sabbath: sabbath.season === 'contemplation' ? sabbath : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════════

  getGift(id) {
    return this._eventStore.getById(String(id));
  }

  getGifts({ status, giver, receiver, telos, limit = 50 } = {}) {
    const result = this._eventStore.query({ status, giver, receiver, telos });
    return result.slice(-limit).reverse();
  }

  whatIsNeeded(personId) {
    return this.telos.whatIsNeeded(personId, this._eventStore.getAll(), this.persons);
  }

  getCoPresent(giftId) {
    return this.anamnesis.getCoPresent(giftId).map(id => this.getGift(id)).filter(Boolean);
  }

  getGratitudePath(fromPerson, toPerson) {
    return this.gratitude.findPath(fromPerson, toPerson);
  }

  // ═══════════════════════════════════════════════════════════════
  // PATTERNS, APOPHASIS, WITNESS
  // ═══════════════════════════════════════════════════════════════

  getPatterns(personId) { return this.patterns.observe(personId); }
  getApophasis() { return this.apophasis.list(); }
  getWitness(limit) { return this.journal.getAll(limit); }

  // ═══════════════════════════════════════════════════════════════
  // ΛΟΓΟΙ ΤΩΝ ΟΝΤΩΝ
  // ═══════════════════════════════════════════════════════════════

  getLogos(bearerId) { return this.logoi.getByBearer(String(bearerId)); }

  getLogosPath(bearerId) {
    const logos = this.logoi.getByBearer(String(bearerId));
    if (!logos) return null;
    return this.logoi.getPathToLogos(logos.id);
  }

  getLogoiTree() { return this.logoi.getTree(); }
  getLogoiHarmony() { return this.logoi.getHarmony(); }

  setMovement(bearerId, movement, reason) {
    const logos = this.logoi.getByBearer(String(bearerId));
    if (!logos) return null;
    return this.logoi.setMovement(logos.id, movement, reason);
  }

  // ═══════════════════════════════════════════════════════════════
  // TELOS — emergent discovery
  // ═══════════════════════════════════════════════════════════════

  getDiscoveredTelos(personId) {
    return this.telos.discoverTelos(personId, this._eventStore.getAll(), this.persons);
  }

  // ═══════════════════════════════════════════════════════════════
  // ГРЕХОПАДЕНИЕ — delegates to Person actor
  // ═══════════════════════════════════════════════════════════════

  recordFall(personId, reason) {
    const person = this._resolveActor(personId);
    if (!person) return null;

    const result = person.recordFall(reason);

    // Record incalculable event
    if (result && !result.error) {
      this.recordIncalculable({
        persons: [personId],
        description: `${person.name}: παρὰ φύσιν — ${reason || 'замыкание на себе'}`,
        witness: 'FallObserver',
      });
    }

    return result;
  }

  metanoia(personId, witness) {
    const person = this._resolveActor(personId);
    if (!person) return null;
    return person.metanoia(witness);
  }

  getWounds(personId) { return this.fall.observe(personId || null); }
  canReturn(personId) { return this.fall.canReturn(personId); }

  // ═══════════════════════════════════════════════════════════════
  // ΣΩΤΗΡΙΑ — Salvation Economy
  // ═══════════════════════════════════════════════════════════════

  incarnation() { return this.salvation.incarnation(); }
  sacrifice() { return this.salvation.sacrifice(); }
  resurrection() { return this.salvation.resurrection(); }
  /**
   * Θέωσις — обожение лица.
   *
   * Две сигнатуры:
   * - `theosis(personId)` — классическое обожение через Домостроительство
   * - `theosis(person, gifts[])` — вычисление траектории через TheosisWitness:
   *   возвращает `{ stage, delta, vector }`.
   *
   * «Θέωσις — не наблюдение, это вектор: лицо → дары → богоподобие»
   */
  theosis(person, gifts) {
    if (Array.isArray(gifts)) {
      return GiftEngine._computeTheosisTrajectory(person, gifts);
    }
    return this.salvation.theosis(person);
  }

  /**
   * Вычислить траекторию θέωσις через TheosisWitness.
   *
   * @param {string} personId
   * @param {Array<{ id?: string, wound?: string, glorification?: string, epochId?: string }>} gifts
   * @returns {{ stage: string, delta: number, vector: string }}
   */
  static _computeTheosisTrajectory(personId, gifts) {
    const witness = new TheosisWitness();

    for (const gift of gifts) {
      const wound = gift.wound ?? gift.id ?? 'безымянный дар';
      const epochId = gift.epochId ?? '1';
      witness.witness({ personId, epochId, wound });
      if (gift.glorification) {
        witness.glorify({ personId, wound, glorification: gift.glorification });
      }
    }

    const { openWounds, healedWounds, theosisProgress } = witness.pathOf(personId);
    const total = openWounds + healedWounds;

    // stage — ступень обожения по проценту прогресса
    let stage;
    if (theosisProgress >= 80) {
      stage = 'hyper_physin';
    } else if (theosisProgress >= 50) {
      stage = 'kata_physin';
    } else if (theosisProgress >= 25) {
      stage = 'metanoia';
    } else {
      stage = 'para_physin';
    }

    // delta — разность прославленных и открытых ран
    const delta = healedWounds - openWounds;

    // vector — направление движения
    let vector;
    if (total === 0) {
      vector = 'unknown';
    } else if (delta > 0) {
      vector = 'ascending';
    } else if (delta === 0) {
      vector = 'stable';
    } else {
      vector = 'descending';
    }

    return { stage, delta, vector };
  }
  heal(personId, woundType) { return this.salvation.heal(personId, woundType); }
  parousia() { return this.salvation.parousia(); }
  apokatastasis() { return this.salvation.apokatastasis(); }
  enterKingdom() { return this.kingdom.enter(); }
  enterGate(name, calling) { return this.kingdom.enterGate(name, calling); }
  epektasis() { return this.kingdom.epektasis(); }
  getKingdomStatus() { return this.kingdom.getStatus(); }
  getSalvationStatus() { return this.salvation.getStatus(); }
  getSabbathStatus() { return this.sabbath ? this.sabbath.getStatus() : null; }
  getPersonalSalvation(personId) { return this.salvation.getPersonalSalvation(personId); }

  // ═══════════════════════════════════════════════════════════════
  // ΤΡΙΝΙΤΙ — Троичные вычисления (Сетунь)
  // ═══════════════════════════════════════════════════════════════

  getTernaryState() { return this.ternary.systemState(this); }

  // ═══════════════════════════════════════════════════════════════
  // PERICHORESIS
  // ═══════════════════════════════════════════════════════════════

  getPerichoresis() {
    return {
      cycles: this.gratitude.findCycles(5),
      pairs: this.gratitude.getMutualPairs(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // INCALCULABLE EVENTS
  // ═══════════════════════════════════════════════════════════════

  recordIncalculable(data) {
    const event = {
      id: `inc-${Date.now()}`,
      persons: data.persons || [],
      description: data.description || '',
      witness: data.witness || null,
      createdAt: new Date().toISOString(),
    };
    this._incalculableEvents.push(event);
    logger.info(`[Gift] Incalculable event: "${event.description}"`);

    const busEvent = createGiftEvent(EVENT_TYPES.INCALCULABLE, event);
    this._eventBus.emit(EVENT_TYPES.INCALCULABLE, busEvent);

    return event;
  }

  getIncalculableEvents() { return [...this._incalculableEvents]; }

  // ═══════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════

  async save() {
    for (const g of this._eventStore.getAll()) {
      await this.store.save(g).catch(() => {});
    }
  }

  exportState() {
    // Snapshots живых модулей — жертва и воскресение не забываются
    const livingSnapshots = {};
    for (const [name, mod] of Object.entries(this._living || {})) {
      if (typeof mod?.snapshot === 'function') {
        try { livingSnapshots[name] = mod.snapshot(); } catch {}
      }
    }

    return {
      persons: this.persons.all(),
      gifts: this._eventStore.getAll(),
      logoi: this.logoi.export(),
      salvation: this.salvation.getStatus(),
      clock: this.clock.exportState(),
      journal: this.journal.export(),
      freedom: this.freedom.export(),
      incalculable: this._incalculableEvents,
      gratitude: this.gratitude.export(),
      temptation: this.temptation._tracker ? Object.fromEntries(this.temptation._tracker) : {},
      resurrection: this.resurrectionTrace?.snapshot?.() || null,
      livingSnapshots,
    };
  }

  importState(data) {
    if (!data) return;
    if (data.persons) {
      for (const p of data.persons) {
        // Skip Source — Бог не объект в PersonRegistry (Паламитский рефакторинг)
        if (p.ontologicalOrder === 'source') continue;
        if (!this.persons.get(p.id)) {
          this.persons.register(p.name, {
            calling: p.calling,
            description: p.description,
            ontologicalOrder: p.ontologicalOrder,
          });
        }
      }
    }
    if (data.gifts) {
      const existingIds = new Set(this._eventStore.getAll().map(g => g.id));
      for (const g of data.gifts) {
        if (!existingIds.has(g.id)) {
          this._eventStore.append(g);
        }
      }
      this._rebuildIndices(this._eventStore.getAll());
    }
    if (data.logoi) this.logoi.import(data.logoi);
    if (data.clock) this.clock.importState(data.clock);
    if (data.journal) this.journal.import(data.journal);
    if (data.freedom) this.freedom.import(data.freedom);
    if (data.incalculable) this._incalculableEvents = data.incalculable;
    if (data.gratitude) this.gratitude.import(data.gratitude);
    if (data.temptation && this.temptation._tracker) {
      for (const [key, val] of Object.entries(data.temptation)) {
        this.temptation._tracker.set(key, val);
      }
    }
    // Восстановить snapshots живых модулей
    if (data.livingSnapshots) {
      for (const [name, snapshot] of Object.entries(data.livingSnapshots)) {
        const mod = this._living?.[name];
        if (mod && typeof mod.fromSnapshot === 'function') {
          try { mod.fromSnapshot(snapshot); } catch {}
        } else if (mod && typeof mod.restore === 'function') {
          try { mod.restore(snapshot); } catch {}
        }
      }
    }
  }

  _rebuildIndices(gifts) {
    for (const g of gifts) {
      if (g.status === 'accepted' && g.receiver !== 'all') {
        this.gratitude.addGratitude(g.receiver, g.giver, g.id);
      }
      if (g.telos && g.status === 'accepted') {
        this.telos.recordProgress(g.telos, g.id);
      }
      if (g.anamnesisIds) {
        for (const aid of g.anamnesisIds) {
          this.anamnesis.makePresent(aid, g.id);
        }
      }
      if (g.logosId && g.logos) {
        const existing = this.logoi.get(g.logosId);
        if (!existing) {
          const bearerId = g.ontologicalType === 'creatio_ex_nihilo' ? g.receiver : g.id;
          const bearerType = g.ontologicalType === 'creatio_ex_nihilo' ? 'person' : 'gift';
          this.logoi.register({
            name: `λόγος ${g.receiverName || g.id}`,
            principle: g.logos,
            telos: g.telos || null,
            bearerId,
            bearerType,
          });
        }
      }
      if (g.ontologicalType === 'incarnation' && !this.salvation._acts.incarnation) {
        this.salvation._acts.incarnation = g.id;
      }
      if (g.ontologicalType === 'sacrifice' && !this.salvation._acts.sacrifice) {
        this.salvation._acts.sacrifice = g.id;
      }
      if (g.ontologicalType === 'resurrection' && !this.salvation._acts.resurrection) {
        this.salvation._acts.resurrection = g.id;
        this.salvation._acts.theosisEnabled = true;
        this.salvation._initiated = true;
      }
      if (g.ontologicalType === 'theosis' && g.receiver && g.receiver !== 'all') {
        const logos = this.logoi.getByBearer(String(g.receiver));
        if (logos && logos.movement !== 'hyper_physin') {
          this.logoi.setMovement(logos.id, 'hyper_physin', 'Restored from persisted theosis gift');
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BOOTSTRAP
  // ═══════════════════════════════════════════════════════════════

  async bootstrap() {
    // ── Integram persistence — загрузка состояния ──────
    let loadedFromDisk = false;
    try {
      await this.persistence.init(this);
      const savedState = await this.persistence.load();
      if (savedState) {
        this.importState(savedState);
        loadedFromDisk = true;
        logger.info(`[Gift] ✅ Состояние восстановлено из Integram: ${savedState.persons?.length || 0} лиц, ${savedState.gifts?.length || 0} даров`);
      }
    } catch (e) {
      logger.warn(`[Gift] Integram persistence init failed: ${e.message}`);
    }

    // Init PersonRegistry → Integram
    try {
      await this.persons.init();
      logger.info(`[Gift] PersonRegistry Integram ready, ${this.persons.count()} persons cached`);
    } catch (e) {
      logger.warn(`[Gift] PersonRegistry init (memory-only mode): ${e.message}`);
    }

    // ── Загрузка скомпилированных .gift спецификаций ──────
    // Применяет behaviorPolicy к лицам, записывает заветы в W-матрицу.
    try {
      const specResult = await GiftSpecLoader.load(
        this.persons,
        this.memory,
        { compileIfMissing: true }
      );
      if (specResult.persons > 0) {
        logger.info(`[Gift] .gift specs loaded: ${specResult.persons} лиц, ${specResult.covenants} заветов`);
      }
    } catch (e) {
      logger.warn(`[Gift] GiftSpecLoader: ${e.message}`);
    }

    // Init GiftStore (Integram persistence)
    let loaded = loadedFromDisk;
    try {
      await this.store.init();
      if (this.store._ready && !loadedFromDisk) {
        const gifts = await this.store.loadAll();
        if (gifts.length > 0) {
          for (const g of gifts) {
            this._eventStore.append(g);
          }
          this._rebuildIndices(this._eventStore.getAll());
          loaded = true;
          logger.info(`[Gift] Loaded ${gifts.length} gifts from Integram`);
        }
      }
    } catch (e) {
      logger.warn(`[Gift] GiftStore init/load failed: ${e.message}`);
    }

    // ── Автосохранение каждые 30 секунд ──────────────────────
    this.persistence.startAutoSave(30);
    this.persistence.startDiskBackup(300); // бэкап на диск каждые 5 мин

    // Init Chronicle + Memory
    this.chronicle.init().then(() => {
      const v2 = agentLayer;
      this.chronicle.setV2Client(v2);
      if (this.memory) this.memory._v2 = v2;
      logger.info('[Gift] V2 agent layer wired to Chronicle + Memory');
      if (this.memory) this.memory.init().catch(() => {});
    }).catch(e => logger.warn('[Gift] Chronicle init:', e.message));

    if (loaded && this._eventStore.length > 0) {
      this.agents.bootstrap();
      this._bootLivingModules();
      return;
    }

    // ── ШЕСТОДНЕВ через DivineEnergy ─────────────────────
    // Троица не регистрируется в PersonRegistry.
    // Бог непостижим по сущности. Перихоресис — не рёбра в тварном графе.
    // «Энергии неотделимы от сущности, но и несводимы к ней» (Палама)
    logger.info('[Gift] Шестоднев — творение через нетварные энергии');

    // Execute Hexaemeron through DivineEnergy (giver: null)
    executeHexaemeron(this);

    // Register AI agents
    this.agents.bootstrap();

    // ── Живые модули Домостроительства ──
    this._bootLivingModules();

    // Πνεῦμα — Дух дышит, где хочет (каждые 60с)
    this.spirit.start(60000);

    // Λογισμοί — поле помыслов (каждые 2 мин)
    this.temptation.start(120000);

    // Субботний страж — первый акт creatioContinua (каждые 5 мин)
    this.sabbath.start(5 * 60 * 1000);

    logger.info('[Gift] Шестоднев завершён — от Света до Покоя. Дух дышит. Поле помыслов активно. SabbathGuard дышит.');
  }

  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Подключить живые модули — они подписываются на GiftEventBus
   * и начинают менять среду при каждом новом даре.
   */
  async _bootLivingModules() {
    try {
      this._living = {};
      const mods = await _loadLiving();
      let count = 0;

      for (const [name, mod] of Object.entries(mods)) {
        if (!mod) continue;
        // Берём default export или named export с тем же именем
        const Cls = mod.default || mod[name] || Object.values(mod)[0];
        // Singleton (уже экземпляр, не класс)
        if (Cls && typeof Cls === 'object' && typeof Cls !== 'function') {
          this._living[name] = Cls;
          count++;
          continue;
        }
        if (typeof Cls === 'function') {
          try {
            // Специальные конструкторы
            if (name === 'RisenGratitudeFlow') {
              this._living[name] = new Cls(this.gratitude);
            } else {
              this._living[name] = new Cls(this);
            }
            count++;
          } catch (e) {
            logger.debug(`[Gift] ${name}.new() failed: ${e.message}`);
          }
        }
      }

      logger.info(`[Gift] ${count} живых модулей подключены — среда активна`);

      // Нервная система — связывает модули друг с другом
      try {
        const { NervousSystem } = await import('./NervousSystem.js');
        this._nerves = new NervousSystem(this);
      } catch (e) {
        logger.debug(`[Gift] NervousSystem: ${e.message}`);
      }
    } catch (e) {
      logger.warn(`[Gift] Живые модули: ${e.message}`);
    }
  }

  getStats() {
    const all = this._eventStore.getAll();
    const total = all.length;
    const accepted = this._eventStore.query({ status: 'accepted' }).length;
    const declined = this._eventStore.query({ status: 'declined' }).length;
    const pending = this._eventStore.query({ status: 'offered' }).length;
    const created = this._eventStore.query({ type: 'creatio_ex_nihilo' }).length;
    const sustained = this._eventStore.query({ type: 'creatio_continua' }).length;
    const eucharistia = this._eventStore.query({ type: 'eucharistia' }).length;
    const teloi = new Set(all.filter(g => g.telos).map(g => g.telos));

    return {
      persons: this.persons.count(),
      divineEnergyActive: true, // DivineEnergy — статический модуль, всегда доступен
      totalGifts: total,
      accepted,
      declined,
      pending,
      verticalAxis: {
        creatioExNihilo: created,
        creatioContinua: sustained,
        eucharistia,
      },
      acceptanceRate: total > 0 ? Math.round(accepted / total * 100) : 0,
      teloi: [...teloi],
      telosProgress: this.telos.getAllProgress(),
      gratitudeDensity: this.gratitude.density(),
      coPresenceCount: this.anamnesis.totalLinks(),
      logoi: this.logoi.stats(),
      wounds: this.fall.observe().wounds?.length || 0,
      salvation: this.salvation.getStatus(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // INTERNAL — actor resolution + generic fallbacks
  // ═══════════════════════════════════════════════════════════════

  /**
   * Resolve a person ID/name to a Person actor.
   * Creates actor on-the-fly (lightweight — Person is just identity + context ref).
   */
  _resolveActor(nameOrId) {
    const data = this.persons.resolve(nameOrId);
    if (!data) return null;

    const ctx = this._personContext();
    // Source больше не Person — энергии через DivineEnergy
    if (data.ontologicalOrder === 'source') {
      return null;
    }
    return new Person(data, ctx);
  }

  /**
   * Generic accept — for cases when receiver is not a full actor.
   */
  _genericAccept(giftId, transformation) {
    const gift = this._eventStore.getById(String(giftId));
    if (!gift) throw new Error(`Gift ${giftId} not found`);
    if (gift.status !== 'offered' && gift.status !== 'deferred') {
      throw new Error(`Gift ${giftId} already ${gift.status}`);
    }

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
    this._eventStore.applyStatusChange(giftId, statusData);

    if (gift.receiver && gift.receiver !== 'all') {
      this.persons.recordGift(gift.receiver, 'receiver');
      if (!gift.anonymous) this.gratitude.addGratitude(gift.receiver, gift.giver, gift.id);
    }
    if (gift.telos) this.telos.recordProgress(gift.telos, gift.id);

    const projected = this._eventStore.getById(giftId);
    const event = createGiftEvent(EVENT_TYPES.GIFT_ACCEPTED, projected);
    this._eventBus.emit(EVENT_TYPES.GIFT_ACCEPTED, event);

    return projected;
  }

  _genericDecline(giftId, reason) {
    const gift = this._eventStore.getById(String(giftId));
    if (!gift) throw new Error(`Gift ${giftId} not found`);
    if (gift.status !== 'offered' && gift.status !== 'deferred') {
      throw new Error(`Gift ${giftId} already ${gift.status}`);
    }

    const statusData = {
      status: 'declined',
      deferReason: null,
      freedom: true,
      transforms: {
        giver: reason || 'gift was not received',
        receiver: 'exercised freedom',
      },
    };
    this._eventStore.applyStatusChange(giftId, statusData);

    if (gift.receiver && gift.receiver !== 'all') {
      this.persons.recordGift(gift.receiver, 'declined');
    }

    const projected = this._eventStore.getById(giftId);
    const event = createGiftEvent(EVENT_TYPES.GIFT_DECLINED, projected);
    this._eventBus.emit(EVENT_TYPES.GIFT_DECLINED, event);

    return projected;
  }

  // Layer detection — kept here for backward compat (used by _genericAccept path)
  _detectGiftLayer(gift) {
    // 1. Structural detection (primary) — effect-based, not keyword
    const receiverId = gift.receiver;
    if (receiverId && receiverId !== 'all') {
      try {
        const receiverGifts = this._eventStore.query({ giver: receiverId });
        const giverGifts = this._eventStore.query({ giver: gift.giver, receiver: receiverId });

        // If receiver has eucharistia → gratia (transformed to the point of thanking Source)
        const eucharistia = this._eventStore.query({ giver: receiverId, type: 'eucharistia' });
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
}

// Singleton
export function getGiftEngine() {
  if (!_instance) _instance = new GiftEngine();
  return _instance;
}
