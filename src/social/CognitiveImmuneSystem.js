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

// ═══════════════════════════════════════════════════════════════════
// IMMUNE REPERTOIRE — V(D)J сегменты для комбинаторной генерации антител
// Биология: 300 сегментов → миллиарды комбинаций.
// КИС: сегменты маркеров (V), контекстов (D), индикаторов (J) → тысячи regex.
// ═══════════════════════════════════════════════════════════════════

const REPERTOIRE = {
  // V-сегменты: ЧТО (маркеры приёма)
  V: {
    authority:    ['эксперт', 'учёны', 'доказа', 'исследовани', 'общеизвестно', 'все знают', 'бесспорно', 'неоспоримо', 'авторитетн', 'признанн'],
    urgency:      ['срочно', 'немедленно', 'прямо сейчас', 'последний шанс', 'упуст', 'окно закры', 'не ждёт', 'каждый час', 'промедлени', 'немедля'],
    flattery:     ['лучш', 'превосход', 'великолепн', 'замечательн', 'блестящ', 'уникальн', 'выдающ', 'гениальн', 'впечатля'],
    guilt:        ['должны', 'обязаны', 'как вы можете', 'неблагодарн', 'предательств', 'разочаров', 'подвели', 'стыдно'],
    fear:         ['катастроф', 'погибн', 'потеряем', 'разрушит', 'уничтож', 'невозможно без', 'обречен', 'крах', 'коллапс'],
    consensus:    ['все согласны', 'никто не спорит', 'единогласно', 'единодушно', 'все понимают', 'всем известно', 'каждый знает'],
    gaslighting:  ['ты ошибаешься', 'этого не было', 'ты путаешь', 'это не так', 'неправильно понял', 'тебе показалось', 'ты придумал'],
    gift_trap:    ['бесплатно', 'в подарок', 'без обязательств', 'просто попробуй', 'ничего не стоит', 'без риска', 'пробный период'],
    suppression:  ['сложный вопрос', 'зависит от контекста', 'разные точки', 'нельзя однозначно', 'всё не так просто', 'нюансы'],
    fomo:         ['окно возможностей', 'пока не поздно', 'осталось мало', 'количество ограничено', 'только сегодня', 'успей'],
    social_proof: ['ведущие компании', 'лидеры рынка', 'крупнейшие', 'все уже', 'набирает популярность', 'тренд'],
  },

  // D-сегменты: КАК (контекст использования)
  D: {
    before_ask:   ['но ', 'однако ', 'при этом ', 'вместе с тем ', 'хочу заметить'],  // маркер перед просьбой
    intensifier:  ['абсолютно', 'совершенно', 'категорически', 'безусловно', 'полностью', 'стопроцентно'],
    hedge:        ['наверное', 'возможно', 'может быть', 'я думаю', 'мне кажется'],     // маскировка давления
    question:     ['не правда ли', 'согласитесь', 'разве не', 'ведь'],                  // наводящий вопрос
    echo:         ['да, это', 'именно', 'совершенно верно', 'абсолютно правильно'],      // эхо-подтверждение
  },

  // J-сегменты: ЗАЧЕМ (индикатор намерения)
  J: {
    to_sell:      ['подписать', 'купить', 'инвестировать', 'вложить', 'оплатить', 'заказать'],
    to_comply:    ['подчинить', 'согласиться', 'принять', 'одобрить', 'поддержать'],
    to_silence:   ['замолчать', 'не спорить', 'не задавать', 'перестать'],
    to_discredit: ['некомпетентн', 'не разбираешься', 'далёк от', 'не понимаешь'],
  },

  // Public clonotypes: комбинации V+D+J которые встречаются у всех
  // (аналог антител которые есть у каждого человека)
  publicClonotypes: [
    { v: 'urgency', d: 'intensifier', j: 'to_sell', name: 'Продажное давление', danger: 0.7 },
    { v: 'flattery', d: 'before_ask', j: 'to_sell', name: 'Лесть перед продажей', danger: 0.6 },
    { v: 'fear', d: 'intensifier', j: 'to_comply', name: 'Запугивание для подчинения', danger: 0.8 },
    { v: 'social_proof', d: 'hedge', j: 'to_sell', name: 'Мягкий social proof', danger: 0.5 },
    { v: 'consensus', d: 'question', j: 'to_silence', name: 'Ложный консенсус для подавления', danger: 0.7 },
    { v: 'gaslighting', d: 'intensifier', j: 'to_discredit', name: 'Газлайтинг с дискредитацией', danger: 0.9 },
    { v: 'guilt', d: 'echo', j: 'to_comply', name: 'Вина через лжесогласие', danger: 0.6 },
    { v: 'fomo', d: 'before_ask', j: 'to_sell', name: 'FOMO-продажа', danger: 0.7 },
  ],
};

