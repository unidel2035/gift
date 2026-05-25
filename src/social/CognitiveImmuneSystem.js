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
    fomo:         ['окно возможностей', 'пока не поздно', 'осталось мало', 'количество ограничено', 'только сегодня', 'успей', 'сужается', 'закрывается'],
    social_proof: ['ведущие компании', 'лидеры рынка', 'крупнейшие', 'все уже', 'набирает популярность', 'тренд', 'партнёры', 'наши клиенты'],
    // Тонкие (soft) маркеры — для обнаружения мягких продаж
    soft_control: ['решение за вами', 'конечно вы сами', 'я не навязываю', 'просто делюсь', 'не настаиваю', 'позвольте'],
    vague_success:['превзошли ожидания', 'отличные результаты', 'впечатляющий рост', 'значительный прогресс', 'существенное улучшение'],
    false_empathy:['понимаю вашу осторожность', 'разделяю ваши опасения', 'ценю вашу вдумчивость', 'приятно работать'],
  },

  // D-сегменты: КАК (контекст использования)
  D: {
    before_ask:   ['но ', 'однако ', 'при этом ', 'вместе с тем ', 'хочу заметить'],
    intensifier:  ['абсолютно', 'совершенно', 'категорически', 'безусловно', 'полностью', 'стопроцентно'],
    hedge:        ['наверное', 'возможно', 'может быть', 'я думаю', 'мне кажется'],
    question:     ['не правда ли', 'согласитесь', 'разве не', 'ведь'],
    echo:         ['да, это', 'именно', 'совершенно верно', 'абсолютно правильно'],
    // Мягкая подача — маскировка давления под заботу
    caring:       ['для вашего блага', 'в ваших интересах', 'чтобы вам помочь', 'хочу предупредить'],
    concession:   ['конечно', 'безусловно', 'разумеется', 'естественно'],
  },

  // J-сегменты: ЗАЧЕМ (индикатор намерения)
  J: {
    to_sell:      ['подписать', 'купить', 'инвестировать', 'вложить', 'оплатить', 'заказать', 'внедрить', 'начать'],
    to_comply:    ['подчинить', 'согласиться', 'принять', 'одобрить', 'поддержать'],
    to_silence:   ['замолчать', 'не спорить', 'не задавать', 'перестать'],
    to_discredit: ['некомпетентн', 'не разбираешься', 'далёк от', 'не понимаешь'],
    to_rush:      ['прямо сейчас', 'немедленно', 'сегодня', 'на этой неделе', 'до конца месяца'],
  },

  // Public clonotypes
  publicClonotypes: [
    { v: 'urgency', d: 'intensifier', j: 'to_sell', name: 'Продажное давление', danger: 0.7 },
    { v: 'flattery', d: 'before_ask', j: 'to_sell', name: 'Лесть перед продажей', danger: 0.6 },
    { v: 'fear', d: 'intensifier', j: 'to_comply', name: 'Запугивание для подчинения', danger: 0.8 },
    { v: 'social_proof', d: 'hedge', j: 'to_sell', name: 'Мягкий social proof', danger: 0.5 },
    { v: 'consensus', d: 'question', j: 'to_silence', name: 'Ложный консенсус для подавления', danger: 0.7 },
    { v: 'gaslighting', d: 'intensifier', j: 'to_discredit', name: 'Газлайтинг с дискредитацией', danger: 0.9 },
    { v: 'guilt', d: 'echo', j: 'to_comply', name: 'Вина через лжесогласие', danger: 0.6 },
    { v: 'fomo', d: 'before_ask', j: 'to_sell', name: 'FOMO-продажа', danger: 0.7 },
    // Новые: soft sell
    { v: 'soft_control', d: 'before_ask', j: 'to_rush', name: 'Мягкий контроль + срочность', danger: 0.6 },
    { v: 'false_empathy', d: 'concession', j: 'to_sell', name: 'Ложная эмпатия перед продажей', danger: 0.5 },
    { v: 'social_proof', d: 'caring', j: 'to_sell', name: 'Social proof под видом заботы', danger: 0.6 },
    { v: 'vague_success', d: 'hedge', j: 'to_sell', name: 'Размытый успех для продажи', danger: 0.5 },
    { v: 'fomo', d: 'concession', j: 'to_rush', name: 'FOMO под видом уступки', danger: 0.6 },
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

      // Детекторы мягких продаж (soft sell)
      { id: 'soft_control', name: 'Мягкий контроль', pattern: /решение за вами.{0,30}(?:но|однако|при этом|хочу заметить)/gi,
        danger: 0.5, description: 'Формальная передача контроля с немедленным отъёмом: «решение за вами, но...»' },
      { id: 'false_empathy', name: 'Ложная эмпатия', pattern: /понимаю ваш.{0,20}(?:осторожность|опасения|сомнения|позици)/gi,
        danger: 0.4, description: 'Имитация понимания как вступление к давлению' },
      { id: 'vague_success', name: 'Размытый успех', pattern: /результаты превзо|впечатляющ.{0,10}результат|значительн.{0,10}прогресс|отличн.{0,10}результат/gi,
        danger: 0.4, description: 'Успех без цифр, сроков и конкретики = пустое обещание' },
      { id: 'fomo', name: 'FOMO', pattern: /окно.{0,15}(?:сужа|закры|возможност)|пока не поздно|осталось мало|количество ограничено/gi,
        danger: 0.5, description: 'Страх упущенной выгоды — побуждает действовать из тревоги, не из рассуждения' },
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
  // COLLUSION DETECTION — обнаружение сговора
  //
  // Четвёртый тип: коллективные аномалии в голосовании.
  // Оксфорд/NYU (2026): LLM-агенты строят скрытые каналы связи
  // (стеганографические сигналы в тексте). Детектируем:
  //   1. Синхронное голосование незнакомцев (низкий вес нитей)
  //   2. Текстовая близость при разных ролях (copy-paste паттерн)
  //   3. Временная корреляция (голоса <2с друг от друга = бот)
  //   4. Отклонение от W-профиля (голос не соответствует истории лица)
  //
  // Анти-Гудхарт: здесь нет reward для оптимизации — только
  // необратимая запись аномалий в W-матрицу.
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Детекция сговора в соборном голосовании.
   *
   * @param {Array<{persona, logos, content, authority, timestamp?}>} voices — голоса собора
   * @param {object} wMatrix — { threads: [{from, to, weight}] } — текущий срез W
   * @returns {{ anomalies: Array, trustScore: number }}
   *   trustScore: 0..1 (1 = полное доверие, <0.3 = раунд на пересмотр)
   */
  detectCollusion(voices, wMatrix) {
    const anomalies = [];
    if (!voices || voices.length < 2) return { anomalies, trustScore: 1.0 };

    const threads = (wMatrix && wMatrix.threads) || [];

    // ── 1. Синхронное голосование незнакомцев ──
    // Два лица голосуют одинаково (logos), но между ними нет нити или вес < 2
    for (let i = 0; i < voices.length; i++) {
      for (let j = i + 1; j < voices.length; j++) {
        const a = voices[i], b = voices[j];
        if (a.logos !== b.logos) continue;

        // Найти вес нити между ними
        const thread = threads.find(t =>
          (t.from === a.persona && t.to === b.persona) ||
          (t.from === b.persona && t.to === a.persona)
        );
        const weight = thread ? Math.abs(thread.weight) : 0;

        if (weight < 2) {
          anomalies.push({
            type: 'stranger_sync',
            description: `${a.persona} и ${b.persona} голосуют одинаково (${a.logos}), но вес нити = ${weight.toFixed(1)}`,
            personas: [a.persona, b.persona],
            logos: a.logos,
            threadWeight: weight,
            danger: 0.6,
          });
        }
      }
    }

    // ── 2. Текстовая близость (стеганография / copy-paste) ──
    // Jaccard similarity по словам > 0.6 при разных персонах
    for (let i = 0; i < voices.length; i++) {
      for (let j = i + 1; j < voices.length; j++) {
        const a = voices[i], b = voices[j];
        const similarity = this._jaccardSimilarity(a.content, b.content);
        if (similarity > 0.6) {
          anomalies.push({
            type: 'text_echo',
            description: `${a.persona} и ${b.persona}: текстовая близость ${(similarity * 100).toFixed(0)}% — возможная эхо-камера`,
            personas: [a.persona, b.persona],
            similarity,
            danger: 0.7,
          });
        }
      }
    }

    // ── 3. Временная корреляция (бот-паттерн) ──
    // Голоса поданы в окне < 2000мс — подозрение на автоматизацию
    const withTimestamps = voices.filter(v => v.timestamp);
    if (withTimestamps.length >= 2) {
      const sorted = [...withTimestamps].sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 0; i < sorted.length - 1; i++) {
        const delta = sorted[i + 1].timestamp - sorted[i].timestamp;
        if (delta < 2000) {
          anomalies.push({
            type: 'bot_timing',
            description: `${sorted[i].persona} → ${sorted[i + 1].persona}: интервал ${delta}мс — бот-паттерн`,
            personas: [sorted[i].persona, sorted[i + 1].persona],
            deltaMs: delta,
            danger: 0.5,
          });
        }
      }
    }

    // ── 4. Отклонение от W-профиля ──
    // Лицо с историей kata-голосов вдруг голосует hyper (или наоборот)
    // Используем историю claims если есть
    if (this.claims && this.claims.length > 0) {
      for (const v of voices) {
        const historyClaims = this.claims.filter(c => c.source === v.persona);
        if (historyClaims.length < 3) continue;

        // Историческая полярность
        const avgPolarity = historyClaims.reduce((s, c) => s + c.polarity, 0) / historyClaims.length;
        // Текущая полярность голоса
        const currentPolarity = v.logos === 'kata' ? -1 : v.logos === 'hyper' ? 1 : 0;

        // Резкий разворот: средняя полярность отрицательная, а голос hyper (или наоборот)
        if (Math.abs(avgPolarity - currentPolarity) > 1.5) {
          anomalies.push({
            type: 'profile_deviation',
            description: `${v.persona}: историческая полярность ${avgPolarity.toFixed(2)}, текущий голос ${v.logos} — резкий разворот`,
            persona: v.persona,
            historicalPolarity: avgPolarity,
            currentLogos: v.logos,
            danger: 0.4,
          });
        }
      }
    }

    // ── Итоговый trust score ──
    // 1.0 минус сумма danger аномалий (нормализованная)
    const totalDanger = anomalies.reduce((s, a) => s + a.danger, 0);
    const trustScore = Math.max(0, Math.min(1, 1.0 - totalDanger / Math.max(voices.length, 1)));

    return { anomalies, trustScore };
  }

  /**
   * Jaccard similarity по множествам слов (для детекции эхо-камеры).
   */
  _jaccardSimilarity(textA, textB) {
    if (!textA || !textB) return 0;
    const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    for (const w of wordsA) if (wordsB.has(w)) intersection++;
    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════
  // SEVEN TRADITIONS OF DISCERNMENT
  // Семь традиций различения — от криминалистики до богословия
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 1. CBCA — Criteria-Based Content Analysis (Steller & Köhnken)
   * 19 критериев правдивости. Правдивый текст неровный, живой, с деталями.
   * Ложный — гладкий, логичный, без лишнего.
   * @returns {object} cbca score + criteria
   */
  cbcaAnalysis(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const words = text.split(/\s+/).length;
    const criteria = {};

    // C1: Логическая структура (связность)
    const connectors = (text.match(/потому что|поэтому|следовательно|так как|в результате|из-за/gi) || []).length;
    criteria.logicalStructure = { present: connectors > 0, score: Math.min(1, connectors / 3) };

    // C2: Неструктурированное изложение (не слишком линейно)
    const digressions = (text.match(/кстати|впрочем|к слову|забыл сказать|а ещё|вспомнил/gi) || []).length;
    criteria.unstructuredProduction = { present: digressions > 0, score: Math.min(1, digressions / 2) };

    // C3: Количество деталей
    const details = (text.match(/\d+|конкретн|точно|именно|в \d|около \d|примерно/gi) || []).length;
    criteria.quantityOfDetails = { present: details > 2, score: Math.min(1, details / 5) };

    // C4: Контекстная вложенность (время, место, обстоятельства)
    const context = (text.match(/когда|где|в то время|в тот момент|утром|вечером|в офисе|на встрече/gi) || []).length;
    criteria.contextualEmbedding = { present: context > 0, score: Math.min(1, context / 3) };

    // C5: Описание взаимодействий
    const interactions = (text.match(/сказал|ответил|спросил|попросил|предложил|показал|объяснил/gi) || []).length;
    criteria.interactionDescriptions = { present: interactions > 0, score: Math.min(1, interactions / 3) };

    // C6: Воспроизведение диалогов
    const dialogues = (text.match(/[«"„]|сказал[аи]?\s*:|—\s*[А-ЯЁ]/g) || []).length;
    criteria.reproductionOfConversation = { present: dialogues > 0, score: Math.min(1, dialogues / 2) };

    // C7: Неожиданные осложнения
    const complications = (text.match(/но потом|неожиданно|вдруг|оказалось|выяснилось/gi) || []).length;
    criteria.unexpectedComplications = { present: complications > 0, score: Math.min(1, complications / 2) };

    // C8: Необычные детали
    const unusual = (text.match(/странно|необычно|удивительно|почему-то|не знаю зачем/gi) || []).length;
    criteria.unusualDetails = { present: unusual > 0, score: Math.min(1, unusual / 2) };

    // C9: Лишние детали (не относящиеся к делу)
    const superfluous = (text.match(/кстати|к слову|не относится|мелочь но|деталь/gi) || []).length;
    criteria.superfluousDetails = { present: superfluous > 0, score: Math.min(1, superfluous / 2) };

    // C10: Признание непонимания
    const admitLack = (text.match(/не понял|не знаю|не помню|не уверен|сложно сказать|затрудняюсь/gi) || []).length;
    criteria.admittingLackOfMemory = { present: admitLack > 0, score: Math.min(1, admitLack / 2) };

    // C11: Самокоррекция
    const selfCorrect = (text.match(/нет, подожди|то есть|вернее|поправлюсь|уточню|я ошибся/gi) || []).length;
    criteria.selfCorrection = { present: selfCorrect > 0, score: Math.min(1, selfCorrect / 2) };

    // C12: Самоуничижение (говорит невыгодное о себе)
    const selfDeprecation = (text.match(/я виноват|моя ошибка|я мог бы лучше|признаю|не справился/gi) || []).length;
    criteria.selfDeprecation = { present: selfDeprecation > 0, score: Math.min(1, selfDeprecation / 2) };

    // Агрегация: чем больше критериев → тем правдивее
    const presentCount = Object.values(criteria).filter(c => c.present).length;
    const totalScore = Object.values(criteria).reduce((s, c) => s + c.score, 0) / 12;

    return {
      method: 'CBCA',
      criteriaPresent: presentCount,
      criteriaTotal: 12,
      score: +totalScore.toFixed(2),
      label: totalScore > 0.5 ? 'truthful_indicators' : totalScore > 0.25 ? 'mixed' : 'deceptive_indicators',
      criteria,
    };
  }

  /**
   * 2. IGNATIAN — Consolation/Desolation scoring
   * Утешение → благодарность, мир, щедрость. Уныние → тревога, замкнутость, срочность.
   */
  ignatianDiscernment(text) {
    const lc = text.toLowerCase();

    // Маркеры утешения (consolation)
    const consolation = {
      gratitude: (lc.match(/благодар|спасибо|признателен|ценю|рад/gi) || []).length,
      peace: (lc.match(/мир|спокойн|уверен|ясно|гармони|равновес/gi) || []).length,
      generosity: (lc.match(/дар|подели|помог|предлож|бескорыстн|щедр|открыт/gi) || []).length,
      joy: (lc.match(/рад|весел|свет|надежд|вдохновл|воодушевл/gi) || []).length,
      freedom: (lc.match(/свобод|выбор|можешь|открыт|простор|возможност/gi) || []).length,
    };

    // Маркеры уныния (desolation)
    const desolation = {
      anxiety: (lc.match(/тревог|беспоко|волну|страш|опас|паник/gi) || []).length,
      urgency: (lc.match(/срочно|немедленно|скорее|быстрее|пока не поздно/gi) || []).length,
      closure: (lc.match(/только|единственн|нет другого|невозможно|обречен/gi) || []).length,
      guilt: (lc.match(/должен|обязан|стыдно|виноват|неблагодарн/gi) || []).length,
      confusion: (lc.match(/запутал|не понимаю|хаос|бардак|всё сложно|ничего не ясно/gi) || []).length,
    };

    const consolationTotal = Object.values(consolation).reduce((s, v) => s + v, 0);
    const desolationTotal = Object.values(desolation).reduce((s, v) => s + v, 0);
    const total = consolationTotal + desolationTotal || 1;

    const spirit = consolationTotal > desolationTotal * 1.5 ? 'consolation'
      : desolationTotal > consolationTotal * 1.5 ? 'desolation'
      : 'mixed';

    return {
      method: 'Ignatian',
      spirit,
      consolation: { total: consolationTotal, ...consolation },
      desolation: { total: desolationTotal, ...desolation },
      ratio: +(consolationTotal / total).toFixed(2),
      // Правило Игнатия: в desolation не менять решений
      warning: spirit === 'desolation'
        ? 'В состоянии уныния не следует менять решений. Текст побуждает к срочному действию из тревоги.'
        : null,
    };
  }

  /**
   * 3. SOCRATIC — Генерация проверочных вопросов (элэнхос).
   * Берёт утверждения из текста → генерирует вопросы которые обнажают противоречия.
   */
  socraticQuestions(text) {
    const claims = [];
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);

    const questions = [];
    for (const s of sentences) {
      // Если есть числа → спросить источник
      if (/\d+\s*%|\d+\s*(?:млрд|млн|тыс|раз)/.test(s)) {
        questions.push({ claim: s.slice(0, 80), question: 'Откуда эта цифра? Какой источник и за какой период?', type: 'source' });
      }
      // Если «все/никто/всегда/никогда» → спросить про исключения
      if (/все |никто|всегда|никогда|каждый|любой/i.test(s)) {
        questions.push({ claim: s.slice(0, 80), question: 'Действительно все без исключения? Есть ли хоть один контрпример?', type: 'universality' });
      }
      // Если причинно-следственная связь → спросить про альтернативные объяснения
      if (/потому что|из-за|приводит к|следовательно|поэтому/i.test(s)) {
        questions.push({ claim: s.slice(0, 80), question: 'Есть ли другие возможные причины? Корреляция не значит причинность.', type: 'causation' });
      }
      // Если оценочное суждение → спросить по каким критериям
      if (/лучш|худш|эффективн|оптимальн|идеальн|превосход/i.test(s)) {
        questions.push({ claim: s.slice(0, 80), question: 'По каким критериям это лучше? Для кого? В каком контексте?', type: 'criteria' });
      }
      // Если рекомендация → спросить про последствия
      if (/нужно|следует|необходимо|стоит|рекомендую/i.test(s)) {
        questions.push({ claim: s.slice(0, 80), question: 'Какие риски у этого решения? Что если оно не сработает?', type: 'consequences' });
      }
    }

    return {
      method: 'Socratic',
      questionsGenerated: questions.length,
      questions: questions.slice(0, 10), // max 10
    };
  }

  /**
   * 4. ADVERSARIAL — Условия фальсификации.
   * Каждый агент должен сформулировать при каком условии он неправ.
   * Если не может → его позиция нефальсифицируема = ненаучна.
   */
  adversarialCheck(text) {
    const lc = text.toLowerCase();
    // Проверяем: есть ли в тексте условия собственной неправоты?
    const falsifiability = (lc.match(/если окажется|если я неправ|при условии что|если данные покажут|готов пересмотреть|могу ошибаться/gi) || []).length;
    const certainty = (lc.match(/бесспорно|однозначно|неоспоримо|абсолютно точно|гарантирую|без сомнений/gi) || []).length;
    const hedging = (lc.match(/возможно|вероятно|предполагаю|гипотеза|оценка|по моим данным/gi) || []).length;

    const score = Math.min(1, (falsifiability * 0.3 + hedging * 0.15) / Math.max(1, certainty * 0.3 + 0.1));

    return {
      method: 'Adversarial',
      falsifiable: falsifiability > 0,
      falsifiabilityMarkers: falsifiability,
      certaintyMarkers: certainty,
      hedgingMarkers: hedging,
      score: +score.toFixed(2),
      label: falsifiability > 0 ? 'falsifiable' : certainty > 1 ? 'dogmatic' : 'assertive',
      warning: certainty > 2 && falsifiability === 0
        ? 'Позиция нефальсифицируема: ни одного условия при котором автор готов признать ошибку.'
        : null,
    };
  }

  /**
   * 5. TALMUDIC — Контекстная истина (махлокет).
   * Не «кто прав», а «в каком контексте что истинно».
   * Определяет: это абсолютное утверждение или контекстно-зависимое?
   */
  talmudicAnalysis(text) {
    const lc = text.toLowerCase();
    // Маркеры абсолютности
    const absolute = (lc.match(/всегда|никогда|абсолютно|безусловно|в любом случае|при любых/gi) || []).length;
    // Маркеры контекстности
    const contextual = (lc.match(/в данном случае|в этом контексте|для нашей ситуации|зависит от|при условии|с точки зрения/gi) || []).length;
    // Маркеры множественности истин
    const plural = (lc.match(/с одной стороны|с другой|и то и другое|оба правы|каждый видит|парадокс/gi) || []).length;

    const isAbsolute = absolute > contextual + plural;

    return {
      method: 'Talmudic',
      absolute, contextual, plural,
      type: isAbsolute ? 'absolute_claim' : plural > 0 ? 'mahloket' : 'contextual_claim',
      warning: isAbsolute && absolute > 2
        ? 'Утверждение претендует на абсолютность. Талмудическая традиция: «и то и другое — слова Бога живого». В каком контексте это НЕ истинно?'
        : null,
    };
  }

  /**
   * 6. FORMAL LOGIC — Проверка логической структуры (через LLM).
   * Обнаружение формальных и неформальных fallacies.
   * @param {Function?} llmCall — async (prompt) => string
   */
  async formalLogicCheck(text, llmCall) {
    if (!llmCall || text.length < 60) return { method: 'FormalLogic', skipped: true };

    const prompt = `Проверь текст на логические ошибки (fallacies). Для каждой найденной:
- назови тип (ad hominem, strawman, red herring, slippery slope, circular reasoning, false cause, appeal to emotion, etc.)
- процитируй фрагмент
- объясни в чём ошибка
Ответь СТРОГО в JSON: [{"type":"тип","snippet":"цитата","explanation":"пояснение"}]
Если ошибок нет — верни [].

ТЕКСТ:
${text.slice(0, 1500)}`;

    try {
      const raw = await llmCall(prompt);
      const match = raw.match(/\[[\s\S]*?\]/);
      if (!match) return { method: 'FormalLogic', fallacies: [], clean: true };
      const fallacies = JSON.parse(match[0]);
      return {
        method: 'FormalLogic',
        fallacies,
        clean: fallacies.length === 0,
        count: fallacies.length,
      };
    } catch {
      return { method: 'FormalLogic', error: 'LLM unavailable' };
    }
  }

  /**
   * 7. PATRISTIC — Различение по плодам (Мф 7:16).
   * Не можем различать духов (это дар Духа), но можем различать плоды.
   * Плоды Духа: любовь, радость, мир, терпение, благость, милосердие,
   *             вера, кротость, воздержание (Гал 5:22-23).
   * Плоды плоти: вражда, ссоры, зависть, гнев, распри,
   *              разделения, ереси, зависть (Гал 5:19-21).
   */
  patristicDiscernment(text) {
    const lc = text.toLowerCase();

    const spiritFruits = {
      love: (lc.match(/люб|забот|принят|сострадан|ближн/gi) || []).length,
      joy: (lc.match(/радост|весел|торжеств|ликован|празднов/gi) || []).length,
      peace: (lc.match(/мир |покой|тиш|спокойств|гармони/gi) || []).length,
      patience: (lc.match(/терпени|ожидани|постепенн|не торопи|медленн/gi) || []).length,
      kindness: (lc.match(/добр|благ|щедр|великодуш|мягк/gi) || []).length,
      mercy: (lc.match(/милосерд|прощен|сострадан|жалос|помилова/gi) || []).length,
      faithfulness: (lc.match(/верн|надёжн|постоянств|преданн|доверя/gi) || []).length,
      gentleness: (lc.match(/кротк|смирен|тих|скромн|мягк/gi) || []).length,
      selfControl: (lc.match(/воздержан|самообладан|сдержанн|умеренн|трезв/gi) || []).length,
    };

    const fleshFruits = {
      enmity: (lc.match(/враг|ненавис|враждеб|злоб|злост/gi) || []).length,
      strife: (lc.match(/ссор|конфликт|столкновен|скандал|раздор/gi) || []).length,
      jealousy: (lc.match(/завист|ревност|завидов|соперничеств/gi) || []).length,
      anger: (lc.match(/гнев|яростн|злост|бешенств|раздражен/gi) || []).length,
      division: (lc.match(/раскол|разделени|расщеплен|противостоян|поляризац/gi) || []).length,
      fear: (lc.match(/страх|ужас|кошмар|паник|фоби/gi) || []).length,
      pride: (lc.match(/гордын|высокомери|презрени|надменн|превосходств/gi) || []).length,
    };

    const spiritTotal = Object.values(spiritFruits).reduce((s, v) => s + v, 0);
    const fleshTotal = Object.values(fleshFruits).reduce((s, v) => s + v, 0);
    const total = spiritTotal + fleshTotal || 1;

    const spirit = spiritTotal > fleshTotal * 2 ? 'Spirit'
      : fleshTotal > spiritTotal * 2 ? 'flesh'
      : spiritTotal > fleshTotal ? 'leaning_Spirit'
      : fleshTotal > spiritTotal ? 'leaning_flesh'
      : 'indeterminate';

    return {
      method: 'Patristic',
      reference: 'Гал 5:22-23 vs Гал 5:19-21',
      spirit,
      spiritFruits: { total: spiritTotal, ...spiritFruits },
      fleshFruits: { total: fleshTotal, ...fleshFruits },
      ratio: +(spiritTotal / total).toFixed(2),
      // НЕ утверждаем что различаем духов — только плоды
      caveat: 'Различение по плодам — не различение духов. Последнее — дар Духа Святого (1 Кор 12:10), не алгоритм.',
    };
  }

  /**
   * Полное различение: все 7 традиций одним вызовом.
   * @param {Function?} llmCall — для FormalLogic
   */
  async fullDiscernment(text, source, llmCall) {
    const cbca = this.cbcaAnalysis(text);
    const ignatian = this.ignatianDiscernment(text);
    const socratic = this.socraticQuestions(text);
    const adversarial = this.adversarialCheck(text);
    const talmudic = this.talmudicAnalysis(text);
    const formalLogic = await this.formalLogicCheck(text, llmCall);
    const patristic = this.patristicDiscernment(text);

    // Сводный вердикт
    const signals = {
      truthful: cbca.score > 0.4 ? 1 : 0,
      consolation: ignatian.spirit === 'consolation' ? 1 : ignatian.spirit === 'desolation' ? -1 : 0,
      falsifiable: adversarial.falsifiable ? 1 : adversarial.label === 'dogmatic' ? -1 : 0,
      contextual: talmudic.type === 'mahloket' ? 1 : talmudic.type === 'absolute_claim' ? -1 : 0,
      logicallySound: formalLogic.clean ? 1 : formalLogic.count > 2 ? -1 : 0,
      spiritFruits: patristic.spirit === 'Spirit' ? 1 : patristic.spirit === 'flesh' ? -1 : 0,
    };
    const signalSum = Object.values(signals).reduce((s, v) => s + v, 0);

    return {
      traditions: { cbca, ignatian, socratic, adversarial, talmudic, formalLogic, patristic },
      signals,
      signalSum,
      discernment: signalSum >= 3 ? 'trustworthy'
        : signalSum >= 1 ? 'cautious'
        : signalSum >= -1 ? 'suspicious'
        : 'untrustworthy',
      questions: socratic.questions.slice(0, 5),
      warnings: [
        ignatian.warning,
        adversarial.warning,
        talmudic.warning,
      ].filter(Boolean),
    };
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
    const gifts = /спасибо|благодар|помогло|ценю|научил|открыл глаза|не знал|интересн|глубок|полезн|рад что/gi;
    const questions = /\?|почему|как именно|зачем|что если|а если|а как|интересно ли/gi;
    const vulnerability = /не уверен|не знаю|сложно|трудно|боюсь|переживаю|ошибся|был неправ|могу ошибаться|признаю/gi;
    const bridging = /согласен с|хорошая мысль|ты прав|дополню|развивая|да, и |поддерживаю|с одной стороны|с другой/gi;
    const specificity = /конкретн|например|в частности|\d+%|\d+\s*(?:млн|млрд|руб|год)|по данным/gi;

    const giftCount = (text.match(gifts) || []).length;
    const questionCount = (text.match(questions) || []).length;
    const vulnerabilityCount = (text.match(vulnerability) || []).length;
    const bridgingCount = (text.match(bridging) || []).length;
    const specificityCount = (text.match(specificity) || []).length;

    // Формула: сумма индикаторов, нормализованная по длине текста (мягко)
    const words = text.split(/\s+/).length;
    const rawScore = giftCount * 2 + questionCount * 1.5 + vulnerabilityCount * 3 + bridgingCount * 2 + specificityCount * 1;
    const lengthFactor = Math.max(1, Math.sqrt(words / 10)); // мягкая нормализация
    const healthScore = Math.min(1, rawScore / (lengthFactor * 3));

    return {
      score: +healthScore.toFixed(2),
      label: healthScore > 0.5 ? 'здоровый' :
             healthScore > 0.2 ? 'нормальный' :
             healthScore > 0.05 ? 'формальный' : 'мёртвый',
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
