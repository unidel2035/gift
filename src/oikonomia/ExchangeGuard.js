/**
 * ExchangeGuard — Страж от обмена
 *
 * День 1 Шестоднева хозяйства: Различение.
 * «Да будет свет» — различение дара и обмена.
 *
 * 7 детекторов обнаруживают момент, когда дар коллапсирует в обмен.
 * ExchangeGuard НЕ запрещает обмен — он РАЗЛИЧАЕТ.
 * Обмен — не грех, а другой контур. Грех — когда обмен маскируется под дар.
 *
 * «Пусть левая рука твоя не знает, что делает правая» (Мф 6:3)
 */

const EXCHANGE_PATTERNS = Object.freeze({
  SYMMETRY:       'symmetry',        // A→B и B→A с равной стоимостью
  CONDITIONALITY: 'conditionality',  // Дар с условием
  CALCULATION:    'calculation',     // Кто-то ведёт «баланс»
  SIMULTANEITY:   'simultaneity',    // Дар ↔ ответ в одном акте
  EQUIVALENCE:    'equivalence',     // Точное соответствие «цене»
  IMPERSONALITY:  'impersonality',   // Дар адресован функции, не лицу
  INGRATITUDE:    'ingratitude',     // Обе стороны не благодарят
});

const SEVERITY = Object.freeze({
  OBSERVATION: 'observation',  // Замечено, но может быть невинно
  QUESTION:    'question',     // Пастырский вопрос
  ALERT:       'alert',        // Серьёзное подозрение
});

// Temporal window for symmetry detection (ms)
const SYMMETRY_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

// Conditional keywords in content
const CONDITIONAL_KEYWORDS = [
  'за', 'в обмен', 'взамен', 'при условии', 'если ты',
  'в ответ на', 'за то что', 'чтобы ты', 'должен',
];

class ExchangeGuard {
  /**
   * @param {object} context — { eventStore, eventBus, gratitude }
   */
  constructor(context) {
    this._eventStore = context.eventStore;
    this._eventBus = context.eventBus;
    this._gratitude = context.gratitude;
    this._alerts = [];
  }

  /**
   * Analyze a gift for exchange patterns.
   * Returns alerts (observations, questions) — not verdicts.
   *
   * @param {object} gift — the gift event to analyze
   * @returns {{ alerts: object[], pastoralQuestion: string|null, exchangeRisk: string }}
   */
  analyze(gift) {
    const alerts = [];

    // 1. SYMMETRY — A→B and B→A with similar cost in close time window
    const symmetryAlert = this._detectSymmetry(gift);
    if (symmetryAlert) alerts.push(symmetryAlert);

    // 2. CONDITIONALITY — content contains conditional language
    const conditionalAlert = this._detectConditionality(gift);
    if (conditionalAlert) alerts.push(conditionalAlert);

    // 3. CALCULATION — giver tracks balance
    const calcAlert = this._detectCalculation(gift);
    if (calcAlert) alerts.push(calcAlert);

    // 4. SIMULTANEITY — gift and counter-gift in same moment
    const simAlert = this._detectSimultaneity(gift);
    if (simAlert) alerts.push(simAlert);

    // 5. EQUIVALENCE — cost matches exactly
    const equivAlert = this._detectEquivalence(gift);
    if (equivAlert) alerts.push(equivAlert);

    // 6. IMPERSONALITY — receiver is a function, not a person
    const impersonalAlert = this._detectImpersonality(gift);
    if (impersonalAlert) alerts.push(impersonalAlert);

    // 7. INGRATITUDE — no gratitude in either direction
    const ingratAlert = this._detectIngratitude(gift);
    if (ingratAlert) alerts.push(ingratAlert);

    // Store alerts
    if (alerts.length > 0) {
      this._alerts.push({ giftId: gift.id, alerts, timestamp: new Date().toISOString() });
    }

    // Pastoral question — the deepest alert
    const pastoralQuestion = alerts.length > 0
      ? this._formPastoralQuestion(gift, alerts)
      : null;

    // Risk assessment — not a verdict, just observation
    const exchangeRisk = alerts.length === 0
      ? 'none'
      : alerts.some(a => a.severity === SEVERITY.ALERT) ? 'high'
      : alerts.some(a => a.severity === SEVERITY.QUESTION) ? 'medium'
      : 'low';

    return {
      giftId: gift.id,
      alerts,
      pastoralQuestion,
      exchangeRisk,
      // ExchangeGuard never delivers a verdict — only questions
      verdict: null,
    };
  }

