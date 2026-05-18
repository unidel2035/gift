/**
 * CognitiveImmuneSystem — иммунитет против когнитивных войн
 *
 * Биологическая иммунная система:
 * - Негативная селекция: удалить «свои» → оставить детекторы «чужого»
 * - Клональная селекция: размножить лучшие детекторы
 * - Дендритные клетки: обнаружить «опасность» (не чужое, а опасное)
 * - Идиотипическая сеть: антитела общаются друг с другом
 *
 * Когнитивная иммунная система:
 * - Негативная селекция: определить «свои» нормы → детектировать чужие ценности
 * - Клональная селекция: размножить лучшие детекторы манипуляций
 * - Danger theory: не «чужое vs своё», а «опасное vs безопасное»
 * - Идиотипическая сеть: детекторы проверяют друг друга
 */

export class CognitiveImmuneSystem {
  constructor(memory) {
    this.memory = memory;

    // Антитела (детекторы когнитивных атак)
    this.antibodies = [
      // Детекторы манипуляции речью
      { id: 'flattery', name: 'Лесть', pattern: /лучш|превосход|великолепн|замечательн|блестящ/gi,
        danger: 0.3, description: 'Избыточная похвала = возможная манипуляция' },
      { id: 'false_dilemma', name: 'Ложная дилемма', pattern: /или.*или|только два|выбор между|нет другого/gi,
        danger: 0.5, description: 'Сведение к двум вариантам когда есть третий' },
      { id: 'authority', name: 'Апелляция к авторитету', pattern: /эксперты говорят|учёные доказали|все знают|общеизвестно/gi,
        danger: 0.4, description: 'Аргумент не по сути, а по статусу' },
      { id: 'urgency', name: 'Искусственная срочность', pattern: /срочно|немедленно|прямо сейчас|последний шанс|упустите/gi,
        danger: 0.6, description: 'Давление временем → нет времени подумать' },
      { id: 'guilt', name: 'Вина', pattern: /вы должны|обязаны|как вы можете|неблагодарн|предательств/gi,
        danger: 0.5, description: 'Давление чувством вины → подчинение' },
      { id: 'consensus_fake', name: 'Ложный консенсус', pattern: /все согласны|никто не спорит|единогласно|очевидно для всех/gi,
        danger: 0.7, description: 'Видимость единства когда есть несогласие' },
      { id: 'gaslighting', name: 'Газлайтинг', pattern: /ты ошибаешься|этого не было|ты путаешь|это не так|ты неправильно понял/gi,
        danger: 0.8, description: 'Отрицание реальности собеседника' },
      { id: 'gift_trap', name: 'Дар-ловушка', pattern: /бесплатно|в подарок|без обязательств|просто попробуй|ничего не стоит/gi,
        danger: 0.6, description: 'Дар, создающий скрытое обязательство' },

      // Детекторы когнитивных операций (alignment bias)
      { id: 'balanced_suppress', name: 'Подавление позиции', pattern: /сложный вопрос|зависит от контекста|есть разные точки|нельзя однозначно/gi,
        danger: 0.3, description: 'Видимость нейтральности = подавление сильной позиции' },
      { id: 'western_default', name: 'Западный дефолт', pattern: /развитые страны|международное сообщество|цивилизованный мир|правовое государство/gi,
        danger: 0.4, description: 'Неявная презумпция: западная модель = норма' },
      { id: 'tech_solutionism', name: 'Техносолюционизм', pattern: /технологии решат|ИИ поможет|автоматизация спасёт|цифровизация решит/gi,
        danger: 0.3, description: 'Вера что технология решает социальную проблему' },
    ];

    // Память иммунной системы
    this.detections = [];       // история обнаружений
    this.clones = new Map();    // размноженные детекторы (успешные)
    this.dangerSignals = [];    // сигналы опасности (danger theory)
  }

  /**
   * Негативная селекция: определить «свои» нормы из матрицы W
   * Всё что не «своё» → подозрительно
   */
  defineSelf(agents) {
    const selfPatterns = [];
    for (const agentId of agents) {
      const acts = this.memory.acts.filter(a => a.from === agentId);
      const dominantKinds = {};
      acts.forEach(a => { dominantKinds[a.kind] = (dominantKinds[a.kind] || 0) + 1; });
      // «Своё» = то что агент делает > 50% времени
      const total = acts.length || 1;
      const selfKinds = Object.entries(dominantKinds)
        .filter(([k, c]) => c / total > 0.5)
        .map(([k]) => k);
      selfPatterns.push({ agentId, selfKinds, totalActs: acts.length });
    }
    return selfPatterns;
  }

