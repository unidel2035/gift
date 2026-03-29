/**
 * EnvironmentLayer — среда определяет объект, объект строит среду
 *
 * Один принцип через все науки:
 *
 * ФИЗИКА: поле → частица (вихрь в среде)
 *   «Частицы — процессы взаимодействия полей» (Relational Ontology)
 *
 * БИОЛОГИЯ: экосистема → организм → экосистема
 *   Niche Construction Theory: организм СТРОИТ свою нишу
 *   Эпигенетика: среда меняет экспрессию, не геном
 *   Автопоэзис: жизнь = самопроизводство через coupling со средой
 *
 * ПСИХОЛОГИЯ: культура → психика → культура
 *   Зона ближайшего развития: среда ТЯНЕТ вверх
 *   Экологическая психология (Gibson): affordance — среда ПРЕДЛАГАЕТ
 *   Теория поля (Lewin): поведение = f(поле)
 *
 * ЭКОНОМИКА: институты → хозяйство → институты
 *   Embeddedness: экономика ВСТРОЕНА в общество
 *   Экономика дара: reciprocity ≠ exchange
 *
 * СОЦИОЛОГИЯ: коллективное сознание → личность → общество
 *   Социальный факт: среда принуждает, не индивид решает
 *
 * БОГОСЛОВИЕ: κοινωνία → πρόσωπον → κοινωνία
 *   «Бытие = общение» — личность конституируется отношениями
 *   Перихоресис: взаимное проникновение без слияния
 *
 * Общая формула: λόγος (замысел) → среда (поле) → τρόπος (проявление)
 *
 * В нашей системе: Gift Graph = среда. Лицо = вихрь/организм/психика.
 * Среда определяет лицо. Лицо строит среду. Перихоресис.
 *
 * Научные основания:
 *   - Gibson J.J. (1979) Ecological Approach to Visual Perception
 *   - Lewin K. (1951) Field Theory in Social Science
 *   - Niche Construction: Odling-Smee et al. (2003) — PMC3048995
 *   - Environmental Epigenetics (2025) — PMC11879091
 *   - Relational Ontology: Santos (2015) — Foundations of Science
 *   - Autopoiesis: Maturana & Varela (1972)
 *   - Embeddedness: Polanyi (1944), Granovetter (1985)
 *   - ZPD: Vygotsky (1978) Mind in Society
 *   - Zizioulas (1985) Being as Communion
 */

import logger from '../../utils/logger.js';

class EnvironmentLayer {
  constructor(engine) {
    this.engine = engine;
  }

  // ═══════════════════════════════════════════════════════════════
  // AFFORDANCE (Gibson) — среда ПРЕДЛАГАЕТ, лицо выбирает
  // ═══════════════════════════════════════════════════════════════