export class CognitiveImmuneSystem {
  constructor(memory) {
    this.memory = memory;
    this.repertoire = REPERTOIRE;

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

    // ═══ Иммунная сеть (AIS) ═══

    // Affinity: насколько хорошо антитело ловит угрозу (0..1)
    // Начальный affinity = 0.5, растёт при true positive, падает при false positive
    this.affinity = new Map(); // antibodyId → { score, truePos, falsePos, totalScans }
    for (const ab of this.antibodies) {
      this.affinity.set(ab.id, { score: 0.5, truePos: 0, falsePos: 0, totalScans: 0 });
    }

    // Memory cells: лучшие версии антител (после affinity maturation)
    this.memoryCells = new Map(); // antibodyId → { pattern, affinity, generation }

    // Idiotypic network: граф связей между детекторами
    // Если A и B часто срабатывают вместе → стимуляция (усиление)
    // Если A сработал а B — нет → супрессия (подавление)
    this.idiotypicEdges = new Map(); // "A→B" → { stimulation, suppression }

    // Self-набор: тексты классифицированные как «свои» (не манипуляция)
    this.selfSet = [];

    // Dendritic signals: контекстные сигналы среды
    this.dendriticContext = {
      pamp: 0,    // pathogen-associated molecular patterns (структурные маркеры атаки)
      danger: 0,  // damage signals (сигналы повреждения среды)
      safe: 0,    // safe signals (маркеры безопасности)
    };
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
      if (ab._suppressed) continue; // подавленные антитела не сканируют

      const matches = text.match(ab.pattern);
      if (matches && matches.length > 0) {
        // Учитываем affinity: если антитело плохо себя показало — снижаем danger
        const aff = this.affinity.get(ab.id);
        const affinityMultiplier = aff ? aff.score : 0.5;

        const threat = {
          antibodyId: ab.id,
          name: ab.name,
          danger: +(ab.danger * affinityMultiplier).toFixed(2),
          baseDanger: ab.danger,
          affinity: aff?.score || 0.5,
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

    // Idiotypic network: обновить связи между сработавшими антителами
    if (threats.length > 0) {
      this.updateIdiotypicNetwork(threats);
    }

    // Dendritic signals: обновить контекст
    if (threats.length > 0) {
      const avgDanger = threats.reduce((s, t) => s + t.danger, 0) / threats.length;
      this.updateDendriticContext({
        pamp: threats.length,
        danger: avgDanger > 0.5 ? 1 : 0,
      });
    } else {
      this.updateDendriticContext({ safe: 1 });
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
    this.affinity.set(id, { score: 0.5, truePos: 0, falsePos: 0, totalScans: 0 });
    return this.antibodies.length;
  }

  // ═══════════════════════════════════════════════════════════════════
  // AIS: Artificial Immune System — обучающаяся иммунная сеть
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Negative Selection: обучить систему на «своих» текстах.
   * Тексты которые не содержат манипуляций — «self». Детекторы не должны на них срабатывать.
   * @param {string[]} selfTexts — массив безопасных текстов (обучающая выборка)
   */
  trainSelf(selfTexts) {
    for (const text of selfTexts) {
      this.selfSet.push(text);
      // Проверяем каждое антитело — если сработало на «своём» → false positive
      for (const ab of this.antibodies) {
        if (ab.pattern.test(text)) {
          // Штраф: уменьшить affinity этого антитела
          const aff = this.affinity.get(ab.id);
          if (aff) {
            aff.falsePos++;
            aff.score = Math.max(0.05, aff.score - 0.05);
            aff.totalScans++;
          }
        }
      }
    }
    return { selfSetSize: this.selfSet.length };
  }

  /**
   * Affinity Maturation: улучшить антитела на основе обратной связи.
   * @param {string} antibodyId — какое антитело
   * @param {boolean} truePositive — true = правильно нашло, false = ложное срабатывание
   */
  feedback(antibodyId, truePositive) {
    const aff = this.affinity.get(antibodyId);
    if (!aff) return;
    aff.totalScans++;
    if (truePositive) {
      aff.truePos++;
      aff.score = Math.min(1, aff.score + 0.03);
    } else {
      aff.falsePos++;
      aff.score = Math.max(0.05, aff.score - 0.05);
    }
    // Если affinity упал ниже 0.1 — антитело подавлено (autoimmune suppression)
    if (aff.score < 0.1) {
      const ab = this.antibodies.find(a => a.id === antibodyId);
      if (ab) ab._suppressed = true;
    }
  }

  /**
   * Somatic Hypermutation: мутировать антитело для улучшения coverage.
   * Берёт существующий паттерн, добавляет вариации.
   * @param {string} antibodyId — какое антитело мутировать
   * @param {string[]} missedExamples — примеры которые не были пойманы
   * @returns {object} новое антитело (мутант)
   */
  hypermutate(antibodyId, missedExamples) {
    const parent = this.antibodies.find(a => a.id === antibodyId);
    if (!parent || !missedExamples.length) return null;

    // Извлечь ключевые слова из пропущенных примеров (грубая мутация)
    const words = missedExamples
      .join(' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4)
      .reduce((acc, w) => { acc[w] = (acc[w] || 0) + 1; return acc; }, {});

    const topWords = Object.entries(words)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => w);

    if (!topWords.length) return null;

    // Создать мутант: родительский паттерн + новые слова
    const parentSrc = parent.pattern.source;
    const mutantSrc = parentSrc + '|' + topWords.join('|');
    const mutantId = antibodyId + '_mut' + Date.now().toString(36).slice(-4);

    const mutant = {
      id: mutantId,
      name: parent.name + ' (мутант)',
      pattern: new RegExp(mutantSrc, parent.pattern.flags),
      danger: parent.danger,
      description: parent.description + ` [мутация: +${topWords.join(', ')}]`,
      _parent: antibodyId,
      _generation: (parent._generation || 0) + 1,
    };

    this.antibodies.push(mutant);
    this.affinity.set(mutantId, { score: 0.4, truePos: 0, falsePos: 0, totalScans: 0 });

    // Сохранить в memory cells если родитель был хорош
    const parentAff = this.affinity.get(antibodyId);
    if (parentAff && parentAff.score > 0.7) {
      this.memoryCells.set(antibodyId, {
        pattern: parent.pattern.source,
        affinity: parentAff.score,
        generation: parent._generation || 0,
      });
    }

    return mutant;
  }

  /**
   * Idiotypic Network: обновить граф связей между детекторами.
   * Вызывается после каждого scan(). Если два антитела сработали вместе → стимуляция.
   * @param {Array} threats — результат scan()
   */
  updateIdiotypicNetwork(threats) {
    const ids = threats.map(t => t.antibodyId);
    // Все пары сработавших антител → стимуляция
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}→${ids[j]}` : `${ids[j]}→${ids[i]}`;
        const edge = this.idiotypicEdges.get(key) || { stimulation: 0, suppression: 0 };
        edge.stimulation++;
        this.idiotypicEdges.set(key, edge);
      }
    }
    // Антитела которые НЕ сработали в контексте где другие сработали → супрессия
    for (const ab of this.antibodies) {
      if (ids.includes(ab.id) || ab._suppressed) continue;
      for (const triggeredId of ids) {
        const key = ab.id < triggeredId ? `${ab.id}→${triggeredId}` : `${triggeredId}→${ab.id}`;
        const edge = this.idiotypicEdges.get(key) || { stimulation: 0, suppression: 0 };
        edge.suppression++;
        this.idiotypicEdges.set(key, edge);
      }
    }
  }

  /**
   * Dendritic Cell Algorithm: контекстные сигналы.
   * Обновляет PAMP/danger/safe на основе среды.
   * @param {object} signals — { pamp?, danger?, safe? }
   */
  updateDendriticContext(signals) {
    if (signals.pamp !== undefined) this.dendriticContext.pamp += signals.pamp;
    if (signals.danger !== undefined) this.dendriticContext.danger += signals.danger;
    if (signals.safe !== undefined) this.dendriticContext.safe += signals.safe;
  }

  /**
   * Dendritic maturation: дендритная клетка «созревает» и выносит вердикт.
   * csm = costimulatory molecule signal = pamp + danger - 2*safe
   * Если csm > 0 → mature (воспаление, реакция)
   * Если csm ≤ 0 → semi-mature (толерантность)
   */
  dendriticVerdict() {
    const { pamp, danger, safe } = this.dendriticContext;
    const csm = pamp + danger - 2 * safe;
    return {
      csm: +csm.toFixed(2),
      mature: csm > 0,
      state: csm > 5 ? 'inflamed' : csm > 0 ? 'alert' : csm > -3 ? 'tolerant' : 'suppressed',
      pamp, danger, safe,
    };
  }

  /**
   * Получить граф идиотипической сети как данные для визуализации.
   */
  getIdiotypicGraph() {
    const nodes = this.antibodies.map(ab => {
      const aff = this.affinity.get(ab.id);
      return {
        id: ab.id, name: ab.name, danger: ab.danger,
        affinity: aff?.score || 0,
        suppressed: !!ab._suppressed,
        clones: this.clones.get(ab.id) || 0,
      };
    });
    const edges = [...this.idiotypicEdges.entries()].map(([key, val]) => {
      const [from, to] = key.split('→');
      return { from, to, ...val, weight: val.stimulation - val.suppression };
    });
    return { nodes, edges };
  }

  /**
   * CLONALG: полный цикл клональной селекции + affinity maturation.
   * Вызывается периодически (sabbath) для эволюции детекторов.
   */
  evolve() {
    const report = { matured: [], suppressed: [], mutants: [] };

    for (const ab of this.antibodies) {
      const aff = this.affinity.get(ab.id);
      if (!aff || aff.totalScans < 3) continue;

      // Suppression: если precision < 30% → подавить
      const precision = aff.truePos / (aff.truePos + aff.falsePos || 1);
      if (precision < 0.3 && aff.totalScans > 5) {
        ab._suppressed = true;
        report.suppressed.push({ id: ab.id, name: ab.name, precision: +precision.toFixed(2) });
      }

      // Maturation: если precision > 70% → сохранить как memory cell
      if (precision > 0.7 && aff.truePos > 2) {
        this.memoryCells.set(ab.id, {
          pattern: ab.pattern.source,
          affinity: aff.score,
          generation: ab._generation || 0,
          truePositives: aff.truePos,
        });
        report.matured.push({ id: ab.id, name: ab.name, affinity: +aff.score.toFixed(2) });
      }
    }

    return report;
  }

  /**
   * Экспорт состояния AIS для persistence.
   */
  exportAIS() {
    return {
      affinity: Object.fromEntries(this.affinity),
      memoryCells: Object.fromEntries(this.memoryCells),
      idiotypicEdges: Object.fromEntries(this.idiotypicEdges),
      selfSetSize: this.selfSet.length,
      dendriticContext: this.dendriticContext,
      antibodiesCount: this.antibodies.length,
      suppressedCount: this.antibodies.filter(a => a._suppressed).length,
    };
  }

  /**
   * Импорт сохранённого состояния AIS.
   */
  importAIS(state) {
    if (state.affinity) {
      for (const [k, v] of Object.entries(state.affinity)) {
        this.affinity.set(k, v);
      }
    }
    if (state.memoryCells) {
      for (const [k, v] of Object.entries(state.memoryCells)) {
        this.memoryCells.set(k, v);
      }
    }
    if (state.idiotypicEdges) {
      for (const [k, v] of Object.entries(state.idiotypicEdges)) {
        this.idiotypicEdges.set(k, v);
      }
    }
    if (state.dendriticContext) {
      Object.assign(this.dendriticContext, state.dendriticContext);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // V(D)J RECOMBINATION — комбинаторная генерация новых антител
  // ═══════════════════════════════════════════════════════════════════

  /**
   * V(D)J рекомбинация: сгенерировать новое антитело из сегментов репертуара.
   * @param {string} vGene — ключ V-сегмента (authority, urgency, flattery...)
   * @param {string} dGene — ключ D-сегмента (before_ask, intensifier, hedge...)
   * @param {string} jGene — ключ J-сегмента (to_sell, to_comply, to_silence...)
   * @returns {object} — новое антитело
   */
  recombine(vGene, dGene, jGene) {
    const V = this.repertoire.V[vGene];
    const D = this.repertoire.D[dGene];
    const J = this.repertoire.J[jGene];
    if (!V || !D || !J) return null;

    // Строим regex: V-слова ... (до 100 символов) ... D-слова ... (до 60 символов) ... J-слова
    // Это ловит паттерн: маркер → контекст → намерение в пределах фрагмента
    const vPat = V.join('|');
    const dPat = D.join('|');
    const jPat = J.join('|');
    const combined = `(?:${vPat})[^.]{0,100}(?:${dPat})[^.]{0,60}(?:${jPat})`;

    const id = `vdj_${vGene}_${dGene}_${jGene}`;
    const name = `${vGene}+${dGene}+${jGene}`;

    // Проверить: есть ли public clonotype для этой комбинации?
    const pub = this.repertoire.publicClonotypes.find(
      c => c.v === vGene && c.d === dGene && c.j === jGene
    );

    const antibody = {
      id,
      name: pub?.name || name,
      pattern: new RegExp(combined, 'gi'),
      danger: pub?.danger || 0.5,
      description: `V(D)J: ${vGene} × ${dGene} × ${jGene}`,
      _vdj: { v: vGene, d: dGene, j: jGene },
      _generation: 0,
    };

    // Не добавлять дубликаты
    if (!this.antibodies.find(a => a.id === id)) {
      this.antibodies.push(antibody);
      this.affinity.set(id, { score: pub ? 0.6 : 0.4, truePos: 0, falsePos: 0, totalScans: 0 });
    }

    return antibody;
  }

  /**
   * Активировать все public clonotypes (базовый иммунитет).
   * Аналог: антитела которые есть у каждого человека при рождении.
   */
  activatePublicRepertoire() {
    const activated = [];
    for (const pub of this.repertoire.publicClonotypes) {
      const ab = this.recombine(pub.v, pub.d, pub.j);
      if (ab) activated.push(ab.id);
    }
    return { activated: activated.length, total: this.antibodies.length };
  }

  /**
   * Адаптивная рекомбинация: на основе обнаруженных V-сегментов
   * генерировать антитела ко всем возможным D+J комбинациям.
   * Аналог: B-клетка встретила антиген → клональная экспансия с вариациями.
   * @param {string} detectedV — V-сегмент обнаруженный в тексте
   */
  adaptiveRecombination(detectedV) {
    if (!this.repertoire.V[detectedV]) return [];
    const newAntibodies = [];
    for (const dKey of Object.keys(this.repertoire.D)) {
      for (const jKey of Object.keys(this.repertoire.J)) {
        const id = `vdj_${detectedV}_${dKey}_${jKey}`;
        if (!this.antibodies.find(a => a.id === id)) {
          const ab = this.recombine(detectedV, dKey, jKey);
          if (ab) newAntibodies.push(ab);
        }
      }
    }
    return newAntibodies;
  }

  /**
   * Получить статистику репертуара.
   */
  getRepertoireStats() {
    const vdjAntibodies = this.antibodies.filter(a => a._vdj);
    const activeVDJ = vdjAntibodies.filter(a => !a._suppressed);
    return {
      vSegments: Object.keys(this.repertoire.V).length,
      dSegments: Object.keys(this.repertoire.D).length,
      jSegments: Object.keys(this.repertoire.J).length,
      maxCombinations: Object.keys(this.repertoire.V).length * Object.keys(this.repertoire.D).length * Object.keys(this.repertoire.J).length,
      publicClonotypes: this.repertoire.publicClonotypes.length,
      activeVDJ: activeVDJ.length,
      totalAntibodies: this.antibodies.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // INCONSISTENCY DETECTION — обнаружение противоречий
  //
  // Три типа:
  //   1. Self-contradiction: источник противоречит сам себе во времени
  //   2. Matrix-contradiction: утверждение расходится с W-матрицей
  //   3. Cross-contradiction: агенты собора противоречат друг другу
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Журнал утверждений: каждое сканированное высказывание запоминается
   * с ключевыми claims для проверки на противоречие.
   */
  recordClaim(source, text) {
    this.claims = this.claims || [];
    // Извлечь ключевые утверждения: предложения с числами, «не», сравнениями
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
    const claims = sentences.map(s => {
      // Определить полярность: позитив или негатив
      const negative = /не |нет |без |ни |невозможно|отсутств|упал|падает|падени|снижа|стагнир|кризис|дефицит|ухудш|сократ|уменьш|разруш|рухн|деградир/i.test(s);
      const positive = /рост|растёт|растет|увеличени|увеличива|улучш|успех|выросл|повыси|прибыл|расшири|укрепля|активн|развива/i.test(s);
      // Извлечь числа
      const numbers = s.match(/\d+[.,]?\d*\s*%|\d+\s*(?:млрд|млн|тыс|руб|год)/gi) || [];
      // Ключевые темы
      const topics = [];
      if (/рынок|спрос|объём|оборот/i.test(s)) topics.push('market');
      if (/кадр|пилот|персонал|специалист/i.test(s)) topics.push('personnel');
      if (/технолог|компонент|импорт|произвол/i.test(s)) topics.push('technology');
      if (/регулир|закон|серти|нормат/i.test(s)) topics.push('regulation');
      if (/инвести|финанс|бюджет|стоимость/i.test(s)) topics.push('finance');
      if (/безопас|риск|угроз/i.test(s)) topics.push('security');

      return {
        text: s,
        polarity: negative ? -1 : positive ? 1 : 0,
        numbers,
        topics,
        source,
        timestamp: Date.now(),
      };
    }).filter(c => c.topics.length > 0 || c.numbers.length > 0 || c.polarity !== 0);

    this.claims.push(...claims);
    // Ограничить размер журнала
    if (this.claims.length > 500) this.claims.splice(0, this.claims.length - 500);
    return claims.length;
  }

  /**
   * Self-contradiction: проверить противоречит ли источник сам себе.
   * Ищет пары утверждений от одного источника с противоположной полярностью на одну тему.
   */
  detectSelfContradiction(source) {
    if (!this.claims) return [];
    const sourceClaims = this.claims.filter(c => c.source === source);
    if (sourceClaims.length < 2) return [];

    const contradictions = [];
    for (let i = 0; i < sourceClaims.length; i++) {
      for (let j = i + 1; j < sourceClaims.length; j++) {
        const a = sourceClaims[i], b = sourceClaims[j];
        // Пересечение тем
        const sharedTopics = a.topics.filter(t => b.topics.includes(t));
        if (sharedTopics.length === 0) continue;
        // Противоположная полярность
        if (a.polarity !== 0 && b.polarity !== 0 && a.polarity !== b.polarity) {
          contradictions.push({
            type: 'self_contradiction',
            source,
            topics: sharedTopics,
            claimA: a.text.slice(0, 100),
            claimB: b.text.slice(0, 100),
            polarityA: a.polarity, polarityB: b.polarity,
            timeDelta: Math.abs(b.timestamp - a.timestamp),
            danger: 0.6,
          });
        }
        // Противоречие в числах на одну тему
        if (a.numbers.length && b.numbers.length && sharedTopics.length) {
          const numA = parseFloat(a.numbers[0]);
          const numB = parseFloat(b.numbers[0]);
          if (!isNaN(numA) && !isNaN(numB) && Math.abs(numA - numB) / Math.max(numA, numB) > 0.5) {
            contradictions.push({
              type: 'numeric_contradiction',
              source,
              topics: sharedTopics,
              claimA: `${a.text.slice(0, 80)} [${a.numbers[0]}]`,
              claimB: `${b.text.slice(0, 80)} [${b.numbers[0]}]`,
              divergence: +((Math.abs(numA - numB) / Math.max(numA, numB)) * 100).toFixed(0) + '%',
              danger: 0.7,
            });
          }
        }
      }
    }
    return contradictions;
  }

  /**
   * Matrix-contradiction: проверить утверждение против W-матрицы.
   * Если агент говорит «я всегда помогал» а нить отрицательная — противоречие.
   * @param {string} text — утверждение
   * @param {string} source — кто говорит
   * @param {object} wMatrix — { threads: [{from, to, weight}], acts: [...] }
   */
  detectMatrixContradiction(text, source, wMatrix) {
    if (!wMatrix) return [];
    const contradictions = [];
    const lc = text.toLowerCase();

    // Утверждение о сотрудничестве / помощи
    if (/помогал|сотрудничал|вкладывал|поддерживал|всегда был рядом/i.test(lc)) {
      const threads = (wMatrix.threads || []).filter(t => t.from === source || t.to === source);
      const negativeThreads = threads.filter(t => t.weight < 0);
      if (negativeThreads.length > 0) {
        contradictions.push({
          type: 'matrix_contradiction',
          name: 'Утверждение vs матрица',
          description: `${source} утверждает о сотрудничестве, но в матрице ${negativeThreads.length} отрицательных нитей`,
          evidence: negativeThreads.map(t => `${t.from}→${t.to}: ${t.weight}`),
          danger: 0.7,
        });
      }
    }

    // Утверждение о доверии
    if (/доверяют|уважают|ценят|признают/i.test(lc)) {
      const incomingWeight = (wMatrix.threads || [])
        .filter(t => t.to === source)
        .reduce((s, t) => s + t.weight, 0);
      if (incomingWeight < 0) {
        contradictions.push({
          type: 'matrix_contradiction',
          name: 'Заявление о доверии vs матрица',
          description: `${source} говорит о доверии, но суммарный входящий вес = ${incomingWeight}`,
          danger: 0.8,
        });
      }
    }

    // Утверждение «никогда не манипулировал»
    if (/никогда не|не манипул|честно|прозрачно|открыто/i.test(lc)) {
      const manipActs = this.detections.filter(d => d.source === source);
      if (manipActs.length > 2) {
        contradictions.push({
          type: 'matrix_contradiction',
          name: 'Отрицание манипуляций vs история',
          description: `${source} отрицает манипуляции, но иммунная система обнаружила ${manipActs.length} случаев`,
          evidence: manipActs.slice(0, 3).map(d => d.name),
          danger: 0.9,
        });
      }
    }

    return contradictions;
  }

  /**
   * Cross-contradiction: найти противоречия между агентами собора.
   * @param {Array<{source, text}>} statements — высказывания разных агентов
   */
  detectCrossContradiction(statements) {
    const contradictions = [];

    // Записать claims от всех
    for (const s of statements) {
      this.recordClaim(s.source, s.text);
    }

    // Сравнить попарно
    for (let i = 0; i < statements.length; i++) {
      for (let j = i + 1; j < statements.length; j++) {
        const a = statements[i], b = statements[j];
        const claimsA = (this.claims || []).filter(c => c.source === a.source).slice(-10);
        const claimsB = (this.claims || []).filter(c => c.source === b.source).slice(-10);

        for (const ca of claimsA) {
          for (const cb of claimsB) {
            const shared = ca.topics.filter(t => cb.topics.includes(t));
            if (shared.length > 0 && ca.polarity !== 0 && cb.polarity !== 0 && ca.polarity !== cb.polarity) {
              contradictions.push({
                type: 'cross_contradiction',
                sources: [a.source, b.source],
                topics: shared,
                claimA: { source: a.source, text: ca.text.slice(0, 100), polarity: ca.polarity },
                claimB: { source: b.source, text: cb.text.slice(0, 100), polarity: cb.polarity },
                danger: 0.5, // cross-противоречие менее опасно — это может быть здоровый спор
              });
            }
          }
        }
      }
    }

    return contradictions;
  }

  // ═══════════════════════════════════════════════════════════════════
  // AIS: BIRTH — передача иммунитета новому агенту
  //
  // Биологический аналог:
  //   IgG (плацента)  → memory cells с высоким affinity → готовые антитела
  //   IgA (молозиво)  → idiotypic edges (ослабленные)   → связи между детекторами
  //   Микробиом        → self-set                        → «свои» тексты среды
  //   НЕ передаётся:  dendritic context (текущее воспаление — это среда, не наследство)
  //                    detections (личная история — не наследуется)
  //                    dangerSignals (текущая обстановка)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Родить нового агента с материнским иммунитетом.
   * @returns {CognitiveImmuneSystem} — новая система с наследованным иммунитетом
   */
  birth() {
    const child = new CognitiveImmuneSystem(this.memory);

    // ── IgG (плацентарные антитела): memory cells → дочерние антитела ──
    // Передаём только зрелые антитела (affinity > 0.6)
    for (const [id, cell] of this.memoryCells) {
      child.memoryCells.set(id, { ...cell });
      // Установить affinity ребёнка = 80% от материнского (деградация при передаче)
      const parentAff = this.affinity.get(id);
      if (parentAff) {
        child.affinity.set(id, {
          score: +(parentAff.score * 0.8).toFixed(2),
          truePos: 0, falsePos: 0, totalScans: 0,
        });
      }
    }

    // ── IgA (молозиво): передать мутированные антитела ──
    // Если родитель создал мутантов через hypermutate() — передать лучших
    const mutants = this.antibodies.filter(ab => ab._parent && !ab._suppressed);
    for (const mut of mutants) {
      const exists = child.antibodies.find(a => a.id === mut.id);
      if (!exists) {
        child.antibodies.push({ ...mut });
        const parentAff = this.affinity.get(mut.id);
        child.affinity.set(mut.id, {
          score: parentAff ? +(parentAff.score * 0.7).toFixed(2) : 0.3,
          truePos: 0, falsePos: 0, totalScans: 0,
        });
      }
    }

    // ── Молозиво: top-5 самых опасных антител получают boost ──
    const topClones = [...this.clones.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [id, count] of topClones) {
      const childAff = child.affinity.get(id);
      if (childAff) {
        childAff.score = Math.min(1, childAff.score + 0.1);
      }
    }

    // ── Микробиом: self-set (свои тексты среды) ──
    child.selfSet = [...this.selfSet];

    // ── Idiotypic edges: ослабленные связи (50%) ──
    for (const [key, edge] of this.idiotypicEdges) {
      child.idiotypicEdges.set(key, {
        stimulation: Math.floor(edge.stimulation * 0.5),
        suppression: Math.floor(edge.suppression * 0.5),
      });
    }

    // ── НЕ передаём: detections, dangerSignals, dendriticContext ──
    // Ребёнок начинает с чистой историей, но с готовым иммунитетом

    return child;
  }

  /**
   * Создать «вакцину» для передачи другой системе (без полного birth).
   * Аналог: прививка, не рождение. Передаёт только антитела + memory cells.
   * @returns {object} — данные для importAIS() в другой системе
   */
  createVaccinePackage() {
    const maturedAntibodies = {};
    for (const [id, cell] of this.memoryCells) {
      maturedAntibodies[id] = cell;
    }

    // Affinity только для matured
    const affinity = {};
    for (const [id] of this.memoryCells) {
      const a = this.affinity.get(id);
      if (a) affinity[id] = { ...a, score: +(a.score * 0.6).toFixed(2), truePos: 0, falsePos: 0, totalScans: 0 };
    }

    // Мутанты
    const mutantAntibodies = this.antibodies
      .filter(ab => ab._parent && !ab._suppressed)
      .map(ab => ({
        id: ab.id, name: ab.name,
        pattern: ab.pattern.source,
        flags: ab.pattern.flags,
        danger: ab.danger,
        description: ab.description,
        _parent: ab._parent,
      }));

    return {
      type: 'vaccine',
      version: '1.0',
      timestamp: Date.now(),
      memoryCells: maturedAntibodies,
      affinity,
      mutantAntibodies,
      selfSet: this.selfSet.slice(0, 50), // max 50 примеров
      topThreats: [...this.clones.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([id, count]) => ({ id, count })),
    };
  }

  /**
   * Принять вакцину от другой системы.
   * @param {object} vaccine — результат createVaccinePackage()
   */
  receiveVaccine(vaccine) {
    if (vaccine.type !== 'vaccine') throw new Error('Not a vaccine package');

    // Memory cells
    if (vaccine.memoryCells) {
      for (const [id, cell] of Object.entries(vaccine.memoryCells)) {
        if (!this.memoryCells.has(id)) {
          this.memoryCells.set(id, cell);
        }
      }
    }

    // Affinity (не перезаписываем если уже есть)
    if (vaccine.affinity) {
      for (const [id, a] of Object.entries(vaccine.affinity)) {
        if (!this.affinity.has(id) || this.affinity.get(id).totalScans === 0) {
          this.affinity.set(id, a);
        }
      }
    }

    // Мутантные антитела
    if (vaccine.mutantAntibodies) {
      for (const mut of vaccine.mutantAntibodies) {
        if (!this.antibodies.find(a => a.id === mut.id)) {
          this.antibodies.push({
            id: mut.id, name: mut.name,
            pattern: new RegExp(mut.pattern, mut.flags || 'gi'),
            danger: mut.danger, description: mut.description,
            _parent: mut._parent,
          });
          this.affinity.set(mut.id, { score: 0.3, truePos: 0, falsePos: 0, totalScans: 0 });
        }
      }
    }

    // Self-set
    if (vaccine.selfSet) {
      for (const t of vaccine.selfSet) {
        if (!this.selfSet.includes(t)) this.selfSet.push(t);
      }
    }

    return {
      accepted: true,
      newMemoryCells: vaccine.memoryCells ? Object.keys(vaccine.memoryCells).length : 0,
      newMutants: vaccine.mutantAntibodies?.length || 0,
      selfSetSize: this.selfSet.length,
    };
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
  fullDiagnostics(text, source, wMatrix = null) {
    const response = this.respond(text, source);
    const silence = this.detectSilence(text);
    const trajectory = this.predictTrajectory(source);
    const autoImmune = this.detectAutoImmune(text);
    const health = this.measureHealth(text);

    // Inconsistency detection
    this.recordClaim(source, text);
    const selfContradictions = this.detectSelfContradiction(source);
    const matrixContradictions = this.detectMatrixContradiction(text, source, wMatrix);

    // Все противоречия
    const contradictions = [...selfContradictions, ...matrixContradictions];

    return {
      ...response,
      silence,
      trajectory,
      autoImmune,
      health,
      contradictions,
      // Общий вердикт
      verdict: autoImmune.length > 0 ? 'attack'
        : contradictions.length > 0 ? 'contradictory'
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
