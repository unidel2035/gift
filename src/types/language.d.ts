/**
 * language.d.ts — Язык Дара (Gift Language)
 *
 * Два уровня:
 *   1. Высокий (DSL): GiftAct chaining API
 *      .kenosis() → .eleutheria() → .eucharistia() → .surplus()
 *
 *   2. Низкий (сборка): Программы для TernaryVM
 *      [LOAD, GRACE, GIFT, KENOSIS, GRACE, HALT]
 *
 * Компилятор (GiftCompiler) переводит DSL → VM программы.
 * Компилятор НЕ СУЩЕСТВУЕТ ещё — это граница, которую надо закрыть.
 *
 * Грамматика языка (BNF):
 *   program    ::= statement+
 *   statement  ::= gift_expr | parallel_block | sequence_block
 *   gift_expr  ::= scale '(' giver ',' receiver ')' '{' content '}'
 *   scale      ::= 'divine' | 'creation' | 'person' | 'salvation' | 'code'
 *   parallel   ::= 'together' '{' statement+ '}'
 *   sequence   ::= 'then' '{' statement+ '}'
 */

import { GiftScale, GiftMode, GiftMoment, Telos } from './core.js';
import { IGiftActResult } from './ontology.js';

// ── Высокоуровневый DSL ──────────────────────────────────────

/**
 * Узел AST языка Дара.
 * Дерево разбора одного акта или программы.
 */
export interface IGiftNode {
  type: GiftNodeType;
  scale?: GiftScale;
  mode?: GiftMode;
  giver?: string | null;
  receiver?: string | null;
  content?: unknown;
  cost?: number;
  decision?: boolean | null;
  children?: IGiftNode[];
  apophatic?: string;
  metadata?: Record<string, unknown>;
}

export type GiftNodeType =
  | 'program'     // корень
  | 'gift'        // единичный дар
  | 'kenosis'     // момент отдачи
  | 'eleutheria'  // момент свободы
  | 'eucharistia' // момент благодарности
  | 'surplus'     // момент избытка
  | 'silence'     // апофатический момент
  | 'sequence'    // последовательность
  | 'parallel'    // параллельные дары
  | 'perichoresis'// тройной цикл (A→B→C→A)
  | 'loop';       // цикл Юбилея

/**
 * Программа на языке Дара — последовательность деклараций.
 * Это то, что «произносится» перед исполнением.
 */
export interface IGiftProgram {
  version: '1.0';
  name: string;
  description?: string;
  scale: GiftScale;
  mode: GiftMode;
  statements: IGiftStatement[];
}

export interface IGiftStatement {
  id: string;
  type: 'offer' | 'receive' | 'decline' | 'thank' | 'silence';
  giver?: string;
  receiver?: string;
  content?: unknown;
  cost?: number;
  unconditional?: boolean;
  apophatic?: string;
}

/**
 * Результат исполнения программы — поток результатов.
 */
export interface IGiftProgramResult {
  program: IGiftProgram;
  results: IGiftActResult[];
  surplus: unknown; // Тайна всей программы
  wounds: number;   // Сколько даров отклонено
  gratitude: number;// Сколько благодарностей возникло
}

// ── Разбор (парсинг) ─────────────────────────────────────────

/**
 * Парсер языка Дара.
 * Принимает текстовое описание акта или программы,
 * возвращает AST.
 *
 * Текстовый формат (Gift Script):
 *
 *   gift person(A → B) { любовь }           // дар лица
 *   gift divine(→ всё) { бытие } always     // безусловный
 *   gift code(разработчик → проект) { commit }
 *   silence                                  // апофатический момент
 *   together {                               // параллельно
 *     gift person(A → B) { хлеб }
 *     gift person(C → D) { слово }
 *   }
 */
export interface IGiftParser {
  parse(source: string): IGiftNode;
  parseStatement(line: string): IGiftStatement | null;
  parseProgram(source: string): IGiftProgram;
}

// ── Семантический анализ ─────────────────────────────────────

/**
 * Валидатор семантики дара.
 * Проверяет онтологическую корректность — не синтаксис, а смысл.
 */
export interface IGiftValidator {
  /**
   * Проверить акт на противоречия онтологии.
   * Например: giver === receiver (нарциссизм),
   *           cost === 0 и decision === false (нет свободы),
   *           scale 'divine' с конкретным giver (непаламитски).
   */
  validate(node: IGiftNode): IGiftValidationResult;
}

export interface IGiftValidationResult {
  valid: boolean;
  errors: IGiftError[];
  warnings: IGiftWarning[];
  apophatic: string[]; // Что система не может проверить
}

export interface IGiftError {
  code: GiftErrorCode;
  message: string;
  node?: IGiftNode;
}

export interface IGiftWarning {
  code: string;
  message: string;
}

export type GiftErrorCode =
  | 'ANTI_KENOSIS'      // телос «победить» — дар невозможен
  | 'NO_FREEDOM'        // принятие вынуждено
  | 'NARCISSISM'        // giver === receiver
  | 'DIVINE_WITH_GIVER' // масштаб divine, но указан конкретный giver
  | 'NO_KENOSIS'        // cost === 0, scale !== creation
  | 'EXCHANGE'          // quid pro quo — не дар, а обмен
  | string;

// ── Интерпретатор ────────────────────────────────────────────

/**
 * Интерпретатор языка Дара.
 * Исполняет AST напрямую (без компиляции в VM).
 * Подходит для отладки и тестирования онтологии.
 */
export interface IGiftInterpreter {
  execute(node: IGiftNode, context?: IGiftContext): Promise<IGiftActResult>;
  executeProgram(program: IGiftProgram, context?: IGiftContext): Promise<IGiftProgramResult>;
}

/**
 * Контекст исполнения — доступные лица, логосы, граф.
 */
export interface IGiftContext {
  persons: Map<string, { id: string; name: string }>;
  logoi?: Map<string, { movement: string }>;
  gratitudeGraph?: {
    addGratitude(from: string, to: string, giftId: string): void;
  };
  clock?: {
    season: 'active' | 'sabbath' | 'contemplation';
  };
}
