/**
 * Vintage — διάκρισις идей по плодам.
 *
 * 1 Фес 5:21 «всё испытывайте, хорошего держитесь».
 * Мф 7:16 «по плодам их узнаете их».
 * Кассиан Римлянин, *Собеседования* II — διάκρισις как высший дар.
 *
 * Vintage отличается от Decoupage:
 *   Decoupage = διαίρεσις = аналитическое разделение по сферам (anatomy)
 *   Vintage   = διάκρισις = узнавание по плодам через время (botany)
 *
 * Архитектурно: Vintage сканирует прошлые акты-идеи (`type: 'question'`,
 * `type: 'word'` с тегом 'idea', symphony-акты) и проверяет: что из них
 * **проросло** в реальность — реальные дары, реальные поведенческие сдвиги,
 * реальные нити в W?
 *
 * Богословский режим: идеи без плодов не отбрасываются —
 * они помечаются как «отложенные» (анастасис: воскрешение позже).
 * Не «плохая идея», а «не время».
 *
 * Использование:
 *   const v = new Vintage(memory);
 *   const report = v.assess({ since: '2026-04-01', cycles: 3 });
 *   // report: { tasted, fruited, sleeping, deferred, vintage }
 */

const DEFAULT_CYCLE_MS = 1000 * 60 * 60 * 24 * 30;  // месяц = цикл выдержки

export class Vintage {
  constructor(memory, { actsIndex = null } = {}) {
    if (!memory) throw new Error('Vintage: memory обязательна');
    this.memory = memory;
    // actsIndex — внешний журнал актов с текстами (data/act-index.json), т.к.
    // W сама по себе хранит только тензор. Без него Vintage работает только
    // на symphonies + W-fingerprint.
    this.actsIndex = actsIndex;
  }

  /**
   * Оценить вино. Возвращает структурированный отчёт.
   *
   * @param {object} opts
   * @param {string|Date} [opts.since] — нижняя граница выдержки (default: 30 дней назад)
   * @param {number} [opts.cycles] — сколько циклов выдержки прошло (default: 1)
   * @param {function} [opts.fruitDetector] — функция (idea) → boolean: дала ли идея плод?
   *   По умолчанию: идея «дала плод» если есть symphony акт после неё ИЛИ
   *   если в act-index появились related акты с linkedIssue от той же темы.
   */
  assess({ since = null, cycles = 1, fruitDetector = null } = {}) {
    const sinceMs = since
      ? (typeof since === 'string' ? new Date(since).getTime() : since.getTime())
      : Date.now() - DEFAULT_CYCLE_MS * cycles;

    const symphonies = this.memory.symphonies();
    const allActs    = this.actsIndex ?? [];

    // 1. Идеи: акты типа 'question' + 'word' (выдвинутые) + symphony.
    //    Из act-index берём акты с типом question/word/witness и временем > since.
    //    Из памяти symphonies — те, что записаны как симфонии.
    const ideas = [];

    for (const a of allActs) {
      const t = new Date(a.ts).getTime();
      if (t < sinceMs) continue;
      if (!['question', 'word', 'witness', 'covenant'].includes(a.type)) continue;
      ideas.push({
        kind:    'act',
        ts:      a.ts,
        from:    a.from,
        to:      a.to,
        type:    a.type,
        content: a.content ?? '',
        linkedIssue: a.linkedIssue ?? null,
      });
    }

    for (const s of symphonies) {
      const t = new Date(s.recordedAt).getTime();
      if (t < sinceMs) continue;
      ideas.push({
        kind:    'symphony',
        ts:      s.recordedAt,
        from:    s.act.giverIds?.join('+') ?? '?',
        to:      s.act.receiverId,
        content: s.act.content ?? s.act.question ?? '',
        actId:   s.actId,
      });
    }

    // 2. Различение по плодам.
    const detect = fruitDetector ?? this._defaultFruitDetector(allActs);

    const tasted   = [];   // прошли через дегустацию (= в выборке)
    const fruited  = [];   // дали плод
    const sleeping = [];   // зреют (выдержка < cycles)
    const deferred = [];   // не дали плода после cycles → анастасис

    const cycleEdge = Date.now() - DEFAULT_CYCLE_MS * cycles;

    for (const idea of ideas) {
      const ageMs = Date.now() - new Date(idea.ts).getTime();
      const fruit = detect(idea);
      tasted.push({ ...idea, fruit });

      if (fruit) {
        fruited.push({ ...idea, fruit });
        continue;
      }
      if (new Date(idea.ts).getTime() > cycleEdge) {
        sleeping.push(idea);  // ещё в бочке
      } else {
        deferred.push(idea);  // выдержка прошла — нет плода — анастасис
      }
    }

    return {
      tasted,
      fruited,
      sleeping,
      deferred,
      vintage: this._describeVintage(tasted, fruited, sleeping, deferred),
      since:   new Date(sinceMs).toISOString(),
      cycles,
    };
  }

  /**
   * fruitDetector по умолчанию: идея «дала плод», если в act-index есть
   * последующий акт того же linkedIssue, или акт с >= 50% общих токенов.
   */
  _defaultFruitDetector(actsIndex) {
    return (idea) => {
      const ideaTime = new Date(idea.ts).getTime();
      // Symphony — само по себе плод (это уже иконный акт)
      if (idea.kind === 'symphony') return { kind: 'symphony', strong: true };

      // Issue plus subsequent acts
      if (idea.linkedIssue) {
        const followUps = actsIndex.filter(a =>
          a.linkedIssue === idea.linkedIssue &&
          new Date(a.ts).getTime() > ideaTime &&
          a.type === 'code'
        );
        if (followUps.length > 0) return { kind: 'code-fruit', count: followUps.length };
      }

      // Lexical signal: общие токены ≥3 символа в content
      const ideaTokens = this._tokens(idea.content);
      if (ideaTokens.size === 0) return null;
      let bestOverlap = 0;
      for (const a of actsIndex) {
        if (new Date(a.ts).getTime() <= ideaTime) continue;
        const at = this._tokens(a.content ?? '');
        const inter = [...ideaTokens].filter(t => at.has(t)).length;
        const overlap = inter / ideaTokens.size;
        if (overlap > bestOverlap) bestOverlap = overlap;
        if (bestOverlap >= 0.5) return { kind: 'lexical', overlap: bestOverlap };
      }
      return null;
    };
  }

  _tokens(s) {
    return new Set(
      (s ?? '').toLowerCase()
        .replace(/[^\wа-яё]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4)
    );
  }

  _describeVintage(tasted, fruited, sleeping, deferred) {
    const total = tasted.length;
    if (total === 0) return 'пустой винтаж — нет идей в выдержке';
    const fr = (fruited.length  / total * 100).toFixed(0);
    const sl = (sleeping.length / total * 100).toFixed(0);
    const df = (deferred.length / total * 100).toFixed(0);

    const tone =
      fruited.length / total >= 0.4 ? 'богатый — много плодов' :
      fruited.length / total >= 0.15 ? 'средний — нормальная выдержка' :
      sleeping.length > deferred.length ? 'юный — большинство ещё в бочке' :
      'тонкий — много идей не проросло, нужна ревизия терруара';

    return {
      total,
      fruited:   `${fruited.length} (${fr}%)`,
      sleeping:  `${sleeping.length} (${sl}%)`,
      deferred:  `${deferred.length} (${df}%) — анастасис, не отбрасывание`,
      tone,
    };
  }
}

export default Vintage;
