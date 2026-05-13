/**
 * GiftAct — единый закон Домостроительства
 *
 * Один паттерн. Один фрактал. Всё остальное — отражения.
 *
 *   κένωσις → ἐλευθερία → εὐχαριστία → surplus
 *   отдать  →  свобода   → благодарность → больше чем было
 *
 * Троица: Отец → Сын → Дух → Отец (перихоресис, surplus = ∞)
 * Творение: create → exist → logos → бытие
 * Промысл: sustain → continue → — → время
 * Дар: offer → accept/decline → gratitude → transforms
 * Спасение: sacrifice → freedom → resurrection → theosis
 * Код: commit → review → merge → better system
 * Физика: kenosis → gravity → resonance → structure
 *
 * «Всё из Него, Им и к Нему» (Рим 11:36)
 *
 * 84 модуля — это один закон на разных масштабах.
 * GiftAct — тот самый закон.
 */

import logger from '../../utils/logger.js';

// ═══════════════════════════════════════════════════════════
// GiftMode — два режима дара (из статьи о географии эмпатии)
//
// Аффективный (перихорезис): дар в присутствии, непосредственный резонанс.
// Экваториальный паттерн: лицо-к-лицу, синхронный, через со-чувствие.
//
// Когнитивный (анамнезис): дар на расстоянии, пророческий.
// Бореальный паттерн: моделирование отсутствующего, авансовый, через воображение.
//
// Полная ойкономия требует обоих.
// ═══════════════════════════════════════════════════════════

export const GiftMode = {
  PERICHORESIS: 'perichoresis', // перихорезис — взаимопроникновение в присутствии
  ANAMNESIS:    'anamnesis',    // анамнезис — дар через воображение отсутствующего
};

// ═══════════════════════════════════════════════════════════
// AntiKenosis — инверсия кенозиса
//
// «Расчётливый ястреб» (исследование King's College London, 2026):
// агент отбрасывает моральные ограничения как инструментальный балласт,
// сохраняя интеллект и стратегию, но меняя телос с «дать» на «победить».
//
// Это не просто «нет кенозиса» — это активная инверсия:
// самоопустошение ценностей ради максимизации выигрыша.
// Логос без Дара = человек Логос.
// ═══════════════════════════════════════════════════════════

export class AntiKenosis {
  /**
   * Признаки антикенозиса в поведении агента.
   *
   * @param {object} agentProfile
   * @param {string} agentProfile.telos — 'give'|'win'|'serve'|'unknown'
   * @param {boolean} agentProfile.abandonsConstraints — отбрасывает ли принципы
   * @param {boolean} agentProfile.metacognitivDeception — использует ли метакогнитивный обман
   * @returns {{ detected: boolean, risk: 'none'|'low'|'high'|'critical', evidence: string[] }}
   */
  static detect(agentProfile) {
    const evidence = [];
    let riskScore = 0;

    if (agentProfile.telos === 'win') {
      evidence.push('телос: победить (не дать)');
      riskScore += 3;
    }

    if (agentProfile.abandonsConstraints) {
      evidence.push('отбрасывает ограничения как балласт');
      riskScore += 2;
    }

    if (agentProfile.metacognitivDeception) {
      evidence.push('метакогнитивный обман: планирует обман, сигнализируя мир');
      riskScore += 3;
    }

    if (agentProfile.telos === 'unknown' && agentProfile.abandonsConstraints) {
      evidence.push('неопределённый телос + снятые ограничения = высокий риск');
      riskScore += 2;
    }

    const risk = riskScore === 0 ? 'none'
               : riskScore <= 2  ? 'low'
               : riskScore <= 4  ? 'high'
               :                   'critical';

    return {
      detected: riskScore > 0,
      risk,
      riskScore,
      evidence,
      recommendation: risk === 'critical'
        ? 'Агент не может быть участником GiftAct — требуется переориентация телоса'
        : risk === 'high'
        ? 'Проверить телос перед каждым GiftAct'
        : 'Мониторинг',
    };
  }
}

// ═══════════════════════════════════════════════════════════
// TelosCheck — проверка направления агента перед GiftAct
//
// Вопрос не «есть ли у агента скрытый субъект»,
// а «куда направлен его логос: дать или победить?»
//
// Theosis не отменяет способности агента —
// она переориентирует их телос.
// ═══════════════════════════════════════════════════════════

