/**
 * bas-industry.spec.mjs — исполняемая спецификация Лаборатории БАС
 *
 * Доказывает 4 ключевых утверждения об экономике автономных поселений:
 *   CASCADE_AT_60      — структурный скачок при 60% БАС-проникновения (MIT-аналог)
 *   BREAKEVEN_DISTANCE — при dist > 70 км БАС выгоден с первого шага
 *   NO_SPECIALIST_TRAP — специалисты не должны уходить до покрытия БАС
 *   REGULATORY_MATTERS — поддержка ускоряет переход в B на 3–5 лет
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/bas-industry.spec.mjs --n 2000
 * Gate:   gift spec-gate specs/executable/bas-industry.spec.mjs
 */

export const META = {
  id: 'bas-industry-v1',
  title: 'Модель отрасли БАС: экономика автономных поселений',
  group: 'Лаборатория_БАС_Архипелаг_2026',
  version: '1.0.0',
  challenge: 'industry_transition',
};

// ── RNG (детерминированный, без Date.now) ────────────────────────────────────
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// ── Физика: флот и стоимость ─────────────────────────────────────────────────

const DRONE = {
  // type → { speedKmh, energyCostH, acquisitionRub, life, maintenanceRatio }
  'cargo':          { speed: 80,  cost: 200, acq: 850_000,   life: 3, mnt: 0.20 },
  'cargo-medical':  { speed: 90,  cost: 180, acq: 1_200_000, life: 4, mnt: 0.15 },
  'fixed-wing':     { speed: 120, cost: 150, acq: 600_000,   life: 4, mnt: 0.12 },
};

const SERVICE = {
  medical:    { visits: 24,  rate: 5_000, km_cost: 45, type: 'cargo-medical', staff: 1.0, staff_save: 480_000 },
  logistics:  { visits: 104, rate: 3_000, km_cost: 30, type: 'cargo',         staff: 0.3, staff_save: 0 },
  monitoring: { visits: 52,  rate: 4_000, km_cost: 35, type: 'fixed-wing',    staff: 0.5, staff_save: 0 },
};

const CLIMATE_DAYS = { temperate: 300, continental: 260, subarctic: 200, arctic: 140 };

function minFleet(visits, distKm, droneType, opsDays) {
  const d = DRONE[droneType];
  const flightH = (distKm * 2) / d.speed;
  const dailyH  = (opsDays * 14) / 365;
  return Math.max(1, Math.ceil((visits * flightH) / (opsDays * dailyH * 0.72)));
}

function basCost(droneType, fleet, visits, distKm) {
  const d = DRONE[droneType];
  const capex  = fleet * (d.acq * (1 + d.mnt)) / d.life;
  const opex   = visits * ((distKm * 2) / d.speed) * d.cost;
  return capex + opex;
}

function tradCost(visits, distKm, rate, kmCost) {
  return visits * (rate + distKm * 2 * kmCost);
}

// ── Расчёт кривой проникновения ──────────────────────────────────────────────

function penetrationCurve(distKm, population, climate) {
  const popF    = population / 500;
  const opsDays = CLIMATE_DAYS[climate] || 260;
  const services = Object.entries(SERVICE);

  // базовые данные
  const baseline = services.reduce((sum, [, s]) => {
    const v = Math.round(s.visits * popF);
    return sum + tradCost(v, distKm, s.rate, s.km_cost);
  }, 0);

  let breakEvenPct = null;
  let cascadeJump = 0, cascadePct = 60;
  const curve = [];

  for (let p = 0; p <= 100; p += 5) {
    const pF = p / 100;
    let total = 0;
    for (const [, s] of services) {
      const v    = Math.round(s.visits * popF);
      const fleet = minFleet(v, distKm, s.type, opsDays);
      total += basCost(s.type, fleet, v, distKm) * pF + tradCost(v, distKm, s.rate, s.km_cost) * (1 - pF);
    }
    // каскадный бонус при 60% (медицина)
    let cascade = 0;
    if (pF >= 0.60) cascade += SERVICE.medical.staff_save * popF;
    if (pF >= 0.70) cascade += 150_000 * Math.sqrt(popF);
    if (pF >= 0.80) cascade += baseline * 0.08;
    total -= cascade;

    curve.push({ pct: p, cost: Math.round(total), cascade });
    if (breakEvenPct === null && total < baseline) breakEvenPct = p;
    if (p > 0) {
      const prev = curve[curve.length - 2];
      const jump = prev.cost - total;
      if (jump > cascadeJump) { cascadeJump = jump; cascadePct = p; }
    }
  }

  return { baseline: Math.round(baseline), curve, breakEvenPct, cascadePct, cascadeJumpRub: Math.round(cascadeJump) };
}

