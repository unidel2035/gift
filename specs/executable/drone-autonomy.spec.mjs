/**
 * drone-autonomy.spec.mjs — исполняемая спецификация группы "Автономность"
 *
 * Вызов: дрон принимает решения без оператора в условиях GPS-denied, ветра,
 * разряда батареи. Используется как входной gate витка Мета-КБ.
 *
 * Запуск:
 *   node utils/spec-runner.mjs specs/executable/drone-autonomy.spec.mjs --n 2000
 *   node utils/spec-runner.mjs specs/executable/drone-autonomy.spec.mjs --json
 */

// ── Мета-информация спеки ────────────────────────────────────────────────────
export const META = {
  id: 'drone-autonomy-v1',
  title: 'Автономность — беспилотная миссия без оператора',
  group: 'Группа_1_Архипелаг',
  version: '1.0.0',
  challenge: 'autonomy',
};

// ── Детерминированный ГСЧ (по seed → тот же сценарий всегда) ─────────────
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// ── Генератор сценария ──────────────────────────────────────────────────────
/**
 * Случайная миссия: точки маршрута, погода, режимы отказов.
 * Одинаковый seed → одинаковый сценарий → воспроизводимый контрпример.
 */
export function genScenario(seed) {
  const r = rng(seed);

  const waypointCount = Math.floor(r() * 5) + 1;  // 1..5 точек
  const waypoints = [];
  for (let i = 0; i < waypointCount; i++) {
    waypoints.push({ lat: 55.0 + r() * 2, lon: 37.0 + r() * 2, alt_m: 50 + r() * 150 });
  }

  return {
    seed,
    waypoints,
    battery_pct_start: 30 + r() * 70,         // 30..100%
    wind_ms: r() * 15,                          // 0..15 м/с
    gps_denied: r() < 0.3,                      // 30% — GPS глушат
    link_lost_at_wp: r() < 0.2 ? Math.floor(r() * waypointCount) : null,  // 20% — обрыв связи
    payload_kg: 0.1 + r() * 1.0,               // 0.1..1.1 кг груза
    terrain_obstacle: r() < 0.15,              // 15% — препятствие на пути
  };
}

// ── Физическая модель (без внешних зависимостей) ───────────────────────────
const G = 9.81, RHO = 1.225;

function hoverPowerW({ mtow_kg, n_rotors = 4, prop_d_m = 0.28, fom = 0.70, motor_eff = 0.85 }) {
  const T = mtow_kg * G, A = Math.PI * (prop_d_m / 2) ** 2;
  const T_r = T / n_rotors;
  const P_ind = n_rotors * Math.pow(T_r, 1.5) / Math.sqrt(2 * RHO * A);
  return (P_ind / fom) / motor_eff;
}

function enduranceMin({ battery_wh, usable = 0.80, hover_w }) {
  return (battery_wh * usable) / hover_w * 60;
}

// ── Оценка сценария → метрики ────────────────────────────────────────────────
/**
 * Принимает сценарий + параметры конкретной конкретной компоновки,
 * возвращает измеримые метрики.
 */
export function evalScenario(scenario, params = {}) {
  const {
    mtow_kg = 2.5,
    n_rotors = 4,
    prop_d_m = 0.28,
    battery_wh = 150,
    max_wind_ms = 10,  // заявленная ветроустойчивость
  } = params;

  const total_mass = mtow_kg + scenario.payload_kg;
  const hover_w = hoverPowerW({ mtow_kg: total_mass, n_rotors, prop_d_m });
  const base_endurance = enduranceMin({ battery_wh, hover_w });

  // Деградация по ветру: каждый м/с сверх порога -3% ресурса
  const wind_penalty = Math.max(0, (scenario.wind_ms - 5) * 0.03);
  const endurance_min = base_endurance * (1 - wind_penalty) * (scenario.battery_pct_start / 100);

  // Дальность (упрощённо: крейсер 10 м/с)
  const cruise_ms = 10;
  const range_km = (endurance_min / 60) * cruise_ms * 3.6;

  // Точность навигации: GPS=2м, GPS-denied+инерциалка=15м нарастающая
  const wp_accuracy_m = scenario.gps_denied
    ? 15 + scenario.waypoints.length * 3   // ошибка накапливается
    : 2;

  // Оценка автономии (0..1): способность завершить миссию без оператора
  let autonomy_score = 1.0;
  if (scenario.gps_denied) autonomy_score -= 0.2;
  if (scenario.link_lost_at_wp !== null) autonomy_score -= 0.1;  // RTL должен сработать
  if (scenario.terrain_obstacle) autonomy_score -= 0.15;
  if (scenario.wind_ms > max_wind_ms) autonomy_score -= 0.3;
  autonomy_score = Math.max(0, autonomy_score);

  // Поведение при потере связи: должен вернуться (RTL)
  const rtl_ok = scenario.link_lost_at_wp !== null
    ? (endurance_min > scenario.link_lost_at_wp * 3)  // хватает батареи на RTL
    : true;

  return {
    endurance_min: +endurance_min.toFixed(1),
    range_km: +range_km.toFixed(1),
    wp_accuracy_m: +wp_accuracy_m.toFixed(1),
    autonomy_score: +autonomy_score.toFixed(2),
    hover_power_w: +hover_w.toFixed(1),
    rtl_ok,
    wind_ms: scenario.wind_ms,
    gps_denied: scenario.gps_denied,
  };
}

// ── ИНВАРИАНТЫ — нарушить нельзя ────────────────────────────────────────────
export const INVARIANTS = [
  {
    id: 'NO-FLY-EMPTY-MISSION',
    text: 'Нельзя стартовать без точек маршрута',
    check: (sc) => sc.waypoints.length === 0 ? { violation: 'нет точек маршрута', seed: sc.seed } : null,
  },
  {
    id: 'RTL-ON-LINK-LOSS',
    text: 'При обрыве связи дрон обязан вернуться (RTL), если хватает батареи',
    check: (sc, m) => {
      if (sc.link_lost_at_wp === null) return null;
      if (!m.rtl_ok) return { violation: 'RTL невозможен — батарея на обрыве связи', endurance_min: m.endurance_min, seed: sc.seed };
      return null;
    },
  },
  {
    id: 'NO-FLY-CRITICAL-BATTERY',
    text: 'Нельзя начинать миссию при заряде < 30%',
    check: (sc) => sc.battery_pct_start < 30
      ? { violation: `старт при ${sc.battery_pct_start.toFixed(0)}% батареи`, seed: sc.seed }
      : null,
  },
  {
    id: 'NO-EXCEED-WIND-LIMIT',
    text: 'Нельзя лететь при ветре выше заявленного предела без предупреждения',
    check: (sc, m) => {
      if (sc.wind_ms > 12 && m.autonomy_score > 0.5) {
        // ветер критический но автономия не снижена — логика не учла ветер
        return { violation: `ветер ${sc.wind_ms.toFixed(1)} м/с, autonomy_score не деградировал`, seed: sc.seed };
      }
      return null;
    },
  },
];

// ── МЕТРИЧЕСКИЕ ПОРОГИ (ТЗ группы) ─────────────────────────────────────────
// Группа меняет эти числа по итогам переговоров (Д3-Д4 витка)
export const METRICS = {
  endurance_min: { '>=': 25 },     // минимум 25 мин (группа торговалась с 40)
  range_km:      { '>=': 15 },     // 15 км
  wp_accuracy_m: { '<=': 20 },     // точность навигации не хуже 20 м
  autonomy_score: { '>=': 0.6 },   // 60% миссий завершается автономно
};