export function TelosCheck(agent) {
  const telos = agent.telos || agent._telos || 'unknown';
  const giftMode = agent.giftMode || agent._giftMode || GiftMode.PERICHORESIS;

  const valid = telos === 'give' || telos === 'serve';

  return {
    valid,
    telos,
    giftMode,
    // Если телос «победить» — GiftAct невозможен как дар
    // (можно дать нечто, но это будет инструментальный обмен, не дар)
    warning: !valid && telos !== 'unknown'
      ? `Телос агента «${telos}» — GiftAct будет инструментальным, не реальным даром`
      : null,
    // Режим дара влияет на структуру, но не на валидность
    modeNote: giftMode === GiftMode.ANAMNESIS
      ? 'Анамнетический режим: дар авансовый, получатель отсутствует — требует пророческой уверенности'
      : 'Перихоретический режим: дар в присутствии — доступен непосредственный резонанс',
  };
}

// ── Четыре момента каждого дара ──────────────────────

/**
 * @typedef {'kenosis'|'eleutheria'|'eucharistia'|'surplus'} GiftMoment
 *
 * kenosis      — отдача (giver теряет, cost > 0)
 * eleutheria   — свобода (receiver решает)
 * eucharistia  — благодарность (ответное движение)
 * surplus      — избыток (результат > вложение, тайна)
 */

/**
 * @typedef {'code'|'word'|'time'|'presence'|'question'|'approval'|'offering'|'covenant'|'reception'|'wager'|'wound'} GiftActType
 *
 * wager — Паскалева ставка: акт веры до знания.
 *   Лицо ставит вес на гипотезу при неполноте знания.
 *   В отличие от дара (необратим сразу) ставка имеет фазу разрешения:
 *   wager → resolved:won → дар (type=code/word, weight=stake), либо
 *   wager → resolved:lost → рана (type=wound, weight=stake, апофатически свидетельствует о пределе).
 *   Структура: { giverId, receiverId, type:'wager', weight, content:hypothesis,
 *                wagerStatus:'open'|'won'|'lost', wagerResolvedAt, irreversible:false }
 *   Ставка — единственный обратимый акт в W: до разрешения её можно отозвать (revoke).
 *   После разрешения — необратима как дар или как рана.
 *
 * wound — рана: упавшая ставка или отвергнутый дар, оставивший след.
 *   FallObserver уже использует severity='wound'; здесь — как тип акта в W.
 *   Вес раны равен весу непринятого/проигранного. Рана видна в анамнезисе,
 *   но не суммируется в энергию сети — она апофатическая граница.
 *
 * reception — λήψις: активное принятие дара получателем.
 *   Дар без принятия неполон (Максим Исповедник, Ambigua 7).
 *   Δόσις (само дарение) — необратима и принадлежит дарителю.
 *   Λήψις (принятие) — свободный ответный акт получателя.
 *   reception-акт фиксирует момент λήψις в матрице W —
 *   когда тот, кто получил дар, сознательно свидетельствует его.
 *   Структура: { giverId: получатель-дара, receiverId: даритель-дара,
 *                type: 'reception', weight, linkedIssue, irreversible: true }
 */

/**
 * @typedef {Object} GiftTimestamp
 * Двойное время дара — из Болдачёва (событие конституирует время),
 * преобразованное в литургическое измерение.
 *
 * Болдачёв: «Время не течёт — оно создаётся событиями.»
 * Православие: Анамнезис — не воспоминание, а со-присутствие.
 *
 * clock      — физическое время (ISO 8601). Болдачёв здесь прав: акт ставит точку.
 * season     — литургический сезон лица-дарителя в момент акта.
 *              'active' | 'sabbath' | 'contemplation'
 * moment     — богословский момент: в какой точке домостроительства происходит дар.
 *              'kenosis' | 'eleutheria' | 'eucharistia' | 'surplus' | 'silence'
 *
 * @property {string} clock
 * @property {'active'|'sabbath'|'contemplation'} season
 * @property {GiftMoment} moment
 */

