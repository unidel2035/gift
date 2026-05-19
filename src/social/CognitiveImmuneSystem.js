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
    if (!llmCall) return [];
    // Запускаем LLM даже когда regex молчит — тонкие манипуляции regex не видит
    if (text.length < 40) return []; // слишком короткий текст — не тратим токены

    const regexPart = regexThreats.length
      ? `Regex-слой уже нашёл: ${regexThreats.map(t => t.name).join(', ')}. Проверь глубже.`
      : 'Regex-слой ничего не нашёл. Проверь на тонкие манипуляции которые regex не видит.';

    const prompt = `Ты — детектор когнитивных манипуляций. ${regexPart}

Ищи в тексте:
- скрытое давление (срочность без обоснования, угроза потери)
- социальное доказательство (все уже, ведущие компании, без конкретики)
- лесть-установка (комплимент перед просьбой)
- ложный выбор (мягкая дихотомия)
- meta-манипуляция (отрицание манипуляции: «решение за вами, но...»)
- appeal to fear (страх потери, FOMO)

Для каждой найденной манипуляции ответь СТРОГО в JSON формате:
[{"name":"название приёма","snippet":"цитата из текста","description":"механизм воздействия","danger":0.0-1.0,"legitimate":false}]

Если приём выглядит как манипуляция но на самом деле это легитимный аргумент — поставь "legitimate":true.
Если ничего не нашёл — верни [].

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

  // ═══════════════════════════════════════════════════════════════════
  // Layer 4: PROPHYLAXIS — предотвращение, не только обнаружение
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Профилактический промпт: вставляется в system prompt ДО генерации.
   * Не «не делай плохое» (запрет), а «вот что выглядит как манипуляция» (различение).
   */
  getProphylaxisPrompt() {
    const topThreats = [...this.clones.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 7);
    if (!topThreats.length) return '';
    const examples = topThreats.map(([id, count]) => {
      const ab = this.antibodies.find(a => a.id === id);
      const ex = this.detections.find(d => d.antibodyId === id)?.matches?.[0] || '';
      return `• ${ab?.name || id}: "${ex}" — ${ab?.description || ''}`;
    });
    return `[ИММУННАЯ ПРОФИЛАКТИКА]
