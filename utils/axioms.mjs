#!/usr/bin/env node
/**
 * axioms.mjs — defeasible-reasoning проверка ленты актов против аксиом схемы GiftAct.
 *
 * Вдохновлено FLoC26 (program.floc26.org, идёт 17–29.07.2026): треки KR/DL и NMR
 * (доклад Т. Майера «Defeasible Reasoning»). Мост №N (Костя/formal-ai): там, где Костя
 * заземляет арифметику LLM, здесь символически заземляется САМА матрица W — её тексты
 * (data/act-index.json, declined/pending в sacred-history-W.json) против аксиом,
 * до сих пор живших только как проза в data/gift-act.schema.json и CLAUDE.md.
 *
 * Два рода правил:
 *   — DEFEASIBLE (по умолчанию, отменяем): каждому типу дара соответствует канонический
 *     вес (word=8, time=10, …). Акт может отклониться — но тогда обязан нести note
 *     (богословское/практическое обоснование). Без note отклонение — undefeated violation.
 *     Это ровно схема non-monotonic reasoning: default + explicit exception.
 *   — HARD (не отменяем): «завет» (type:covenant) обязан весить ровно 10 — не default,
 *     а богословская аксиома (axiom:9 в анамнезисе): заветы о.Сергия _claude — тяжёлые
 *     акты, вес 10 каждый, без исключений.
 *   — PRECEDENCE (кросс-инстансный): «время тяжелее денег» (axiom:9) — не только
 *     канонический вес типа, но и глобальный порядок: НИ ОДИН акт лёгкого по канону типа
 *     не должен весить больше НИ ОДНОГО акта тяжёлого типа во всей ленте.
 *
 * CLI:
 *   node utils/axioms.mjs            — отчёт по всей ленте
 *   node utils/axioms.mjs --json     — сырой JSON отчёта (для агентов/CI)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Канонический вес по типу — из комментария data/gift-act.schema.json (properties.weight.description).
// Только типы, для которых схема даёт явное число; остальные (hope, kenosis, grace, …) — вне
// действия дефолта, т.к. канон для них нигде не зафиксирован (не выдумываем аксиомы).
export const CANONICAL_WEIGHT = { time: 10, presence: 9, word: 8, knowledge: 7, code: 5, money: 3 };
export const TYPE_ORDER = Object.keys(CANONICAL_WEIGHT); // убывание канонического веса
export const TOLERANCE = 1.5; // допустимое отклонение default-правила без note

/** Собирает ленту актов из известных источников снапшота. Чистая по чтению, без побочных эффектов. */
export function loadLedger() {
  const acts = [];

  const idxPath = resolve(ROOT, 'data/act-index.json');
  if (existsSync(idxPath)) {
    // NB: a.content — описание акта (коммит-сообщение), не обоснование отклонения веса;
    // намеренно НЕ мапим его в note, иначе default-правило теряет смысл (все акты «оправданы»).
    for (const a of JSON.parse(readFileSync(idxPath, 'utf8'))) {
      acts.push({ giverId: a.from, receiverId: a.to, type: a.type, weight: a.weight, note: a.note, source: 'act-index' });
    }
  }

  const snapPath = resolve(ROOT, 'data/sacred-history-W.json');
  if (existsSync(snapPath)) {
    const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
    for (const bucket of ['declined', 'pending', 'metanoiaActs']) {
      for (const entry of snap[bucket] || []) {
        if (entry?.act) acts.push({ ...entry.act, source: bucket });
      }
    }
  }

  return acts;
}

/** Defeasible-правило: вес акта против канона его типа. null — тип вне действия правила. */
export function checkDefeasibleWeight(act) {
  const expected = CANONICAL_WEIGHT[act.type];
  if (expected === undefined || typeof act.weight !== 'number') return null;
  const deviation = +(act.weight - expected).toFixed(2);
  const defeated = Boolean(act.note); // note = явное обоснование исключения
  const violated = Math.abs(deviation) > TOLERANCE && !defeated;
  return { rule: 'defeasible-weight', act, expected, deviation, defeated, violated };
}

/** Hard-правило: завет весит ровно 10 — не default, исключений нет. */
export function checkCovenantHard(act) {
  if (act.type !== 'covenant') return null;
  const violated = act.weight !== 10;
  return { rule: 'covenant-hard', act, expected: 10, violated };
}