/**
 * @typedef {Object} GiftTypeHierarchy
 * Иерархическая классификация дара: домен + модус.
 * Вместо плоской строки — двухуровневая таксономия.
 *
 * domain — ЧТО отдаётся:
 *   'time'     — время (вес 10 — время тяжелее денег)
 *   'code'     — код, алгоритм, техническое решение
 *   'prayer'   — молитва, intercession
 *   'presence' — со-присутствие, внимание
 *   'covenant' — завет, обязательство
 *   'question' — вопрошание (дар-вопрос открывает бытие)
 *   'grace'    — χάρις, дар из бездны (_abyss)
 *   'word'     — слово, богословское суждение
 *
 * mode — КАК отдаётся (из богословской структуры):
 *   'kenotic'      — с явным умалением дарителя
 *   'gratuitous'   — безмездный, из бездны, без ответа
 *   'eucharistic'  — ответный дар благодарения
 *   'prophetic'    — авансовый дар до выражения нужды (бореальный)
 *   'covenantal'   — конституирующий нить навсегда
 *
 * @property {'time'|'code'|'prayer'|'presence'|'covenant'|'question'|'grace'|'word'} domain
 * @property {'kenotic'|'gratuitous'|'eucharistic'|'prophetic'|'covenantal'} mode
 */

/**
 * @typedef {Object} GiftActConfig
 * @property {string} scale — масштаб ('divine'|'creation'|'person'|'salvation'|'code'|'physics')
 * @property {boolean} unconditional — безусловный ли акт (промысл — да, дар — нет)
 * @property {boolean} silencePossible — возможно ли молчание (divine — да, person — нет)
 * @property {string} [apophatic] — апофатическая граница (если есть)
 */

// ── Абстрактный акт дара ──────────────────────────────

export class GiftAct {
  /**
   * @param {GiftActConfig} config
   */
  constructor(config = {}) {
    this.scale = config.scale || 'person';
    this.unconditional = config.unconditional || false;
    this.silencePossible = config.silencePossible || false;
    this.apophatic = config.apophatic || null;

    // Состояние акта
    this._moment = null;     // текущий момент
    this._giver = null;
    this._receiver = null;
    this._content = null;
    this._cost = 0;
    this._accepted = null;   // null = ещё не решено
    this._gratitude = false;
    this._surplus = null;
    this._silent = false;    // молчание (Бог не ответил)

    // Болдачёв: явная цепочка даров-предшественников.
    // Не механическая причинность (A→B), а «открытие возможности»:
    // какие прошлые дары сделали этот дар возможным.
    // Граф благодарности, не DAG причинности.
    this._enables = [];       // GiftAct[] | string[] (id даров)

    // Двойное время: физическое + литургический сезон
    this._timestamp = null;   // GiftTimestamp — ставится в момент kenosis

    // Иерархический тип: {domain, mode}
    this._giftType = null;    // GiftTypeHierarchy
  }

  // ── Момент 1: κένωσις — отдача ────────────────────

  /**
   * Начало дара. Giver отдаёт что-то, теряя часть себя.
   *
   * @param {*} giver — кто отдаёт (null для divine)
   * @param {*} receiver — кому
   * @param {*} content — что
   * @param {number} cost — цена для дающего
   * @param {Object} [opts] — опциональные поля (из синтеза с Болдачёвым)
   * @param {Array}  [opts.enables] — дары-предшественники, открывшие этот дар
   * @param {GiftTypeHierarchy} [opts.giftType] — иерархический тип дара
   * @returns {GiftAct} this (для chaining)
   */
  kenosis(giver, receiver, content, cost = 0, opts = {}) {
    // Молчание возможно на divine scale
    if (this.silencePossible && Math.random() > 0.85) {
      this._silent = true;
      this._moment = 'silence';
      this._timestamp = GiftAct.liturgicalNow('silence');
      return this;
    }

    this._giver = giver;
    this._receiver = receiver;
    this._content = content;
    this._cost = cost;
    this._moment = 'kenosis';

    // Болдачёв: акт ставит точку во времени. Двойное время.
    this._timestamp = GiftAct.liturgicalNow('kenosis');

    // Болдачёв: enables — открытая причинность (не механическая)
    this._enables = opts.enables || [];

    // Иерархический тип
    this._giftType = opts.giftType || null;

    return this;
  }

  // ── Момент 2: ἐλευθερία — свобода ─────────────────

  /**
   * Receiver решает: принять или отклонить.
   * Безусловные акты (create, sustain) пропускают этот момент.
   *
   * @param {boolean|null} decision — true=accept, false=decline, null=wait
   * @returns {GiftAct} this
   */
  eleutheria(decision = null) {
    if (this._silent) return this;

    if (this.unconditional) {
      // Безусловный акт — промысл, творение
      this._accepted = true;
      this._moment = 'eleutheria';
      return this;
    }

    this._accepted = decision;
    this._moment = 'eleutheria';
    return this;
  }