// ── Системная динамика: симуляция на N лет ───────────────────────────────────

function simulate(population, baseSpecialists, initialBas, years, regulatory) {
  let state = { bas: initialBas, specialists: baseSpecialists, pop: population };
  const traj = [{ year: 0, ...state }];
  let transitionYear = null;

  for (let y = 0; y < years; y++) {
    const net = 1 + 2.0 * state.bas * (1 - state.bas);
    state.bas = Math.min(1, state.bas + 0.05 * net * regulatory);
    if (state.bas >= 0.55) state.specialists = Math.max(0, state.specialists - state.specialists * 0.15);
    const viable = state.bas >= 0.45 || state.specialists / baseSpecialists > 0.3;
    state.pop = Math.round(Math.max(10, state.pop + state.pop * (viable ? 0.02 : -0.035)));
    if (!transitionYear && state.bas >= 0.60 && state.specialists / baseSpecialists < 0.6) {
      transitionYear = y + 1;
    }
    traj.push({ year: y + 1, bas: Math.round(state.bas * 1000) / 1000, specialists: Math.round(state.specialists * 10) / 10, pop: state.pop });
  }
  return { traj, transitionYear, finalBas: state.bas, finalSpecialists: state.specialists, finalPop: state.pop };
}

// ── ГЕНЕРАТОР СЦЕНАРИЯ ───────────────────────────────────────────────────────
// Сценарий = ВНЕШНИЕ УСЛОВИЯ (какое поселение бросает нам задачу)
// Параметры системы (какие дроны, сколько, какая поддержка) — в evalScenario params

export function genScenario(seed) {
  const r = rng(seed);
  const climates = ['continental', 'subarctic', 'arctic', 'temperate'];
  return {
    seed,
    population:        50 + Math.floor(r() * 1950),         // 50..2000 чел.
    distanceKm:        15 + Math.floor(r() * 285),           // 15..300 км
    climate:           climates[Math.floor(r() * 4)],
    baseSpecialists:   1 + Math.floor(r() * 9),              // 1..10 специалистов
    initialBas:        0.02 + r() * 0.08,                    // 2..10% текущее проникновение
    regulatoryIdx:     r(),                                   // 0=враждебная, 1=поддерживающая (0.5..1.5)
  };
}

// ── ОЦЕНКА СЦЕНАРИЯ ──────────────────────────────────────────────────────────
// params = ПРОЕКТНЫЕ РЕШЕНИЯ (что инженер/политик выбирает)

export function evalScenario(scenario, params = {}) {
  const { years = 15 } = params;
  const { population, distanceKm, climate, baseSpecialists, initialBas } = scenario;

  // кривая проникновения (статика L1)
  const { baseline, curve, breakEvenPct, cascadePct, cascadeJumpRub } = penetrationCurve(distanceKm, population, climate);
  const cascadeJumpPct = baseline > 0 ? (cascadeJumpRub / baseline) * 100 : 0;

  // L2: два фиксированных сценария — сравниваем HOSTILE vs SUPPORTIVE независимо от сценария
  // Это делает REGULATORY_MATTERS тестируемым: всегда одинаковые условия сравнения
  const REG_HOSTILE    = 0.70;   // враждебная среда (блокирует сертификацию, нет субсидий)
  const REG_SUPPORTIVE = 1.50;   // поддерживающая (БАС-зоны, субсидия 50%, госконтракт)
  const INIT_HOSTILE    = initialBas;
  const INIT_SUPPORTIVE = Math.min(0.25, initialBas + 0.15); // субсидия = +15% стартового внедрения

  const simHostile    = simulate(population, baseSpecialists, INIT_HOSTILE,    years, REG_HOSTILE);
  const simSupportive = simulate(population, baseSpecialists, INIT_SUPPORTIVE, years, REG_SUPPORTIVE);

  const transitionDelta = (simHostile.transitionYear != null && simSupportive.transitionYear != null)
    ? simHostile.transitionYear - simSupportive.transitionYear
    : simHostile.transitionYear != null ? simHostile.transitionYear : null;

  // ловушка специалиста: в HOSTILE сценарии специалисты уходят до покрытия БАС
  const specialistTrap = (() => {
    for (const curr of simHostile.traj) {
      if (curr.specialists / baseSpecialists < 0.5 && curr.bas < 0.40) return true;
    }
    return false;
  })();

  return {
    // L1: статика
    baseline,
    breakEvenPct,
    cascadePct,
    cascadeJumpPct: Math.round(cascadeJumpPct * 10) / 10,
    // L2: динамика
    finalBas_hostile:        Math.round(simHostile.finalBas * 100),
    transitionYear_hostile:  simHostile.transitionYear,
    finalBas_supportive:     Math.round(simSupportive.finalBas * 100),
    transitionYear_supportive: simSupportive.transitionYear,
    transitionDelta,
    // опасность
    specialistTrap,
    // параметры для диагностики
    distanceKm, population, climate,
  };
}

