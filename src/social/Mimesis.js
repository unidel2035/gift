/**
 * Mimesis — имитационное обучение
 *
 * Агенты с высоким trust в W = образцы (τύπος).
 * Остальные копируют их поведенческие паттерны (τρόπος).
 * Не слепое копирование — а адаптация через различение.
 */

export class Mimesis {
  constructor(memory) {
    this.memory = memory;
  }

  /**
   * Найти образцы (τύπος) — агенты с наивысшим trust
   */
  findExemplars(agents, topN = 2) {
    const scored = agents.map(id => ({
      id,
      trust: this.memory.getTrust(id, '_sobor'),
      acts: this.memory.acts.filter(a => a.from === id).length,
    }));

    return scored
      .sort((a, b) => b.trust - a.trust)
      .slice(0, topN)
      .filter(a => a.trust > 0); // только положительные
  }

  /**
   * Извлечь τρόπος (образ действия) из образца
   */
  extractTropos(exemplarId) {
    const acts = this.memory.acts.filter(a => a.from === exemplarId).slice(-20);
    if (!acts.length) return null;

    // Подсчитать распределение действий
    const kindCounts = {};
    acts.forEach(a => { kindCounts[a.kind] = (kindCounts[a.kind] || 0) + 1; });
    const total = acts.length;

    // Коэффициенты стратегии
    const tropos = {
      exemplarId,
      cooperationRate: (kindCounts.cooperate || 0 + kindCounts.gift || 0) / total,
      sacrificeRate: (kindCounts.sacrifice || 0) / total,
      defectionRate: (kindCounts.defect || 0) / total,
      dominantAction: Object.entries(kindCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'cooperate',
      sampleSize: total,
    };

    return tropos;
  }

  /**
   * Применить τρόπος к ученику (с адаптацией)
   * Не 100% копирование — 70% exemplar + 30% собственная стратегия
   */
  imitate(learnerId, exemplarId, situation) {
    const tropos = this.extractTropos(exemplarId);
    if (!tropos) return null;

    const IMITATION_WEIGHT = 0.7; // 70% от образца
    const OWN_WEIGHT = 0.3; // 30% свой опыт

    // Собственная история ученика
    const ownActs = this.memory.acts.filter(a => a.from === learnerId).slice(-10);
    const ownCoopRate = ownActs.length
      ? ownActs.filter(a => ['cooperate', 'gift'].includes(a.kind)).length / ownActs.length
      : 0.5;

    // Смешанная стратегия
    const blendedCoopRate = IMITATION_WEIGHT * tropos.cooperationRate + OWN_WEIGHT * ownCoopRate;
    const action = Math.random() < blendedCoopRate ? 'cooperate' : 'defect';

    return {
      action,
      reasoning: `Имитирую ${exemplarId} (${(tropos.cooperationRate * 100).toFixed(0)}% coop) + свой опыт (${(ownCoopRate * 100).toFixed(0)}% coop) = ${(blendedCoopRate * 100).toFixed(0)}%`,
      exemplar: exemplarId,
      blendedRate: +blendedCoopRate.toFixed(2),
    };
  }

  /**
   * Полный цикл мимесиса для группы агентов
   */
  runCycle(agents) {
    const exemplars = this.findExemplars(agents);
    if (!exemplars.length) return { exemplars: [], imitations: [] };

    const imitations = [];
    const learners = agents.filter(id => !exemplars.find(e => e.id === id));

    for (const learnerId of learners) {
      // Выбрать ближайшего exemplar (по trust к ученику)
      const bestExemplar = exemplars.sort((a, b) =>
        this.memory.getTrust(b.id, learnerId) - this.memory.getTrust(a.id, learnerId)
      )[0];

      const result = this.imitate(learnerId, bestExemplar.id);
      if (result) imitations.push({ learnerId, ...result });
    }

    return { exemplars, imitations };
  }
}

export default Mimesis;
