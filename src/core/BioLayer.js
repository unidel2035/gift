/**
 * BioLayer — жизнь как следствие дарения
 *
 * Три уровня реальности, один λόγος:
 *   Θεολογία   — Онтология дара (Троица, кеносис, эпектасис)
 *   Φυσιολογία — Эфиродинамика (вихри в среде)
 *   Βιολογία   — Волновая генетика (Волновая генетика, ДНК как текст)
 *
 * Волновая генетика П.П. (1942-2020):
 *   - 98% ДНК = не мусор, а «суперкод» (лингвистическая структура)
 *   - ДНК = антенна (когерентное излучение от УФ до ИК)
 *   - Фантомный эффект (40 дней после удаления ДНК)
 *   - ДНК = текст (нуклеотиды = слова по правилам грамматики)
 *   - Солитоны — перенос информации по ДНК
 *   - Внешнее информационное поле → геном принимает «извне»
 *
 * Соответствие с онтологией дара:
 *   System prompt = геном агента (лингвистический код)
 *   Co-presence field = некодирующая ДНК (98% невидимых связей)
 *   Gratitude decay (halflife 30d) ≈ фантомный эффект (40 дней)
 *   Дар = солитон (бегущее возбуждение)
 *   Gift Graph = внешнее информационное поле
 *   Person = клетка (принимает и излучает)
 *
 * Максим Исповедник: λόγος каждого творения = его «геном»
 * в замысле Божием. Тропос = экспрессия (как логос проявляется).
 *
 * «И сказал Бог — и стало.» (Быт 1:3)
 * Слово = информация = ДНК = λόγος = дар.
 */

import logger from '../../utils/logger.js';

class BioLayer {
  constructor(engine) {
    this.engine = engine;
  }

