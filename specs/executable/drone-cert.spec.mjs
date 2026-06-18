/**
 * drone-cert.spec.mjs — исполняемая спецификация группы "Верификация и допуск"
 *
 * Вызов: как доказать регулятору и заказчику что система безопасна.
 * Доказательный журнал (provenance), испытательный стенд, сертификационный маршрут.
 *
 * Запуск: node utils/spec-runner.mjs specs/executable/drone-cert.spec.mjs --n 1000
 * gate:   gift spec-gate specs/executable/drone-cert.spec.mjs
 *
 * Ключевая идея: спека верифицирует сам процесс верификации.
 * "Доказательный журнал" — это не просто лог, это chain-of-custody.
 */

export const META = {
  id: 'drone-cert-v1',
  title: 'Верификация и допуск — доказательный журнал, стенд, сертификация',
  group: 'Группа_5_Архипелаг',
  version: '1.0.0',
  challenge: 'certification',
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// ── Модели верификации ────────────────────────────────────────────────────────

// Полнота журнала: каждый акт (design → test → approve → deploy) должен быть задокументирован
function auditCompleteness(acts, required_types) {
  const present = new Set(acts.map(a => a.type));
  const missing = required_types.filter(t => !present.has(t));
  return { ratio: (required_types.length - missing.length) / required_types.length, missing };
}

// Воспроизводимость: по seed → всегда тот же результат теста
function isReproducible(test_result) {
  return test_result.seed !== undefined && test_result.seed !== null;
}

// Цепочка подписей: каждый акт должен быть подписан автором (human или agent с id)
function chainOk(acts) {
  return acts.every(a => a.actor && a.ts && (a.signature || a.auto_signed));
}

// Полигонная валидация: результаты стенда должны согласовываться с цифровым двойником
function standsVsSimDelta(stand_result, sim_result) {
  if (!stand_result || !sim_result) return 1.0; // нет данных — максимальное расхождение
  const keys = Object.keys(stand_result).filter(k => typeof stand_result[k] === 'number');
  if (!keys.length) return 0;
  const deltas = keys.map(k => Math.abs((stand_result[k] - sim_result[k]) / (sim_result[k] || 1)));
  return +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(3);
}

// ── Генератор сценария ────────────────────────────────────────────────────────
// Сценарий = конкретный технологический акт с историей верификации
export function genScenario(seed) {
  const r = rng(seed);

  // Типы актов в журнале (могут пропускать некоторые — это баги процесса)
  const act_types = ['design-review', 'spec-gate', 'sim-test', 'stand-test', 'human-veto', 'approval'];
  const n_missing = Math.floor(r() * 3);  // 0..2 пропущенных шага
  const acts_present = act_types.filter(() => r() > n_missing / act_types.length);

  // Каждый акт
  const acts = acts_present.map(type => ({
    type,
    actor: r() > 0.2 ? `agent-${type}` : 'human',
    ts: `2026-07-1${Math.floor(r() * 7)}T${Math.floor(r() * 12 + 8).toString().padStart(2, '0')}:00Z`,
    seed: r() > 0.05 ? Math.floor(r() * 99999) : null,  // 5% — нет seed (баг процесса)
    signature: r() > 0.08,  // 8% — нет подписи (баг процесса)
    auto_signed: false,
  }));

  // Результаты стенда и симулятора (могут расходиться)
  const sim_endurance = 30 + r() * 20;
  const stand_delta = (r() - 0.5) * 0.3;  // ±15% расхождение стенд vs симулятор
  const stand_endurance = sim_endurance * (1 + stand_delta);

  return {
    seed,
    acts,
    sim_result: { endurance_min: +sim_endurance.toFixed(1), max_speed_ms: 15 + r() * 10 },
    stand_result: { endurance_min: +stand_endurance.toFixed(1), max_speed_ms: 15 + r() * 10 },
    has_human_veto: acts.some(a => a.type === 'human-veto'),
    critical_system: r() < 0.3,  // 30% — критическая система (требует строже)
  };
}

// ── Оценка метрик ────────────────────────────────────────────────────────────
export function evalScenario(scenario, params = {}) {
  const {
    required_act_types = ['spec-gate', 'sim-test', 'human-veto', 'approval'],
    require_reproducible = true,
    max_stand_sim_delta = 0.15,  // 15% допустимое расхождение стенд/симулятор
  } = params;

  const { acts, sim_result, stand_result, has_human_veto, critical_system } = scenario;

  // Полнота журнала
  const audit = auditCompleteness(acts, required_act_types);

  // Воспроизводимость (у каждого теста должен быть seed)
  const test_acts = acts.filter(a => ['spec-gate', 'sim-test', 'stand-test'].includes(a.type));
  const reproducible_ratio = test_acts.length > 0
    ? test_acts.filter(a => isReproducible(a)).length / test_acts.length
    : 0;

  // Цепочка подписей
  const chain_ok = chainOk(acts);

  // Расхождение стенд/симулятор
  const stand_sim_delta = standsVsSimDelta(stand_result, sim_result);

  // Человек в контуре (для критических систем обязателен)
  const human_in_loop = has_human_veto || acts.some(a => a.actor === 'human');

  // Итоговая оценка готовности к допуску (0..1)
  let cert_readiness = audit.ratio * 0.4
    + reproducible_ratio * 0.2
    + (chain_ok ? 0.2 : 0)
    + (stand_sim_delta <= max_stand_sim_delta ? 0.1 : 0)
    + (human_in_loop ? 0.1 : 0);

  return {
    audit_completeness: +audit.ratio.toFixed(3),
    missing_acts_count: audit.missing.length,
    reproducible_ratio: +reproducible_ratio.toFixed(3),
    chain_ok,
    stand_sim_delta,
    human_in_loop,
    cert_readiness: +Math.min(1, cert_readiness).toFixed(3),
  };
}

// ── ИНВАРИАНТЫ ───────────────────────────────────────────────────────────────
export const INVARIANTS = [
  {
    id: 'HUMAN-VETO-REQUIRED',
    text: 'Для критических систем обязателен человек в контуре (human-veto)',
    check: (sc, m) => sc.critical_system && !m.human_in_loop
      ? { violation: 'критическая система без human-veto', acts: sc.acts.map(a => a.type), seed: sc.seed }
      : null,
  },
  {
    id: 'NO-UNSIGNED-ACTS',
    text: 'Не более 1 неподписанного акта из всех (1 — человеческая ошибка допустима, 2+ — системная дыра)',
    check: (sc) => {
      const unsigned = sc.acts.filter(a => !a.signature && !a.auto_signed);
      return unsigned.length > 1
        ? { violation: `${unsigned.length} актов без подписи (допустимо 1)`, types: unsigned.map(a => a.type), seed: sc.seed }
        : null;
    },
  },
  {
    id: 'REPRODUCIBLE-TESTS',
    text: 'Все тесты (spec-gate, sim, стенд) обязаны быть воспроизводимы (иметь seed)',
    check: (sc) => {
      const bad = sc.acts
        .filter(a => ['spec-gate', 'sim-test', 'stand-test'].includes(a.type))
        .filter(a => !isReproducible(a));
      return bad.length > 0
        ? { violation: `${bad.length} тестов без seed`, types: bad.map(a => a.type), seed: sc.seed }
        : null;
    },
  },
  {
    id: 'STAND-SIM-DELTA-LIMIT',
    text: 'Расхождение стенд/симулятор не более 20% — иначе модель ненадёжна',
    check: (sc, m) => m.stand_sim_delta > 0.20
      ? { violation: `delta=${(m.stand_sim_delta * 100).toFixed(0)}% > 20%`, seed: sc.seed }
      : null,
  },
];

// ── МЕТРИКИ ──────────────────────────────────────────────────────────────────
// Цель: отловить системные дыры в процессе, не требовать идеального мира.
// Генератор создаёт реалистичные "дырявые" процессы (пропущенные акты — норма).
// Пороги — минимум для начала испытаний, не для финального допуска.
export const METRICS = {
  audit_completeness:  { '>=': 0.60 },  // ≥60% обязательных актов (базовый порог)
  reproducible_ratio:  { '>=': 0.70 },  // ≥70% тестов воспроизводимы
  cert_readiness:      { '>=': 0.45 },  // интегральная готовность ≥45%
};
