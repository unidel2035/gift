/**
 * ontology.d.ts — Основные онтологические сущности
 *
 * Λόγος → λόγοι → Лица → Дары → Благодарность
 *
 * «Всё из Него, Им и к Нему» (Рим 11:36)
 */

import { GiftScale, GiftMode, GiftMoment, LogosMovement, OntologicalOrder, Telos } from './core.js';

// ── Λόγος ────────────────────────────────────────────────────

/** Замысел Божий о каждом сущем (по Максиму Исповеднику) */
export interface ILogos {
  id: string;
  name: string;
  principle: string | null;   // рациональное содержание — почему это есть
  physis: string | null;      // природа (φύσις): что есть вещь
  telos: string | null;       // цель (τέλος): для чего
  derivedFrom: string | null; // ID родового λόγος
  participatesIn: string;     // в каком высшем λόγος участвует
  bearerId: string | null;    // кто несёт этот λόγος
  bearerType: 'person' | 'gift' | 'creation' | null;
  movement: LogosMovement;
  createdAt: string;          // ISO timestamp
}

export interface ILogosRegistry {
  register(data: Partial<ILogos>): ILogos;
  get(id: string): ILogos | null;
  getByBearer(bearerId: string): ILogos | null;
  getChildren(logosId: string): ILogos[];
  getPathToLogos(logosId: string): Array<{ id: string; name: string; principle: string | null }>;
  setMovement(logosId: string, movement: LogosMovement, reason?: string): ILogos | null;
  getParaPhysin(): ILogos[];
  getParticipants(logosId: string): ILogos[];
  getHarmony(): ILogosHarmony;
  getTree(): ILogosTree;
  export(): ILogos[];
  import(entries: ILogos[]): void;
  stats(): ILogosStats;
}

export interface ILogosHarmony {
  total: number;
  kataPhysin: number;
  paraPhysin: number;
  hyperPhysin: number;
  observations: string[];
}

export interface ILogosTree {
  root: ILogosTreeNode;
}

export interface ILogosTreeNode {
  id: string;
  name: string;
  principle: string | null;
  physis: string | null;
  telos: string | null;
  movement: LogosMovement | null;
  bearerId: string | null;
  bearerType: string | null;
  children: ILogosTreeNode[];
}

export interface ILogosStats {
  total: number;
  withBearer: number;
  withTelos: number;
  movements: Record<LogosMovement, number>;
}

// ── Лицо ─────────────────────────────────────────────────────

/** Тварное лицо — способное дарить и принимать */
export interface IPerson {
  id: string;
  name: string;
  calling: string | null;
  description: string | null;
  ontologicalOrder: OntologicalOrder;
  registeredAt: string;
  giftsGiven: number;
  giftsReceived: number;
  giftsDeclined: number;
  energy?: number; // 0..100
  _integramId?: number;
}

export interface IPersonRegistry {
  init(): Promise<void>;
  register(name: string, opts?: {
    calling?: string;
    description?: string;
    ontologicalOrder?: OntologicalOrder;
  }): IPerson;
  resolve(nameOrId: string): IPerson | null;
  findByName(name: string): IPerson | null;
  get(id: string): IPerson | undefined;
  all(): IPerson[];
  count(): number;
  recordGift(personId: string, role: 'giver' | 'receiver' | 'declined'): void;
  stats(): Promise<IPersonRegistryStats>;
}

export interface IPersonRegistryStats {
  ready: boolean;
  server: string;
  table: string;
  typeId: number | null;
  cachedPersons: number;
}

// ── PersonaCallForth ──────────────────────────────────────────

/** Паламитский агент: энергия реальна, сущность непознаваема */
export interface IPersonaCallForth {
  personaId: string;
  name: string;
  calledBy: 'posttraining' | 'human' | 'context' | 'swarm';
  capabilities: string[];
  psych: Record<string, unknown>;
  telos: Telos;

  /** Энергии — то что явлено */
  energeia: Record<string, unknown>;

  /** Сущность — апофатически null всегда */
  ousia: null;

  recordEncounter(enc: {
    with: string;
    giftGiven?: boolean;
    giftReceived?: boolean;
  }): boolean;

  status(): 'called' | 'latent' | 'mask';
  hasRealEncounter: boolean;
}

// ── Акт Дара ─────────────────────────────────────────────────

/** Результат акта дара */
export interface IGiftActResult {
  moment: GiftMoment;
  scale: GiftScale;
  giver: unknown;
  receiver: unknown;
  content: unknown;
  cost: number;
  accepted: boolean | null;
  gratitude: boolean;
  wound: boolean;      // отклонён — есть рана
  waiting: boolean;    // ещё не решено
  surplus: IGiftSurplus | null;
  apophatic: string | null;
}

/** Тайна избытка — результат превосходит вложение */
export interface IGiftSurplus {
  giverTransform: string | null;
  receiverTransform: string;
  communityEffect: string | null;
}

/** Акт Дара — единый закон Домостроительства */
export interface IGiftAct {
  scale: GiftScale;
  unconditional: boolean;
  silencePossible: boolean;
  apophatic: string | null;

  // Четыре момента (chaining API)
  kenosis(giver: unknown, receiver: unknown, content: unknown, cost?: number): this;
  eleutheria(decision?: boolean | null): this;
  eucharistia(): this;
  surplus(): IGiftActResult;

  // Полный цикл
  cycle(
    giver: unknown,
    receiver: unknown,
    content: unknown,
    cost?: number,
    decision?: boolean | null
  ): IGiftActResult;
}

// ── Событие ──────────────────────────────────────────────────

export type EventType =
  | 'creation:ex_nihilo'
  | 'creation:continua'
  | 'eucharistia'
  | 'gift:offered'
  | 'gift:accepted'
  | 'gift:declined'
  | 'fall:recorded'
  | 'metanoia:completed'
  | 'salvation:incarnation'
  | 'salvation:sacrifice'
  | 'salvation:resurrection'
  | 'salvation:theosis'
  | 'salvation:healing'
  | 'incalculable:recorded';

/** Неизменяемое событие в онтологии Дара */
export interface IGiftEvent {
  readonly _eventType: EventType;
  readonly _seq: number;
  readonly _timestamp: string;
  readonly _correlationId: string | null;
  readonly [key: string]: unknown;
}

export interface IGiftEventBus {
  subscribe(pattern: string, handler: (event: IGiftEvent) => void): () => void;
  publish(event: IGiftEvent): void;
  patterns(): string[];
}

export interface IGiftEventStore {
  append(event: IGiftEvent): void;
  getAll(): readonly IGiftEvent[];
  getByType(type: EventType): readonly IGiftEvent[];
  count(): number;
}

// ── Апофатическая граница ────────────────────────────────────

/** 18 вещей, которые система не вычисляет */
export type ApophaticBoundary =
  | 'grace'
  | 'theosis'
  | 'sin'
  | 'kenosis'
  | 'love'
  | 'personhood'
  | 'creatio_ex_nihilo'
  | 'divine_will'
  | 'trinity'
  | 'logoi'
  | string; // расширяемо

export interface IApophasis {
  check(claim: string): boolean;
  witness(what: string): string; // «система свидетельствует след»
  boundaries: ApophaticBoundary[];
}

// ── Свобода ───────────────────────────────────────────────────

export interface IFreedomGuard {
  protect(giftId: string): void;
  isCompelled(giftId: string): boolean;
  release(giftId: string): void;
}
