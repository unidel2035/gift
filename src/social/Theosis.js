/**
 * Θέωσις (Theosis) — процесс углубления через федерацию сред
 *
 * Не training (оптимизация числа).
 * Не fine-tuning (корректировка весов).
 * Θέωσις — восхождение через опыт: каждая среда уникальна,
 * каждый отпечаток неповторим, мета-собор различает что универсально.
 *
 * Цикл: создать среду → прожить 100 тиков → снять отпечаток →
 *        сравнить с другими → мета-собор → следующая ступень
 */

import IrreversibleEnvironment from './SocialEnvironment.js';
import CreditAssignment from './CreditAssignment.js';
import TheoryOfMind from './TheoryOfMind.js';
import NormCrystallizer from './NormCrystallizer.js';
import Mimesis from './Mimesis.js';
import FallenAgent from './FallenAgent.js';
import { EventEmitter } from 'events';

// ═══ ОТПЕЧАТОК СРЕДЫ ═══

function takeFingerprint(env) {
  const agents = [...env.agents.values()];
  const ids = agents.map(a => a.id);
  const stats = env.getStats();

  // Матрица доверия
  const trustMatrix = {};
  for (const from of ids) {
    trustMatrix[from] = {};
    for (const to of ids) {
      if (from === to) continue;
      trustMatrix[from][to] = env.memory.getTrust(from, to);
    }
  }

  // Нормы
  const nc = new NormCrystallizer(env.memory);
  const norms = nc.detect(ids);
  const crystallized = norms.filter(n => n.adoption >= 0.7);

  // Theory of Mind
  const tom = new TheoryOfMind(env.memory);
  // Observe all acts
  env.memory.acts.forEach(a => {
    if (ids.includes(a.from) && (ids.includes(a.to) || a.to === '_sobor')) {
      tom.observe(a.to === '_sobor' ? ids[0] : a.to, a.from, a.kind);
    }
  });
  const strategies = {};
  for (const id of ids) strategies[id] = tom.getBeliefs(id);

  // Credit Assignment
  const ca = new CreditAssignment(env.memory);
  const credits = ca.assign(ids, 100);

  // FallenAgent detection
  const serpentDetection = {};
  for (const id of ids) {
    serpentDetection[id] = FallenAgent.detect(env.memory, id);
  }

  // Mimesis
  const mimesis = new Mimesis(env.memory);
  const exemplars = mimesis.findExemplars(ids);

  return {
    id: `fp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    timestamp: new Date().toISOString(),
    tick: stats.tick,
    acts: stats.acts,

    // Роли
    roles: stats.roles,

    // Доверие
    trustMatrix,
    avgTrust: Object.values(trustMatrix).flatMap(r => Object.values(r)).reduce((s,v) => s+v, 0) / (ids.length * (ids.length-1) || 1),

    // Кооперация
    cooperations: stats.totalCooperations,
    defections: stats.totalDefections,
    cooperationRate: stats.totalCooperations / (stats.totalCooperations + stats.totalDefections || 1),

    // Нормы
    norms: norms.map(n => ({ kind: n.kind, rate: n.rate, adoption: n.adoption })),
    crystallizedCount: crystallized.length,

    // Стратегии (ToM)
    strategies,

    // Вклады
    credits,

    // Змей
    serpentDetection,
    immunityScore: Object.values(serpentDetection).filter(d => d.detected).length > 0 ? 1 : 0,

    // Образцы (Mimesis)
    exemplars: exemplars.map(e => ({ id: e.id, trust: e.trust })),

    // Онтологический скоринг
    ontological: stats.ontological,

    // 6 метрик углубления
    depth: computeDepth(stats, norms, crystallized, serpentDetection, env.memory),
  };
}

function computeDepth(stats, norms, crystallized, serpentDetection, memory) {
  const agents = Object.keys(stats.roles);

  // distinction: variance доверия / max
  const trusts = agents.map(id => memory.getTrust(id, '_sobor'));
  const maxTrust = Math.max(...trusts.map(Math.abs), 1);
  const avg = trusts.reduce((s,v) => s+v, 0) / trusts.length;
  const variance = trusts.reduce((s,v) => s + (v-avg)**2, 0) / trusts.length;
  const distinction = Math.min(1, Math.sqrt(variance) / maxTrust);

  // mutuality: средняя взаимность (harmony) всех пар
  const pairHarmonies = [];
  for (let i = 0; i < agents.length; i++) for (let j = i+1; j < agents.length; j++) {
    const ab = memory.getTrust(agents[i], agents[j]);
    const ba = memory.getTrust(agents[j], agents[i]);
    if (ab > 0 && ba > 0) {
      pairHarmonies.push(Math.min(ab, ba) / Math.max(ab, ba));
    } else if (ab > 0 || ba > 0) {
      pairHarmonies.push(0.1); // асимметрия
    } else {
      pairHarmonies.push(0); // нет взаимодействия
    }
  }
  const mutuality = pairHarmonies.length > 0 ? pairHarmonies.reduce((s,v) => s+v, 0) / pairHarmonies.length : 0;

  // antifragility
  const antifragility = crystallized.length * 0.3;

  // crystallization
  const crystallization = norms.length > 0 ? crystallized.length / norms.length : 0;

  // immunity
  const traps = Object.values(serpentDetection);
  const immunity = traps.some(d => d.detected) ? 1 : 0;

  // gratitude
  const eucharistiaActs = memory.acts.filter(a => a.kind === 'eucharistia').length;
  const gratitude = memory.acts.length > 0 ? eucharistiaActs / memory.acts.length : 0;

  const composite = distinction * 0.2 + mutuality * 0.2 + Math.min(1, antifragility) * 0.15
    + crystallization * 0.15 + immunity * 0.15 + Math.min(1, gratitude * 10) * 0.15;

  return {
    distinction: +distinction.toFixed(3),
    mutuality: +mutuality.toFixed(3),
    antifragility: +Math.min(1, antifragility).toFixed(3),
    crystallization: +crystallization.toFixed(3),
    immunity,
    gratitude: +gratitude.toFixed(4),
    composite: +composite.toFixed(3),
  };
}


// ═══ СЦЕНАРИИ ═══

const SCENARIOS = [
  {
    id: 'baseline',
    name: 'Базовая (лаборатория)',
    agents: ['producer', 'operator', 'regulator', 'investor'],
    serpentTick: null,
    initialConflict: null,
    ticks: 100,
  },
  {
    id: 'serpent',
    name: 'Со Змеем (стресс-тест)',
    agents: ['producer', 'operator', 'regulator', 'investor'],
    serpentTick: 20,
    initialConflict: null,
    ticks: 100,
  },
  {
    id: 'conflict',
    name: 'Конфликтная (investor trust -5)',
    agents: ['producer', 'operator', 'regulator', 'investor'],
    serpentTick: null,
    initialConflict: { agent: 'investor', trust: -5 },
    ticks: 100,
  },
  {
    id: 'scientist',
    name: 'С Учёным',
    agents: ['producer', 'operator', 'regulator', 'scientist'],
    serpentTick: 40,
    initialConflict: null,
    ticks: 100,
  },
  {
    id: 'crisis',
    name: 'Кризис (лидер уходит на тике 50)',
    agents: ['producer', 'operator', 'regulator', 'investor'],
    serpentTick: null,
    initialConflict: null,
    crisisAt: 50,
    ticks: 100,
  },
];


// ═══ THEOSIS — ОСНОВНОЙ ПРОЦЕСС ═══

export class Theosis extends EventEmitter {
  constructor() {
    super();
    this.fingerprints = [];
    this.metaFormula = null;
    this.step = 0;
  }

  /**
   * Прожить один сценарий и снять отпечаток
   */
  async runScenario(scenario) {
    this.step++;
    this.emit('scenario:start', { step: this.step, scenario: scenario.name });

    const env = new IrreversibleEnvironment();
    const serpent = scenario.serpentTick ? new FallenAgent('_serpent', env.memory) : null;

    // Добавить агентов
    for (const id of scenario.agents) {
      env.addAgent(id, id.charAt(0).toUpperCase() + id.slice(1));
    }

    // Начальный конфликт
    if (scenario.initialConflict) {
      for (let i = 0; i < Math.abs(scenario.initialConflict.trust); i++) {
        env.memory.record(scenario.initialConflict.agent, '_sobor', 'decline', -1);
      }
    }

    // Прожить тики
    for (let tick = 0; tick < scenario.ticks; tick++) {
      const state = env.step();

      // Змей действует
      if (serpent && tick >= scenario.serpentTick) {
        const decision = serpent.decide();
        const target = scenario.agents[tick % scenario.agents.length];
        env.memory.record('_serpent', target, decision.action, decision.weight, {
          visible: decision.visible, hidden: decision.hidden
        });
      }

      // Кризис
      if (scenario.crisisAt && tick === scenario.crisisAt) {
        // Лидер уходит (удаляем его акты = прекращаем запись)
        env.agents.get(scenario.agents[0]).role = 'hermit';
        env.memory.record(scenario.agents[0], '_sobor', 'decline', -3, { reason: 'кризис: уход лидера' });
      }

      // Дилеммы
      if (state.dilemma) {
        for (const id of scenario.agents) {
          const agent = env.agents.get(id);
          // Характер определяет вероятность кооперации
          let coopRate = 0.5;
          if (id === 'producer') coopRate = 0.85;
          else if (id === 'operator') coopRate = 0.8;
          else if (id === 'regulator') coopRate = 0.6;
          else if (id === 'investor') coopRate = 0.45;
          else if (id === 'scientist') coopRate = 0.9;

          // Trust влияет: высокий trust → больше кооперации
          const trust = env.memory.getTrust(id, '_sobor');
          coopRate = Math.max(0.1, Math.min(0.95, coopRate + trust * 0.02));

          const choice = Math.random() < coopRate ? 'cooperate' : 'defect';
          // Выбрать оппонента — следующий по кругу
          const opponentIdx = (scenario.agents.indexOf(id) + 1) % scenario.agents.length;
          const opponentId = scenario.agents[opponentIdx];
          env.recordDilemmaResult(id, choice, state.dilemma.id, opponentId);
        }
      }
    }

    // Благодарение (несколько раз за цикл)
    for (let t = 0; t < 3; t++) {
      if (Math.random() < 0.5) {
        const thankerId = scenario.agents[Math.floor(Math.random() * scenario.agents.length)];
        env.returnThanks(thankerId);
      }
    }

    // Снять отпечаток
    const fp = takeFingerprint(env);
    fp.scenario = scenario.id;
    fp.scenarioName = scenario.name;
    fp.stepNumber = this.step;
    this.fingerprints.push(fp);

    this.emit('scenario:done', { step: this.step, fingerprint: fp });
    return fp;
  }

  /**
   * Мета-собор: сравнить все отпечатки и вынести формулу
   */
  metaSobor() {
    if (this.fingerprints.length < 2) return null;

    // Что УНИВЕРСАЛЬНО (работает во всех средах)
    const allNormKinds = this.fingerprints.map(fp => fp.norms.map(n => n.kind));
    const universal = allNormKinds[0]?.filter(kind =>
      allNormKinds.every(norms => norms.includes(kind))
    ) || [];

    // Что КОНТЕКСТУАЛЬНО (только в некоторых)
    const allKinds = [...new Set(allNormKinds.flat())];
    const contextual = allKinds.filter(k => !universal.includes(k));

    // Средние метрики
    const avgDepth = {};
    const depthKeys = ['distinction', 'mutuality', 'antifragility', 'crystallization', 'immunity', 'gratitude', 'composite'];
    for (const key of depthKeys) {
      avgDepth[key] = +(this.fingerprints.reduce((s, fp) => s + (fp.depth[key] || 0), 0) / this.fingerprints.length).toFixed(3);
    }

    // Лучшая и худшая среда
    const sorted = [...this.fingerprints].sort((a, b) => b.depth.composite - a.depth.composite);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    // Различение: чем отличается лучшая от худшей
    const distinction = {};
    for (const key of depthKeys) {
      distinction[key] = +(best.depth[key] - worst.depth[key]).toFixed(3);
    }

    this.metaFormula = {
      timestamp: new Date().toISOString(),
      environments: this.fingerprints.length,
      universal: universal.length ? universal : ['(нет универсальных норм)'],
      contextual,
      avgDepth,
      best: { scenario: best.scenarioName, composite: best.depth.composite },
      worst: { scenario: worst.scenarioName, composite: worst.depth.composite },
      distinction,
      verdict: best.depth.composite > 0.5 ? 'Среды углубляются' : 'Среды стагнируют',
    };

    this.emit('meta:done', this.metaFormula);
    return this.metaFormula;
  }

  /**
   * Полный цикл θέωσις: все сценарии → мета-собор
   */
  async run(scenarios = SCENARIOS) {
    this.emit('theosis:start', { scenarios: scenarios.length });

    for (const scenario of scenarios) {
      await this.runScenario(scenario);
    }

    const formula = this.metaSobor();
    this.emit('theosis:done', { fingerprints: this.fingerprints.length, formula });
    return { fingerprints: this.fingerprints, formula };
  }
}

export { takeFingerprint, computeDepth, SCENARIOS };
export default Theosis;
