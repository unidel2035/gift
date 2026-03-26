/**
 * compiler.d.ts — Компилятор и виртуальная машина
 *
 * Два слоя:
 *   GiftCompiler — парсит .gift текст, исполняет через GiftEngine
 *   TernaryVM    — низкоуровневая VM на тритах (Сетунь)
 *
 * GiftAct DSL → GiftCompiler → GiftEngine (высокий уровень)
 * GiftAct     → GiftCompiler → TernaryVM  (низкий уровень, планируется)
 *
 * «В начале было Слово» (Ин 1:1)
 */

import { ITryte, ITrit, TritValue } from './core.js';

// ── Opcodes TernaryVM ────────────────────────────────────────

export type Opcode =
  | 'LOAD'    // загрузить из памяти
  | 'STORE'   // сохранить в память
  | 'ADD'     // сложить
  | 'MUL'     // умножить
  | 'NOP'     // нет операции
  | 'GIFT'    // дарить
  | 'KENOSIS' // самоопустошение
  | 'GRACE'   // благодать
  | 'HALT';   // остановка

export type OpcodePair = [TritValue, TritValue];

export const OPCODES: Record<Opcode, OpcodePair>;

// ── Инструкции ───────────────────────────────────────────────

export interface IInstruction {
  op: OpcodePair;
  arg?: TritValue;
}

// ── TernaryVM ────────────────────────────────────────────────

export interface ITernaryVM {
  memory: ITernaryMemory;
  accumulator: ITryte;
  pc: number;
  halted: boolean;
  log: IVMStepLog[];

  loadProgram(instructions: IInstruction[]): void;
  step(): IVMStep;
  run(): IVMRunResult;
}

export interface IVMStep {
  pc: number;
  action: string;
  acc: string;
  halted: boolean;
}

export interface IVMStepLog {
  pc: number;
  action: string;
  acc: string;
}

export interface IVMRunResult {
  steps: number;
  halted: boolean;
  accumulator: ITryteJSON;
  log: IVMStepLog[];
}

export interface ITryteJSON {
  logos: ITritJSON;
  energy: ITritJSON;
  relation: ITritJSON;
  health: number | null;
  repr: string;
}

export interface ITritJSON {
  value: TritValue;
  name: string;
  short: string;
}

// ── TernaryMemory ────────────────────────────────────────────

export interface ITernaryMemory {
  size: number;
  read(address: number | ITryte): ITryte;
  write(address: number | ITryte, tryte: ITryte): void;
  dump(): Array<{ address: number; tryte: string; health: number | null }>;
}

// ── TernaryALU ───────────────────────────────────────────────

export interface ITernaryALU {
  addTrytes(a: ITryte, b: ITryte): { result: ITryte; carry: ITrit };
  mulTrits(a: ITrit, b: ITrit): ITrit;
  compare(a: ITrit, b: ITrit): ITrit;
  mux(selector: ITrit, a: ITrit, b: ITrit, c: ITrit): ITrit;
  consensus(trits: ITrit[]): ITrit;
}

// ── GiftCompiler ─────────────────────────────────────────────

/**
 * Компилятор языка Дара.
 *
 * Принимает .gift текст (русский + греческий + английский),
 * разбирает и исполняет через GiftEngine.
 *
 * Версия v0.1: regex-парсер (не полная грамматика).
 * Версия v1.0: PEG/ANTLR грамматика + компиляция в TernaryVM.
 */
export interface IGiftCompiler {
  /**
   * Исполнить .gift программу.
   * @param source — текст программы
   * @returns результаты всех команд
   */
  execute(source: string): Promise<IGiftCompilerResult[]>;

  /**
   * Только разобрать — без исполнения.
   * Полезно для отладки грамматики.
   */
  parse(source: string): IGiftStatement[];
}

export interface IGiftStatement {
  type: string;
  args: Record<string, unknown>;
  line: number;
  raw: string;
}

export interface IGiftCompilerResult {
  statement: IGiftStatement;
  success: boolean;
  result?: unknown;
  error?: string;
}

// ── Встроенные программы ─────────────────────────────────────

export interface IBuiltinPrograms {
  /** Программа Спасения: LOAD → GRACE → GIFT → KENOSIS → GRACE → HALT */
  salvationProgram(): IInstruction[];
  /** Программа Творения: GRACE × 3 → STORE → HALT */
  creationProgram(): IInstruction[];
  /** Пустая программа: NOP → HALT */
  emptyProgram(): IInstruction[];
}
