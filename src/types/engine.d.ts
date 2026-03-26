/**
 * engine.d.ts — GiftEngine: тонкий координатор
 *
 * GiftEngine — фасад. Не God Object.
 * Каждая подсистема отвечает за свой аспект онтологии.
 *
 * Три зоны:
 *   Видимое    — события (GiftEventStore)
 *   Умопостигаемое — паттерны, вопросы (PatternObserver, LogosRegistry)
 *   Апофатическое  — молчание (Apophasis, HolySaturday)
 */

import { IPersonRegistry } from './ontology.js';
import { ILogosRegistry } from './ontology.js';
import { IGiftEventBus, IGiftEventStore } from './ontology.js';
import { IGratitudeGraph } from './graph.js';
import { ITernaryRegister } from './compiler.js';

// ── Подсистемы ────────────────────────────────────────────────

export interface IGiftEngineSubsystems {
  // Лица
  persons: IPersonRegistry;

  // Граф
  gratitude: IGratitudeGraph;
  graph: IGratitudeGraph; // Legacy alias

  // Память
  anamnesis: IAnamnesisCache;
  memory: IAnamnesisMemory;
  chronicle: IGiftChronicle;
  store: IGiftStore;

  // Теология
  logoi: ILogosRegistry;
  apophasis: IApophasis;
  freedom: IFreedomGuard;
  spirit: IHolySpiritEngine;
  kingdom: INewJerusalem;
  angels: IAngelicOrder;
  temptation: ITemptationField;
  salvation: ISalvationWitness;
  resurrectionTrace: IResurrectionTrace;

  // Физика и среда
  physics: IPhysicalLayer;
  bio: IBioLayer;
  environment: IEnvironmentLayer;

  // Тернарная логика
  ternary: ITernaryRegister;

  // Время
  clock: ILiturgicalClock;
  sabbath: ISabbathGuard;

  // Агенты
  agents: IGiftAgents;
  techPackage: ITechPackageEngine;

  // Телос
  telos: ITelosPlanner;

  // Наблюдение
  patterns: IPatternObserver;
  fall: IFallObserver;
  journal: IWitnessJournal;
  discernment: IDiscernmentGuard;
  persistence: IGiftPersistence;

  // События
  _eventBus: IGiftEventBus;
  _eventStore: IGiftEventStore;
}

// ── GiftEngine ───────────────────────────────────────────────

export interface IGiftEngine extends IGiftEngineSubsystems {
  // ── Инициализация ──────────────────────────────────────

  /** Подключить Socket.IO для реалtime уведомлений */
  setIO(io: unknown): void;

  /** Подключить SOD-мост */
  setSodBridge(fn: unknown): void;

  // ── Обратная совместимость ──────────────────────────────

  /** Все события (из GiftEventStore) */
  _gifts: readonly IGiftEventData[];
  gifts: readonly IGiftEventData[];

  // ── Creatio ─────────────────────────────────────────────

  /**
   * Creatio ex nihilo — зарегистрировать новое лицо через нетварную энергию.
   */
  creatio(name: string, opts?: {
    calling?: string;
    description?: string;
  }): Promise<IGiftEventData>;

  // ── Дар ─────────────────────────────────────────────────

  /**
   * Предложить дар.
   */
  offer(opts: {
    giver: string;
    receiver: string;
    content: string;
    cost?: number;
    telos?: string;
    anamnesis?: string[];
  }): Promise<IGiftEventData>;

  /**
   * Принять дар.
   */
  accept(id: string, opts?: {
    giverTransform?: string;
    receiverTransform?: string;
  }): Promise<IGiftEventData>;

  /**
   * Отклонить дар.
   */
  decline(id: string, reason?: string): Promise<IGiftEventData>;

  // ── Статистика ──────────────────────────────────────────

  stats(): IGiftEngineStats;
}

export interface IGiftEventData {
  id: string;
  type: string;
  giver?: string;
  receiver?: string;
  content?: unknown;
  cost?: number;
  status?: 'offered' | 'accepted' | 'declined';
  timestamp?: string;
  [key: string]: unknown;
}

export interface IGiftEngineStats {
  persons: number;
  gifts: number;
  accepted: number;
  declined: number;
  gratitudeEdges: number;
  cycles: number;
  phase: string;
  logoi: { total: number; harmony: number };
  ternary: { phase: string; health: number };
}

// ── Заглушки для подсистем ──────────────────────────────────
// (полные интерфейсы — в соответствующих файлах)

export interface IAnamnesisCache { get(key: string): unknown; set(key: string, val: unknown): void; }
export interface IAnamnesisMemory { remember(context: string): Promise<string[]>; }
export interface IGiftChronicle { record(event: unknown): void; getAll(): unknown[]; }
export interface IGiftStore { save(gift: unknown): Promise<void>; }
export interface IApophasis { check(claim: string): boolean; }
export interface IFreedomGuard { protect(giftId: string): void; isCompelled(giftId: string): boolean; }
export interface IHolySpiritEngine { pulse(): void; }
export interface INewJerusalem { vision(): unknown; }
export interface IAngelicOrder { scan(): unknown[]; }
export interface ITemptationField { level(): number; }
export interface ISalvationWitness { witness(event: unknown): void; }
export interface IResurrectionTrace { hasRisen(): boolean; }
export interface IPhysicalLayer { state(): unknown; }
export interface IBioLayer { state(): unknown; }
export interface IEnvironmentLayer { state(): unknown; }
export interface ILiturgicalClock { currentState(): ILiturgicalState; }
export interface ILiturgicalState {
  season: 'active' | 'sabbath' | 'contemplation';
  heartPurity: number;
  graceProb: number;
  temptationLevel: number;
}
export interface ISabbathGuard { isResting(): boolean; enforce(): void; }
export interface IGiftAgents { all(): unknown[]; }
export interface ITechPackageEngine { status(): unknown; }
export interface ITelosPlanner { plan(personId: string): unknown; }
export interface IPatternObserver { observe(): unknown[]; }
export interface IFallObserver { hasFallen(personId: string): boolean; }
export interface IWitnessJournal { entries(): unknown[]; }
export interface IDiscernmentGuard { discern(spirit: unknown): 'of_god' | 'of_man' | 'enemy'; }
export interface IGiftPersistence { snapshot(): unknown; restore(snapshot: unknown): void; }
export interface ITernaryRegister {
  systemState(engine: IGiftEngine): ITernarySystemState;
}
export interface ITernarySystemState {
  persons: Array<{ name: string; tryte: unknown; repr: string }>;
  system: { health: number; normalized: number; phase: string; incalculable: number };
}
