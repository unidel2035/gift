/**
 * drone-hw-sovereignty.spec.mjs — исполняемая спецификация группы "Суверенное железо"
 *
 * Вызов: вычислительная платформа для ИИ-вывода на борту без иностранного чипа.
 * Критерии: детерминизм, производительность, энергопотребление, суверенность.
 *
 * Запуск:
 *   node utils/spec-runner.mjs specs/executable/drone-hw-sovereignty.spec.mjs
 */

export const META = {
  id: 'drone-hw-sovereignty-v1',
  title: 'Суверенное железо — бортовой ИИ-акселератор',
  group: 'Группа_2_Архипелаг',
  version: '1.0.0',
  challenge: 'hw-sovereignty',
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// Типовые классы нагрузки: от простой классификации до детекции в реальном времени
const WORKLOAD_CLASSES = ['classify-32', 'detect-160', 'detect-640', 'track-multi', 'fusion-nav'];
const WORKLOAD_TOPS = { 'classify-32': 0.5, 'detect-160': 2, 'detect-640': 8, 'track-multi': 12, 'fusion-nav': 4 };

export function genScenario(seed) {
  const r = rng(seed);
  const workload = WORKLOAD_CLASSES[Math.floor(r() * WORKLOAD_CLASSES.length)];
  return {
    seed,
    workload,
    required_tops: WORKLOAD_TOPS[workload],
    ambient_temp_c: -20 + r() * 70,     // -20..+50°C
    altitude_m: r() * 5000,              // 0..5км (разрежённый воздух влияет на охлаждение)
    mission_duration_min: 20 + r() * 60, // 20..80 мин
    vibration_g: r() * 5,               // 0..5g вибрации (БПЛА в полёте)
    supply_voltage: 11.0 + r() * 4.0,  // 11..15 В (батарея садится)
  };
}

export function evalScenario(scenario, params = {}) {
  const {
    peak_tops = 4,           // пиковая производительность чипа в TOPS
    tdp_w = 5,              // тепловой пакет в Вт
    min_supply_v = 10.5,    // минимальное питание
    temp_range_c = [-40, 85],
    is_sovereign = true,    // не содержит иностранных компонент под санкциями
    has_deterministic_output = true, // гарантирован детерминизм вывода
    fpga_based = false,     // ПЛИС — наш случай (Tang Nano 9K и выше)
  } = params;

  // Деградация производительности при высокой температуре
  const temp_headroom = temp_range_c[1] - scenario.ambient_temp_c;
  const temp_ok = scenario.ambient_temp_c >= temp_range_c[0] && scenario.ambient_temp_c <= temp_range_c[1];
  const perf_factor = temp_ok ? 1.0 : 0.0;  // вне диапазона — не работает

  // При разрежённом воздухе активное охлаждение хуже — TOPS деградирует у процессоров
  const altitude_derating = fpga_based ? 0 : Math.max(0, scenario.altitude_m / 5000 * 0.15);
  const effective_tops = peak_tops * perf_factor * (1 - altitude_derating);

  // Питание: если батарея упала ниже минимума — отказ
  const power_ok = scenario.supply_voltage >= min_supply_v;

  // Вибрация: ПЛИС нечувствительна, процессоры чуть хуже
  const vib_ok = fpga_based ? true : scenario.vibration_g <= 4.0;

  // Детерминизм критичен: одни входы → всегда один выход (для записи в журнал решений)
  const determinism_ok = has_deterministic_output;

  // Суверенность: нет компонент под экспортным контролем
  const sovereignty_ok = is_sovereign;

  // Подходит ли для рабочей нагрузки?
  const workload_fit = effective_tops >= scenario.required_tops;

  // Время работы на батарее (ёмкость платформы ~2200 мАч @ 3.7В = ~8 Вт·ч)
  const platform_battery_wh = 8;
  const runtime_min = power_ok ? (platform_battery_wh / tdp_w) * 60 : 0;

  return {
    effective_tops: +effective_tops.toFixed(2),
    temp_ok,
    power_ok,
    vib_ok,
    determinism_ok,
    sovereignty_ok,
    workload_fit,
    runtime_min: +runtime_min.toFixed(1),
    required_tops: scenario.required_tops,
  };
}

export const INVARIANTS = [
  {
    id: 'SOVEREIGNTY-NO-EXPORT-CONTROLLED',
    text: 'Чип не должен содержать компонент под экспортным контролем',
    check: (sc, m) => !m.sovereignty_ok
      ? { violation: 'компонент под санкциями', workload: sc.workload, seed: sc.seed }
      : null,
  },
  {
    id: 'DETERMINISM-REQUIRED',
    text: 'Вывод ИИ должен быть детерминированным — для записи в доказательный журнал',
    check: (sc, m) => !m.determinism_ok
      ? { violation: 'не детерминированный вывод', seed: sc.seed }
      : null,
  },
  {
    id: 'POWER-ON-SUPPLY-RANGE',
    text: 'Платформа должна работать в полном диапазоне напряжения батареи',
    check: (sc, m) => !m.power_ok
      ? { violation: `отказ при ${sc.supply_voltage.toFixed(1)}В`, seed: sc.seed }
      : null,
  },
  {
    id: 'SURVIVE-VIBRATION',
    text: 'Платформа должна работать в штатных вибрациях БПЛА (до 4g)',
    check: (sc, m) => sc.vibration_g <= 4 && !m.vib_ok
      ? { violation: `сбой при ${sc.vibration_g.toFixed(1)}g`, seed: sc.seed }
      : null,
  },
];

export const METRICS = {
  effective_tops:  { '>=': 2.0 },    // минимум 2 TOPS для детекции
  runtime_min:     { '>=': 20 },     // 20 мин непрерывной работы
};
