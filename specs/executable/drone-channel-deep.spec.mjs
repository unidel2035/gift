/**
 * drone-channel-deep.spec.mjs — Deep spec группы "Суверенный канал"
 *
 * Отличие от drone-channel.spec.mjs:
 *   - evalScenario вызывает gnuradio_bridge.py (BER-симуляция)
 *   - вместо аналитической модели Friis — реальные расчёты Friis+BER+QAM
 *   - при GNU Radio installed — настоящая симуляция flowgraph
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/drone-channel-deep.spec.mjs --n 50
 * Deep mode (по конкретным seeds):
 *   node utils/spec-runner.mjs specs/executable/drone-channel-deep.spec.mjs --seed 1847 --n 1
 *
 * Медленнее fast-spec (~500мс/сценарий без GNU Radio, ~5с с GNU Radio).
 * Используй fast-spec для N=1000, deep для верификации 10-20 контрпримеров.
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGES = resolve(dirname(fileURLToPath(import.meta.url)), '../bridges');
const GNR_BRIDGE = resolve(BRIDGES, 'gnuradio_bridge.py');

export const META = {
  id: 'drone-channel-deep-v1',
  title: 'Суверенный канал (Deep) — GNU Radio BER-симуляция',
  group: 'Группа_4_Архипелаг',
  version: '1.0.0',
  challenge: 'sovereign-channel',
  tier: 'deep',  // маркер: этот spec вызывать только для верификации
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// Сценарий идентичен fast-spec — те же внешние условия
export function genScenario(seed) {
  const r = rng(seed);
  const jamming_level = Math.floor(r() * 4);
  return {
    seed,
    jamming_level,
    gps_available: jamming_level === 0 && r() > 0.2,
    range_m: 200 + r() * 2800,
    mission_min: 15 + r() * 45,
    visibility: ['good', 'good', 'smoke', 'night'][Math.floor(r() * 4)],
    packet_burst: r() < 0.2,
    relay_nodes: Math.floor(r() * 4),
  };
}

// Deep evalScenario: реальная BER через gnuradio_bridge.py
export function evalScenario(scenario, params = {}) {
  const {
    imu_grade = 'good_mems',
    use_vio = true,
    tx_power_dbm = 20,
    use_mesh = true,
    is_sovereign = true,
    crypto_onboard = true,
    has_baro = true,
    modulation = 'gfsk',  // gfsk / lora / bpsk
  } = params;

  const { jamming_level, gps_available, range_m, mission_min, visibility, packet_burst, relay_nodes } = scenario;

  // ── Навигация (аналитика — быстро) ────────────────────────────────────────
  let nav_accuracy_m;
  if (gps_available) {
    nav_accuracy_m = 3;
  } else {
    const drift_rates = { consumer: 15, tactical: 3, good_mems: 8 };
    const imu_drift = mission_min * (drift_rates[imu_grade] ?? 10);
    const vio_acc = use_vio
      ? (visibility === 'night' || visibility === 'smoke' ? mission_min * 5 : mission_min * 0.5)
      : Infinity;
    const baro_fix = has_baro ? 5 : 20;
    nav_accuracy_m = Math.min(imu_drift, vio_acc, baro_fix + mission_min * 0.3);
  }

  // ── Радиоканал: GNU Radio / аналитика ────────────────────────────────────
  const eff_range = use_mesh && relay_nodes > 0 ? range_m / (relay_nodes + 1) : range_m;

  let rfResult;
  try {
    const raw = execFileSync('python3', [
      GNR_BRIDGE,
      '--tx-power', String(tx_power_dbm),
      '--range',    String(Math.round(eff_range)),
      '--jamming',  String(jamming_level),
      '--modulation', modulation,
    ], { encoding: 'utf8', timeout: 30_000 });
    rfResult = JSON.parse(raw);
  } catch (e) {
    // Fallback на аналитику (Friis) если bridge недоступен
    rfResult = _analyticalFallback(tx_power_dbm, eff_range, jamming_level);
  }

  const burst_penalty = packet_burst ? 0.05 : 0;
  const link_reliability = +Math.max(0, Math.min(1,
    rfResult.packet_delivery - burst_penalty
  )).toFixed(3);

  // Задержка: base + mesh hops + jamming overhead
  const latency_ms = 20 + relay_nodes * 2 + jamming_level * 10;

  return {
    nav_accuracy_m: +nav_accuracy_m.toFixed(1),
    link_reliability,
    latency_ms: +latency_ms.toFixed(0),
    snr_db: rfResult.snr_db ?? null,
    link_margin_db: rfResult.link_margin_db ?? null,
    ber: rfResult.ber ?? null,
    rf_method: rfResult.method ?? 'unknown',
    sovereignty_ok: is_sovereign,
    crypto_ok: crypto_onboard,
    gps_available,
  };
}

// Аналитический fallback (если python недоступен)
function _analyticalFallback(tx_dbm, range_m, jamming_level) {
  const path_loss_db = 20 * Math.log10(Math.max(1, range_m)) + 20 * Math.log10(915e6) - 147.55;
  const rx_dbm = tx_dbm - path_loss_db;
  const snr_db = rx_dbm - (-100 + 6);  // sensitivity -100дБм, NF 6дБ
  const jam_penalty = [0, 10, 20, 35][Math.min(jamming_level, 3)];
  const snr_effective = snr_db - jam_penalty;
  const ber = snr_effective > 10 ? 1e-6 : snr_effective > 0 ? Math.exp(-snr_effective * 0.3) * 0.01 : 0.3;
  const per = 1 - Math.pow(1 - ber, 64 * 8);
  return {
    packet_delivery: Math.max(0, 1 - per),
    snr_db: Math.round(snr_effective * 10) / 10,
    link_margin_db: Math.round((snr_effective + 7.5) * 10) / 10,
    ber, method: 'js-friis-fallback',
  };
}

// ИНВАРИАНТЫ — те же что в fast-spec (суверенность нельзя размыть)
export const INVARIANTS = [
  {
    id: 'SOVEREIGNTY-NO-FOREIGN-STACK',
    text: 'Канал не должен зависеть от иностранного стека под санкциями',
    check: (sc, m) => !m.sovereignty_ok
      ? { violation: 'иностранный стек в критическом пути', seed: sc.seed }
      : null,
  },
  {
    id: 'CRYPTO-ONBOARD',
    text: 'Шифрование автономно (не зависит от внешнего сервера ключей)',
    check: (sc, m) => !m.crypto_ok
      ? { violation: 'шифрование требует внешнего сервера', seed: sc.seed }
      : null,
  },
  {
    id: 'SNR-ABOVE-DEMOD-THRESHOLD',
    text: 'SNR должен быть выше порога демодуляции (-7.5 дБ для LoRa SF7) при jamming ≤ 2',
    check: (sc, m) => sc.jamming_level <= 2 && m.snr_db !== null && m.snr_db < -7.5
      ? { violation: `SNR=${m.snr_db}дБ ниже порога -7.5дБ при jamming=${sc.jamming_level}`, seed: sc.seed }
      : null,
  },
  {
    id: 'LINK-MINIMUM-UNDER-JAMMING',
    text: 'При jamming=1 и дальности ≤1000м связь ≥70%',
    check: (sc, m) => sc.jamming_level === 1 && sc.range_m <= 1000 && m.link_reliability < 0.7
      ? { violation: `reliability=${m.link_reliability} при jamming=1, range=${sc.range_m.toFixed(0)}м`, seed: sc.seed }
      : null,
  },
];

// МЕТРИКИ — тот же уровень что у fast-spec (deep подтверждает или опровергает)
export const METRICS = {
  nav_accuracy_m:  { '<=': 30 },
  link_reliability:{ '>=': 0.55 },
  latency_ms:      { '<=': 200 },
};
