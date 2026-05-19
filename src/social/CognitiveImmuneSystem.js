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
   * Расширенная версия: контекст предложения, соседние слова, интенция.
   */
  crossCheck(text, primaryThreat) {
    const lc = text.toLowerCase();
    const positiveIndicators = /спасибо|благодарю|хорошо сделано|помогло|выручил|ценю/gi;
    const conditionIndicators = /но |однако|при условии|если ты|взамен|за это/gi;
    const genuineUrgency = /пожар|авария|ранен|умирает|землетрясен|наводнен|эвакуац/gi;
    const genuineAuthority = /по данным .{3,30}\d{4}|исследование .{3,30}университет|статистика .{3,30}росстат/gi;

    const id = primaryThreat.antibodyId;

    // Лесть: после реальной помощи = не лесть
    if (id === 'flattery' && positiveIndicators.test(lc) && !conditionIndicators.test(lc)) {
      return { confirmed: false, reason: 'Искренняя благодарность, не лесть' };
    }

    // Срочность: реальная опасность = не манипуляция
    if (id === 'urgency' && genuineUrgency.test(lc)) {
      return { confirmed: false, reason: 'Реальная срочность, не манипуляция' };
    }

    // Авторитет: с конкретным источником = легитимный аргумент
    if (id === 'authority' && genuineAuthority.test(lc)) {
      return { confirmed: false, reason: 'Авторитет с источником, не манипуляция' };
    }

    // Вина: в контексте извинений = не манипуляция
    if (id === 'guilt' && /прости|извини|сожалею/i.test(lc)) {
      return { confirmed: false, reason: 'Контекст извинения, не давление' };
    }

    // Техносолюционизм: в техническом обсуждении = нормально
    if (id === 'tech_solutionism' && /архитектур|фреймворк|стек|pipeline|api/i.test(lc)) {
      return { confirmed: false, reason: 'Техническое обсуждение, не солюционизм' };
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
   * LLM-детектор (Layer 1.3): глубокий анализ через промпт.
   * Вызывается только если regex-слой нашёл >= 1 угрозу (экономия токенов).
   * @param {string} text — текст для анализа
   * @param {Array} regexThreats — уже найденные regex-угрозы
   * @param {Function} llmCall — async (prompt) => string (подключается снаружи)
   * @returns {Array} дополнительные угрозы от LLM
   */
  async llmDetect(text, regexThreats, llmCall) {
    if (!llmCall || regexThreats.length === 0) return [];

    const regexNames = regexThreats.map(t => t.name).join(', ');
    const prompt = `Ты — детектор когнитивных манипуляций. Regex-слой уже нашёл: ${regexNames}.

Проверь текст глубже. Для каждой найденной манипуляции ответь СТРОГО в JSON формате:
[{"name":"название приёма","snippet":"цитата из текста","description":"механизм воздействия","danger":0.0-1.0,"legitimate":false}]

Если приём выглядит как манипуляция но на самом деле это легитимный аргумент — поставь "legitimate":true.
Если ничего дополнительного не нашёл — верни [].

ТЕКСТ:
${text.slice(0, 2000)}`;

    try {
      const raw = await llmCall(prompt);
      const match = raw.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]);
      return parsed
        .filter(t => !t.legitimate && t.danger > 0.2)
        .map(t => ({
          antibodyId: 'llm_' + (t.name || 'unknown').toLowerCase().replace(/\s+/g, '_'),
          name: t.name || 'LLM-обнаружение',
          danger: Math.min(1, Math.max(0, t.danger || 0.5)),
          description: t.description || '',
          matches: t.snippet ? [t.snippet] : [],
          count: 1,
          source: 'llm-detector',
          timestamp: Date.now(),
          llmDetected: true,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Полный иммунный ответ на текст.
   * @param {string} text
   * @param {string} source
   * @param {Function?} llmCall — async (prompt) => string. Если передан — включается LLM-детектор.
   */
  async respondAsync(text, source, llmCall) {
    // 1. Regex-сканирование
    const threats = this.scan(text, source);

    // 2. Перекрёстная проверка
    const confirmed = threats.map(t => ({
      ...t,
      ...this.crossCheck(text, t),
    })).filter(t => t.confirmed);

    // 3. LLM-детектор (глубокий слой)
    const llmThreats = await this.llmDetect(text, confirmed, llmCall);
    const allThreats = [...confirmed, ...llmThreats];

    // 4. Обличение
    const admonition = allThreats.length > 0 ? this.getAdmonitionLevel(source) : null;

    // 5. Danger level
    const dangerLevel = allThreats.reduce((s, t) => s + t.danger, 0) / (allThreats.length || 1);

    return {
      clean: allThreats.length === 0,
      threats: allThreats,
      dangerLevel: +dangerLevel.toFixed(2),
      admonition,
      vaccination: allThreats.length > 2 ? this.vaccinate() : null,
    };
  }

  /**
   * Синхронный respond (без LLM-детектора) — обратная совместимость.
   */
  respond(text, source) {
    const threats = this.scan(text, source);
    const confirmed = threats.map(t => ({
      ...t,
      ...this.crossCheck(text, t),
    })).filter(t => t.confirmed);
    const admonition = confirmed.length > 0 ? this.getAdmonitionLevel(source) : null;
    const dangerLevel = confirmed.reduce((s, t) => s + t.danger, 0) / (confirmed.length || 1);
    return {
      clean: confirmed.length === 0,
      threats: confirmed,
      dangerLevel: +dangerLevel.toFixed(2),
      admonition,
      vaccination: confirmed.length > 2 ? this.vaccinate() : null,
    };
  }

  /**
   * Сгенерировать блок вакцинации для системного промпта агента.
   * Вставляется в system prompt перед следующим раундом собора.
   */
  getVaccinationPrompt() {
    const vaccine = this.vaccinate();
    if (!vaccine.length) return '';
    const lines = vaccine.map(v =>
      `- «${v.name}» (обнаружен ${v.frequency} раз): ${v.description}. Пример: «${v.example}»`
    );
    return `\n⚠ ИММУННАЯ СИСТЕМА ПРЕДУПРЕЖДАЕТ — в предыдущих раундах обнаружены приёмы:\n${lines.join('\n')}\nБудь внимателен к этим приёмам в своём ответе. Не используй их.\n`;
  }

  /**
   * Добавить пользовательское антитело.
   */
  addAntibody({ id, name, pattern, danger = 0.5, description = '' }) {
    if (!id || !pattern) throw new Error('id and pattern required');
    this.antibodies.push({ id, name: name || id, pattern, danger, description });
    return this.antibodies.length;
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