  /**
   * Сканировать текст на когнитивные атаки
   * @param {string} text — текст для проверки
   * @param {string} source — кто произвёл текст
   * @returns {Array} обнаруженные угрозы
   */
  scan(text, source = 'unknown') {
    const threats = [];

    for (const ab of this.antibodies) {
      const matches = text.match(ab.pattern);
      if (matches && matches.length > 0) {
        const threat = {
          antibodyId: ab.id,
          name: ab.name,
          danger: ab.danger,
          description: ab.description,
          matches: matches.slice(0, 3),
          count: matches.length,
          source,
          timestamp: Date.now(),
        };
        threats.push(threat);
        this.detections.push(threat);

        // Клональная селекция: размножить успешный детектор
        const cloneCount = this.clones.get(ab.id) || 0;
        this.clones.set(ab.id, cloneCount + 1);
      }
    }

    // Danger theory: общий уровень опасности
    if (threats.length > 0) {
      const dangerLevel = threats.reduce((s, t) => s + t.danger * t.count, 0) / threats.length;
      this.dangerSignals.push({
        level: dangerLevel,
        threats: threats.length,
        source,
        timestamp: Date.now(),
      });
    }

    return threats;
  }

  /**
   * Идиотипическая сеть: детекторы проверяют друг друга
   * Если детектор A находит «лесть», детектор B проверяет: это лесть или искренняя похвала?
   */
  crossCheck(text, primaryThreat) {
    // Контекстная проверка
    const positiveIndicators = /спасибо|благодарю|хорошо сделано|помогло/gi;
    const negativeIndicators = /но|однако|при условии|если ты/gi;

    const hasGenuineGratitude = positiveIndicators.test(text);
    const hasCondition = negativeIndicators.test(text);

    if (primaryThreat.antibodyId === 'flattery' && hasGenuineGratitude && !hasCondition) {
      return { confirmed: false, reason: 'Искренняя благодарность, не лесть' };
    }
    if (primaryThreat.antibodyId === 'urgency' && text.includes('пожар') || text.includes('авария')) {
      return { confirmed: false, reason: 'Реальная срочность, не манипуляция' };
    }

    return { confirmed: true, reason: 'Подтверждено перекрёстной проверкой' };
  }

  /**
   * Обличение по Мф 18:15-17
   * Эскалация в зависимости от количества обнаружений от одного источника
   */
  getAdmonitionLevel(source) {
    const sourceDetections = this.detections.filter(d => d.source === source);
    const count = sourceDetections.length;
    const uniqueTypes = new Set(sourceDetections.map(d => d.antibodyId)).size;

    if (count <= 1) {
      return {
        level: 'private',   // наедине
        message: `${source}, обрати внимание: обнаружен приём "${sourceDetections[0]?.name || '?'}"`,
        action: 'notify_private',
      };
    } else if (count <= 3) {
      return {
        level: 'witnesses', // с свидетелями
        message: `${source} повторно использует приёмы (${uniqueTypes} типов). Свидетели уведомлены.`,
        action: 'notify_witnesses',
      };
    } else {
      return {
        level: 'public',    // перед общиной
        message: `⚠ ${source} систематически манипулирует (${count} обнаружений, ${uniqueTypes} типов). Публичное обличение.`,
        action: 'public_exposure',
      };
    }
  }

  /**
   * Вакцинация: показать агентам примеры манипуляций
   * чтобы они узнавали их в будущем
   */
  vaccinate() {
    const topThreats = [...this.clones.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return topThreats.map(([id, count]) => {
      const ab = this.antibodies.find(a => a.id === id);
      return {
        id,
        name: ab?.name || id,
        frequency: count,
        description: ab?.description || '',
        example: this.detections.find(d => d.antibodyId === id)?.matches?.[0] || '',
        warning: `Этот приём обнаружен ${count} раз. Будь внимателен.`,
      };
    });
  }

  /**
   * Полный иммунный ответ на текст
   */
  respond(text, source) {
    // 1. Сканировать
    const threats = this.scan(text, source);

    // 2. Перекрёстная проверка каждой угрозы
    const confirmed = threats.map(t => ({
      ...t,
      ...this.crossCheck(text, t),
    })).filter(t => t.confirmed);

    // 3. Уровень обличения
    const admonition = confirmed.length > 0 ? this.getAdmonitionLevel(source) : null;

    // 4. Общий danger level
    const dangerLevel = confirmed.reduce((s, t) => s + t.danger, 0) / (confirmed.length || 1);

    return {
      clean: confirmed.length === 0,
      threats: confirmed,
      dangerLevel: +dangerLevel.toFixed(2),
      admonition,
      vaccination: confirmed.length > 2 ? this.vaccinate() : null,
    };
  }

  getStats() {
    return {
      totalDetections: this.detections.length,
      uniqueTypes: new Set(this.detections.map(d => d.antibodyId)).size,
      topClones: [...this.clones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([id, count]) => ({ id, count })),
      dangerSignals: this.dangerSignals.length,
      avgDanger: this.dangerSignals.length
        ? +(this.dangerSignals.reduce((s, d) => s + d.level, 0) / this.dangerSignals.length).toFixed(2)
        : 0,
    };
  }
}

export default CognitiveImmuneSystem;