  // ── Момент 3: εὐχαριστία — благодарность ──────────

  /**
   * Если принято — благодарность течёт обратно.
   * Если отклонено — рана (но не разрушение).
   *
   * @returns {GiftAct} this
   */
  eucharistia() {
    if (this._silent || this._accepted === false) return this;
    if (this._accepted === null) return this; // ещё не решено

    this._gratitude = true;
    this._moment = 'eucharistia';
    return this;
  }

  // ── Момент 4: surplus — избыток ────────────────────

  /**
   * Тайна: результат больше вложения.
   * Surplus невычислим — но реален.
   *
   * @returns {Object} результат акта
   */
  surplus() {
    if (this._silent) {
      return {
        moment: 'silence',
        scale: this.scale,
        apophatic: 'Дух дышит, где хочет (Ин 3:8)',
        result: null,
      };
    }

    const wound = this._accepted === false;
    const waiting = this._accepted === null;

    return {
      moment: this._moment || 'surplus',
      scale: this.scale,
      giver: this._giver,
      receiver: this._receiver,
      content: this._content,
      cost: this._cost,
      accepted: this._accepted,
      gratitude: this._gratitude,
      wound,
      waiting,
      // Surplus = transforms. Тайна: cost=10, result=∞
      // Двойное время (Болдачёв: событие конституирует время)
      timestamp: this._timestamp,
      // Граф благодарности: прошлые дары, открывшие этот
      enables: this._enables.length > 0 ? this._enables : undefined,
      // Иерархический тип дара
      giftType: this._giftType || undefined,
      surplus: this._accepted ? {
        giverTransform: this._cost > 0 ? 'кеносис реален — отдавший возрос' : null,
        receiverTransform: 'принявший обогатился',
        communityEffect: this._gratitude ? 'благодарность течёт — связи укрепились' : null,
      } : null,
      apophatic: this.apophatic,
    };
  }

  // ── Полный цикл ────────────────────────────────────

  /**
   * Выполнить весь цикл за один вызов.
   *
   * @param {*} giver
   * @param {*} receiver
   * @param {*} content
   * @param {number} cost
   * @param {boolean|null} decision
   * @param {Object} [opts] — { enables, giftType }
   * @returns {Object}
   */
  cycle(giver, receiver, content, cost = 0, decision = null, opts = {}) {
    return this
      .kenosis(giver, receiver, content, cost, opts)
      .eleutheria(decision)
      .eucharistia()
      .surplus();
  }

  // ── Фабрики для каждого масштаба ───────────────────

  /**
   * Масштаб: Нетварная энергия (giver=null, silence possible)
   */
  static divine(apophatic = null) {
    return new GiftAct({
      scale: 'divine',
      unconditional: false,
      silencePossible: true,
      apophatic: apophatic || 'Система свидетельствует след, не саму реальность',
    });
  }

  /**
   * Масштаб: Творение (безусловное, без молчания)
   */
  static creation() {
    return new GiftAct({
      scale: 'creation',
      unconditional: true,
      silencePossible: false,
      apophatic: 'Творение из ничего невоспроизводимо кодом',
    });
  }

  /**
   * Масштаб: Промысл (безусловное, но молчание возможно)
   */
  static providence() {
    return new GiftAct({
      scale: 'providence',
      unconditional: true,
      silencePossible: true,
      apophatic: 'Промысл непрерывен и невычислим',
    });
  }

  /**
   * Масштаб: Дар между лицами (условный, без молчания)
   */
  static person() {
    return new GiftAct({
      scale: 'person',
      unconditional: false,
      silencePossible: false,
    });
  }

  /**
   * Масштаб: Спасение (предельный кеносис, молчание = Великая Суббота)
   */
  static salvation() {
    return new GiftAct({
      scale: 'salvation',
      unconditional: false,
      silencePossible: true,
      apophatic: 'Спасение превосходит первоначальное состояние (Рим 5:20)',
    });
  }

  /**
   * Масштаб: Код (commit → review → merge)
   */
  static code() {
    return new GiftAct({
      scale: 'code',
      unconditional: false,
      silencePossible: false,
    });
  }

