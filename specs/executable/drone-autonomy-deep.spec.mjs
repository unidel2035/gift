/**
 * drone-autonomy-deep.spec.mjs — Deep spec группы "Автономность роя"
 *
 * Отличие от drone-autonomy-real.spec.mjs:
 *   - evalScenario вызывает sitl_bridge.py (кинематическая SITL-модель)
 *   - При ArduPilot SITL установлен — настоящая симуляция автопилота
 *   - При pymavlink — улучшенная аналитика с MAVLink PID-константами
 *   - Fallback: аналитическая кинематика ветер+PID
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/drone-autonomy-deep.spec.mjs --n 20
 * Deep mode: node utils/spec-runner.mjs ... --seed 42 --n 1
 *
 * Медленнее fast-spec (~200мс/сценарий без SITL, ~10с с SITL).
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGES = resolve(dirname(fileURLToPath(import.meta.url)), '../bridges');
const SITL_BRIDGE = resolve(BRIDGES, 'sitl_bridge.py');

export const META = {
  id: 'drone-autonomy-deep-v1',
  title: 'Автономность роя (Deep) — ArduPilot SITL / кинематика',
  group: 'Группа_1_Архипелаг',
  version: '1.0.0',
  challenge: 'autonomous-swarm',
  tier: 'deep',
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// Тот же сценарий что и в fast-spec (детерминированный по seed)
export function genScenario(seed) {
  const r = rng(seed);
  return {
    seed,
    wind_ms: r() * 14,            // 0..14 м/с
    n_waypoints: Math.floor(r() * 9) + 2,  // 2..10
    total_distance_m: 200 + r() * 1800,    // 200..2000м
    nav_gain: 0.5 + r() * 1.5,            // 0.5..2.0
    sensor_noise_m: r() * 2.0,            // 0..2м
    mtow_kg: 1.5 + r() * 8.5,            // 1.5..10кг
    battery_wh: 100 + r() * 300,          // 100..400 Вт·ч
    n_obstacles: Math.floor(r() * 8),     // 0..7 препятствий
  };
}

// Вызов SITL-моста (Python)
function callSitlBridge(scenario, params) {
  const bridgeParams = {
    wind_ms: scenario.wind_ms,
    n_waypoints: scenario.n_waypoints,
    total_distance_m: scenario.total_distance_m,
    nav_gain: params.nav_gain ?? scenario.nav_gain,
    sensor_noise_m: params.sensor_noise_m ?? scenario.sensor_noise_m,
    mtow_kg: params.mtow_kg ?? scenario.mtow_kg,
    battery_wh: params.battery_wh ?? scenario.battery_wh,
    n_obstacles: scenario.n_obstacles,
  };
  try {
    const out = execFileSync('python3', [SITL_BRIDGE, '--params', JSON.stringify(bridgeParams)],
      { timeout: 30_000, encoding: 'utf8' });
    return JSON.parse(out.trim());
  } catch {
    // Fallback: аналитика JS
    return analyticalAutonomy(bridgeParams);
  }
}

// JS-аналитика (fallback если Python недоступен)
function analyticalAutonomy({ wind_ms, n_waypoints, total_distance_m, nav_gain = 1, sensor_noise_m = 0.5, mtow_kg = 3, battery_wh = 200, n_obstacles = 2 }) {
  const v = 10;
  const L = total_distance_m / Math.max(n_waypoints, 1);
  const crossTrack = (wind_ms / (nav_gain * v + 0.01)) * 0.3 * L;
  const navError = Math.min(Math.sqrt(crossTrack ** 2 + (sensor_noise_m * 1.5) ** 2), 50);
  const flightTime = total_distance_m / v;
  const pWind = 0.5 * 1.225 * 0.05 * wind_ms ** 2 * 0.8 / 0.7;
  const energyUsed = (150 * (1 + 0.1 * mtow_kg / 3) + pWind) * flightTime / 3600;
  const battPct = Math.max(0, (1 - energyUsed / battery_wh) * 100);
  const missionCompletion = navError > 20 || battPct < 20
    ? Math.max(0.3, 1 - navError / 50 - Math.max(0, 20 - battPct) / 100)
    : Math.min(1, 0.95 + nav_gain * 0.05);
  return {
    nav_accuracy_m: +navError.toFixed(2),
    mission_completion: +missionCompletion.toFixed(3),
    battery_pct_remaining: +battPct.toFixed(1),
    collision_avoidance_ok: n_obstacles <= 5,
    flight_time_s: +(total_distance_m / v).toFixed(1),
    method: 'analytical-js-kinematic',
  };
}

export function evalScenario(scenario, params = {}) {
  const res = callSitlBridge(scenario, params);
  return {
    nav_accuracy_m: res.nav_accuracy_m,
    mission_completion: res.mission_completion,
    battery_pct_remaining: res.battery_pct_remaining,
    collision_avoidance_ok: res.collision_avoidance_ok,
    flight_time_s: res.flight_time_s,
    sitl_method: res.method,
    scenario,
  };
}

export const INVARIANTS = {
  'COLLISION-AVOIDANCE': {
    check: (r) => r.collision_avoidance_ok !== false,
    desc: 'Уклонение от препятствий обязательно при ≤5 препятствий на маршруте',
  },
  'BATTERY-RESERVE': {
    check: (r) => r.battery_pct_remaining >= 15,
    desc: 'Батарея при посадке: не менее 15%',
  },
  'MISSION-COMPLETABLE': {
    check: (r) => r.mission_completion >= 0.7,
    desc: 'Успешность миссии ≥ 70% для сертификации автономности',
  },
};

export const METRICS = {
  nav_accuracy_m: { threshold: 20, dir: 'lt', label: 'Точность навигации (м)' },
  mission_completion: { threshold: 0.8, dir: 'gt', label: 'Выполнение миссии (доля)' },
  battery_pct_remaining: { threshold: 20, dir: 'gt', label: 'Остаток батареи (%)' },
  flight_time_s: { threshold: 600, dir: 'lt', label: 'Время полёта (с)' },
};