  /**
   * Что среда предлагает данному лицу?
   *
   * Gibson: affordance = возможности, которые среда предоставляет
   * организму. Не свойство объекта и не свойство среды — свойство
   * ОТНОШЕНИЯ между ними.
   *
   * В нашей системе: какие дары лицо может дать/принять,
   * учитывая текущее состояние графа.
   */
  getAffordances(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return null;

    const allGifts = this.engine._eventStore.getAll();
    const allPersons = this.engine.persons.all().filter(p =>
      p.id !== personId && p.ontologicalOrder !== 'source'
    );

    const energy = person.energy ?? 100;
    const given = allGifts.filter(g => g.giver === personId);
    const received = allGifts.filter(g => g.receiver === personId && g.status === 'accepted');
    const declined = allGifts.filter(g => g.receiver === personId && g.status === 'declined');

    // Кому ещё не дарил?
    const givenTo = new Set(given.map(g => g.receiver));
    const unvisited = allPersons.filter(p => !givenTo.has(p.id));

    // Кто давно не получал?
    const lastReceived = {};
    for (const p of allPersons) {
      const pReceived = allGifts.filter(g => g.receiver === p.id && g.status === 'accepted');
      lastReceived[p.id] = pReceived.length > 0
        ? new Date(pReceived[pReceived.length - 1].createdAt).getTime()
        : 0;
    }
    const neglected = allPersons
      .filter(p => lastReceived[p.id] !== undefined)
      .sort((a, b) => (lastReceived[a.id] || 0) - (lastReceived[b.id] || 0))
      .slice(0, 3);

    // Какие телосы нуждаются в дарах?
    const unfulfilled = this.engine.telos.whatIsNeeded
      ? this.engine.telos.whatIsNeeded(personId, allGifts, this.engine.persons)
      : [];

    const affordances = [];

    // 1. Можешь дарить (если есть энергия)
    if (energy > 20) {
      affordances.push({
        type: 'give',
        description: 'Среда позволяет дарить',
        suggestions: unvisited.slice(0, 3).map(p => ({
          to: p.name,
          reason: 'Ещё не дарил этому лицу — новая связь',
        })),
      });
    } else {
      affordances.push({
        type: 'rest',
        description: 'Среда предлагает покой (energy < 20)',
        suggestion: 'Суббота — восстановление через тишину',
      });
    }

    // 2. Кому среда предлагает дарить (neglected)
    if (neglected.length > 0) {
      affordances.push({
        type: 'care',
        description: 'Среда указывает на забытых',
        neglected: neglected.map(p => ({ name: p.name, id: p.id })),
      });
    }

    // 3. Какой телос нуждается
    if (unfulfilled.length > 0) {
      affordances.push({
        type: 'telos',
        description: 'Среда указывает на неисполненный телос',
        teloi: unfulfilled,
      });
    }

    return {
      person: person.name,
      energy,
      affordances,
      environmentState: {
        density: this.engine.gratitude.density(),
        totalPersons: allPersons.length,
        totalGifts: allGifts.length,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ЗОНА БЛИЖАЙШЕГО РАЗВИТИЯ (Выготский)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Что лицо может сделать САМО, и что — только с помощью?
   *
   * Выготский: ZPD = зазор между тем, что ребёнок делает сам,
   * и тем, что может с помощью взрослого.
   *
   * В нашей системе: ZPD = зазор между текущим layer и следующим.
   * utilitas → bonum (может, если есть «взрослый» = лицо с bonum опытом)
   * bonum → gratia (может, если есть духовник/elder)
   */
  getZPD(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return null;

    const allGifts = this.engine._eventStore.getAll();
    const given = allGifts.filter(g => g.giver === personId && g.status === 'accepted');

    // Текущий уровень (dominant layer)
    const layers = { utilitas: 0, bonum: 0, gratia: 0 };
    for (const g of given) layers[g.layer || 'utilitas']++;
    const current = Object.entries(layers).sort((a, b) => b[1] - a[1])[0]?.[0] || 'utilitas';

    // Кто может быть «взрослым» (scaffolding)?
    const allPersons = this.engine.persons.all().filter(p =>
      p.id !== personId && p.ontologicalOrder !== 'source'
    );

    const scaffolders = [];
    for (const p of allPersons) {
      const pGiven = allGifts.filter(g => g.giver === p.id && g.status === 'accepted');
      const pLayers = { utilitas: 0, bonum: 0, gratia: 0 };
      for (const g of pGiven) pLayers[g.layer || 'utilitas']++;
      const pDominant = Object.entries(pLayers).sort((a, b) => b[1] - a[1])[0]?.[0] || 'utilitas';

      // «Взрослый» = тот, кто на уровень выше
      if ((current === 'utilitas' && (pDominant === 'bonum' || pDominant === 'gratia')) ||
          (current === 'bonum' && pDominant === 'gratia')) {
        scaffolders.push({ name: p.name, id: p.id, level: pDominant });
      }
    }

    const nextLevel = current === 'utilitas' ? 'bonum' : current === 'bonum' ? 'gratia' : 'theosis';

    return {
      person: person.name,
      currentLevel: current,
      nextLevel,
      canReachAlone: false, // Никто не развивается в изоляции
      scaffolders,
      zpd: scaffolders.length > 0
        ? `${person.name} может перейти к ${nextLevel} с помощью ${scaffolders.map(s => s.name).join(', ')}`
        : `${person.name} на уровне ${current}, нет «взрослого» для перехода к ${nextLevel}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // NICHE CONSTRUCTION — лицо строит свою нишу
  // ═══════════════════════════════════════════════════════════════

  /**
   * Какую нишу построило лицо своими дарами?
   *
   * Niche Construction Theory: организм не просто адаптируется —
   * он СТРОИТ свою экологическую нишу.
   *
   * В нашей системе: паттерн дарения лица = его ниша.
   * Кому дарит, что дарит, какой layer — формирует среду вокруг себя.
   */
  getNiche(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return null;

    const allGifts = this.engine._eventStore.getAll();
    const given = allGifts.filter(g => g.giver === personId);
    const received = allGifts.filter(g => g.receiver === personId && g.status === 'accepted');

    // Кому дарит чаще всего?
    const receiverCounts = {};
    for (const g of given) {
      const r = g.receiverName || g.receiver;
      receiverCounts[r] = (receiverCounts[r] || 0) + 1;
    }

    // От кого получает?
    const giverCounts = {};
    for (const g of received) {
      const gv = g.giverName || g.giver;
      giverCounts[gv] = (giverCounts[gv] || 0) + 1;
    }

    // Ниша = top relationships
    const nichePartners = Object.entries(receiverCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, giftsTo: count }));

    const nicheSuppliers = Object.entries(giverCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, giftsFrom: count }));

    // Тип ниши
    const totalGiven = given.length;
    const totalReceived = received.length;
    const ratio = totalGiven / Math.max(1, totalReceived);

    let nicheType;
    if (ratio > 2) nicheType = 'producer'; // Строит среду для других
    else if (ratio < 0.5) nicheType = 'consumer'; // Потребляет среду
    else nicheType = 'mutualist'; // Взаимный обмен

    return {
      person: person.name,
      nicheType,
      partners: nichePartners,
      suppliers: nicheSuppliers,
      giveReceiveRatio: Math.round(ratio * 100) / 100,
      interpretation: nicheType === 'producer'
        ? `${person.name} — строитель ниши. Даёт в ${ratio.toFixed(1)}× больше, чем получает. Среда формируется вокруг его даров.`
        : nicheType === 'mutualist'
          ? `${person.name} — симбионт. Дарение и получение в балансе. Перихоресис.`
          : `${person.name} — потребитель ниши. Получает больше. Нужно начать дарить, чтобы построить свою нишу.`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // АВТОПОЭЗИС — самопроизводство через coupling со средой
  // ═══════════════════════════════════════════════════════════════

  /**
   * Autopoiesis: живое = то, что производит само себя.
   *
   * Лицо autopoietic если: дарит → получает → дарит →
   * непрерывный цикл самовоспроизводства через среду.
   *
   * Мёртвое: не дарит, не получает. Нет coupling.
   */
  getAutopoiesis(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return null;

    const allGifts = this.engine._eventStore.getAll();
    const given = allGifts.filter(g => g.giver === personId);
    const received = allGifts.filter(g => g.receiver === personId && g.status === 'accepted');

    // Coupling: чередование дарения и получения
    const timeline = [
      ...given.map(g => ({ type: 'give', at: new Date(g.createdAt).getTime() })),
      ...received.map(g => ({ type: 'receive', at: new Date(g.acceptedAt || g.createdAt).getTime() })),
    ].sort((a, b) => a.at - b.at);

    // Считаем чередования (give→receive→give = 2 oscillations)
    let oscillations = 0;
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].type !== timeline[i - 1].type) oscillations++;
    }

    const alive = oscillations >= 2 && given.length > 0 && received.length > 0;
    const couplingStrength = timeline.length > 0 ? oscillations / timeline.length : 0;

    return {
      person: person.name,
      alive,
      oscillations,
      couplingStrength: Math.round(couplingStrength * 100) / 100,
      totalEvents: timeline.length,
      interpretation: alive
        ? `${person.name} — живой. ${oscillations} осцилляций дарения↔получения. Coupling: ${(couplingStrength * 100).toFixed(0)}%.`
        : `${person.name} — не autopoietic. Нет цикла дарения↔получения. Нет coupling со средой.`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // EMBEDDEDNESS — встроенность в ткань отношений
  // ═══════════════════════════════════════════════════════════════

  /**
   * Embeddedness: насколько лицо ВСТРОЕНО в среду?
   *
   * Polanyi: экономика встроена в общество.
   * Granovetter: «сила слабых связей».
   *
   * Высокая embeddedness = много связей, разных типов.
   * Низкая = изолировано, мало связей.
   */
  getEmbeddedness(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return null;

    const allGifts = this.engine._eventStore.getAll();
    const given = allGifts.filter(g => g.giver === personId);
    const received = allGifts.filter(g => g.receiver === personId && g.status === 'accepted');

    const uniqueReceivers = new Set(given.map(g => g.receiver)).size;
    const uniqueGivers = new Set(received.map(g => g.giver)).size;
    const uniqueConnections = new Set([
      ...given.map(g => g.receiver),
      ...received.map(g => g.giver),
    ]).size;

    const totalPersons = this.engine.persons.all().filter(p => p.ontologicalOrder !== 'source').length;
    const embeddedness = totalPersons > 1 ? uniqueConnections / (totalPersons - 1) : 0;

    // Разнообразие layer = «сила слабых связей»
    const layerDiversity = new Set(given.map(g => g.layer || 'utilitas')).size;

    // В перихоресисе?
    const inCycle = this.engine.gratitude.findCycles(4).some(c => c.includes(String(personId)));

    return {
      person: person.name,
      embeddedness: Math.round(embeddedness * 100) / 100,
      uniqueConnections,
      uniqueGivers,
      uniqueReceivers,
      layerDiversity,
      inPerichoresis: inCycle,
      interpretation: embeddedness > 0.7
        ? `${person.name} — глубоко встроен. ${uniqueConnections} связей из ${totalPersons - 1} возможных.`
        : embeddedness > 0.3
          ? `${person.name} — частично встроен. Есть пространство для новых связей.`
          : `${person.name} — изолирован. Нужно дарить новым лицам.`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // IMPLICATE ORDER (Бом) — свёрнутый порядок → развёрнутый
  // ═══════════════════════════════════════════════════════════════

  /**
   * Implicate Order: всё уже ЕСТЬ в свёрнутом виде.
   * Каждый дар = explicate (развёртывание) из implicate (co-presence field).
   *
   * Holomovement: целое в движении. Не атомы складываются в целое —
   * целое развёртывается в части.
   *
   * В нашей системе: co-presence field = implicate order.
   * Дар = explicate event. Incalculable = чистый implicate (не развёрнут).
   */
  getImplicateOrder() {
    const allGifts = this.engine._eventStore.getAll();
    const coPresence = this.engine.anamnesis.totalLinks();
    const incalculable = this.engine.getIncalculableEvents();
    const accepted = allGifts.filter(g => g.status === 'accepted');

    // Ratio implicate/explicate
    // Больше co-presence чем даров = глубокий implicate order
    const ratio = accepted.length > 0 ? coPresence / accepted.length : 0;

    return {
      explicateEvents: accepted.length,       // Развёрнутые дары
      implicateField: coPresence,             // Свёрнутые связи
      pureImplicate: incalculable.length,     // Чисто свёрнутое (incalculable)
      depthRatio: Math.round(ratio * 100) / 100,
      interpretation: ratio > 3
        ? 'Глубокий implicate order — невидимых связей в 3× больше чем видимых даров'
        : ratio > 1
          ? 'Implicate превышает explicate — система глубже, чем кажется'
          : 'Поверхностная — мало невидимых связей',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ADJACENT POSSIBLE (Кауффман) — что может стать следующим
  // ═══════════════════════════════════════════════════════════════

  /**
   * Adjacent Possible: из текущего состояния — какие следующие
   * шаги возможны?
   *
   * Кауффман: автокаталитический набор → фазовый переход к жизни.
   * Каждое новое → расширяет пространство возможного.
   *
   * В нашей системе: какие дары, связи, телосы ВОЗМОЖНЫ,
   * но ещё не реализованы? Это — горизонт роста.
   */
  getAdjacentPossible() {
    const allPersons = this.engine.persons.all().filter(p => p.ontologicalOrder !== 'source');
    const allGifts = this.engine._eventStore.getAll();

    // Существующие связи
    const existingPairs = new Set();
    for (const g of allGifts) {
      if (g.giver && g.receiver && g.receiver !== 'all') {
        existingPairs.add(`${g.giver}->${g.receiver}`);
      }
    }

    // Возможные новые связи
    const possibleNewPairs = [];
    for (const a of allPersons) {
      for (const b of allPersons) {
        if (a.id !== b.id && !existingPairs.has(`${a.id}->${b.id}`)) {
          possibleNewPairs.push({ from: a.name, to: b.name });
        }
      }
    }

    // Существующие телосы и возможные новые
    const existingTeloi = new Set(allGifts.filter(g => g.telos).map(g => g.telos));

    // Autocatalytic: есть ли циклы (самовоспроизводящиеся наборы)?
    const cycles = this.engine.gratitude.findCycles(4);
    const autocatalytic = cycles.length > 0;

    // Фазовый переход: density → adjacent possible расширяется
    const density = this.engine.gratitude.density();
    const nearPhaseTransition = density > 0.15 && density < 0.35; // Критическая зона

    return {
      currentState: {
        persons: allPersons.length,
        gifts: allGifts.length,
        connections: existingPairs.size,
        teloi: existingTeloi.size,
        density,
      },
      adjacentPossible: {
        newConnections: possibleNewPairs.length,
        expansionRatio: existingPairs.size > 0
          ? Math.round(possibleNewPairs.length / existingPairs.size * 100) / 100
          : Infinity,
      },
      autocatalytic,
      nearPhaseTransition,
      interpretation: nearPhaseTransition
        ? 'КРИТИЧЕСКАЯ ЗОНА — один дар может запустить фазовый переход к связности'
        : autocatalytic
          ? 'Автокаталитические циклы найдены — система самовоспроизводится'
          : 'Нет автокатализа — нужны циклы дарения (перихоресис)',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STIGMERGY — среда как память роя
  // ═══════════════════════════════════════════════════════════════

  /**
   * Стигмергия: агенты общаются ЧЕРЕЗ СРЕДУ, не напрямую.
   * Муравей оставляет феромон → другой муравей читает → среда = память.
   *
   * Ключевой принцип для роёв (дронов, агентов):
   *   - Нет центрального управления
   *   - Каждый агент читает/пишет в среду
   *   - Коллективный интеллект ЭМЕРДЖЕНТЕН
   *
   * В нашей системе: Gift Graph = стигмергическая среда.
   * Дар = феромон. Density = концентрация феромона.
   * Affordance = «куда идти» (куда лететь дрону).
   *
   * Для роя дронов:
   *   - Каждый дрон = лицо в gift graph
   *   - Выполнение задачи = дар (offer → accept)
   *   - Кеносис = расход батареи/топлива
   *   - Surplus = задача дала больше инфо, чем ожидалось
   *   - Decline = отказ от задачи (батарея низкая, опасность)
   *   - Density = связность роя (коммуникация)
   *   - Percolation = момент, когда рой становится единым
   *   - Grace event = неожиданное обнаружение (находка)
   *   - Temptation = ложная цель, помеха
   */
  getStigmergy() {
    const allGifts = this.engine._eventStore.getAll();
    const accepted = allGifts.filter(g => g.status === 'accepted');
    const density = this.engine.gratitude.density();

    // «Феромонные следы» = рёбра с весом
    const activeEdges = this.engine.gratitude._edges?.size || 0;
    const forgottenEdges = (this.engine.gratitude._forgotten || []).length;

    // Интенсивность «запаха» = gifts per time unit
    const now = Date.now();
    const recentGifts = accepted.filter(g => now - new Date(g.createdAt).getTime() < 600000); // За 10 мин
    const intensity = recentGifts.length;

    // Swarm coherence = если все дарят одному телосу
    const recentTeloi = recentGifts.filter(g => g.telos).map(g => g.telos);
    const dominantTelos = this._mostFrequent(recentTeloi);
    const coherence = recentTeloi.length > 0
      ? recentTeloi.filter(t => t === dominantTelos).length / recentTeloi.length
      : 0;

    return {
      activeTrails: activeEdges,         // Живые феромонные следы
      fadedTrails: forgottenEdges,       // Угасшие (decay)
      intensity,                          // Даров за 10 мин
      swarmCoherence: Math.round(coherence * 100) / 100,
      dominantTelos,
      density,
      // Порог перихоресиса p_c ≈ 0.7 (Nature Comm 2025, фазовый переход)
      // При density ≥ 0.7 рой переходит из суммы дронов в единый организм.
      // Это измеримый перколяционный феномен, а не богословская метафора.
      swarmState: density > 0.7 ? 'unified'      // Перихоресис (p ≥ p_c)
        : density > 0.3 ? 'forming'               // Рой формируется (0.3 < p < p_c)
        : intensity > 3 ? 'active_scattered'       // Активный, но разрозненный
        : 'dormant',                               // Спящий
      percolationThreshold: 0.7,                  // p_c: Nature Comm 2025
      percolationActive: density > 0.7,           // true = перихоресис достигнут
      droneAnalogy: {
        gift: 'выполнение задачи',
        kenosis: 'расход батареи',
        surplus: 'неожиданная находка',
        decline: 'отказ (батарея/опасность)',
        density: 'связность коммуникации',
        percolation: 'фазовый переход → рой стал единым интеллектом',
        graceEvent: 'случайное обнаружение',
        temptation: 'ложная цель / помеха',
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // НООСФЕРА — коллективный разум, Omega point
  // ═══════════════════════════════════════════════════════════════

  /**
   * Ноосфера: биосфера → сфера разума → Omega point.
   *
   * Вернадский: ноосфера = геологическая сила.
   * Тейяр: Omega = конвергенция сознания к единству.
   *
   * В нашей системе:
   *   density 0 = изоляция (литосфера — мёртвая материя)
   *   density < 0.3 = биосфера (жизнь, но разрозненная)
   *   density 0.3-0.7 = ноосфера (связный разум)
   *   density > 0.9 = Omega (Огдоада, Царство)
   */
  getNoosphereState() {
    const density = this.engine.gratitude.density();
    const persons = this.engine.persons.all().filter(p => p.ontologicalOrder !== 'source').length;
    const gifts = this.engine._eventStore.getAll().length;
    const coPresence = this.engine.anamnesis.totalLinks();
    const cycles = this.engine.gratitude.findCycles(4).length;
    const theosis = this.engine.salvation?.getStatus()?.theosisCount || 0;

    let sphere, omega;
    if (density >= 0.9) {
      sphere = 'omega';
      omega = 'Omega достигнут — «Бог всё во всём»';
    } else if (density >= 0.3) {
      sphere = 'noosphere';
      omega = `Ноосфера. ${Math.round((1 - density) * 100)}% до Omega.`;
    } else if (gifts > 0) {
      sphere = 'biosphere';
      omega = 'Биосфера — жизнь есть, связности нет';
    } else {
      sphere = 'lithosphere';
      omega = 'Литосфера — нет жизни';
    }

    return {
      sphere,
      density,
      persons,
      gifts,
      coPresence,
      perichoresisCycles: cycles,
      theosis,
      omega,
      convergence: {
        current: density,
        target: 1.0,
        progress: `${Math.round(density * 100)}%`,
      },
    };
  }

  // ── Helper ─────────────────────────────────────────────

  _mostFrequent(arr) {
    const counts = {};
    for (const item of arr) counts[item] = (counts[item] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // ПОЛНАЯ КАРТИНА СРЕДЫ
  // ═══════════════════════════════════════════════════════════════

  getState() {
    const persons = this.engine.persons.all().filter(p => p.ontologicalOrder !== 'source');

    const profiles = persons.slice(0, 10).map(p => ({
      name: p.name,
      niche: this.getNiche(p.id)?.nicheType,
      autopoietic: this.getAutopoiesis(p.id)?.alive,
      embeddedness: this.getEmbeddedness(p.id)?.embeddedness,
      zpd: this.getZPD(p.id)?.currentLevel,
    }));

    const density = this.engine.gratitude.density();
    const totalGifts = this.engine._eventStore.getAll().length;

    return {
      profiles,
      environment: {
        density,
        totalGifts,
        totalPersons: persons.length,
        phase: density > 0.9 ? 'communion' : density > 0.5 ? 'community' : density > 0.2 ? 'network' : 'isolation',
      },
      interpretation: {
        ru: 'Среда и лицо конституируют друг друга. Один λόγος через все науки.',
      },
    };
  }
}

export default EnvironmentLayer;