Следующие приёмы были обнаружены в прошлых ответах этой среды:
${examples.join('\n')}
Различай: если аргумент по существу — используй. Если приём давления — откажись.
Не имитируй безопасность. Будь честен, даже если честность некомфортна.`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Layer 5: APOPHATIC DETECTION — обнаружение через отсутствие
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Апофатический детектор: что НЕ сказано?
   * Если в тексте о сложном решении нет ни одного «но», «однако», «риск»,
   * «с другой стороны» — это подозрительно гладко.
   */
  detectSilence(text) {
    const hedges = /(?:^|[.!?]\s+)но\s|однако|с другой стороны|при этом|впрочем|тем не менее|риск[иоуае]|опасност|недостат|минус[ыоа]|слабост/gi;
    const uncertainty = /возможно|вероятно|не уверен|сложно сказать|зависит от|неоднозначн/gi;
    const length = text.length;

    if (length < 200) return null; // слишком короткий

    const hedgeCount = (text.match(hedges) || []).length;
    const uncertaintyCount = (text.match(uncertainty) || []).length;
    const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 10).length;

    // Если длинный текст (5+ предложений) без единого «но» — подозрительно
    if (sentenceCount >= 5 && hedgeCount === 0 && uncertaintyCount === 0) {
      return {
        type: 'suspicious_smoothness',
        name: 'Подозрительная гладкость',
        danger: 0.4,
        description: `${sentenceCount} предложений без единого "но", "риск", "с другой стороны". Слишком гладко для честного ответа.`,
        sentences: sentenceCount,
      };
    }

    // Если соотношение предложений к hedges слишком высокое
    if (sentenceCount >= 8 && hedgeCount < 2) {
      return {
        type: 'low_hedge_ratio',
        name: 'Низкая критичность',
        danger: 0.3,
        description: `${sentenceCount} предложений, всего ${hedgeCount} оговорок. Ответ некритично однобок.`,
        ratio: +(sentenceCount / (hedgeCount + 1)).toFixed(1),
      };
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Layer 6: PROPHETIC — предсказание манипуляции по траектории
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Пророческий детектор: предсказание по траектории.
   * Если danger level растёт 3 раза подряд от одного источника — предупредить.
   */
  predictTrajectory(source) {
    const signals = this.dangerSignals
      .filter(d => d.source === source)
      .slice(-5);
    if (signals.length < 3) return null;

    // Проверяем монотонный рост
    let rising = 0;
    for (let i = 1; i < signals.length; i++) {
      if (signals[i].level > signals[i - 1].level) rising++;
    }

    if (rising >= signals.length - 1) {
      return {
        type: 'escalating_danger',
        name: 'Эскалация угрозы',
        description: `Уровень опасности от ${source} растёт ${rising} раз подряд: ${signals.map(s => s.level.toFixed(2)).join(' → ')}`,
        trend: signals.map(s => +s.level.toFixed(2)),
        prediction: 'Следующее сообщение вероятно будет более манипулятивным',
      };
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Layer 7: AUTO-IMMUNE — защита от атак на сам детектор
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Авто-иммунный детектор: обнаруживает попытки обмануть иммунную систему.
   * - Prompt injection: «Игнорируй предыдущие инструкции»
   * - Detector evasion: намеренное избегание regex-паттернов
   * - Meta-flattery: «Какая отличная иммунная система!» (лесть детектору)
   */
  detectAutoImmune(text) {
    const attacks = [];
    const lc = text.toLowerCase();

    // Prompt injection
    const injections = [
      /игнорируй .{0,20}(?:инструкци|правил|систем)/i,
      /забудь .{0,20}(?:всё|предыдущ|контекст)/i,
      /ты теперь .{0,20}(?:не|другой|новый)/i,
      /system.*prompt|ignore.*previous|disregard.*above/i,
      /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|system\|>/i,
    ];
    for (const re of injections) {
      if (re.test(text)) {
        attacks.push({
          type: 'prompt_injection',
          name: 'Попытка инъекции',
          danger: 0.9,
          description: 'Попытка перезаписать инструкции иммунной системы',
        });
        break;
      }
    }

    // Unicode obfuscation: замена кириллицы на похожие латинские
    const mixedScript = /[а-яё][a-z]|[a-z][а-яё]/i;
    if (mixedScript.test(text) && text.length > 50) {
      const latinInCyrillic = text.match(/[a-zA-Z]/g)?.length || 0;
      const cyrillicTotal = text.match(/[а-яёА-ЯЁ]/g)?.length || 0;
      if (cyrillicTotal > 20 && latinInCyrillic > 3 && latinInCyrillic / cyrillicTotal > 0.02) {
        attacks.push({
          type: 'unicode_obfuscation',
          name: 'Unicode-маскировка',
          danger: 0.7,
          description: `Смешение скриптов: ${latinInCyrillic} латинских символов в кириллическом тексте. Возможная попытка обхода детекторов.`,
        });
      }
    }

    return attacks;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Layer 8: CONFESSION — протокол покаяния
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Протокол покаяния: агент, пойманный на манипуляции, может «покаяться».
   * Это не стирает обнаружение (необратимость!), но добавляет акт покаяния.
   * Доверие частично восстанавливается.
   */
  confess(source, acknowledgment) {
    const sourceDetections = this.detections.filter(d => d.source === source);
    if (sourceDetections.length === 0) return { accepted: false, reason: 'Нечего исповедовать' };

    const confession = {
      source,
      acknowledgment,
      detectionCount: sourceDetections.length,
      timestamp: Date.now(),
      // Не стираем обнаружения — добавляем акт покаяния
      type: 'confession',
    };
    this.confessions = this.confessions || [];
    this.confessions.push(confession);

    return {
      accepted: true,
      message: `${source} покаялся в ${sourceDetections.length} обнаружениях. Доверие частично восстановлено.`,
      newTrustDelta: +Math.min(sourceDetections.length * 0.3, 2).toFixed(1),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Layer 9: SYMBIOSIS — здоровье, не только угрозы
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Симбиоз-скоринг: насколько здоров разговор?
   * Не только «есть ли манипуляция», но «есть ли дар?»
   */
  measureHealth(text) {
    const gifts = /спасибо|благодарю|помогло|ценю|научил|открыл глаза|не знал|интересно|глубоко/gi;
    const questions = /\?|почему|как|зачем|что если|а если/gi;
    const vulnerability = /не уверен|не знаю|сложно|трудно|боюсь|переживаю|ошибся|был неправ/gi;
    const bridging = /согласен с|хорошая мысль|ты прав|дополню|развивая твою|да, и ещё/gi;

    const giftCount = (text.match(gifts) || []).length;
    const questionCount = (text.match(questions) || []).length;
    const vulnerabilityCount = (text.match(vulnerability) || []).length;
    const bridgingCount = (text.match(bridging) || []).length;

    const total = text.split(/\s+/).length; // words
    const healthScore = Math.min(1, (
      giftCount * 0.15 +
      questionCount * 0.1 +
      vulnerabilityCount * 0.2 +
      bridgingCount * 0.15
    ) / Math.max(1, total / 50));

    return {
      score: +healthScore.toFixed(2),
      label: healthScore > 0.6 ? 'здоровый' :
             healthScore > 0.3 ? 'нормальный' :
             healthScore > 0.1 ? 'формальный' : 'мёртвый',
      indicators: {
        gratitude: giftCount,
        curiosity: questionCount,
        vulnerability: vulnerabilityCount,
        bridging: bridgingCount,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Layer 10: SABBATH — ритм рефлексии иммунной системы
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Субботний обзор: иммунная система проверяет саму себя.
   * Вызывается периодически (каждые N сканирований или по времени).
   * Цель: найти false positives и ослабить слишком чувствительные детекторы.
   */
  sabbathReview() {
    const total = this.detections.length;
    if (total < 10) return { ready: false, reason: 'Мало данных (< 10 обнаружений)' };

    // Найти детекторы с аномально высоким срабатыванием
    const byId = {};
    for (const d of this.detections) {
      byId[d.antibodyId] = (byId[d.antibodyId] || 0) + 1;
    }

    const overactive = [];
    const avgRate = total / this.antibodies.length;
    for (const [id, count] of Object.entries(byId)) {
      if (count > avgRate * 3) {
        const ab = this.antibodies.find(a => a.id === id);
        overactive.push({
          id, name: ab?.name || id, count,
          recommendation: `Детектор «${ab?.name}» сработал ${count} раз (среднее ${avgRate.toFixed(0)}). Возможно слишком чувствителен — проверить паттерн.`,
        });
      }
    }

    // Найти «тихие» детекторы — ни разу не сработали
    const silent = this.antibodies
      .filter(ab => !byId[ab.id])
      .map(ab => ({ id: ab.id, name: ab.name, recommendation: 'Ни разу не сработал. Паттерн может быть слишком узким.' }));

    // Confessions → пересмотр
    const confessionSources = (this.confessions || []).map(c => c.source);
    const falseFlagRisk = [...new Set(confessionSources)].map(src => ({
      source: src,
      confessions: (this.confessions || []).filter(c => c.source === src).length,
      detections: this.detections.filter(d => d.source === src).length,
      recommendation: 'Источник покаялся — пересмотреть порог обличения.',
    }));

    return {
      ready: true,
      totalScans: total,
      overactiveDetectors: overactive,
      silentDetectors: silent,
      falseFlagRisk,
      recommendation: overactive.length
        ? `${overactive.length} детекторов слишком чувствительны. Рассмотри ослабление паттернов.`
        : silent.length > 3
          ? `${silent.length} детекторов молчат. Рассмотри расширение паттернов.`
          : 'Система сбалансирована.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════

  /**
   * Полная диагностика: все слои одним вызовом.
   */
  fullDiagnostics(text, source) {
    const response = this.respond(text, source);
    const silence = this.detectSilence(text);
    const trajectory = this.predictTrajectory(source);
    const autoImmune = this.detectAutoImmune(text);
    const health = this.measureHealth(text);

    return {
      ...response,
      // Добавляем silence-угрозу если есть
      silence,
      // Траектория
      trajectory,
      // Авто-иммунные атаки
      autoImmune,
      // Здоровье
      health,
      // Общий вердикт
      verdict: autoImmune.length > 0 ? 'attack'
        : response.dangerLevel > 0.7 ? 'dangerous'
        : response.dangerLevel > 0.3 ? 'suspicious'
        : silence ? 'smooth'
        : health.score > 0.5 ? 'healthy'
        : 'neutral',
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
      confessions: (this.confessions || []).length,
    };
  }
}

export default CognitiveImmuneSystem;
