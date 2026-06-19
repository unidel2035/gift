/**
 * drone-swarm-deep.spec.mjs — Deep spec группы "Координация роя"
 *
 * Отличие от drone-swarm.spec.mjs:
 *   - evalScenario вызывает swarm_bridge.py (potential-field / numpy)
 *   - При numpy — геометрически точная симуляция расхождения дронов
 *   - Fallback: аналитическая гексагональная сетка
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/drone-swarm-deep.spec.mjs --n 10
 * Deep mode: node utils/spec-runner.mjs ... --seed 7 --n 1
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGES = resolve(dirname(fileURLToPath(import.meta.url)), '../bridges');
const SWARM_BRIDGE = resolve(BRIDGES, 'swarm_bridge.py');

export const META = {
  id: 'drone-swarm-deep-v1',
  title: 'Координация роя (Deep) — numpy potential-field / гексагональная геометрия',
  group: 'Группа_3_Архипелаг',
  version: '1.0.0',
  challenge: 'swarm-coordination',
  tier: 'deep',
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export function genScenario(seed) {
  const r = rng(seed);
  return {
    seed,
    n_drones: Math.floor(r() * 23) + 3,     // 3..25 дронов
    zone_side_m: 100 + r() * 900,            // 100..1000м
    min_sep_m: 10 + r() * 30,               // 10..40м
    sensor_radius_m: 20 + r() * 60,          // 20..80м покрытие сенсора
    v_swarm_ms: 2 + r() * 10,               // 2..12 м/с
    formation_type: r() < 0.5 ? 'hex' : 'grid',
  };
}

function callSwarmBridge(scenario, params) {
  const bridgeParams = {
    n_drones: params.n_drones ?? scenario.n_drones,
    zone_side_m: params.zone_side_m ?? scenario.zone_side_m,
    min_sep_m: params.min_sep_m ?? scenario.min_sep_m,
    sensor_radius_m: params.sensor_radius_m ?? scenario.sensor_radius_m,
    v_swarm_ms: params.v_swarm_ms ?? scenario.v_swarm_ms,
    formation_type: params.formation_type ?? scenario.formation_type,
  };
  try {
    const out = execFileSync('python3', [SWARM_BRIDGE, '--params', JSON.stringify(bridgeParams)],
      { timeout: 60_000, encoding: 'utf8' });
    return JSON.parse(out.trim());
  } catch {
    return analyticalSwarm(bridgeParams);
  }
}

function analyticalSwarm({ n_drones, zone_side_m, min_sep_m = 15, sensor_radius_m = 30, v_swarm_ms = 5 }) {
  // Гексагональная сетка: шаг d ≈ zone * sqrt(2 / (sqrt(3) * N))
  const d = zone_side_m * Math.sqrt(2 / (Math.sqrt(3) * n_drones + 1e-6));
  const actualMinSep = d * 0.866;  // ближайшие соседи в гексагоне
  // Покрытие: приблизительно (N * π * r²) / zone²  capped at 100%
  const coverageRaw = (n_drones * Math.PI * sensor_radius_m ** 2) / zone_side_m ** 2 * 100;
  const coverage = Math.min(100, coverageRaw * 0.7);  // 0.7 = overlap factor
  const convergence = (zone_side_m * 0.4 * Math.sqrt(n_drones) / n_drones) / v_swarm_ms + Math.log2(n_drones + 1) * 2;
  return {
    min_sep_m: +actualMinSep.toFixed(2),
    coverage_pct: +coverage.toFixed(1),
    convergence_s: +convergence.toFixed(1),
    n_drones,
    zone_side_m,
    collision_free: actualMinSep >= min_sep_m,
    method: 'analytical-js-hex',
  };
}

export function evalScenario(scenario, params = {}) {
  const res = callSwarmBridge(scenario, params);
  return {
    min_sep_m: res.min_sep_m,
    coverage_pct: res.coverage_pct,
    convergence_s: res.convergence_s,
    collision_free: res.collision_free,
    swarm_method: res.method,
    scenario,
  };
}

export const INVARIANTS = {
  'COLLISION-FREE': {
    check: (r) => r.collision_free !== false,
    desc: 'Фактическое расстояние между дронами ≥ min_sep_m',
  },
  'COVERAGE-MINIMUM': {
    check: (r) => r.coverage_pct >= 60,
    desc: 'Покрытие зоны наблюдения не менее 60%',
  },
  'CONVERGENCE-BOUNDED': {
    check: (r) => r.convergence_s <= 300,
    desc: 'Время схождения роя ≤ 5 минут',
  },
};

export const METRICS = {
  min_sep_m: { threshold: 15, dir: 'gt', label: 'Мин. расстояние (м)' },
  coverage_pct: { threshold: 70, dir: 'gt', label: 'Покрытие зоны (%)' },
  convergence_s: { threshold: 120, dir: 'lt', label: 'Время схождения (с)' },
};
