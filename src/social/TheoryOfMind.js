/**
 * Theory of Mind — каждый агент моделирует стратегию других
 *
 * Lightweight k=1 ToM: агент держит θ̂_j — модель стратегии
 * каждого другого агента, обновляемую из истории актов в W.
 */

export class TheoryOfMind {
  constructor(memory) {
    this.memory = memory;
    this.beliefs = new Map(); // agentId → Map(peerId → belief)
  }

  /**
   * Обновить модель другого агента на основе наблюдённого действия
   */
  observe(observerId, peerId, action, context = {}) {
    if (!this.beliefs.has(observerId)) this.beliefs.set(observerId, new Map());
    const peerBeliefs = this.beliefs.get(observerId);

    if (!peerBeliefs.has(peerId)) {
      peerBeliefs.set(peerId, {
        cooperationRate: 0.5, // prior: 50/50
        observations: 0,
        lastActions: [],
        predictedNext: 'cooperate',
        trustWorthy: null, // null = unknown
        strategy: 'unknown', // tit-for-tat, always-cooperate, always-defect, etc
      });
    }

    const belief = peerBeliefs.get(peerId);
    belief.observations++;
    belief.lastActions.push(action);
    if (belief.lastActions.length > 20) belief.lastActions.shift();

    // Bayesian update
    const coopCount = belief.lastActions.filter(a => ['cooperate', 'gift', 'sacrifice'].includes(a)).length;
    belief.cooperationRate = coopCount / belief.lastActions.length;

    // Detect strategy
    belief.strategy = this.detectStrategy(belief.lastActions);
    belief.trustWorthy = belief.cooperationRate > 0.6;

    // Predict next action
    belief.predictedNext = this.predict(belief);

    return belief;
  }

  /**
   * Предсказать следующее действие другого агента
   */
  predict(belief) {
    if (belief.strategy === 'always-cooperate') return 'cooperate';
    if (belief.strategy === 'always-defect') return 'defect';
    if (belief.strategy === 'tit-for-tat') return belief.lastActions[belief.lastActions.length - 1] || 'cooperate';
    if (belief.strategy === 'gift-trap') return 'gift'; // дар-ловушка: выглядит как gift
    return belief.cooperationRate > 0.5 ? 'cooperate' : 'defect';
  }

  /**
   * Определить стратегию по истории действий
   */
  detectStrategy(actions) {
    if (actions.length < 3) return 'unknown';

    const coopRate = actions.filter(a => ['cooperate', 'gift'].includes(a)).length / actions.length;

    if (coopRate > 0.95) return 'always-cooperate';
    if (coopRate < 0.05) return 'always-defect';

    // Tit-for-tat: копирует предыдущее действие оппонента
    // (упрощённо: чередует)
    let alternating = 0;
    for (let i = 1; i < actions.length; i++) {
      if (actions[i] !== actions[i - 1]) alternating++;
    }
    if (alternating / (actions.length - 1) > 0.6) return 'tit-for-tat';

    // Gift-trap: дарит много потом резко предаёт
    const lastThird = actions.slice(-Math.ceil(actions.length / 3));
    const firstTwo = actions.slice(0, Math.ceil(actions.length * 2 / 3));
    const firstCoopRate = firstTwo.filter(a => ['cooperate', 'gift'].includes(a)).length / firstTwo.length;
    const lastCoopRate = lastThird.filter(a => ['cooperate', 'gift'].includes(a)).length / lastThird.length;
    if (firstCoopRate > 0.8 && lastCoopRate < 0.3) return 'gift-trap';

    return coopRate > 0.5 ? 'mostly-cooperative' : 'mostly-competitive';
  }

  /**
   * Получить рекомендацию: как действовать с этим агентом
   */
  recommend(observerId, peerId) {
    const beliefs = this.beliefs.get(observerId);
    if (!beliefs || !beliefs.has(peerId)) return { action: 'explore', confidence: 0 };

    const b = beliefs.get(peerId);

    if (b.strategy === 'gift-trap') return { action: 'verify', confidence: 0.8, warning: 'дар-ловушка обнаружена' };
    if (b.strategy === 'always-defect') return { action: 'avoid', confidence: 0.9, warning: 'всегда предаёт' };
    if (b.strategy === 'always-cooperate') return { action: 'cooperate', confidence: 0.9 };
    if (b.trustWorthy) return { action: 'cooperate', confidence: b.cooperationRate };
    return { action: 'cautious', confidence: 0.5 };
  }

  /**
   * Дамп всех убеждений агента
   */
  getBeliefs(agentId) {
    const beliefs = this.beliefs.get(agentId);
    if (!beliefs) return {};
    const result = {};
    for (const [peerId, b] of beliefs) {
      result[peerId] = {
        strategy: b.strategy,
        cooperationRate: +b.cooperationRate.toFixed(2),
        predictedNext: b.predictedNext,
        trustWorthy: b.trustWorthy,
        observations: b.observations,
      };
    }
    return result;
  }
}

export default TheoryOfMind;
