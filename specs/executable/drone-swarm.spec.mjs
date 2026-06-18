/**
 * drone-swarm.spec.mjs — исполняемая спецификация группы "Рой"
 *
 * Вызов: координация 10 дронов без GPS и без центра.
 * Покрыть 50 км² за 30 минут. Каждый дрон автономен.
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/drone-swarm.spec.mjs --n 1000
 * gate:   gift spec-gate specs/executable/drone-swarm.spec.mjs
 */

export const META = {
  id: 'drone-swarm-v1',
  title: 'Рой — 10 дронов без GPS и без центра управления',
  group: 'Группа_3_Архипелаг',
  version: '1.0.0',
  challenge: 'swarm',
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// ── Физика: покрытие территории роем ────────────────────────────────────────
// Дрон с камерой покрывает полосу шириной ~2×высота*tg(35°) при FOV 70°
function coverageStripM(altitude_m) {
  return 2 * altitude_m * Math.tan((35 * Math.PI) / 180);
}

// Скорость съёмки: area = strip_width × speed × time
// При scan_speed_ms и altitude:
function coverageKm2({ n_drones, altitude_m, scan_speed_ms, mission_min, overlap = 0.2 }) {
  const strip_m = coverageStripM(altitude_m) * (1 - overlap);
  const dist_per_drone_m = scan_speed_ms * mission_min * 60;
  return (n_drones * strip_m * dist_per_drone_m) / 1e6; // км²
}

// ── Модель стигмергии (без центра) ──────────────────────────────────────────
// Дроны оставляют "феромоны" (broadcast координаты посещённых секторов).
// Без GPS: используют визуальную одометрию + барометр → ошибка накапливается.
// Collision avoidance: дрон уступает если сосед в 15м по горизонтали и 5м по вертикали.

function stigmergyScore({ n_drones, gps_denied, link_range_m, area_km2 }) {
  // Насколько хорошо рой покрывает без дублирования при потере GPS
  let score = 1.0;
  if (gps_denied) score -= 0.25;              // локализация хуже
  if (link_range_m < 500) score -= 0.2;       // короткая связь — слепые зоны
  if (n_drones > 10) score -= 0.1;            // перегрузка сетки координации
  return Math.max(0, score);
}

// ── Генератор сценария ──────────────────────────────────────────────────────
// Сценарий = ВНЕШНИЕ УСЛОВИЯ (природа, противник)
// Параметры системы (высота, скорость) — в params → их итерирует инженер
export function genScenario(seed) {
  const r = rng(seed);
  const n_drones_total = 8 + Math.floor(r() * 5);  // 8..12 дронов в рое
  return {
    seed,
    n_drones_total,
    area_km2: 35 + r() * 30,                        // 35..65 км² (задаёт заказчик)
    mission_min: 25 + r() * 15,                     // 25..40 мин (задаёт заказчик)
    gps_denied: r() < 0.4,                          // 40% сценариев без GPS
    link_range_m: 200 + r() * 800,                  // 200..1000 м (помехи)
    drone_failures: Math.floor(r() * n_drones_total * 0.2),  // 0..20% отказов
    wind_ms: r() * 12,                              // 0..12 м/с ветер
  };
}

// ── Оценка метрик ────────────────────────────────────────────────────────────
// params = КОНФИГУРАЦИЯ СИСТЕМЫ (что проектирует инженер, итерируется для GREEN)
export function evalScenario(scenario, params = {}) {
  const {
    altitude_m = 100,           // высота съёмки — инженер выбирает (больше = шире полоса)
    scan_speed_ms = 12,         // крейсерская скорость — инженер выбирает
    battery_wh_per_drone = 150, // ёмкость батареи на дрон
    hover_power_w = 200,        // мощность в режиме съёмки
    link_boost = 1.0,           // коэффициент усиления радио (1.0 = штатный)
  } = params;

  const {
    n_drones_total, area_km2, mission_min,
    gps_denied, link_range_m, drone_failures,
  } = scenario;

  // Активных дронов (минус отказавшие)
  const active = Math.max(1, n_drones_total - drone_failures);

  // Покрытие
  const actual_coverage_km2 = coverageKm2({ n_drones: active, altitude_m, scan_speed_ms, mission_min, overlap: 0.25 });
  const coverage_ratio = Math.min(1, actual_coverage_km2 / area_km2);

  // Эффективный link_range с учётом усиления
  const eff_link_range = link_range_m * link_boost;

  // Стигмергия (качество координации без центра)
  const stigmergy = stigmergyScore({ n_drones: active, gps_denied, link_range_m: eff_link_range, area_km2 });

  // Эффективное покрытие с учётом качества координации
  const effective_coverage_km2 = +(actual_coverage_km2 * (0.5 + stigmergy * 0.5)).toFixed(2);

  // Время на батарее
  const endurance_per_drone_min = (battery_wh_per_drone * 0.8) / hover_power_w * 60;

  // Коллизии: при плохой GPS и коротком радио
  const collision_risk = gps_denied && eff_link_range < 400 ? (1 - stigmergy) * 0.3 : 0;

  return {
    coverage_km2: effective_coverage_km2,
    coverage_ratio: +coverage_ratio.toFixed(2),
    stigmergy_score: +stigmergy.toFixed(2),
    endurance_min: +endurance_per_drone_min.toFixed(1),
    collision_risk: +collision_risk.toFixed(3),
    active_drones: active,
  };
}

// ── ИНВАРИАНТЫ ───────────────────────────────────────────────────────────────
export const INVARIANTS = [
  {
    id: 'NO-COLLISION-RISK-HIGH',
    text: 'Риск столкновения не должен превышать 20% даже при GPS-denied',
    check: (sc, m) => m.collision_risk > 0.2
      ? { violation: `collision_risk=${m.collision_risk} > 0.2`, gps_denied: sc.gps_denied, link_m: sc.link_range_m, seed: sc.seed }
      : null,
  },
  {
    id: 'NO-SINGLE-DRONE-MISSION',
    text: 'Миссия роя требует не менее 3 активных дронов',
    check: (sc, m) => m.active_drones < 3
      ? { violation: `только ${m.active_drones} активных дронов`, failures: sc.drone_failures, total: sc.n_drones_total, seed: sc.seed }
      : null,
  },
  {
    id: 'NO-MISSION-WITHOUT-COORDINATION',
    text: 'Стигмергия не должна падать ниже 0.4 — иначе рой хуже одного дрона',
    check: (sc, m) => m.stigmergy_score < 0.4
      ? { violation: `stigmergy=${m.stigmergy_score}`, gps_denied: sc.gps_denied, link_m: sc.link_range_m, seed: sc.seed }
      : null,
  },
];

// ── МЕТРИКИ (ТЗ группы) ──────────────────────────────────────────────────────
// Согласованные пороги после переговоров предприниматель↔инженер (Д3-Д4 витка):
// Исходное требование 50 км² → 35 км² гарантированно при GPS-denied + 20% отказов
export const METRICS = {
  coverage_km2:    { '>=': 35 },          // ≥35 км² гарантированно (пересогласовано с 50)
  coverage_ratio:  { '>=': 0.6 },         // ≥60% зоны покрыто
  stigmergy_score: { '>=': 0.5 },         // координация без центра ≥50%
  endurance_min:   { '>=': 25 },          // 25 мин на дрон
  collision_risk:  { '<=': 0.05 },        // риск столкновения ≤ 5%
};