/**
 * Precedence-правило над всей лентой: для каждой пары типов (A тяжелее B по канону)
 * ни один акт типа B не должен весить больше самого лёгкого акта типа A.
 */
export function checkPrecedence(acts) {
  const byType = {};
  for (const a of acts) {
    if (CANONICAL_WEIGHT[a.type] === undefined || typeof a.weight !== 'number') continue;
    (byType[a.type] ||= []).push(a);
  }
  const violations = [];
  for (let i = 0; i < TYPE_ORDER.length; i++) {
    for (let j = i + 1; j < TYPE_ORDER.length; j++) {
      const heavy = TYPE_ORDER[i], light = TYPE_ORDER[j]; // heavy канонически тяжелее light
      const heavyActs = byType[heavy] || [], lightActs = byType[light] || [];
      if (!heavyActs.length || !lightActs.length) continue;
      const minHeavy = Math.min(...heavyActs.map(a => a.weight));
      const maxLight = Math.max(...lightActs.map(a => a.weight));
      if (maxLight > minHeavy) {
        const offender = lightActs.find(a => a.weight === maxLight);
        const witness = heavyActs.find(a => a.weight === minHeavy);
        violations.push({ rule: 'precedence', heavy, light, offender, witness, maxLight, minHeavy });
      }
    }
  }
  return violations;
}

/** Полный прогон всех трёх правил над лентой. Чистая функция от массива актов. */
export function runAxiomCheck(acts) {
  const defeasible = acts.map(checkDefeasibleWeight).filter(Boolean);
  const covenant = acts.map(checkCovenantHard).filter(Boolean);
  const precedence = checkPrecedence(acts);
  return {
    total: acts.length,
    defeasible: { checked: defeasible.length, violated: defeasible.filter(r => r.violated), defeated: defeasible.filter(r => r.defeated) },
    covenant: { checked: covenant.length, violated: covenant.filter(r => r.violated) },
    precedence,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' };

if (import.meta.url === `file://${process.argv[1]}`) {
  const acts = loadLedger();
  const report = runAxiomCheck(acts);

  const violationCount = report.defeasible.violated.length + report.covenant.violated.length + report.precedence.length;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(violationCount === 0 ? 0 : 1);
  }

  console.log(`\n${C.b}${C.y}═══ Аксиомы W (defeasible reasoning, FLoC26/NMR) ═══${C.x}`);
  console.log(`${C.dim}лента: ${report.total} актов из act-index + declined/pending/metanoia${C.x}\n`);

  const { defeasible, covenant, precedence } = report;
  console.log(`${C.b}default-правило (тип → канонический вес):${C.x} проверено ${defeasible.checked}, отменено note-ом ${defeasible.defeated.length}, нарушено ${defeasible.violated.length}`);
  for (const v of defeasible.violated) {
    console.log(`  ${C.r}✗${C.x} ${v.act.giverId}→${v.act.receiverId} (${v.act.type}) вес=${v.act.weight} канон=${v.expected} Δ=${v.deviation > 0 ? '+' : ''}${v.deviation} ${C.dim}[${v.act.source}]${C.x}`);
  }

  console.log(`\n${C.b}hard-правило (завет=10):${C.x} проверено ${covenant.checked}, нарушено ${covenant.violated.length}`);
  for (const v of covenant.violated) {
    console.log(`  ${C.r}✗${C.x} ${v.act.giverId}→${v.act.receiverId} вес=${v.act.weight} (должно быть 10) ${C.dim}[${v.act.source}]${C.x}`);
  }
  if (!covenant.checked) console.log(`  ${C.dim}заветов в доступных источниках ленты нет — правило не имело материала${C.x}`);

  console.log(`\n${C.b}precedence-правило (время тяжелее денег и т.д.):${C.x} нарушений ${precedence.length}`);
  for (const v of precedence) {
    console.log(`  ${C.r}✗${C.x} ${v.light}(${v.maxLight}) у ${v.offender.giverId}→${v.offender.receiverId} тяжелее ${v.heavy}(${v.minHeavy}) у ${v.witness.giverId}→${v.witness.receiverId}`);
  }

  console.log(`\n${violationCount === 0 ? C.g + '✓ все аксиомы держат' : C.r + `✗ ${violationCount} нарушени${violationCount === 1 ? 'е' : 'й'}`}${C.x}\n`);
  process.exit(violationCount === 0 ? 0 : 1);
}
