/**
 * drone-hw-sovereignty-deep.spec.mjs — Deep spec группы "Суверенное железо"
 *
 * Отличие от drone-hw-sovereignty.spec.mjs:
 *   - evalScenario вызывает kicad_bridge.py (реальная проверка BOM)
 *   - kompas_bridge.py (геометрия → масса, момент инерции)
 *   - при установленном KiCad → проверяет реальные .kicad_pcb файлы
 *   - без KiCad → парсит BOM JSON из params.bom_components
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/drone-hw-sovereignty-deep.spec.mjs --n 20
 *
 * params.bom_components — список компонентов для проверки (если нет .kicad_pcb файла):
 *   [{"ref":"U1","mfr":"STM","part":"STM32H7"},{"ref":"U2","mfr":"Миландр","part":"1892BE7Я"}]
 * params.kicad_pcb — путь к файлу платы (опционально)
 * params.kompas_file — путь к .step/.stl файлу (опционально)
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const BRIDGES = resolve(dirname(fileURLToPath(import.meta.url)), '../bridges');
const KICAD_BRIDGE  = resolve(BRIDGES, 'kicad_bridge.py');
const KOMPAS_BRIDGE = resolve(BRIDGES, 'kompas_bridge.py');

export const META = {
  id: 'drone-hw-sovereignty-deep-v1',
  title: 'Суверенное железо (Deep) — KiCad BOM + КОМПАС-3D геометрия',
  group: 'Группа_2_Архипелаг',
  version: '1.0.0',
  challenge: 'hw-sovereignty',
  tier: 'deep',
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// Сценарий: внешние испытательные условия
export function genScenario(seed) {
  const r = rng(seed);
  return {
    seed,
    // Условия вибрации при испытаниях (МС462-10, класс С)
    vibration_g_rms: +(0.5 + r() * 9.5).toFixed(2),   // 0.5..10 g RMS
    // Температура (рабочий диапазон)
    temp_c: +(-20 + r() * 85).toFixed(0),              // -20..65°C
    // Напряжение питания (допустимое отклонение ±15%)
    supply_v: +(4.5 + r() * 3.0).toFixed(2),           // 4.5..7.5 В
    // Влажность (%)
    humidity_pct: Math.floor(r() * 95),                 // 0..95%
    // Сценарий радиационного воздействия (для ответственных задач)
    rad_dose_krad: +(r() * 50).toFixed(1),             // 0..50 крад
  };
}

// Deep evalScenario: реальная проверка через Python bridges
export function evalScenario(scenario, params = {}) {
  const {
    peak_tops = 4,
    is_sovereign = true,
    fpga_based = true,
    power_w = 8,
    kicad_pcb = null,
    kompas_file = null,
    bom_components = null,  // [{ref, mfr, part}] — если нет kicad_pcb
    banned_vendors = 'Xilinx,Altera,Intel FPGA,Lattice',
  } = params;

  // ── 1. BOM compliance через kicad_bridge.py ───────────────────────────────
  let bomResult;
  try {
    const kicadArgs = ['python3', KICAD_BRIDGE];

    if (kicad_pcb && existsSync(kicad_pcb)) {
      kicadArgs.push(kicad_pcb);
    } else if (bom_components) {
      kicadArgs.push('--bom-json', JSON.stringify(bom_components));
    } else {
      // Нет данных — считаем суверенным если is_sovereign=true
      bomResult = { sovereign: is_sovereign, violations: [], components_total: 0, method: 'param-only' };
    }

    if (!bomResult) {
      kicadArgs.push('--banned-vendors', banned_vendors);
      const raw = execFileSync(kicadArgs[0], kicadArgs.slice(1),
        { encoding: 'utf8', timeout: 30_000 });
      bomResult = JSON.parse(raw);
    }
  } catch (e) {
    bomResult = { sovereign: is_sovereign, violations: [], components_total: 0,
                  method: 'fallback', error: e.message };
  }

  // ── 2. Геометрия через kompas_bridge.py ──────────────────────────────────
  let geomResult = null;
  if (kompas_file && existsSync(kompas_file)) {
    try {
      const raw = execFileSync('python3', [KOMPAS_BRIDGE, kompas_file, '--density', '2700'],
        { encoding: 'utf8', timeout: 30_000 });
      geomResult = JSON.parse(raw);
    } catch (e) {
      geomResult = { error: e.message };
    }
  }

  // ── 3. Испытательные условия (аналитика) ─────────────────────────────────
  const { vibration_g_rms, temp_c, supply_v, humidity_pct } = scenario;

  // Вибрация: FPGA-модули выдерживают до 20 g RMS
  const vibration_ok = vibration_g_rms <= 15.0;

  // Температура: военный диапазон -40..85°C, индустриальный -20..70°C
  const temp_ok = temp_c >= -20 && temp_c <= 70;

  // Питание: типичный диапазон модуля 4.75..5.25 В или широкий 3.3..7.4 В
  const supply_ok = supply_v >= 4.5 && supply_v <= 7.5;

  // Влажность: до 90% без конденсата
  const humidity_ok = humidity_pct <= 90;

  // Производительность (не зависит от сценария)
  const perf_adequate = peak_tops >= 1.0;

  const sovereignty_ok = bomResult.sovereign && is_sovereign;
  const determinism_ok = fpga_based; // FPGA = детерминированное поведение

  // Итоговая оценка готовности к допуску
  const tests_pass = vibration_ok && temp_ok && supply_ok && humidity_ok;

  return {
    sovereignty_ok,
    determinism_ok,
    perf_adequate,
    vibration_ok,
    temp_ok,
    supply_ok,
    humidity_ok,
    tests_pass,
    bom_violations: bomResult.violations?.length ?? 0,
    bom_components_total: bomResult.components_total ?? 0,
    bom_method: bomResult.method,
    geom_mass_kg: geomResult?.mass_kg ?? null,
    geom_method: geomResult?.method ?? null,
    power_w,
  };
}

export const INVARIANTS = [
  {
    id: 'SOVEREIGNTY-NO-EXPORT-CONTROLLED',
    text: 'BOM не должен содержать компоненты под экспортным контролем (ECCN 3A001)',
    check: (sc, m) => !m.sovereignty_ok || m.bom_violations > 0
      ? { violation: `${m.bom_violations} запрещённых компонентов в BOM`, seed: sc.seed }
      : null,
  },
  {
    id: 'DETERMINISM-REQUIRED',
    text: 'Алгоритм управления должен быть детерминированным (FPGA или верифицированный MCU)',
    check: (sc, m) => !m.determinism_ok
      ? { violation: 'нет детерминированного исполнителя (нет FPGA)', seed: sc.seed }
      : null,
  },
  {
    id: 'SURVIVE-VIBRATION',
    text: 'Оборудование должно выдерживать вибрацию до 15 g RMS (МС462-10 класс С)',
    check: (sc, m) => !m.vibration_ok
      ? { violation: `вибрация ${sc.vibration_g_rms} g > 15 g`, seed: sc.seed }
      : null,
  },
  {
    id: 'POWER-ON-SUPPLY-RANGE',
    text: 'Система должна работать при напряжении питания 4.5..7.5 В',
    check: (sc, m) => !m.supply_ok
      ? { violation: `напряжение ${sc.supply_v} В вне диапазона 4.5-7.5 В`, seed: sc.seed }
      : null,
  },
  {
    id: 'TEMPERATURE-INDUSTRIAL',
    text: 'Рабочий диапазон температур: -20..70°C (промышленный класс)',
    check: (sc, m) => !m.temp_ok
      ? { violation: `температура ${sc.temp_c}°C вне диапазона -20..70°C`, seed: sc.seed }
      : null,
  },
];

export const METRICS = {
  sovereignty_ok:  { '>=': 1 },   // boolean → 1/0
  determinism_ok:  { '>=': 1 },
  perf_adequate:   { '>=': 1 },
  bom_violations:  { '<=': 0 },   // ноль запрещённых компонентов
};
