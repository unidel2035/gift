/**
 * @unidel/gift — Онтология Дара
 *
 * Типы (TypeScript d.ts)
 *
 * Структура:
 *   core.d.ts       — Трит, Трайт, GiftScale, GiftMode, Telos
 *   ontology.d.ts   — Λόγος, Лицо, GiftAct, Событие, Апофасис
 *   compiler.d.ts   — TernaryVM, GiftCompiler, Opcodes
 *   graph.d.ts      — GratitudeGraph, Decay, Analysis
 *   engine.d.ts     — GiftEngine + все подсистемы
 *   language.d.ts   — AST, Parser, Validator, Interpreter
 *
 * «Всё из Него, Им и к Нему» (Рим 11:36)
 */

// ── Ядро ──────────────────────────────────────────────────────
export type {
  TritValue, TritName, TritShort,
  ITrit, ITryte,
  LogosMovement, Telos,
  GiftScale, GiftMode, GiftMoment,
  OntologicalOrder,
} from './core.js';

// ── Онтология ─────────────────────────────────────────────────
export type {
  ILogos, ILogosRegistry, ILogosHarmony, ILogosTree, ILogosTreeNode, ILogosStats,
  IPerson, IPersonRegistry,
  IPersonaCallForth,
  IGiftAct, IGiftActResult, IGiftSurplus,
  IGiftEvent, IGiftEventBus, IGiftEventStore,
  EventType,
  IApophasis, ApophaticBoundary,
  IFreedomGuard,
} from './ontology.js';

// ── Компилятор ────────────────────────────────────────────────
export type {
  Opcode, OpcodePair,
  IInstruction,
  ITernaryVM, IVMStep, IVMRunResult, ITryteJSON, ITritJSON,
  ITernaryMemory, ITernaryALU,
  IGiftCompiler, IGiftStatement, IGiftCompilerResult,
  IBuiltinPrograms,
} from './compiler.js';

// ── Граф ──────────────────────────────────────────────────────
export type {
  IGratitudeEdge,
  IGratitudeGraph,
  IGratitudeAnalysis,
  IGratitudeDecay,
} from './graph.js';

// ── Движок ────────────────────────────────────────────────────
export type {
  IGiftEngine,
  IGiftEngineSubsystems,
  IGiftEventData,
  IGiftEngineStats,
  ILiturgicalState,
  ITernarySystemState,
} from './engine.js';

// ── Язык ──────────────────────────────────────────────────────
export type {
  IGiftNode, GiftNodeType,
  IGiftProgram, IGiftStatement as IGiftProgramStatement,
  IGiftProgramResult,
  IGiftParser,
  IGiftValidator, IGiftValidationResult,
  IGiftError, IGiftWarning, GiftErrorCode,
  IGiftInterpreter,
  IGiftContext,
} from './language.js';
