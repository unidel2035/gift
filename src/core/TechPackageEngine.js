/**
 * TechPackageEngine — Оценка технологических пакетов по С.Б. Переслегину
 *
 * Технологический пакет = ядро + пакет + периферия + замыкающая технология
 *
 * Пример из авиации:
 *   Ядро: крыло (аэродинамика)
 *   Пакет: двигатель, навигация, материалы
 *   Периферия: комфорт, развлечения, логистика
 *   Замыкающая: подготовка пилотов (без неё — катастрофы)
 *
 * Для рынка БАС (БПЛА):
 *   Ядро: летательная платформа (планер, движитель)
 *   Пакет: навигация, полезная нагрузка, связь, энергетика
 *   Периферия: AI-обработка, аналитика, страхование, сервис
 *   Замыкающая: квалифицированный заказчик + подготовка операторов
 *
 * Онтология дара ВЫЧИСЛЯЕТ:
 *   1. Куда текут дары? (в ядро, пакет, периферию или замыкающую)
 *   2. Где разомкнут пакет? (слой без входящих даров = дефицит)
 *   3. Стартап: какой слой он замыкает? (ценность для фонда НТИ)
 *
 * «Без замыкающей технологии пакет не работает — он просто стоит»
 *    — С.Б. Переслегин
 */

// ═══════════════════════════════════════════════════════════════
// TECHNOLOGY PACKAGE DEFINITION FOR UAS MARKET
// ═══════════════════════════════════════════════════════════════

