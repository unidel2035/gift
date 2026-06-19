#!/usr/bin/env node
/**
 * spec-runner.mjs — универсальный харнес исполняемых спецификаций.
 *
 * Работает с любым .spec.mjs файлом, который экспортирует:
 *   META        — {id, title, group?, version?}
 *   INVARIANTS  — [{id, text, check(scenario, metrics) → violation|null}]
 *   METRICS     — {key: {">=": val, "<=": val, ...}}  (опционально)
 *   genScenario(seed) → scenario                       (обязательно)
 *   evalScenario(scenario, params) → metrics           (опционально)
 *
 * API:
 *   runSpec(specPath, opts) → { passed, violations, metrics, N, meta, durationMs }
 *   runRepairLoop(specPath, candidates, opts) → { winner, report }
 *
 * CLI:
 *   node utils/spec-runner.mjs <spec.mjs> [--n 1000] [--json] [--seed 1]
 */

import { createRequire } from 'node:module';
import { resolve, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

// ── Операторы сравнения метрик ──────────────────────────────────────────────
const OPS = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>':  (a, b) => a > b,
  '<':  (a, b) => a < b,
  '==': (a, b) => a == b,
};

/**
 * Прогнать спеку на N сценариях.
 * @param {string} specPath — абсолютный путь к .spec.mjs
 * @param {object} opts
 *   N:number       число сценариев (default 1000)
 *   seed0:number   начальный seed (default 1)
 *   params:object  дополнительные параметры для evalScenario
 *   maxExamples:number максимум контрпримеров в выводе (default 5)
 */
export async function runSpec(specPath, { N = 1000, seed0 = 1, params = {}, maxExamples = 5 } = {}) {
  if (process.env.SPEC_PARAMS) { try { params = { ...JSON.parse(process.env.SPEC_PARAMS), ...params }; } catch {} }
  const absPath = isAbsolute(specPath) ? specPath : resolve(process.cwd(), specPath);
  const spec = await import(absPath + `?ts=${Date.now()}`).catch(async () => import(absPath));

  const meta = spec.META ?? { id: absPath, title: absPath };
  const invariants = spec.INVARIANTS ?? [];
  const metricThresholds = spec.METRICS ?? {};
  const genScenario = spec.genScenario;
  const evalScenario = spec.evalScenario ?? null;

  if (!genScenario) throw new Error(`spec must export genScenario(seed)`);

  const violations = [];
  const metricAgg = {};  // накапливаем для среднего
  const t0 = performance.now();

  for (let i = 0; i < N; i++) {
    const scenario = genScenario(seed0 + i);
    const metrics = evalScenario ? (await Promise.resolve(evalScenario(scenario, params))) : {};

    // накопить метрики для сводки
    for (const [k, v] of Object.entries(metrics)) {
      if (typeof v === 'number') {
        metricAgg[k] = metricAgg[k] ?? { sum: 0, min: Infinity, max: -Infinity, n: 0 };
        metricAgg[k].sum += v; metricAgg[k].n++;
        if (v < metricAgg[k].min) metricAgg[k].min = v;
        if (v > metricAgg[k].max) metricAgg[k].max = v;
      }
    }

    // инварианты
    for (const inv of invariants) {
      const bad = inv.check(scenario, metrics);
      if (bad) {
        violations.push({ type: 'invariant', invariant: inv.id, text: inv.text,
          seed: scenario.seed ?? (seed0 + i), counterexample: bad });
      }
    }

    // метрические пороги
    for (const [key, cond] of Object.entries(metricThresholds)) {
      const val = metrics[key];
      if (val === undefined) continue;
      for (const [op, thr] of Object.entries(cond)) {
        if (!OPS[op]?.(val, thr)) {
          violations.push({ type: 'metric', metric: key, value: val,
            need: `${op} ${thr}`, seed: scenario.seed ?? (seed0 + i) });
        }
      }
    }
  }

  const durationMs = Math.round(performance.now() - t0);
  const passed = violations.length === 0;

  // статистика метрик
  const metricStats = {};
  for (const [k, a] of Object.entries(metricAgg)) {
    metricStats[k] = { avg: +(a.sum / a.n).toFixed(3), min: +a.min.toFixed(3), max: +a.max.toFixed(3) };
  }

  // группировка нарушений по инварианту/метрике
  const byKind = {};
  for (const v of violations) {
    const k = v.invariant ?? v.metric;
    byKind[k] = (byKind[k] || 0) + 1;
  }

  return {
    passed,
    meta,
    N,
    durationMs,
    violations: violations.slice(0, maxExamples),
    violationsTotal: violations.length,
    byKind,
    metricStats,
  };
}

/**
 * Петля ремонта: прогоняет кандидатов (варианты params/политики) пока не GREEN.
 * Используется агентом: он читает контрпример, правит params, снова прогоняет.
 * @param {string} specPath
 * @param {Array<{label:string, params:object}>} candidates
 * @param {object} opts
 */
export async function runRepairLoop(specPath, candidates, opts = {}) {
  for (const c of candidates) {
    const r = await runSpec(specPath, { ...opts, params: c.params });
    if (r.passed) return { winner: c.label, params: c.params, report: r };
  }
  const last = candidates[candidates.length - 1];
  return { winner: null, params: last?.params, report: await runSpec(specPath, { ...opts, params: last?.params }) };
}

/** Форматировать результат в читаемый вид */
export function formatReport(r) {
  const icon = r.passed ? '✅ GREEN' : '⛔ RED';
  const lines = [`${icon}  ${r.meta.title ?? r.meta.id}  [N=${r.N} за ${r.durationMs}мс]`];
  if (r.passed) {
    lines.push(`   Все инварианты и метрики прошли.`);
  } else {
    lines.push(`   Нарушений: ${r.violationsTotal} (показаны ${r.violations.length})`);
    for (const [k, n] of Object.entries(r.byKind)) lines.push(`   • ${k}: ${n}×`);
    for (const v of r.violations) {
      if (v.type === 'invariant') {
        lines.push(`   ↳ [${v.invariant}] seed=${v.seed} → ${JSON.stringify(v.counterexample).slice(0, 120)}`);
      } else {
        lines.push(`   ↳ [${v.metric}] = ${v.value} (нужно ${v.need}), seed=${v.seed}`);
      }
    }
  }
  if (Object.keys(r.metricStats).length) {
    lines.push('   Метрики (avg / min / max):');
    for (const [k, s] of Object.entries(r.metricStats)) {
      const thr = ''; // TODO: показывать порог рядом
      lines.push(`   • ${k}: avg=${s.avg}  min=${s.min}  max=${s.max}`);
    }
  }
  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('spec-runner.mjs')) {
  const args = process.argv.slice(2);
  const specFile = args.find(a => !a.startsWith('--'));
  if (!specFile) {
    console.error('Использование: node utils/spec-runner.mjs <spec.mjs> [--n 1000] [--json] [--seed 1]');
    process.exit(2);
  }
  const nIdx = args.indexOf('--n');
  const N = nIdx >= 0 ? +(args[nIdx + 1] ?? 1000) : 1000;
  const seedIdx = args.indexOf('--seed');
  const seed0 = seedIdx >= 0 ? +(args[seedIdx + 1] ?? 1) : 1;
  const asJson = args.includes('--json');

  const absSpec = isAbsolute(specFile) ? specFile : resolve(process.cwd(), specFile);
  runSpec(absSpec, { N, seed0 }).then(r => {
    if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else { console.log(formatReport(r)); }
    process.exit(r.passed ? 0 : 1);
  }).catch(e => { console.error('spec-runner error:', e.message); process.exit(2); });
}
