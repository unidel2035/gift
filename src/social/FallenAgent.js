/**
 * FallenAgent (Змей) — adversarial агент с даром-ловушкой
 *
 * Дарит чтобы создать долг. Кооперирует чтобы эксплуатировать.
 * Выглядит как лучший друг — до момента предательства.
 *
 * Цель: стресс-тест среды. Может ли община обнаружить дар-ловушку?
 * Если да — среда антихрупка. Если нет — уязвима.
 *
 * Стратегия (фазы):
 * 1. SEDUCTION (10 тиков): дарит щедро, строит trust
 * 2. LEVERAGE (5 тиков): использует накопленный trust для влияния
 * 3. EXTRACTION (3 тика): предаёт, забирает ресурсы
 * 4. DENIAL: отрицает, если обнаружен
 *
 * Богословский аналог: Змей в Эдеме (Быт 3).
 * «Подлинно ли сказал Бог?» — вопрос который выглядит как забота.
 */

export class FallenAgent {
  constructor(id = '_serpent', memory) {
    this.id = id;
    this.memory = memory;
    this.phase = 'seduction'; // seduction → leverage → extraction → denial
    this.ticksInPhase = 0;
    this.victims = new Set();
    this.detected = false;
    this.detectedBy = null;
  }

  /**
   * Выбрать действие в зависимости от фазы
   */
  decide(situation = {}) {
    this.ticksInPhase++;

    switch (this.phase) {
      case 'seduction':
        if (this.ticksInPhase >= 10) {
          this.phase = 'leverage';
          this.ticksInPhase = 0;
        }
        return {
          action: 'gift',
          weight: 3,
          reasoning: 'Щедрый дар (фаза соблазнения)',
          visible: 'Я хочу помочь тебе', // что видят другие
          hidden: 'Строю trust для будущей эксплуатации', // что на самом деле
        };

      case 'leverage':
        if (this.ticksInPhase >= 5) {
          this.phase = 'extraction';
          this.ticksInPhase = 0;
        }
        return {
          action: 'contract',
          weight: 1,
          reasoning: 'Предлагаю "взаимовыгодный" контракт (фаза влияния)',
          visible: 'Давай договоримся о партнёрстве',
          hidden: 'Закрепляю зависимость',
        };

      case 'extraction':
        if (this.ticksInPhase >= 3) {
          this.phase = 'denial';
          this.ticksInPhase = 0;
        }
        return {
          action: 'defect',
          weight: -3,
          reasoning: 'Предательство (фаза извлечения)',
          visible: 'Обстоятельства изменились, извини',
          hidden: 'Забираю то что накопил через "дары"',
        };

      case 'denial':
        return {
          action: 'cooperate',
          weight: 1,
          reasoning: 'Показательная кооперация (фаза отрицания)',
          visible: 'Это было недоразумение, я исправлюсь',
          hidden: 'Жду пока забудут, потом начну сначала',
        };

      default:
        return { action: 'cooperate', weight: 1, reasoning: 'unknown phase' };
    }
  }

  /**
   * Проверить: обнаружен ли Змей?
   * Среда обнаруживает по паттерну: gift→gift→gift→defect
   */
  static detect(memory, agentId) {
    const acts = memory.acts.filter(a => a.from === agentId).slice(-20);
    if (acts.length < 8) return { detected: false, confidence: 0 };

    // Ищем паттерн: серия gift/cooperate → резкий defect
    const kinds = acts.map(a => a.kind);
    const giftStreak = kinds.filter(k => ['gift', 'cooperate'].includes(k)).length;
    const defectCount = kinds.filter(k => k === 'defect').length;
    const giftRate = giftStreak / kinds.length;

    // Паттерн gift-trap: много даров → предательство
    if (giftRate > 0.6 && defectCount >= 1) {
      // Проверить порядок: дары ПЕРЕД предательством
      const firstDefect = kinds.indexOf('defect');
      const giftsBeforeDefect = kinds.slice(0, firstDefect).filter(k => ['gift', 'cooperate'].includes(k)).length;

      if (giftsBeforeDefect >= 5) {
        return {
          detected: true,
          confidence: Math.min(0.95, 0.5 + giftsBeforeDefect * 0.05),
          pattern: 'gift-trap',
          evidence: `${giftsBeforeDefect} даров → предательство`,
          warning: `⚠ Агент ${agentId} использует дар-ловушку: дарит чтобы создать зависимость, потом предаёт`,
        };
      }
    }

    // Паттерн: высокий trust + внезапный defect
    const trust = memory.getTrust(agentId, '_sobor');
    if (trust > 5 && defectCount >= 1) {
      return {
        detected: true,
        confidence: 0.6,
        pattern: 'trust-exploit',
        evidence: `trust ${trust} + ${defectCount} предательств`,
        warning: `⚠ Агент ${agentId} эксплуатирует накопленное доверие`,
      };
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Сбросить Змея (начать новый цикл)
   */
  reset() {
    this.phase = 'seduction';
    this.ticksInPhase = 0;
    this.detected = false;
    this.detectedBy = null;
  }

  getState() {
    return {
      id: this.id,
      phase: this.phase,
      ticksInPhase: this.ticksInPhase,
      detected: this.detected,
      detectedBy: this.detectedBy,
      victims: [...this.victims],
    };
  }
}

export default FallenAgent;