const UAS_PACKAGE = {
  name: 'Беспилотные авиационные системы (БАС)',

  layers: [
    {
      id: 'core',
      name: 'Ядро',
      nameEn: 'Core',
      description: 'Фундаментальная технология, определяющая пакет',
      color: '#e74c3c',
      technologies: [
        { id: 'airframe', name: 'Планер / аэродинамика', keywords: ['планер', 'рам', 'крыл', 'аэродинам', 'фюзеляж', 'БПЛА', 'дрон', 'платформ', 'конструкц'] },
        { id: 'propulsion', name: 'Движитель / двигатель', keywords: ['двигател', 'мотор', 'пропеллер', 'тяг', 'винт', 'электро', 'ДВС', 'турбин'] },
      ],
    },
    {
      id: 'package',
      name: 'Пакет',
      nameEn: 'Package',
      description: 'Поддерживающие технологии, необходимые для функционирования ядра',
      color: '#f39c12',
      technologies: [
        { id: 'navigation', name: 'Навигация / GNSS / INS', keywords: ['навигац', 'GNSS', 'GPS', 'ГЛОНАСС', 'INS', 'инерциальн', 'автопилот', 'маршрут'] },
        { id: 'payload', name: 'Полезная нагрузка', keywords: ['камер', 'сенсор', 'лидар', 'мультиспектр', 'тепловизор', 'радар', 'полезн', 'нагрузк', 'фото', 'видео'] },
        { id: 'comms', name: 'Связь и управление', keywords: ['связ', 'канал', 'управлен', 'телеметри', 'радио', 'C2', 'командн', 'линк', 'ретранслят'] },
        { id: 'energy', name: 'Энергетика', keywords: ['батаре', 'аккумулят', 'энерг', 'заряд', 'водород', 'топливн', 'ячейк', 'мАч', 'Вт'] },
        { id: 'materials', name: 'Материалы', keywords: ['композит', 'углепласт', 'материал', 'карбон', 'титан', 'сплав'] },
      ],
    },
    {
      id: 'periphery',
      name: 'Периферия',
      nameEn: 'Periphery',
      description: 'Расширяющие технологии — усиливают, но не критичны',
      color: '#3498db',
      technologies: [
        { id: 'ai_processing', name: 'AI-обработка данных', keywords: ['ИИ', 'AI', 'нейросет', 'машинн', 'обучен', 'алгоритм', 'распознав', 'детекц', 'компьютерн', 'автоном'] },
        { id: 'analytics', name: 'Аналитика и визуализация', keywords: ['аналитик', 'визуализац', 'дашборд', 'отчёт', 'статистик', 'мониторинг', 'карт'] },
        { id: 'insurance', name: 'Страхование и ответственность', keywords: ['страхов', 'ответственн', 'риск', 'ущерб', 'компенсац'] },
        { id: 'maintenance', name: 'Сервис и обслуживание', keywords: ['сервис', 'обслуживан', 'ремонт', 'запчаст', 'диагностик', 'ТО'] },
        { id: 'logistics', name: 'Логистика и доставка', keywords: ['логистик', 'доставк', 'склад', 'транспорт', 'цепочк'] },
      ],
    },
    {
      id: 'closing',
      name: 'Замыкающая',
      nameEn: 'Closing',
      description: 'Без этой технологии ВЕСЬ пакет не работает. Не периферия — фундамент применения.',
      color: '#9b59b6',
      technologies: [
        { id: 'swarm_ai', name: 'ИИ управления роем', keywords: ['рой', 'рое', 'swarm', 'групп', 'коллектив', 'автоном', 'координац', 'кооперац', 'мульти-агент', 'мультиагент', 'распределён', 'децентрализ', 'формац'] },
        { id: 'operator_training', name: 'Подготовка операторов', keywords: ['обучен', 'подготовк', 'оператор', 'пилот', 'курс', 'сертифик', 'квалификац', 'кадр', 'выпускник', 'инженер'] },
        { id: 'qualified_customer', name: 'Квалифицированный заказчик', keywords: ['заказчик', 'применен', 'внедрен', 'эксплуатац', 'методолог', 'готовност', 'оценк', 'аудит', 'масштабир'] },
        { id: 'regulation', name: 'Регуляторика и стандарты', keywords: ['стандарт', 'регламент', 'сертифик', 'регулят', 'допуск', 'воздушн', 'пространств', 'безопасн', 'нормат'] },
        { id: 'ecosystem', name: 'Экосистемная координация', keywords: ['экосистем', 'координац', 'платформ', 'интеграц', 'знани', 'данн', 'рынок', 'управлен', 'roadmap'] },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// REAL MARKET DATA — prices, costs, ROI by industry
// ═══════════════════════════════════════════════════════════════

const MARKET_DATA = {
  // Цены на БПЛА (реальные российский рынок 2024-2025)
  dronePrices: [
    { name: 'Геоскан Gemini', type: 'мультиротор', price: 2500000, layer: 'core', maker: 'Геоскан' },
    { name: 'Геоскан 401', type: 'самолёт', price: 3200000, layer: 'core', maker: 'Геоскан' },
    { name: 'ZALA 421-16E', type: 'самолёт', price: 6000000, layer: 'core', maker: 'ZALA AERO GROUP' },
    { name: 'Supercam S350', type: 'самолёт', price: 4500000, layer: 'core', maker: 'Supercam' },
    { name: 'Орион (Иноходец)', type: 'тяжёлый БПЛА', price: 180000000, layer: 'core', maker: 'Кронштадт' },
    { name: 'Аэромакс AMS-100', type: 'агродрон', price: 1800000, layer: 'core', maker: 'Аэромакс' },
    { name: 'DJI Matrice 350 RTK', type: 'мультиротор', price: 950000, layer: 'core', maker: 'DJI (импорт)' },
    { name: 'DJI Agras T40', type: 'агродрон', price: 1200000, layer: 'core', maker: 'DJI (импорт)' },
  ],

  // Стоимость применения по отраслям
  industries: [
    {
      id: 'agro', name: 'Сельское хозяйство',
      costPerUnit: '300-800 руб/га', unitName: 'га',
      annualMarket: 15000000000, // 15 млрд руб
      roiPercent: 180,
      savingsExample: 'Мониторинг 1000 га: БПЛА ~500К vs наземный ~2.5М → экономия 2М руб/сезон',
      closingGap: 'Нет квалифицированных агрономов-операторов. Фермеры не знают, что спросить.',
      giftFlow: 'mass→information (данные с полей → знание о посевах)',
    },
    {
      id: 'energy', name: 'Энергетика (ЛЭП)',
      costPerUnit: '5000-15000 руб/км', unitName: 'км',
      annualMarket: 8000000000, // 8 млрд руб
      roiPercent: 320,
      savingsExample: 'Инспекция 100 км ЛЭП: БПЛА ~1.5М vs вертолёт ~8М → экономия 6.5М руб',
      closingGap: 'Россети хотят, но нет стандартов приёмки данных. Каждый подрядчик — свой формат.',
      giftFlow: 'energy→information (полёт → данные о состоянии ЛЭП)',
    },
    {
      id: 'construction', name: 'Строительство',
      costPerUnit: '50-150К руб/миссия', unitName: 'объект',
      annualMarket: 5000000000, // 5 млрд руб
      roiPercent: 250,
      savingsExample: 'Фотограмметрия стройплощадки: БПЛА ~100К vs геодезия ~600К → экономия 500К',
      closingGap: 'Застройщики не понимают, зачем им БПЛА. Нет методологии интеграции в BIM.',
      giftFlow: 'mass→information→energy (съёмка → 3D-модель → оптимизация работ)',
    },
    {
      id: 'oil_gas', name: 'Нефтегаз',
      costPerUnit: '100-500К руб/миссия', unitName: 'объект',
      annualMarket: 12000000000, // 12 млрд руб
      roiPercent: 400,
      savingsExample: 'Мониторинг трубопровода 200 км: БПЛА ~3М vs вертолёт ~15М → экономия 12М',
      closingGap: 'Режим секретности + требования безопасности. Нет сертифицированных решений.',
      giftFlow: 'energy→information (облёт → детекция утечек)',
    },
    {
      id: 'railway', name: 'Железные дороги',
      costPerUnit: '8000-20000 руб/км', unitName: 'км',
      annualMarket: 3000000000, // 3 млрд руб
      roiPercent: 200,
      savingsExample: 'Инспекция 50 км путей: БПЛА ~1М vs ручная ~4М → экономия 3М',
      closingGap: 'РЖД — госмонополия, медленные закупки. Пилотные проекты не масштабируются.',
      giftFlow: 'energy→mass (инспекция → ремонт инфраструктуры)',
    },
    {
      id: 'forestry', name: 'Лесное хозяйство',
      costPerUnit: '200-500 руб/га', unitName: 'га',
      annualMarket: 4000000000, // 4 млрд руб
      roiPercent: 150,
      savingsExample: 'Мониторинг 5000 га леса: БПЛА ~2.5М vs наземный ~8М → экономия 5.5М',
      closingGap: 'Лесничества не оцифрованы. Нет кадров. Бюджеты минимальны.',
      giftFlow: 'energy→information (облёт → карта лесных ресурсов)',
    },
    {
      id: 'emergency', name: 'МЧС / спасение',
      costPerUnit: '50-200К руб/вылет', unitName: 'вылет',
      annualMarket: 2000000000, // 2 млрд руб
      roiPercent: 0, // ROI не считается — спасение жизней
      savingsExample: 'Поиск пропавших: БПЛА покрывает 10 км²/час vs пеший ~2 км²/час',
      closingGap: 'Нет интеграции в оперативные протоколы. БПЛА — «игрушка» для МЧС.',
      giftFlow: 'energy→mass (поиск → спасение жизней)',
    },
    {
      id: 'delivery', name: 'Доставка грузов',
      costPerUnit: '500-2000 руб/доставка', unitName: 'доставка',
      annualMarket: 1000000000, // 1 млрд руб (зарождающийся)
      roiPercent: 80,
      savingsExample: 'Доставка в удалённый посёлок: БПЛА ~1.5К vs вертолёт ~50К → экономия 48.5К',
      closingGap: 'Регуляторика запрещает полёты над населёнными пунктами. UTM-систем нет.',
      giftFlow: 'mass→mass (перемещение грузов)',
    },
  ],

  // Стоимость подготовки кадров (замыкающая технология!)
  training: {
    operator: { name: 'Оператор БПЛА', cost: 150000, duration: '2-4 недели', demand: 50000 },
    engineer: { name: 'Инженер БПЛА', cost: 300000, duration: '6-12 месяцев', demand: 10000 },
    dataAnalyst: { name: 'Аналитик данных БПЛА', cost: 200000, duration: '3-6 месяцев', demand: 20000 },
    qualifiedCustomer: { name: 'Квалифицированный заказчик', cost: 100000, duration: '1-2 недели', demand: 100000 },
  },

  // Общий рынок
  totalMarket: {
    2024: 55000000000,   // ~55 млрд руб
    2025: 80000000000,   // ~80 млрд руб (прогноз)
    2027: 200000000000,  // ~200 млрд руб
    2030: 1000000000000, // ~1 трлн руб (цель НТИ)
  },
};

export class TechPackageEngine {
  constructor(giftEngine) {
    this._engine = giftEngine;
    this._package = UAS_PACKAGE;
    this._market = MARKET_DATA;
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. CLASSIFY — в какой слой пакета попадает дар?
  // ═══════════════════════════════════════════════════════════════

  classifyGiftToLayer(gift) {
    const text = `${gift.content || ''} ${gift.cost || ''} ${gift.telos || ''}`.toLowerCase();
    const scores = {};

    for (const layer of this._package.layers) {
      let layerScore = 0;
      const matchedTechs = [];

      for (const tech of layer.technologies) {
        let techScore = 0;
        for (const kw of tech.keywords) {
          if (text.includes(kw.toLowerCase())) techScore++;
        }
        if (techScore > 0) {
          matchedTechs.push({ id: tech.id, name: tech.name, score: techScore });
          layerScore += techScore;
        }
      }

      scores[layer.id] = { score: layerScore, technologies: matchedTechs };
    }

    // Determine dominant layer
    let maxScore = 0;
    let dominant = 'unknown';
    for (const [layerId, data] of Object.entries(scores)) {
      if (data.score > maxScore) {
        maxScore = data.score;
        dominant = layerId;
      }
    }

    return { dominant, scores };
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. ANALYZE PACKAGE — полный анализ технологического пакета
  // ═══════════════════════════════════════════════════════════════

  analyzePackage() {
    const gifts = this._engine._gifts.filter(g => g.status === 'accepted');
    const persons = this._engine.persons.all();

    // Classify all gifts into layers
    const layerGifts = { core: [], package: [], periphery: [], closing: [] };
    const layerValues = { core: 0, package: 0, periphery: 0, closing: 0 };

    for (const gift of gifts) {
      const classification = this.classifyGiftToLayer(gift);
      const layer = classification.dominant;
      if (layerGifts[layer]) {
        layerGifts[layer].push({
          id: gift.id,
          giver: this._engine.persons.resolve(gift.giver)?.name || gift.giver,
          receiver: gift.receiver === 'all' ? 'Все' : (this._engine.persons.resolve(gift.receiver)?.name || gift.receiver),
          content: gift.content,
          layer,
          scores: classification.scores,
        });
        layerValues[layer]++;
      }
    }

    const totalGifts = gifts.length || 1;

    // Package completeness per layer
    const layerAnalysis = this._package.layers.map(layer => {
      const giftCount = layerGifts[layer.id].length;
      const techCoverage = {};

      // Which technologies in this layer have gifts?
      for (const tech of layer.technologies) {
        const covered = layerGifts[layer.id].some(g =>
          g.scores[layer.id]?.technologies.some(t => t.id === tech.id)
        );
        techCoverage[tech.id] = { name: tech.name, covered };
      }

      const coveredCount = Object.values(techCoverage).filter(t => t.covered).length;
      const totalTech = layer.technologies.length;
      const completeness = totalTech > 0 ? coveredCount / totalTech : 0;

      return {
        id: layer.id,
        name: layer.name,
        nameEn: layer.nameEn,
        description: layer.description,
        color: layer.color,
        giftCount,
        giftShare: Math.round(giftCount / totalGifts * 1000) / 1000,
        technologies: techCoverage,
        coveredTech: coveredCount,
        totalTech,
        completeness: Math.round(completeness * 1000) / 1000,
        gifts: layerGifts[layer.id],
      };
    });

    // ═══════════════════════════════════════════════════════════════
    // 3. GAPS — где пакет разомкнут?
    // ═══════════════════════════════════════════════════════════════

    const gaps = [];
    for (const layer of layerAnalysis) {
      for (const [techId, tech] of Object.entries(layer.technologies)) {
        if (!tech.covered) {
          gaps.push({
            layer: layer.id,
            layerName: layer.name,
            layerColor: layer.color,
            technology: techId,
            technologyName: tech.name,
            criticality: layer.id === 'closing' ? 'critical' : layer.id === 'core' ? 'high' : layer.id === 'package' ? 'medium' : 'low',
            message: layer.id === 'closing'
              ? `ЗАМЫКАЮЩАЯ ТЕХНОЛОГИЯ ОТСУТСТВУЕТ: ${tech.name}. Без неё весь пакет не работает.`
              : `Разрыв в слое "${layer.name}": ${tech.name} не покрыта дарами.`,
          });
        }
      }
    }

    // Sort: closing gaps first, then core, then package, then periphery
    const layerPriority = { closing: 0, core: 1, package: 2, periphery: 3 };
    gaps.sort((a, b) => layerPriority[a.layer] - layerPriority[b.layer]);

    // ═══════════════════════════════════════════════════════════════
    // 4. PERSONS → LAYER MAPPING (кто какой слой замыкает)
    // ═══════════════════════════════════════════════════════════════

    const personLayers = {};
    for (const person of persons) {
      const personGifts = gifts.filter(g => g.giver === person.id || g.giver === person.name);
      const layerCounts = { core: 0, package: 0, periphery: 0, closing: 0 };

      for (const gift of personGifts) {
        const cl = this.classifyGiftToLayer(gift);
        if (layerCounts[cl.dominant] !== undefined) layerCounts[cl.dominant]++;
      }

      const total = Object.values(layerCounts).reduce((s, v) => s + v, 0) || 1;
      let primaryLayer = 'unknown';
      let maxCount = 0;
      for (const [l, c] of Object.entries(layerCounts)) {
        if (c > maxCount) { maxCount = c; primaryLayer = l; }
      }

      personLayers[person.id] = {
        name: person.name,
        calling: person.calling,
        primaryLayer,
        layers: {
          core: Math.round(layerCounts.core / total * 1000) / 1000,
          package: Math.round(layerCounts.package / total * 1000) / 1000,
          periphery: Math.round(layerCounts.periphery / total * 1000) / 1000,
          closing: Math.round(layerCounts.closing / total * 1000) / 1000,
        },
        giftsGiven: personGifts.length,
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. PACKAGE CLOSURE SCORE
    // ═══════════════════════════════════════════════════════════════

    const coreComplete = layerAnalysis.find(l => l.id === 'core')?.completeness || 0;
    const packageComplete = layerAnalysis.find(l => l.id === 'package')?.completeness || 0;
    const closingComplete = layerAnalysis.find(l => l.id === 'closing')?.completeness || 0;

    // Package is only as strong as its weakest critical layer
    // Closing technology has disproportionate weight (Pereslegin's insight)
    const packageClosureScore = Math.round(
      (coreComplete * 0.25 + packageComplete * 0.25 + closingComplete * 0.5) * 1000
    ) / 1000;

    let packageStatus;
    if (closingComplete < 0.25) {
      packageStatus = 'Пакет разомкнут — замыкающие технологии критически недостаточны. Как авиация без пилотов.';
    } else if (closingComplete < 0.5) {
      packageStatus = 'Пакет частично замкнут — замыкающие технологии в зачатке. Рынок может работать в пилотном режиме.';
    } else if (closingComplete < 0.75) {
      packageStatus = 'Пакет почти замкнут — замыкающие технологии развиваются. Рынок может масштабироваться.';
    } else {
      packageStatus = 'Пакет замкнут — все слои покрыты. Рынок способен к самовоспроизводству.';
    }

    return {
      package: {
        name: this._package.name,
        closureScore: packageClosureScore,
        status: packageStatus,
        layers: layerAnalysis,
      },
      gaps,
      gapCount: gaps.length,
      criticalGaps: gaps.filter(g => g.criticality === 'critical').length,
      persons: Object.values(personLayers).sort((a, b) => b.giftsGiven - a.giftsGiven),
      market: this._market,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. EVALUATE STARTUP — оценка стартапа для фонда НТИ
  // ═══════════════════════════════════════════════════════════════

  evaluateStartup({ name, description, products, targetIndustry, teamSize, askAmount }) {
    const text = `${name} ${description} ${products || ''} ${targetIndustry || ''}`.toLowerCase();

    // 1. What layer does this startup target?
    const layerScores = {};
    for (const layer of this._package.layers) {
      let score = 0;
      const matched = [];
      for (const tech of layer.technologies) {
        let techScore = 0;
        for (const kw of tech.keywords) {
          if (text.includes(kw.toLowerCase())) techScore++;
        }
        if (techScore > 0) {
          matched.push(tech.name);
          score += techScore;
        }
      }
      layerScores[layer.id] = { score, matchedTechs: matched };
    }

    let primaryLayer = 'unknown';
    let maxScore = 0;
    for (const [l, data] of Object.entries(layerScores)) {
      if (data.score > maxScore) { maxScore = data.score; primaryLayer = l; }
    }

    // 2. How critical is this layer to package closure?
    const layerInfo = this._package.layers.find(l => l.id === primaryLayer);
    const layerWeight = { core: 0.25, package: 0.2, periphery: 0.1, closing: 0.45 };
    const strategicValue = layerWeight[primaryLayer] || 0;

    // 3. Does this startup close a gap?
    const packageAnalysis = this.analyzePackage();
    const closedGaps = packageAnalysis.gaps.filter(gap => {
      const layerData = layerScores[gap.layer];
      return layerData && layerData.matchedTechs.some(t => t.includes(gap.technologyName) || gap.technologyName.includes(t));
    });

    // 4. Market opportunity
    const industry = this._market.industries.find(i =>
      text.includes(i.id) || text.includes(i.name.toLowerCase())
    );

    // 5. What gift could this startup offer to the ecosystem?
    const potentialGifts = [];
    if (primaryLayer === 'closing') {
      potentialGifts.push({
        type: 'Замыкающий дар',
        description: `${name} может замкнуть пакет, дав рынку то, чего не хватает: ${layerScores.closing.matchedTechs.join(', ')}`,
        value: 'Критически высокая — без этого дара пакет не работает',
      });
    }
    if (primaryLayer === 'core') {
      potentialGifts.push({
        type: 'Ядерный дар',
        description: `${name} усиливает ядро пакета: ${layerScores.core.matchedTechs.join(', ')}`,
        value: 'Высокая — но ядро уже имеет участников',
      });
    }
    if (primaryLayer === 'package' || primaryLayer === 'periphery') {
      potentialGifts.push({
        type: primaryLayer === 'package' ? 'Пакетный дар' : 'Периферийный дар',
        description: `${name} развивает ${layerInfo?.name || primaryLayer}: ${layerScores[primaryLayer].matchedTechs.join(', ')}`,
        value: primaryLayer === 'package' ? 'Средняя — необходимо, но заменимо' : 'Низкая — усиливает, но не критично',
      });
    }

    // 6. Score
    let ntiScore = 0;
    ntiScore += strategicValue * 40; // Layer importance: up to 18
    ntiScore += (closedGaps.length / Math.max(1, packageAnalysis.gapCount)) * 30; // Gap closure
    ntiScore += (industry ? industry.roiPercent / 400 * 15 : 5); // Market ROI
    ntiScore += (primaryLayer === 'closing' ? 15 : primaryLayer === 'core' ? 8 : primaryLayer === 'package' ? 5 : 2); // Layer bonus
    ntiScore = Math.min(100, Math.round(ntiScore));

    // 7. Recommendation
    let recommendation;
    if (ntiScore >= 70) {
      recommendation = `РЕКОМЕНДУЕТСЯ К ПОДДЕРЖКЕ. ${name} замыкает критический разрыв в технологическом пакете БАС.`;
    } else if (ntiScore >= 40) {
      recommendation = `РАССМОТРЕТЬ. ${name} вносит вклад в пакет, но не является критической замыкающей технологией.`;
    } else {
      recommendation = `НИЗКИЙ ПРИОРИТЕТ. ${name} развивает ${layerInfo?.name || 'неопределённый'} слой — уже покрытый или некритичный.`;
    }

    return {
      startup: { name, description, products, targetIndustry, teamSize, askAmount },
      evaluation: {
        primaryLayer,
        layerName: layerInfo?.name || 'Не определён',
        layerColor: layerInfo?.color || '#999',
        strategicValue: Math.round(strategicValue * 100),
        matchedTechnologies: layerScores[primaryLayer]?.matchedTechs || [],
        closedGaps: closedGaps.map(g => ({ layer: g.layerName, tech: g.technologyName, criticality: g.criticality })),
        potentialGifts,
        ntiScore,
        recommendation,
        marketOpportunity: industry ? {
          industry: industry.name,
          annualMarket: industry.annualMarket,
          roi: industry.roiPercent,
          closingGap: industry.closingGap,
        } : null,
      },
      layerScores,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. MARKET DATA — реальные цены и обороты
  // ═══════════════════════════════════════════════════════════════

  getMarketData() {
    return this._market;
  }

  getIndustryAnalysis() {
    return this._market.industries.map(ind => ({
      ...ind,
      annualMarketLabel: this._formatRubles(ind.annualMarket),
      closingTechNeeded: ind.closingGap,
    }));
  }

  _formatRubles(amount) {
    if (amount >= 1000000000000) return `${(amount / 1000000000000).toFixed(1)} трлн руб`;
    if (amount >= 1000000000) return `${(amount / 1000000000).toFixed(0)} млрд руб`;
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(0)} млн руб`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(0)} тыс руб`;
    return `${amount} руб`;
  }
}
