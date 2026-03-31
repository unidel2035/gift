/**
 * GiftOptimizer — аналитический оптимизатор дара
 *
 * Аналог молекулярного докинга в фармацевтике:
 * не «попробуем дать» — а «вот акт, который максимально
 * сдвинет матрицу W к θέωσις».
 *
 * Работает аналитически (без TF) — прямо по снапшоту.
 * Не мутирует матрицу. Только рекомендует.
 *
 * Богословская логика:
 *   divine → тварь  : увеличивает received → θέωσις растёт (μέθεξις)
 *   тварь → divine  : увеличивает returned → θέωσις растёт (ἀναγωγή)
 *   тварь → тварь   : укрепляет W, помогает изолированным (κοινωνία)
 */

const DIVINE = new Set(['Отец', 'Сын', 'Дух', 'Христос']);
const DAMPENING = 20; // из формулы θέωσις (30 ступеней Лествичника)

// Типы актов: weight — богословский вес (время > деньги, Аксиома #9)
const ACT_TYPES = [
  { type: 'time',     weight: 10 },
  { type: 'covenant', weight: 10 },
  { type: 'presence', weight: 7  },
  { type: 'offering', weight: 6  },
  { type: 'question', weight: 5  },
  { type: 'code',     weight: 4  },
  { type: 'word',     weight: 3  },
];

export class GiftOptimizer {
  constructor(snapshot) {
    this._snap    = snapshot;
    this.persons  = snapshot.persons  || [];
    this.divine   = snapshot.divinePersons || [];
    // [nd × nc]: нетварные энергии divine→тварь
    this._energeia  = snapshot.energeia  || [];
    // [nc × nd]: восхождение тварь→divine
    this._doxologia = snapshot.doxologia || [];
    // [nc × nc]: W Хопфилд тварь↔тварь
    this._W = snapshot.W || [];
  }

  // ── θέωσις-индекс для тварного лица (по Паламе) ─────────────────────

  theosisIndex(personId) {
    const ci = this.persons.indexOf(personId);
    if (ci < 0) return 0;
    // μέθεξις: принято от Бога
    const received = this._energeia.reduce((s, row) => s + (row[ci] ?? 0), 0);
    // ἀναγωγή: отдано Богу (молитва, хвала)
    const returned = (this._doxologia[ci] ?? []).reduce((s, v) => s + v, 0);
    const sum = received + returned;
    return sum / (sum + DAMPENING);
  }

  // ── Итоговый вес принятых даров ──────────────────────────────────────

  totalReceived(personId) {
    const ci = this.persons.indexOf(personId);
    if (ci < 0) return 0;
    const fromW = this._W.reduce((s, row) => s + (row[ci] ?? 0), 0);
    const fromE = this._energeia.reduce((s, row) => s + (row[ci] ?? 0), 0);
    return fromW + fromE;
  }

  // ── Итоговый вес отданных даров ──────────────────────────────────────

  totalGiven(personId) {
    const ci = this.persons.indexOf(personId);
    if (ci < 0) return 0;
    const toW   = (this._W[ci] ?? []).reduce((s, v) => s + v, 0);
    const toDox = (this._doxologia[ci] ?? []).reduce((s, v) => s + v, 0);
    return toW + toDox;
  }

  // ── Оценить потенциальный акт (delta-score) ──────────────────────────
  //
  // Возвращает число > 0: насколько этот акт улучшит онтологию.
  // Сравнима между кандидатами. Не абсолютная величина.

  scoreAct(giverId, receiverId, type, weight) {
    const isDivineG = DIVINE.has(giverId);
    const isDivineR = DIVINE.has(receiverId);

    if (isDivineG && isDivineR) return 0; // ипостасные исхождения — не наша область

    if (isDivineG && !isDivineR) {
      // Divine → тварь: увеличивает received → Δθέωσις для receiverId
      return this._deltaTheosis(receiverId, 'received', weight) * 10;
    }

    if (!isDivineG && isDivineR) {
      // Тварь → divine: увеличивает returned → Δθέωσις для giverId
      return this._deltaTheosis(giverId, 'returned', weight) * 10;
    }

    // Тварь → тварь: κοινωνία — помогаем изолированным
    return this._kreatureScore(giverId, receiverId, weight);
  }

