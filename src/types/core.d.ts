/**
 * core.d.ts — Ядро онтологии
 *
 * Тернарная основа: три состояния бытия.
 * Четвёртое — вне вычисления.
 *
 * «В Нём было жизнь» (Ин 1:4)
 */

// ── Тернарные состояния ──────────────────────────────────────

/** Состояние бытия в онтологии Дара */
export type TritValue =
  | -1    // παρὰ φύσιν — против природы, падение
  |  0    // κατὰ φύσιν — по природе, норма
  |  1    // ὑπὲρ φύσιν — сверх природы, обожение
  | null; // ∅ — невычислимо, вне системы

export type TritName =
  | 'παρὰ φύσιν'
  | 'κατὰ φύσιν'
  | 'ὑπὲρ φύσιν'
  | 'incalculable';

export type TritShort = '-' | '0' | '+' | '∅';

/** Единица тернарной логики */
export interface ITrit {
  value: TritValue;
  name: TritName;
  short: TritShort;

  isIncalculable: boolean;
  isFallen: boolean;
  isNatural: boolean;
  isDeified: boolean;

  // Арифметика
  add(other: ITrit): ITrit;
  not(): ITrit;
  and(other: ITrit): ITrit;
  or(other: ITrit): ITrit;

  // Онтологические операции
  gift(receiver: ITrit): ITrit;
  kenosis(): ITrit;
  grace(): ITrit;
  fall(): ITrit;
  metanoia(): ITrit;
}

/**
 * Трайт — три трита, одно «слово» лица.
 * [logos_movement, energy_state, relation_state]
 */
export interface ITryte {
  trits: [ITrit, ITrit, ITrit];
  logos: ITrit;    // κατὰ/παρὰ/ὑπὲρ φύσιν
  energy: ITrit;   // depleted / normal / full
  relation: ITrit; // isolated / connected / perichoresis

  /** Сумма тритов: -3..+3 или null (incalculable) */
  health(): number | null;

  toString(): string; // '[+0-]'
}

// ── Движение λόγος ──────────────────────────────────────────

export type LogosMovement =
  | 'kata_physin'   // κατὰ φύσιν — по природе
  | 'para_physin'   // παρὰ φύσιν — против природы
  | 'hyper_physin'; // ὑπὲρ φύσιν — сверх природы (обожение)

// ── Телос (направление) агента ──────────────────────────────

export type Telos =
  | 'give'    // дарить
  | 'serve'   // служить
  | 'win'     // победить (AntiKenosis)
  | 'unknown'; // не определён

// ── Масштабы дара ────────────────────────────────────────────

export type GiftScale =
  | 'divine'      // нетварная энергия
  | 'creation'    // творение
  | 'providence'  // промысл
  | 'person'      // между лицами
  | 'salvation'   // спасение
  | 'code'        // программный код
  | 'physics';    // физический слой

// ── Режим дара ───────────────────────────────────────────────

export type GiftMode =
  | 'perichoresis' // аффективный — дар в присутствии
  | 'anamnesis';   // когнитивный — дар на расстоянии, пророческий

// ── Момент дара ──────────────────────────────────────────────

export type GiftMoment =
  | 'kenosis'    // κένωσις — отдача
  | 'eleutheria' // ἐλευθερία — свобода приёма
  | 'eucharistia'// εὐχαριστία — благодарность
  | 'surplus'    // избыток — результат > вложение
  | 'silence';   // молчание — апофатический момент

// ── Онтологический порядок ───────────────────────────────────

export type OntologicalOrder =
  | 'source'   // Πηγή — Источник, нетварный
  | 'person';  // тварное лицо
