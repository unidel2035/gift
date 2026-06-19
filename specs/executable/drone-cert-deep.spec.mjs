/**
 * drone-cert-deep.spec.mjs — Deep spec группы "Сертификация"
 *
 * Отличие от drone-cert.spec.mjs:
 *   - evalScenario вызывает cert_bridge.py (полная нормативная база)
 *   - Конкретные ссылки на пункты ГОСТ 33463, ФАП-140, ИКАО Annex 8
 *   - Детектор запрещённых частот, ECCN-контроль, Remote ID
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/drone-cert-deep.spec.mjs --n 50
 * Deep mode: node utils/spec-runner.mjs ... --seed 5 --n 1
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGES = resolve(dirname(fileURLToPath(import.meta.url)), '../bridges');
const CERT_BRIDGE = resolve(BRIDGES, 'cert_bridge.py');

export const META = {
  id: 'drone-cert-deep-v1',
  title: 'Сертификация (Deep) — ГОСТ 33463 / ФАП-140 / ИКАО Annex 8',
  group: 'Группа_5_Архипелаг',
  version: '1.0.0',
  challenge: 'certification',
  tier: 'deep',
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// Типичный профиль сертификационного испытания
export function genScenario(seed) {
  const r = rng(seed);
  const freqs = [433, 868, 915, 2400, 5800, 1090]; // включая запрещённые
  return {
    seed,
    mtow_kg: 0.1 + r() * 50,               // 0.1..50кг
    max_altitude_m: r() * 1200,             // 0..1200м
    freq_mhz: freqs[Math.floor(r() * freqs.length)],
    max_speed_kmh: 20 + r() * 250,          // 20..270 км/ч
    tx_power_mw: r() * 200,                 // 0..200 мВт
    urban_area: r() < 0.3,                  // 30% в городе
    return_to_home: r() > 0.1,             // 90% RTH есть
    geofencing_enabled: r() > 0.15,        // 85% geofence есть
    remote_id: r() > 0.2,                  // 80% remote ID есть
    adsb_out: r() > 0.5,                   // 50% ADS-B Out
    operator_certified: r() > 0.4,         // 60% сертифицированы
    atc_clearance: r() > 0.6,             // 40% с разрешением ОрВД
    backup_link_km: r() * 10,              // 0..10 км резервный канал
    imu_bias_deg_h: 0.1 + r() * 5,        // 0.1..5 °/ч
    export_target_country: r() < 0.2 ? 'US' : 'RU',  // 20% экспорт
    country: 'RU',
  };
}

function callCertBridge(scenario, params) {
  const bridgeParams = {
    mtow_kg: params.mtow_kg ?? scenario.mtow_kg,
    max_altitude_m: params.max_altitude_m ?? scenario.max_altitude_m,
    freq_mhz: params.freq_mhz ?? scenario.freq_mhz,
    max_speed_kmh: params.max_speed_kmh ?? scenario.max_speed_kmh,
    tx_power_mw: params.tx_power_mw ?? scenario.tx_power_mw,
    urban_area: params.urban_area ?? scenario.urban_area,
    return_to_home: params.return_to_home ?? scenario.return_to_home,
    geofencing_enabled: params.geofencing_enabled ?? scenario.geofencing_enabled,
    remote_id: params.remote_id ?? scenario.remote_id,
    adsb_out: params.adsb_out ?? scenario.adsb_out,
    operator_certified: params.operator_certified ?? scenario.operator_certified,
    atc_clearance: params.atc_clearance ?? scenario.atc_clearance,
    backup_link_km: params.backup_link_km ?? scenario.backup_link_km,
    imu_bias_deg_h: params.imu_bias_deg_h ?? scenario.imu_bias_deg_h,
    country: params.country ?? scenario.country ?? 'RU',
    export_license: params.export_license ?? false,
  };
  try {
    const out = execFileSync('python3', [CERT_BRIDGE, '--params', JSON.stringify(bridgeParams)],
      { timeout: 15_000, encoding: 'utf8' });
    return JSON.parse(out.trim());
  } catch {
    return analyticalCert(bridgeParams);
  }
}

function analyticalCert({ mtow_kg, max_altitude_m, freq_mhz, return_to_home, geofencing_enabled, remote_id }) {
  const violations = [];
  if (freq_mhz === 5800) violations.push('RF-4: 5.8ГГц запрещён для БВС в РФ');
  if (!return_to_home) violations.push('ICAO-A8-1: нет RTH');
  if (!geofencing_enabled) violations.push('ICAO-A8-2: нет geofencing');
  if (!remote_id && mtow_kg > 0.25) violations.push('ICAO-A8-4: нет Remote ID');
  if (max_altitude_m > 150) violations.push('FAP140-2: высота > 150м без разрешения ОрВД');
  return {
    compliant: violations.length === 0,
    violations: violations.map(v => ({ rule: v.split(':')[0], requirement: v, status: 'VIOLATION' })),
    n_violations: violations.length,
    risk_class: mtow_kg <= 7 ? 'mini' : mtow_kg <= 30 ? 'light' : 'medium',
    method: 'analytical-js-basic',
  };
}

export function evalScenario(scenario, params = {}) {
  const res = callCertBridge(scenario, params);
  return {
    compliant: res.compliant,
    n_violations: res.n_violations ?? res.violations?.length ?? 0,
    violations: res.violations ?? [],
    risk_class: res.risk_class,
    cert_method: res.method,
    scenario,
  };
}

export const INVARIANTS = {
  'RTH-MANDATORY': {
    check: (r) => !r.violations?.some(v => v.rule?.includes('ICAO-A8-1')),
    desc: 'Return-to-Home обязателен (ИКАО Annex 8 требование)',
  },
  'NO-BANNED-FREQ': {
    check: (r) => !r.violations?.some(v => v.rule?.includes('RF-4') || v.rule?.includes('RF-5')),
    desc: 'Запрещённые радиочастоты (5.8ГГц, военные) не используются',
  },
  'REMOTE-ID-PRESENT': {
    check: (r) => !r.violations?.some(v => v.rule?.includes('ICAO-A8-4')),
    desc: 'Remote ID обязателен для всех БВС > 250г (с 2024)',
  },
};

export const METRICS = {
  n_violations: { threshold: 0, dir: 'eq', label: 'Нарушений НПА (шт)' },
  compliant: { threshold: 1, dir: 'eq', label: 'Соответствие (0/1)' },
};
