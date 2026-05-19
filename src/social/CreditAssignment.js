/**
 * Credit Assignment — чей конкретно дар привёл к успеху?
 *
 * Декомпозиция коллективного вознаграждения на индивидуальные вклады.
 * Shapley-подобная атрибуция через историю актов в W.
 */

export class CreditAssignment {
  constructor(memory) {
    this.memory = memory;
  }

  /**
   * Вычислить вклад каждого агента в коллективный исход
   * @param {string[]} agents - участники
   * @param {number} collectiveReward - общий результат
   * @param {string} context - контекст (dilemma id, sobor id)
   * @returns {Object} { agentId: { credit, share, reasoning } }
   */
  assign(agents, collectiveReward, context = '') {
    const contributions = {};
    let totalWeight = 0;

    for (const agentId of agents) {
      // Вклад = сумма положительных актов в этом контексте
      const acts = this.memory.acts.filter(a =>
        a.from === agentId &&
        (context ? JSON.stringify(a.context || '').includes(context) : true)
      );

      const positive = acts
        .filter(a => ['gift', 'cooperate', 'witness', 'sacrifice', 'eucharistia'].includes(a.kind))
        .reduce((s, a) => s + Math.abs(a.weight), 0);

      const negative = acts
        .filter(a => ['defect', 'manipulation', 'decline'].includes(a.kind))
        .reduce((s, a) => s + Math.abs(a.weight), 0);

      // Shapley-like: marginal contribution
      const marginal = positive - negative * 2;
      contributions[agentId] = { raw: marginal, acts: acts.length };
      totalWeight += Math.max(0, marginal);
    }

    // Нормализация
    const result = {};
    for (const agentId of agents) {
      const raw = contributions[agentId].raw;
      const share = totalWeight > 0 ? Math.max(0, raw) / totalWeight : 1 / agents.length;
      const credit = collectiveReward * share;

      result[agentId] = {
        credit: +credit.toFixed(2),
        share: +(share * 100).toFixed(1),
        raw: +raw.toFixed(2),
        acts: contributions[agentId].acts,
        reasoning: raw > 5 ? 'существенный вклад' : raw > 0 ? 'умеренный вклад' : raw === 0 ? 'нет вклада' : 'отрицательный вклад',
      };
    }

    return result;
  }

  /**
   * Трассировка: какой конкретный акт привёл к росту ontologicalScore
   */
  traceImpact(agentId, beforeScore, afterScore) {
    const delta = afterScore - beforeScore;
    const recentActs = this.memory.acts
      .filter(a => a.from === agentId)
      .slice(-5);

    return {
      agentId,
      delta: +delta.toFixed(3),
      causalActs: recentActs.map(a => ({
        kind: a.kind,
        weight: a.weight,
        to: a.to,
        impact: a.weight > 0 ? 'positive' : 'negative',
      })),
    };
  }
}

export default CreditAssignment;