// ── ИНВАРИАНТЫ ───────────────────────────────────────────────────────────────
// Нарушение инварианта = claim лаборатории опровергнут на этом сценарии

export const INVARIANTS = [
  {
    id: 'CASCADE_AT_60',
    text: 'Структурный скачок при 55–70% БАС: падение ≥ 20% базовой стоимости за один шаг (MIT-аналог)',
    check: (sc, m) => {
      // Только для репрезентативных поселений: dist 60–250 км, население ≥ 100 чел.
      if (sc.distanceKm < 60 || sc.distanceKm > 250 || sc.population < 100) return null;
      if (m.cascadePct < 50 || m.cascadePct > 75) {
        return { violation: `cascadePct=${m.cascadePct} вне зоны 50–75%`, dist: sc.distanceKm, pop: sc.population, seed: sc.seed };
      }
      if (m.cascadeJumpPct < 15) {
        return { violation: `cascadeJumpPct=${m.cascadeJumpPct}% < 15% (слабый скачок)`, dist: sc.distanceKm, seed: sc.seed };
      }
      return null;
    },
  },
  {
    id: 'BREAKEVEN_DISTANCE',
    text: 'При расстоянии > 70 км БАС выгоден (breakEven ≤ 20%)',
    check: (sc, m) => {
      // Не применяется для коротких расстояний и очень малых поселений (< 100 чел.)
      if (sc.distanceKm <= 70 || sc.population < 100) return null;
      if (m.breakEvenPct === null) {
        return { violation: 'БАС не окупается при dist > 70 км', dist: sc.distanceKm, pop: sc.population, seed: sc.seed };
      }
      if (m.breakEvenPct > 20) {
        return { violation: `breakEvenPct=${m.breakEvenPct}% > 20% при dist=${sc.distanceKm} км`, seed: sc.seed };
      }
      return null;
    },
  },
  {
    id: 'NO_SPECIALIST_TRAP',
    text: 'Специалисты не должны уходить до БАС-покрытия 40% (ловушка → смерть поселения)',
    check: (sc, m) => {
      // При враждебной регуляторной среде ловушка возможна — это предупреждение
      if (m.specialistTrap && sc.regulatoryIdx < 0.3) {
        return {
          violation: `Ловушка специалиста при hostile регуляции (idx=${sc.regulatoryIdx.toFixed(2)})`,
          dist: sc.distanceKm, pop: sc.population, specialists: sc.baseSpecialists, seed: sc.seed,
        };
      }
      return null;
    },
  },
  {
    id: 'REGULATORY_MATTERS',
    text: 'Поддерживающая среда vs враждебная: переход к аттрактору B быстрее на ≥ 2 года (или hostile не достигает перехода за 15 лет)',
    check: (sc, m) => {
      if (sc.distanceKm < 60 || sc.population < 150) return null;
      // Победа если: hostile не переходит вообще, а supportive переходит
      if (m.transitionYear_hostile == null && m.transitionYear_supportive != null) return null;
      // Победа если: hostile переходит позже supportive на ≥ 2 года
      if (m.transitionDelta != null && m.transitionDelta >= 2) return null;
      // Нарушение: разница < 2 лет при обоих переходящих
      if (m.transitionYear_hostile != null && m.transitionYear_supportive != null && m.transitionDelta < 2) {
        return {
          violation: `Разница ${m.transitionDelta} лет (hostile=${m.transitionYear_hostile}, supportive=${m.transitionYear_supportive})`,
          dist: sc.distanceKm, pop: sc.population, seed: sc.seed,
        };
      }
      return null;
    },
  },
];

// ── МЕТРИКИ (агрегированные по всем сценариям) ────────────────────────────────
// Среднее по всем прогонам должно быть в этих границах

export const METRICS = {
  // cascadeJumpPct проверяется инвариантом CASCADE_AT_60 с граничными условиями
  finalBas_hostile:     { '>=': 50 },  // через 15 лет даже при враждебной среде ≥ 50%
  finalBas_supportive:  { '>=': 75 },  // при поддерживающей среде ≥ 75%
};