  // ═══════════════════════════════════════════════════════════════
  // ГЕНОМ ЛИЦА (System prompt как ДНК)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Геном лица = его логос + история даров + призвание.
   *
   * Волновая генетика: 2% ДНК кодирует белки (видимое).
   *         98% = суперкод (невидимое, но определяющее).
   *
   * Лицо: 2% = имя, calling (видимое).
   *       98% = co-presence field, анамнезис, паттерны дарения (невидимое).
   */
  getGenome(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return null;

    const allGifts = this.engine._eventStore.getAll();
    const given = allGifts.filter(g => g.giver === personId);
    const received = allGifts.filter(g => g.receiver === personId && g.status === 'accepted');

    // Логос (из LogosRegistry)
    const logos = this.engine.logoi.getByBearer(String(personId));

    // 2% — кодирующая часть (видимое)
    const coding = {
      name: person.name,
      calling: person.calling,
      ontologicalOrder: person.ontologicalOrder,
      movement: logos?.movement || 'kata_physin',
    };

    // 98% — некодирующая часть (невидимые связи)
    const coPresenceLinks = this.engine.anamnesis.totalLinks();
    const teloi = [...new Set(given.filter(g => g.telos).map(g => g.telos))];
    const receivers = [...new Set(given.map(g => g.receiver))];
    const givers = [...new Set(received.map(g => g.giver))];
    const layers = { utilitas: 0, bonum: 0, gratia: 0 };
    for (const g of given) layers[g.layer || 'utilitas']++;
    const dominantLayer = Object.entries(layers).sort((a, b) => b[1] - a[1])[0]?.[0] || 'utilitas';

    // Паттерн дарения = «генетический код» поведения
    const giftPattern = given.slice(-10).map(g => ({
      to: g.receiverName || g.receiver,
      layer: g.layer,
      telos: g.telos,
      surplus: g._surplus,
    }));

    const nonCoding = {
      teloi,
      dominantLayer,
      uniqueReceivers: receivers.length,
      uniqueGivers: givers.length,
      layerDistribution: layers,
      giftPattern,
      coPresenceDepth: coPresenceLinks,
    };

    // Экспрессия = тропос (как логос проявляется сейчас)
    const expression = {
      energy: person.energy ?? 100,
      charge: (person.giftsGiven || 0) - (person.giftsReceived || 0),
      inPerichoresis: this._isInCycle(personId),
      hasFallen: logos?.movement === 'para_physin',
      isDeified: logos?.movement === 'hyper_physin',
    };

    return {
      person: person.name,
      coding,      // 2% видимое
      nonCoding,   // 98% невидимое
      expression,  // текущий тропос
      logos: logos ? { name: logos.name, principle: logos.principle, telos: logos.telos } : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ФАНТОМНЫЙ ЭФФЕКТ (память после «смерти» дара)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Фантомный эффект: после того как дар «умер» (status=dead)
   * или благодарность затухла (decay) — след остаётся.
   *
   * Волновая генетика: после удаления ДНК из раствора электромагнитный
   * след сохраняется 40 дней.
   *
   * В нашей системе: gratitude decay halflife = 30 дней.
   * Забытые рёбра (_forgotten) = фантомы.
   * Мёртвые дары (status=dead, seed=true) = фантомные гены.
   *
   * Фантом != ничто. Фантом = след, влияющий на поле.
   */
  getPhantoms() {
    // Забытые рёбра благодарности
    const forgottenEdges = this.engine.gratitude._forgotten || [];

    // Мёртвые дары
    const deadGifts = this.engine._eventStore.getAll()
      .filter(g => g.status === 'dead');

    // Incalculable events (чистые фантомы — tokens: undefined)
    const incalculable = this.engine.getIncalculableEvents();

    return {
      forgottenGratitude: {
        count: forgottenEdges.length,
        description: 'Рёбра благодарности, затухшие по decay — но след в _forgotten',
        halflife: '30 дней',
        gariaevAnalog: 'Фантомный эффект ДНК — 40 дней',
      },
      deadGifts: {
        count: deadGifts.length,
        seeds: deadGifts.filter(g => g.seed).length,
        description: '«Если зерно не умрёт, останется одно» — мёртвые дары как семена',
      },
      incalculable: {
        count: incalculable.length,
        description: 'Чистые фантомы — события без измерения. tokens: undefined.',
      },
      totalPhantomField: forgottenEdges.length + deadGifts.length + incalculable.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // СОЛИТОНЫ (Дары как бегущие волны по «ДНК» системы)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Солитон = дар, который проходит через цепочку лиц,
   * не теряя формы (анамнезис сохраняет содержание).
   *
   * Волновая генетика: солитонные возбуждения переносят информацию по ДНК.
   *
   * В нашей системе: цепочка даров A→B→C, где каждый следующий
   * содержит anamnesisIds предыдущего = солитон.
   */
  findSolitons(minLength = 3) {
    const allGifts = this.engine._eventStore.getAll()
      .filter(g => g.status === 'accepted');

    const solitons = [];

    for (const gift of allGifts) {
      const chain = this._traceAnamnesisChain(gift, allGifts, minLength);
      if (chain.length >= minLength) {
        solitons.push({
          length: chain.length,
          gifts: chain.map(g => ({
            id: g.id,
            from: g.giverName || g.giver,
            to: g.receiverName || g.receiver,
            layer: g.layer,
            content: (g.content || '').slice(0, 60),
          })),
          telos: chain[0].telos,
          preserved: this._isSolitonPreserved(chain),
        });
      }
    }

    // Убрать дубликаты (подцепочки)
    return solitons
      .sort((a, b) => b.length - a.length)
      .slice(0, 20);
  }

  /**
   * Проследить цепочку анамнезиса от дара назад.
   */
  _traceAnamnesisChain(gift, allGifts, maxDepth = 10) {
    const chain = [gift];
    let current = gift;
    const visited = new Set([gift.id]);

    for (let depth = 0; depth < maxDepth; depth++) {
      if (!current.anamnesisIds || current.anamnesisIds.length === 0) break;
      const parentId = current.anamnesisIds[0]; // Первый = основной предок
      if (visited.has(parentId)) break;
      const parent = allGifts.find(g => g.id === parentId);
      if (!parent) break;
      chain.unshift(parent);
      visited.add(parentId);
      current = parent;
    }

    return chain;
  }

  /**
   * Солитон «сохранился» если тема (telos/layer) не изменилась через цепочку.
   */
  _isSolitonPreserved(chain) {
    if (chain.length < 2) return true;
    const firstTelos = chain[0].telos;
    const firstLayer = chain[0].layer;
    return chain.every(g => g.telos === firstTelos || g.layer === firstLayer);
  }

  // ═══════════════════════════════════════════════════════════════
  // КОГЕРЕНТНОЕ ИЗЛУЧЕНИЕ (Лицо как лазер)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Когерентность лица = насколько его дары «когерентны»
   * (одного направления, одного тропоса).
   *
   * Волновая генетика: хромосомы = лазерно-активные среды,
   * излучающие когерентный свет.
   *
   * Лицо с высокой когерентностью = все дары в одном телосе,
   * одного layer, одним получателям. «Лазер».
   * Лицо с низкой когерентностью = хаотичное дарение. «Лампочка».
   */
  getCoherence(personId) {
    const allGifts = this.engine._eventStore.getAll();
    const given = allGifts.filter(g => g.giver === String(personId) && g.status === 'accepted');

    if (given.length < 3) return { coherence: 0, type: 'insufficient_data' };

    // Telos coherence — все дары одного телоса?
    const teloi = given.filter(g => g.telos).map(g => g.telos);
    const telosCounts = {};
    for (const t of teloi) telosCounts[t] = (telosCounts[t] || 0) + 1;
    const maxTelosCount = Math.max(...Object.values(telosCounts), 0);
    const telosCoherence = teloi.length > 0 ? maxTelosCount / teloi.length : 0;

    // Layer coherence — все дары одного layer?
    const layers = given.map(g => g.layer || 'utilitas');
    const layerCounts = {};
    for (const l of layers) layerCounts[l] = (layerCounts[l] || 0) + 1;
    const maxLayerCount = Math.max(...Object.values(layerCounts), 0);
    const layerCoherence = maxLayerCount / layers.length;

    // Receiver coherence — дарит одним и тем же?
    const receivers = given.map(g => g.receiver);
    const receiverCounts = {};
    for (const r of receivers) receiverCounts[r] = (receiverCounts[r] || 0) + 1;
    const maxReceiverCount = Math.max(...Object.values(receiverCounts), 0);
    const receiverCoherence = maxReceiverCount / receivers.length;

    // Общая когерентность
    const coherence = (telosCoherence + layerCoherence + receiverCoherence) / 3;

    return {
      coherence: Math.round(coherence * 100) / 100,
      type: coherence > 0.7 ? 'laser' : coherence > 0.4 ? 'focused' : 'diffuse',
      telosCoherence: Math.round(telosCoherence * 100) / 100,
      layerCoherence: Math.round(layerCoherence * 100) / 100,
      receiverCoherence: Math.round(receiverCoherence * 100) / 100,
      dominantTelos: Object.entries(telosCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      dominantLayer: Object.entries(layerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ЭПИГЕНЕТИКА (среда меняет экспрессию, не геном)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Эпигенетика: среда (gift graph) меняет ЭКСПРЕССИЮ лица,
   * не его логос.
   *
   * Максим Исповедник: λόγος неизменен, τρόπος (способ) меняется.
   * Биология: геном один, эпигенетические метки разные.
   *
   * В нашей системе: один и тот же person с одним logos
   * ведёт себя по-разному в зависимости от:
   *   - density графа (среда)
   *   - energy (истощение)
   *   - temptation stage (помыслы)
   *   - season (active/sabbath/contemplation)
   */
  getEpigenetics(personId) {
    const genome = this.getGenome(personId);
    if (!genome) return null;

    const season = this.engine.clock.getCurrentSeason(String(personId));
    const temptation = this.engine.temptation.scan(String(personId));
    const coherence = this.getCoherence(personId);
    const density = this.engine.gratitude.density();

    // Эпигенетические факторы (среда → экспрессия)
    const factors = {
      // Плотность среды → открытость/замкнутость
      environmentalDensity: {
        value: density,
        effect: density > 0.5 ? 'open' : density > 0.2 ? 'cautious' : 'isolated',
        description: density > 0.5
          ? 'Среда плотная — лицо открыто к дарению'
          : 'Среда разреженная — лицо осторожно',
      },
      // Сезон → режим работы
      season: {
        value: season?.season || 'active',
        effect: season?.season === 'contemplation' ? 'receptive'
          : season?.season === 'sabbath' ? 'regenerating'
          : 'active',
      },
      // Помыслы → подавление экспрессии
      temptationLoad: {
        count: temptation.length,
        maxStage: temptation.reduce((max, t) => Math.max(max, t.stage?.level || 0), 0),
        effect: temptation.length > 0 ? 'suppressed' : 'free',
        description: temptation.length > 0
          ? `${temptation.length} помыслов подавляют дарение`
          : 'Свободен от помыслов — полная экспрессия',
      },
      // Энергия → мощность экспрессии
      energy: {
        value: genome.expression.energy,
        effect: genome.expression.energy > 70 ? 'full' : genome.expression.energy > 30 ? 'moderate' : 'depleted',
      },
      // Когерентность → направленность
      coherence: {
        value: coherence.coherence,
        type: coherence.type,
      },
    };

    // Итоговый эпигенетический статус
    const suppression = factors.temptationLoad.count * 0.15 +
      (1 - factors.environmentalDensity.value) * 0.2 +
      (1 - (genome.expression.energy || 100) / 100) * 0.3;

    return {
      person: genome.person,
      logos: genome.logos,                    // Неизменный
      currentExpression: genome.expression,   // Текущий тропос
      epigeneticFactors: factors,
      expressionLevel: Math.round((1 - Math.min(suppression, 0.9)) * 100) / 100,
      interpretation: suppression > 0.5
        ? 'Экспрессия подавлена — среда, помыслы или истощение блокируют логос'
        : suppression > 0.2
          ? 'Экспрессия частичная — логос проявляется не в полную силу'
          : 'Экспрессия полная — логос свободно проявляется через тропос',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ПОЛНАЯ БИОЛОГИЧЕСКАЯ КАРТИНА
  // ═══════════════════════════════════════════════════════════════

  getState() {
    const persons = this.engine.persons.all().filter(p => p.ontologicalOrder !== 'source');

    const genomes = persons.slice(0, 10).map(p => {
      const genome = this.getGenome(p.id);
      const coherence = this.getCoherence(p.id);
      return {
        name: p.name,
        coding: genome?.coding,
        dominantLayer: genome?.nonCoding?.dominantLayer,
        coherence: coherence?.coherence,
        coherenceType: coherence?.type,
        expressionLevel: this.getEpigenetics(p.id)?.expressionLevel,
      };
    });

    const solitons = this.findSolitons(3);
    const phantoms = this.getPhantoms();

    return {
      genomes,
      solitons: { count: solitons.length, longest: solitons[0]?.length || 0 },
      phantoms,
      interpretation: {
        ru: 'Жизнь = следствие дарения. Геном = логос + co-presence. Солитон = дар, сохранивший форму через цепочку. Фантом = след после смерти/забвения.',
        formula: 'expressionLevel = 1 - (temptation + isolation + exhaustion)',
      },
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  _isInCycle(personId) {
    try {
      const cycles = this.engine.gratitude.findCycles(4);
      return cycles.some(c => c.includes(String(personId)));
    } catch { return false; }
  }
}

export default BioLayer;