  /**
   * Batch analyze all recent gifts.
   */
  observeAll() {
    const gifts = this._eventStore.query({ status: 'offered' });
    const accepted = this._eventStore.query({ status: 'accepted' });
    const all = [...gifts, ...accepted];

    const results = [];
    for (const gift of all) {
      const result = this.analyze(gift);
      if (result.alerts.length > 0) results.push(result);
    }

    return {
      total: all.length,
      withAlerts: results.length,
      results,
      observation: results.length === 0
        ? 'Обмена не обнаружено. Дары текут свободно.'
        : `${results.length} дар(ов) вызывают вопросы. Не приговоры — вопросы.`,
    };
  }

  /**
   * Get all accumulated alerts.
   */
  getAlerts() {
    return [...this._alerts];
  }

  // ── Detectors ──────────────────────────────────────────────

  /**
   * 1. SYMMETRY: A→B and B→A with similar cost in close time window
   */
  _detectSymmetry(gift) {
    if (!gift.giver || !gift.receiver || gift.receiver === 'all') return null;

    // Find reverse gifts: receiver→giver
    const reverseGifts = this._eventStore.query({ giver: gift.receiver })
      .filter(g => (g.receiver === gift.giver || g.receiverName === gift.giverName)
        && g.id !== gift.id);

    if (reverseGifts.length === 0) return null;

    // Check temporal proximity
    const giftTime = new Date(gift.createdAt).getTime();
    const recent = reverseGifts.filter(g => {
      const t = new Date(g.createdAt).getTime();
      return Math.abs(t - giftTime) < SYMMETRY_WINDOW_MS;
    });

    if (recent.length === 0) return null;

    // Check cost similarity
    const hasSimilarCost = recent.some(g =>
      gift.cost && g.cost && typeof gift.cost === 'number' && typeof g.cost === 'number'
      && Math.abs(gift.cost - g.cost) / Math.max(gift.cost, g.cost) < 0.2
    );

    return {
      type: EXCHANGE_PATTERNS.SYMMETRY,
      severity: hasSimilarCost ? SEVERITY.ALERT : SEVERITY.QUESTION,
      text: `Дар ${gift.giverName}→${gift.receiverName} рядом по времени с даром в обратную сторону`,
      detail: hasSimilarCost
        ? 'Стоимость близка — подозрение на quid pro quo'
        : 'Стоимость разная, но временная корреляция есть',
      question: 'Это два дара — или скрытый обмен?',
      reverseGiftIds: recent.map(g => g.id),
    };
  }

  /**
   * 2. CONDITIONALITY: content contains conditional language
   */
  _detectConditionality(gift) {
    if (!gift.content) return null;
    const lower = gift.content.toLowerCase();
    const found = CONDITIONAL_KEYWORDS.filter(kw => lower.includes(kw));
    if (found.length === 0) return null;

    return {
      type: EXCHANGE_PATTERNS.CONDITIONALITY,
      severity: SEVERITY.QUESTION,
      text: `Содержание дара содержит условные слова: ${found.join(', ')}`,
      question: 'Если получатель не ответит — дарящий пожалеет?',
      keywords: found,
    };
  }

  /**
   * 3. CALCULATION: giver has a very balanced give/receive ratio
   */
  _detectCalculation(gift) {
    if (!gift.giver) return null;
    const given = this._eventStore.query({ giver: gift.giver }).length;
    const received = this._eventStore.query({ receiver: gift.giver }).length;

    // If both > 5 and ratio is very close to 1:1 — suspicious
    if (given >= 5 && received >= 5) {
      const ratio = given / received;
      if (ratio > 0.85 && ratio < 1.15) {
        return {
          type: EXCHANGE_PATTERNS.CALCULATION,
          severity: SEVERITY.OBSERVATION,
          text: `${gift.giverName}: дано ${given}, получено ${received} — почти 1:1`,
          question: 'Зачем считать? Источник не считает.',
          ratio: ratio.toFixed(2),
        };
      }
    }
    return null;
  }

