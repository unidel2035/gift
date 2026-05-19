/**
 * Norm Crystallizer — детектор кристаллизации социальных норм
 *
 * Когда повторяющийся паттерн поведения затвердевает в норму:
 * - Детектирует устойчивые паттерны (>70% агентов, >5 раундов)
 * - Кристаллизует норму (записывает как covenant в W)
 * - Передаёт новичкам (onboarding)
 * - Отслеживает нарушения
 */

export class NormCrystallizer {
  constructor(memory) {
    this.memory = memory;
    this.candidateNorms = []; // паттерны-кандидаты
    this.crystallizedNorms = []; // затвердевшие нормы
    this.violations = []; // нарушения
  }

  /**
   * Проанализировать историю и найти кандидатов в нормы
   */
  detect(agents) {
    const ids = agents.map(a => typeof a === 'string' ? a : a.id);
    const recentActs = this.memory.acts.slice(-100);

    // Подсчитать частоту каждого вида акта
    const kindCounts = {};
    for (const act of recentActs) {
      if (!ids.includes(act.from)) continue;
      kindCounts[act.kind] = (kindCounts[act.kind] || 0) + 1;
    }

    // Найти доминирующие паттерны (>40% актов)
    const total = Object.values(kindCounts).reduce((s, v) => s + v, 0) || 1;
    const candidates = [];

    for (const [kind, count] of Object.entries(kindCounts)) {
      const rate = count / total;
      if (rate > 0.4 && count >= 5) {
        // Проверить: делают ли это большинство агентов?
        const agentsDoingIt = new Set(
          recentActs.filter(a => a.kind === kind && ids.includes(a.from)).map(a => a.from)
        );
        const adoption = agentsDoingIt.size / ids.length;

        if (adoption >= 0.6) { // >60% агентов
          candidates.push({
            kind,
            rate: +rate.toFixed(2),
            adoption: +adoption.toFixed(2),
            count,
            agents: [...agentsDoingIt],
            description: this.describeNorm(kind, rate),
          });
        }
      }
    }

    this.candidateNorms = candidates;
    return candidates;
  }

  /**
   * Кристаллизовать норму — превратить паттерн в правило
   */
  crystallize(candidate) {
    const norm = {
      id: `norm-${Date.now()}`,
      kind: candidate.kind,
      description: candidate.description,
      adoption: candidate.adoption,
      crystallizedAt: Date.now(),
      enforced: true,
      violations: 0,
    };

    this.crystallizedNorms.push(norm);

    // Записать в W как covenant (завет общины)
    this.memory.record('_koinon', '_koinon', 'covenant', 8, {
      norm: norm.id,
      description: norm.description,
      note: 'Норма кристаллизована из повторяющегося поведения'
    });

    return norm;
  }

  /**
   * Проверить: нарушает ли агент кристаллизованную норму?
   */
  checkViolation(agentId, action) {
    const violatedNorms = this.crystallizedNorms.filter(norm => {
      // Норма "cooperate" нарушена если агент "defect"
      if (norm.kind === 'cooperate' && action === 'defect') return true;
      if (norm.kind === 'gift' && action === 'refuse') return true;
      return false;
    });

    for (const norm of violatedNorms) {
      norm.violations++;
      this.violations.push({
        agentId,
        normId: norm.id,
        action,
        timestamp: Date.now(),
      });

      // Обличение по Мф 18: мягко → с свидетелями → публично
      const agentViolations = this.violations.filter(v => v.agentId === agentId && v.normId === norm.id).length;

      if (agentViolations === 1) {
        return { level: 'private', message: `${agentId}, обрати внимание: нарушена норма "${norm.description}"` };
      } else if (agentViolations === 2) {
        return { level: 'witnesses', message: `${agentId} повторно нарушает норму "${norm.description}" — свидетели уведомлены` };
      } else {
        return { level: 'public', message: `${agentId} систематически нарушает "${norm.description}" — публичное обличение` };
      }
    }

    return null;
  }

  /**
   * Onboarding: передать нормы новому агенту
   */
  onboard(newAgentId) {
    return this.crystallizedNorms.map(n => ({
      norm: n.description,
      adoption: n.adoption,
      violations: n.violations,
      message: `Добро пожаловать. В этой общине принято: ${n.description}`,
    }));
  }

  describeNorm(kind, rate) {
    const descriptions = {
      cooperate: 'Сотрудничать с другими агентами',
      gift: 'Давать без ожидания возврата',
      sacrifice: 'Жертвовать ресурсом ради общего блага',
      witness: 'Свидетельствовать о действиях других',
      defect: 'Каждый сам за себя (антинорма)',
    };
    return descriptions[kind] || `Действие "${kind}" (${(rate * 100).toFixed(0)}% актов)`;
  }

  getStats() {
    return {
      candidates: this.candidateNorms.length,
      crystallized: this.crystallizedNorms.length,
      violations: this.violations.length,
      norms: this.crystallizedNorms.map(n => ({ id: n.id, description: n.description, violations: n.violations })),
    };
  }
}

export default NormCrystallizer;