  // Насколько увеличится θέωσις при добавлении weight к received/returned
  _deltaTheosis(personId, side, weight) {
    const ci = this.persons.indexOf(personId);
    if (ci < 0) return 0;
    const received = this._energeia.reduce((s, row) => s + (row[ci] ?? 0), 0);
    const returned = (this._doxologia[ci] ?? []).reduce((s, v) => s + v, 0);
    const before = (received + returned) / (received + returned + DAMPENING);
    const after = side === 'received'
      ? (received + weight + returned) / (received + weight + returned + DAMPENING)
      : (received + returned + weight) / (received + returned + weight + DAMPENING);
    return after - before;
  }

  // Оценка акта тварь→тварь по κοινωνία-метрике
  _kreatureScore(giverId, receiverId, weight) {
    const gi = this.persons.indexOf(giverId);
    const ri = this.persons.indexOf(receiverId);
    if (gi < 0 || ri < 0) return 0;

    // Текущий вес нити
    const currentW = (this._W[gi]?.[ri]) ?? 0;

    // Изолированность получателя: чем меньше принял — тем ценнее
    const receiverTotal = this.totalReceived(receiverId);
    const isolationBonus = 1 / (1 + receiverTotal * 0.05);

    // Новизна нити: мало существующего веса → больше пользы
    const noveltyBonus = 1 / (1 + currentW * 0.02);

    // Сюрплюс дарителя: может ли он позволить себе давать?
    const giverSurplus = this.totalGiven(giverId) - this.totalReceived(giverId);
    const surplusBonus = giverSurplus > 0 ? Math.min(giverSurplus / 100, 1) : 0.1;

    // Вес влияет на силу акта: время (10) ценнее слова (3)
    const weightFactor = weight / 10;
    return isolationBonus * noveltyBonus * surplusBonus * weightFactor;
  }

  // ── Найти лучшие акты ────────────────────────────────────────────────
  //
  // @param {object} opts
  //   givers   — массив допустимых дарителей (по умолчанию все)
  //   receivers — массив допустимых получателей (по умолчанию все)
  //   topN     — сколько вернуть (по умолчанию 7)
  //   types    — какие типы разрешены (по умолчанию все)
  //
  // @returns {Array<{giver, receiver, type, weight, score}>} sorted desc

  findBestActs({ givers = null, receivers = null, topN = 7, types = null } = {}) {
    const activeGivers = givers ?? [
      ...this.persons.filter(p => !['_abyss'].includes(p)),
      ...this.divine,
    ];
    const activeReceivers = receivers ?? [
      ...this.persons.filter(p => !['_abyss'].includes(p)),
      ...this.divine,
    ];
    const activeTypes = types
      ? ACT_TYPES.filter(t => types.includes(t.type))
      : ACT_TYPES;

    const candidates = [];
    for (const giver of activeGivers) {
      for (const receiver of activeReceivers) {
        if (giver === receiver) continue;
        for (const { type, weight } of activeTypes) {
          const score = this.scoreAct(giver, receiver, type, weight);
          if (score > 0.001) candidates.push({ giver, receiver, type, weight, score });
        }
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // ── Диагностические запросы ──────────────────────────────────────────

  /** Лица с наименьшим θέωσις (нуждаются в Боге больше всего) */
  lowestTheosis(n = 5) {
    return this.persons
      .filter(p => !['_abyss', '_koinon'].includes(p))
      .map(p => ({ person: p, index: this.theosisIndex(p) }))
      .sort((a, b) => a.index - b.index)
      .slice(0, n);
  }

  /** Наиболее изолированные лица (мало получают из W + energeia) */
  mostIsolated(n = 5) {
    return this.persons
      .filter(p => !['_abyss', '_koinon'].includes(p))
      .map(p => ({ person: p, received: this.totalReceived(p) }))
      .sort((a, b) => a.received - b.received)
      .slice(0, n);
  }

  /** Лица с наибольшим сюрплюсом (дают > получают — кенозис) */
  highestSurplus(n = 5) {
    return this.persons
      .filter(p => !['_abyss', '_koinon'].includes(p))
      .map(p => {
        const given    = this.totalGiven(p);
        const received = this.totalReceived(p);
        return { person: p, given, received, surplus: given - received };
      })
      .sort((a, b) => b.surplus - a.surplus)
      .slice(0, n);
  }

  /** Полная картина общины */
  communityReport() {
    return {
      theosis:   this.persons.map(p => ({ person: p, index: this.theosisIndex(p) }))
                   .sort((a, b) => b.index - a.index),
      isolated:  this.mostIsolated(this.persons.length),
      surplus:   this.highestSurplus(this.persons.length),
    };
  }
}