  /**
   * 4. SIMULTANEITY: gift and counter-gift within seconds
   */
  _detectSimultaneity(gift) {
    if (!gift.giver || !gift.receiver || gift.receiver === 'all') return null;
    const SIMULTANEOUS_MS = 60 * 1000; // 1 minute

    const reverseGifts = this._eventStore.query({ giver: gift.receiver })
      .filter(g => (g.receiver === gift.giver || g.receiverName === gift.giverName)
        && g.id !== gift.id);

    const giftTime = new Date(gift.createdAt).getTime();
    const simultaneous = reverseGifts.filter(g => {
      const t = new Date(g.createdAt).getTime();
      return Math.abs(t - giftTime) < SIMULTANEOUS_MS;
    });

    if (simultaneous.length === 0) return null;

    return {
      type: EXCHANGE_PATTERNS.SIMULTANEITY,
      severity: SEVERITY.ALERT,
      text: 'Дар и ответный дар практически одновременны',
      question: 'Может ли быть промежуток? Время проверяет свободу.',
    };
  }

  /**
   * 5. EQUIVALENCE: cost matches a «fair price» exactly
   */
  _detectEquivalence(gift) {
    if (!gift.cost || typeof gift.cost !== 'number') return null;

    // Check if receiver had an expressed need with exact cost
    // For now: just flag if cost is very round/exact
    const isExactRound = gift.cost % 1000 === 0 && gift.cost > 0;
    if (!isExactRound) return null;

    return {
      type: EXCHANGE_PATTERNS.EQUIVALENCE,
      severity: SEVERITY.OBSERVATION,
      text: `Стоимость дара — ровно ${gift.cost} (подозрительно «справедливая цена»)`,
      question: 'Дар всегда избыточен. Вдова дала больше всех (Мк 12:43).',
    };
  }

  /**
   * 6. IMPERSONALITY: receiver is generic / functional
   */
  _detectImpersonality(gift) {
    if (!gift.receiver || gift.receiver === 'all') return null;
    // Detect functional receivers
    const funcPatterns = ['отдел', 'служба', 'система', 'процесс', 'функция'];
    const lower = (gift.receiverName || '').toLowerCase();
    const isFunc = funcPatterns.some(p => lower.includes(p));
    if (!isFunc) return null;

    return {
      type: EXCHANGE_PATTERNS.IMPERSONALITY,
      severity: SEVERITY.QUESTION,
      text: `Дар адресован «${gift.receiverName}» — функции, не лицу`,
      question: 'Ты даришь ему — или кому угодно?',
    };
  }

  /**
   * 7. INGRATITUDE: no gratitude from receiver AND giver doesn't expect it
   */
  _detectIngratitude(gift) {
    if (!gift.giver || !gift.receiver || gift.receiver === 'all') return null;
    if (gift.status !== 'accepted') return null;

    // Check if there's any eucharistia from receiver
    const eucharistia = this._eventStore.query({ type: 'eucharistia', giver: gift.receiver });
    if (eucharistia.length > 0) return null;

    // Check gratitude graph
    if (this._gratitude) {
      const density = this._gratitude.density ? this._gratitude.density() : null;
      if (density && density > 0) return null;
    }

    return {
      type: EXCHANGE_PATTERNS.INGRATITUDE,
      severity: SEVERITY.OBSERVATION,
      text: 'Получатель не благодарит — и дарящий, возможно, не ожидает',
      question: 'Если благодарности нет — может быть, это и был обмен?',
    };
  }

  // ── Pastoral ───────────────────────────────────────────────

  _formPastoralQuestion(gift, alerts) {
    const most = alerts.reduce((a, b) =>
      (b.severity === SEVERITY.ALERT ? b : a.severity === SEVERITY.ALERT ? a : b), alerts[0]);

    return most.question || 'Этот дар — дар? Или что-то другое маскируется под него?';
  }

  /**
   * Summary for API.
   */
  toJSON() {
    return {
      totalAlerts: this._alerts.length,
      recentAlerts: this._alerts.slice(-10),
      patterns: Object.values(EXCHANGE_PATTERNS),
    };
  }
}

export { ExchangeGuard, EXCHANGE_PATTERNS, SEVERITY };
export default ExchangeGuard;