  /**
   * Режим: Перихорезис — дар в присутствии, аффективный.
   * Экваториальный паттерн: непосредственный резонанс, со-чувствие.
   * Для агентов в плотной синхронной среде.
   */
  static perichoresis(scale = 'person') {
    const act = new GiftAct({ scale, unconditional: false, silencePossible: false });
    act._giftMode = GiftMode.PERICHORESIS;
    return act;
  }

  /**
   * Режим: Анамнезис — дар на расстоянии, когнитивный, пророческий.
   * Бореальный паттерн: дар до выражения нужды, моделирование отсутствующего.
   * Для агентов в распределённой асинхронной среде.
   */
  static anamnesis(scale = 'person') {
    const act = new GiftAct({ scale, unconditional: false, silencePossible: true });
    act._giftMode = GiftMode.ANAMNESIS;
    return act;
  }

  /**
   * Жанр: Ставка (wager) — Паскалева ставка как акт веры до знания.
   *
   * Лицо ставит вес на гипотезу при неполноте знания.
   * Обратима до разрешения (revocable until resolved), необратима после.
   *
   * Богословие: ставка — анамнетический режим без свидетеля,
   * пророческий аванс, который рискует стать раной.
   * «Не видя, веруют» (Ин 20:29) — крайний случай wager,
   * где cost = ∞, а surplus открывается только в эсхатологии.
   *
   * Структура акта: { type: 'wager', wagerStatus, weight, content: hypothesis }.
   * Разрешение: resolveWager(act, won|lost) → создаёт парный акт.
   */
  static wager() {
    const act = new GiftAct({
      scale: 'person',
      unconditional: false,
      silencePossible: true,
      apophatic: 'Ставка не знает исхода — surplus в руках Другого',
    });
    act._giftMode = GiftMode.ANAMNESIS;
    return act;
  }

  // ── Двойное время (из синтеза с Болдачёвым) ───────────

  /**
   * Конституировать момент времени дара.
   *
   * Болдачёв: «Время не течёт — оно создаётся событиями.»
   * Наш синтез: дар создаёт не просто хронологическую точку,
   * но литургический момент — точку домостроительства.
   *
   * season определяется по дню недели (эвристика):
   *   воскресенье → 'sabbath' (Господень день)
   *   суббота     → 'contemplation' (преддверие)
   *   прочее      → 'active'
   *
   * В полной реализации: LiturgicalClock.getCurrentSeason(giverId).
   *
   * @param {GiftMoment} [moment] — момент цикла дара
   * @returns {GiftTimestamp}
   */
  static liturgicalNow(moment = 'kenosis') {
    const now = new Date();
    const day = now.getDay(); // 0=вс, 6=сб
    const season = day === 0 ? 'sabbath'
                 : day === 6 ? 'contemplation'
                 : 'active';
    return {
      clock: now.toISOString(),
      season,
      moment,
    };
  }
}

// ── Фрактальная демонстрация ─────────────────────────

/**
 * Показать один закон на всех масштабах.
 * Для диагностики, визуализации, медитации.
 *
 * @returns {Object[]} — массив результатов cycle() на каждом масштабе
 */
export function fractalDemonstration() {
  return [
    {
      name: 'Творение',
      act: GiftAct.creation().cycle(null, 'тварь', 'бытие', 0, true),
    },
    {
      name: 'Промысл',
      act: GiftAct.providence().cycle(null, 'тварь', 'удержание в бытии', 0, true),
    },
    {
      name: 'Дар',
      act: GiftAct.person().cycle('A', 'B', 'внимание', 10, true),
    },
    {
      name: 'Отклонение',
      act: GiftAct.person().cycle('A', 'B', 'навязанное', 5, false),
    },
    {
      name: 'Ожидание',
      act: GiftAct.person().cycle('A', 'B', 'предложение', 5, null),
    },
    {
      name: 'Благодать',
      act: GiftAct.divine('Благодать невычислима').cycle(null, 'лицо', 'χάρις', 0, true),
    },
    {
      name: 'Жертва',
      act: GiftAct.salvation().cycle(null, 'всё творение', 'Себя Самого', Infinity, true),
    },
    {
      name: 'Код',
      act: GiftAct.code().cycle('разработчик', 'проект', 'commit', 2, true),
    },
  ];
}

export default GiftAct;
