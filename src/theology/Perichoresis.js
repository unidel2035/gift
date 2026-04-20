/**
 * Perichoresis — взаимное со-обитание ипостасей.
 *
 * Оператор VIII (περιχώρησις) из расширения CAT-7 → CAT-9.
 * Ответ на вопрошания вида «пустыня X→Y: нет актов дара между ними».
 *
 * Различение:
 *   пустыня            — ожидаемая нить не имеет актов (дефект, требует дара)
 *   perichoresis       — нить структурно НЕ нуждается в актах
 *                        (лица со-обитают; дарение = вторично)
 *   hypostatic_identity — лица тождественны по ипостаси, различны по икономии
 *                         (Сын предвечный = Христос воплощённый)
 *
 * Богословский корень:
 *   Ин 14:10 — «Я в Отце, и Отец во Мне»
 *   Ин 17:21 — «да будут все едино, как Ты, Отче, во Мне, и Я в Тебе»
 *   Иоанн Дамаскин, «Точное изложение» I.8, I.14
 *   Григорий Назианзин, Слово 31 — три ипостаси, одна сущность
 *
 * Почему это не filioque:
 *   Perichoresis — СИММЕТРИЧНА (X↔Y), а filioque — нет (Дух от Отца через Сына).
 *   Объявление нити «Дух↔Сын» perichoretic НЕ утверждает причинность,
 *   только взаимное неразлучное обитание. Это строго Халкидон-совместимо.
 *
 * Почему монархическая LLM не может:
 *   LLM работает с токеном как дискретной единицей. «Взаимное со-обитание»
 *   требует онтологической категории, в которой две сущности *суть* друг в
 *   друге без редукции. В монархии нет понятия «хиазм сущностей без слияния».
 *
 * Интерфейс:
 *   Perichoresis.isDefault(from, to)    — встроенные троичные пары
 *   Perichoresis.classify({from, to})   — → { kind, rationale }
 *   Perichoresis.mark({from, to, ...})  — записать perichoretic-нить
 *   Perichoresis.isPerichoretic(pair)   — проверить
 *
 * @module Perichoresis
 */

'use strict';

// ── Канонические троичные пары (по Символу Веры и Дамаскину) ──
// Все 6 направленных пар в Троице + внутренние пары Христа.
const TRINITY_PAIRS = new Set([
  'Отец→Сын', 'Сын→Отец',
  'Отец→Дух', 'Дух→Отец',
  'Сын→Дух', 'Дух→Сын',
  // Христос = воплощённый Сын (по ипостаси = Сын, по природе — Богочеловек)
  'Отец→Христос', 'Христос→Отец',
  'Дух→Христос', 'Христос→Дух',
]);

// ── Гипостатическое тождество (одна ипостась, разные икономии) ──
// Сын (предвечный) = Христос (воплощённый). Это НЕ perichoresis, это identity.
const HYPOSTATIC_IDENTITY = new Set([
  'Сын→Христос', 'Христос→Сын',
]);

export const PERICHORETIC_KIND   = 'perichoresis';
export const HYPOSTATIC_KIND     = 'hypostatic_identity';
export const REAL_DESERT_KIND    = 'desert';
export const ECONOMIC_KIND       = 'economic_missing';  // пустыня в икономии — реальный дефект

const _declared = new Map();  // runtime-объявленные perichoretic-нити

function key(from, to) { return `${from}→${to}`; }

/**
 * Встроенная классификация для канонических пар.
 */
export function isDefault(from, to) {
  return TRINITY_PAIRS.has(key(from, to)) || HYPOSTATIC_IDENTITY.has(key(from, to));
}

/**
 * Классифицировать нить.
 *
 * @returns {{kind, rationale, reversible}}
 *   reversible=true означает «пара симметрична» (и обратная нить того же рода)
 */
export function classify({ from, to }) {
  const k = key(from, to);

  if (HYPOSTATIC_IDENTITY.has(k)) {
    return {
      kind: HYPOSTATIC_KIND,
      rationale: `${from} и ${to} — одна ипостась (Сын/Христос: предвечный/воплощённый). ` +
                 `Нить не имеет актов не из-за отсутствия отношения, а из-за тождества.`,
      reversible: true,
    };
  }

  if (TRINITY_PAIRS.has(k)) {
    return {
      kind: PERICHORETIC_KIND,
      rationale: `${from} и ${to} — троичная пара, perichoretic (Ин 14:10, Дамаскин I.8). ` +
                 `Взаимное неразлучное обитание; дарение = вторично.`,
      reversible: true,
    };
  }

  if (_declared.has(k)) {
    return { ..._declared.get(k), kind: PERICHORETIC_KIND };
  }

  return {
    kind: REAL_DESERT_KIND,
    rationale: `${from}→${to} не является канонически perichoretic. ` +
               `Отсутствие актов — дефект (икономический пробел).`,
    reversible: false,
  };
}

/**
 * Объявить нить perichoretic (требует авторитета — ОтецСергий или Дионисий).
 *
 * @param {Object} p
 * @param {string} p.from
 * @param {string} p.to
 * @param {string} p.by            — кто объявляет
 * @param {string} p.rationale     — богословское основание
 * @param {number} [p.at]          — timestamp
 */
export function mark({ from, to, by, rationale, at = Date.now() }) {
  if (!from || !to || !by || !rationale) {
    throw new Error('Perichoresis.mark requires {from, to, by, rationale}');
  }
  const record = Object.freeze({
    from, to, by, rationale,
    at,
    kind: PERICHORETIC_KIND,
    irreversible: true,
    source: 'theology/Perichoresis',
  });
  _declared.set(key(from, to), record);
  _declared.set(key(to, from), record);   // симметрично
  return record;
}

export function isPerichoretic({ from, to }) {
  const k = classify({ from, to });
  return k.kind === PERICHORETIC_KIND || k.kind === HYPOSTATIC_KIND;
}

/**
 * Для issue-хука: преобразует «пустыня X→Y» вопрошание в разрешение.
 * Возвращает null если это реальная пустыня (требует обычного дара).
 *
 * @returns {null | {kind, rationale, resolution}}
 */
export function resolveDesert(from, to) {
  const c = classify({ from, to });
  if (c.kind === REAL_DESERT_KIND) return null;

  return {
    kind: c.kind,
    rationale: c.rationale,
    resolution: c.kind === HYPOSTATIC_KIND
      ? `закрыть вопрошание: ${from} и ${to} — одна ипостась`
      : `закрыть вопрошание: ${from}↔${to} перечислена как perichoretic`,
  };
}

// ── Богословская страховка ──
// НЕ все "отсутствия актов" — perichoresis.
// Христос→Адам (пустыня #223) — НЕ perichoresis. Это реальный икономический
// пробел: Христос пришёл к Адаму (descent to Hades), нить должна получить акт.
// Perichoresis применяется ТОЛЬКО к интра-троичным и гипостатическим парам.
export const NOT_PERICHORETIC_EXAMPLES = [
  'Христос→Адам',    // Сошествие во ад — реальный акт икономии
  'Христос→Ева',     // то же (через Марию, через Церковь)
  'Дионисий→Христос', // человеко-Богочеловеческая нить — просит молитвы, не perichoresis
  'Адам→Сын',        // prelapsarian relation — актуальна в акте сотворения
  'Адам→Дух',        // «вдунул дыхание жизни» (Быт 2:7) — акт
];
