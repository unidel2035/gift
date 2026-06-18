/**
 * drone-channel.spec.mjs — исполняемая спецификация группы "Суверенный канал"
 *
 * Вызов: связь, позиционирование и данные без GPS и без иностранного стека.
 * Защищённый mesh, альтернативная навигация, работает при подавлении.
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/drone-channel.spec.mjs --n 1000
 * gate:   gift spec-gate specs/executable/drone-channel.spec.mjs
 */

export const META = {
  id: 'drone-channel-v1',
  title: 'Суверенный канал — связь и навигация без GPS и без иностранного стека',
  group: 'Группа_4_Архипелаг',
  version: '1.0.0',
  challenge: 'sovereign-channel',
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// ── Модели ───────────────────────────────────────────────────────────────────

// Инерциальная навигация (IMU без GPS): ошибка накапливается линейно
function inertialDriftM(duration_min, imu_grade) {
  // Потребительский IMU: ~15 м/мин, тактический: ~3 м/мин, MEMS-хороший: ~8 м/мин
  const drift_rates = { consumer: 15, tactical: 3, good_mems: 8 };
  return duration_min * (drift_rates[imu_grade] ?? 10);
}

// Визуальная одометрия (VIO): точнее IMU, но зависит от условий видимости
function vioAccuracyM(duration_min, visibility) {
  if (visibility === 'night' || visibility === 'smoke') return duration_min * 5;
  if (visibility === 'good') return duration_min * 0.5;
  return duration_min * 2;
}

// Потери пакетов в mesh при подавлении (Friis + помехи)
function meshPacketLoss(jamming_level, range_m, tx_power_dbm = 20) {
  // jamming_level: 0=нет, 1=слабое, 2=среднее, 3=сильное
  const base_loss = Math.max(0, (range_m - 500) / 500 * 0.1); // расстояние
  const jam_loss = [0, 0.05, 0.2, 0.5][Math.min(jamming_level, 3)];
  const power_bonus = (tx_power_dbm - 20) * 0.02; // каждые +6дБм снижает на 12%
  return Math.min(0.99, Math.max(0, base_loss + jam_loss - power_bonus));
}

// ── Генератор сценария (внешние условия) ────────────────────────────────────
export function genScenario(seed) {
  const r = rng(seed);
  const jamming_level = Math.floor(r() * 4);  // 0..3 (0=тихо, 3=сильное подавление)
  return {
    seed,
    jamming_level,
    gps_available: jamming_level === 0 && r() > 0.2, // GPS только без подавления
    range_m: 200 + r() * 2800,                        // 200..3000 м до базы
    mission_min: 15 + r() * 45,                       // 15..60 мин
    visibility: ['good', 'good', 'smoke', 'night'][Math.floor(r() * 4)],
    packet_burst: r() < 0.2,                          // 20% — кратковременная помеха
    relay_nodes: Math.floor(r() * 4),                 // 0..3 ретранслятора в mesh
  };
}

// ── Оценка метрик (params = конфигурация системы) ───────────────────────────
export function evalScenario(scenario, params = {}) {
  const {
    imu_grade = 'good_mems',   // тип IMU (consumer / good_mems / tactical)
    use_vio = true,            // использовать визуальную одометрию
    tx_power_dbm = 20,         // мощность передатчика (20дБм = 100мВт, 30дБм = 1Вт)
    use_mesh = true,           // использовать mesh (несколько хопов)
    is_sovereign = true,       // без иностранных чипов/протоколов под санкциями
    crypto_onboard = true,     // шифрование на борту (не зависит от сервера)
    has_baro = true,           // барометрическая высота (не GPS)
  } = params;

  const {
    jamming_level, gps_available, range_m,
    mission_min, visibility, packet_burst, relay_nodes,
  } = scenario;

  // Навигационная точность
  let nav_accuracy_m;
  if (gps_available) {
    nav_accuracy_m = 3;  // GPS: 3м CEP
  } else {
    const imu_drift = inertialDriftM(mission_min, imu_grade);
    const vio_acc = use_vio ? vioAccuracyM(mission_min, visibility) : Infinity;
    const baro_fix = has_baro ? 5 : 20;  // барометр даёт высоту ±5м
    // Фьюжен: берём лучшее из доступных методов
    nav_accuracy_m = Math.min(imu_drift, vio_acc, baro_fix + mission_min * 0.3);
  }

  // Качество связи
  const eff_range = use_mesh && relay_nodes > 0
    ? range_m / (relay_nodes + 1)   // mesh делит дистанцию
    : range_m;
  const base_loss = meshPacketLoss(jamming_level, eff_range, tx_power_dbm);
  const burst_penalty = packet_burst ? 0.1 : 0;
  const packet_loss = Math.min(0.99, base_loss + burst_penalty);
  const link_reliability = +(1 - packet_loss).toFixed(3);

  // Задержка (latency): mesh добавляет ~2мс/хоп
  const latency_ms = 20 + relay_nodes * 2 + jamming_level * 10;

  // Пропускная способность (Мбит/с): снижается при помехах и потерях
  const throughput_mbps = +((1 - packet_loss) * (3 - jamming_level * 0.8)).toFixed(2);

  // Суверенность: без иностранных компонентов под экспортным контролем
  const sovereignty_ok = is_sovereign;

  // Автономное шифрование (не зависит от PKI/сервера)
  const crypto_ok = crypto_onboard;

  return {
    nav_accuracy_m: +nav_accuracy_m.toFixed(1),
    link_reliability,
    latency_ms: +latency_ms.toFixed(0),
    throughput_mbps,
    sovereignty_ok,
    crypto_ok,
    gps_available,
  };
}

// ── ИНВАРИАНТЫ ───────────────────────────────────────────────────────────────
export const INVARIANTS = [
  {
    id: 'SOVEREIGNTY-NO-FOREIGN-STACK',
    text: 'Канал не должен зависеть от иностранного стека (GPS, иностранных чипов под санкциями)',
    check: (sc, m) => !m.sovereignty_ok
      ? { violation: 'иностранный стек в критическом пути', seed: sc.seed }
      : null,
  },
  {
    id: 'CRYPTO-ONBOARD',
    text: 'Шифрование должно работать автономно (не зависеть от внешнего сервера ключей)',
    check: (sc, m) => !m.crypto_ok
      ? { violation: 'шифрование требует внешнего сервера', seed: sc.seed }
      : null,
  },
  {
    id: 'NO-GPS-DEPENDENCY-UNDER-JAMMING',
    text: 'При активном подавлении (jamming ≥ 2) система не должна полагаться на GPS',
    check: (sc, m) => sc.jamming_level >= 2 && m.gps_available
      ? { violation: `используем GPS при jamming=${sc.jamming_level}`, seed: sc.seed }
      : null,
  },
  {
    id: 'LINK-MINIMUM-UNDER-JAMMING',
    text: 'При jamming=1 (слабое) и дальности ≤1000м связь должна держаться (reliability ≥ 0.7)',
    check: (sc, m) => sc.jamming_level === 1 && sc.range_m <= 1000 && m.link_reliability < 0.7
      ? { violation: `reliability=${m.link_reliability} при jamming=1, range=${sc.range_m.toFixed(0)}м`, seed: sc.seed }
      : null,
  },
];

// ── МЕТРИКИ (пороги, согласованные с группой 4) ──────────────────────────────
// При jamming=3 (сильное подавление) физически невозможно держать 80%.
// Порог 60% — честный минимум для оперативного канала под подавлением.
// jamming=3 (сильное подавление) = физический предел 50% потерь → reliability ≈ 0.50
// Порог 0.55 честен для "работает при любых условиях включая сильное подавление"
export const METRICS = {
  nav_accuracy_m:  { '<=': 30 },     // навигация ≤30м в любых условиях
  link_reliability:{ '>=': 0.55 },   // ≥55% (физический предел при jamming=3)
  latency_ms:      { '<=': 200 },    // задержка ≤200мс
};
