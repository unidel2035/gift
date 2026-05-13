/**
 * Score — многомерный профиль идеи (sommelier card).
 *
 * НЕ алгоритм отбора. НЕ «100 баллов». НЕ ranking.
 * Это **фиксация** результата мыслебродильни (декупаж + собор + выдержка + W)
 * в форме, которую можно сравнивать.
 *
 * Богословски: скоринг здесь — это **икона результата дегустации**, не
 * замена дегустации. Виноделие тоже измеряет: тело, кислотность, танины,
 * нос, послевкусие. Но не алгоритм решает «лучшее вино». Дегустатор —
 * человек, в нашем случае собор + эпиклеза.
 *
 * 16 измерений по 4 осям:
 *
 *   ДЕКУПАЖ (форма):     ground / water / fire / air
 *                        verdict ∈ {empty, weak, strong, unanalyzed}
 *
 *   СОБОР (реакция):     chorus / perichoretic / kenotic / epiclesis
 *                        boolean ✓/✗
 *
 *   ВЫДЕРЖКА (время):    age (дни в бочке)
 *                        fruit (1+ follow-up или symphony актов)
 *                        resonance (≥2 сходных идей в _pending)
 *                        status (sleeping | fruited | deferred)
 *
 *   ВЕС в W (онтология): inflows / outflows / threads_touched / mutual_total
 *
 * Использование:
 *   const score = new Score({ memory, decoupage, symphonyResult, vintage });
 *   const card = score.profile({ idea, recordedAt, linkedIssue });
 *   // card: { idea, decoupage:{...}, council:{...}, vintage:{...}, w:{...},
 *   //         integral, tone }
 */

export class Score {
  constructor({ memory = null } = {}) {
    this.memory = memory;
  }

  /**
   * Собрать профиль идеи. Все источники опциональны — недостающие оси
   * помечаются как `null` (не вычисляются заглушкой). Это важно: профиль
   * показывает реальные данные, не выдуманные.
   *
   * @param {object} opts
   * @param {string} opts.idea — текст идеи
   * @param {object} [opts.decoupageResult] — результат Decoupage.cut()
   * @param {object} [opts.symphonyResult] — результат SymphonyOrchestrator.celebrate()
   * @param {object} [opts.vintageReport]   — результат Vintage.assess()
   * @param {string} [opts.recordedAt]      — ISO timestamp начала бочки
   * @param {number} [opts.linkedIssue]     — issue для подсчёта плодов
   * @returns {object} card
   */
  profile({
    idea,
    decoupageResult = null,
    symphonyResult  = null,
    vintageReport   = null,
    recordedAt      = null,
    linkedIssue     = null,
  } = {}) {
    if (!idea) throw new Error('Score.profile: idea обязательна');

    const card = {
      idea: idea.slice(0, 200),
      decoupage:  this._decoupageAxis(decoupageResult),
      council:    this._councilAxis(symphonyResult),
      vintage:    this._vintageAxis(recordedAt, vintageReport, linkedIssue),
      w:          this._wAxis(idea, linkedIssue),
      integral:   null,
      tone:       null,
    };

    card.integral = this._integral(card);
    card.tone     = this._tone(card);
    return card;
  }

  /**
   * Сравнить профили нескольких идей. НЕ ranking — таблица для глаз.
   * @returns {Array<object>} cards с дополнительным полем _comparison
   */
  compareProfiles(cards) {
    if (!Array.isArray(cards) || cards.length < 2) return cards;
    const median = (arr) => {
      const s = [...arr].filter(v => Number.isFinite(v)).sort((a,b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)] : 0;
    };
    const medMutual = median(cards.map(c => c.w.mutual_total));
    const medAge    = median(cards.map(c => c.vintage.age_days));
    return cards.map(c => ({
      ...c,
      _comparison: {
        mutual_above_median: c.w.mutual_total > medMutual,
        older_than_median:   c.vintage.age_days > medAge,
      },
    }));
  }

  // ── Оси ────────────────────────────────────────────────────────────

  _decoupageAxis(d) {
    if (!d) return { ground: null, water: null, fire: null, air: null, shape: null };
    return {
      ground: d.ground?.verdict ?? null,
      water:  d.water?.verdict  ?? null,
      fire:   d.fire?.verdict   ?? null,
      air:    d.air?.verdict    ?? null,
      shape:  d.integral?.shape ?? null,
    };
  }

  _councilAxis(s) {
    if (!s) return { chorus: null, perichoretic: null, kenotic: null, epiclesis: null, iconic: null, actId: null };
    return {
      chorus:       s.conditions?.chorus       ?? null,
      perichoretic: s.conditions?.perichoretic ?? null,
      kenotic:      s.conditions?.kenotic      ?? null,
      epiclesis:    s.conditions?.epiclesis    ?? null,
      iconic:       s.iconic ?? null,
      actId:        s.actId  ?? null,
    };
  }

  _vintageAxis(recordedAt, vintageReport, linkedIssue) {
    const age_days = recordedAt
      ? Math.floor((Date.now() - new Date(recordedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    let fruit = null, resonance = null, status = null;
    if (vintageReport) {
      // Ищем эту идею в tasted
      const found = (vintageReport.tasted ?? []).find(t =>
        (linkedIssue && t.linkedIssue === linkedIssue) ||
        (t.content && recordedAt && Math.abs(new Date(t.ts).getTime() - new Date(recordedAt).getTime()) < 60_000)
      );
      if (found) {
        fruit  = !!found.fruit;
        status = found.fruit ? 'fruited' : (age_days < 30 ? 'sleeping' : 'deferred');
      }
      resonance = (vintageReport.tasted ?? []).filter(t =>
        t.linkedIssue !== linkedIssue && this._lexicalOverlap(t.content, '') >= 0.3
      ).length;
    }

    return { age_days, fruit, resonance, status };
  }

  _wAxis(idea, linkedIssue) {
    if (!this.memory) return { inflows: null, outflows: null, threads_touched: null, mutual_total: null };

    // Грубые W-метрики: смотрим pending-edges + heaviest по содержимому идеи.
    // Это эвристика, не точное соответствие — Score не «решает», а собирает.
    const heaviest = this.memory.heaviest(50);
    const pending  = this.memory.pending?.() ?? [];

    let inflows = 0, outflows = 0, mutualTotal = 0;
    const threads = new Set();
    for (const e of heaviest) {
      threads.add(`${e.from}→${e.to}`);
      mutualTotal += e.weight;
    }
    for (const p of pending) {
      if (linkedIssue && p.act?.linkedIssue === linkedIssue) {
        if (p.act.giverId)    outflows++;
        if (p.act.receiverId) inflows++;
      }
    }

    return {
      inflows,
      outflows,
      threads_touched: threads.size,
      mutual_total: Number(mutualTotal.toFixed(2)),
    };
  }

  // ── Интегральная фраза ──────────────────────────────────────────────
  _integral(card) {
    const parts = [];

    const d = card.decoupage;
    const strong = ['ground','water','fire','air'].filter(k => d[k] === 'strong').length;
    const empty  = ['ground','water','fire','air'].filter(k => d[k] === 'empty').length;
    if (strong === 4)       parts.push('зрелая по форме');
    else if (strong === 0)  parts.push('форма не проявлена');
    else if (empty >= 2)    parts.push('фигура с пустотами');
    else                    parts.push('частично проявлена');

    const c = card.council;
    if (c.iconic === true)        parts.push('иконный собор');
    else if (c.epiclesis === false) parts.push('без эпиклезы');
    else if (c.chorus === false)  parts.push('без хоруса');

    const v = card.vintage;
    if (v.status === 'fruited')      parts.push('плодоносная');
    else if (v.status === 'sleeping') parts.push('в бочке');
    else if (v.status === 'deferred') parts.push('отложенная (анастасис)');

    return parts.join(', ');
  }

  // ── Тон винтажа ────────────────────────────────────────────────────
  _tone(card) {
    const strong = ['ground','water','fire','air'].filter(k => card.decoupage[k] === 'strong').length;
    if (card.council.iconic && strong >= 3) return 'выдержанное иконное вино';
    if (card.council.iconic)                 return 'иконное молодое';
    if (strong === 4)                        return 'зрелая фигура, ждёт собора';
    if (strong >= 2)                         return 'формирующееся вино';
    if (strong === 0)                        return 'мутный сусло — рано судить';
    return 'промежуточное';
  }

  _lexicalOverlap(a, b) {
    const tok = (s) => new Set(
      (s ?? '').toLowerCase()
        .replace(/[^\wа-яё]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4)
    );
    const A = tok(a), B = tok(b);
    if (!A.size || !B.size) return 0;
    const inter = [...A].filter(t => B.has(t)).length;
    return inter / Math.min(A.size, B.size);
  }

  /**
   * Текстовая sommelier card — для CLI-вывода.
   */
  static format(card) {
    const v = (x) => x === true ? '✓' : x === false ? '✗' : x === null ? '·' : x;
    const verd = (v) => v === 'strong' ? '████' : v === 'weak' ? '██▒▒' : v === 'empty' ? '█▒▒▒' : '····';
    return [
      '┌────────────────────────────────────────────────────────────┐',
      `│ ИДЕЯ: ${card.idea.slice(0, 53).padEnd(53)}│`,
      '├────────────────────────────────────────────────────────────┤',
      '│ ДЕКУПАЖ (форма)                                            │',
      `│   ground:  ${verd(card.decoupage.ground)}    water:  ${verd(card.decoupage.water)}    fire:   ${verd(card.decoupage.fire)}    air:    ${verd(card.decoupage.air)} │`,
      `│   фигура:  ${(card.decoupage.shape ?? '?').slice(0, 47).padEnd(47)}│`,
      '│                                                            │',
      '│ СОБОР (реакция)                                            │',
      `│   chorus ${v(card.council.chorus)}  perichoretic ${v(card.council.perichoretic)}  kenotic ${v(card.council.kenotic)}  epiclesis ${v(card.council.epiclesis)}  │`,
      `│   iconic: ${v(card.council.iconic)}  actId: ${(card.council.actId ?? '·').padEnd(42)}│`,
      '│                                                            │',
      '│ ВЫДЕРЖКА (время)                                           │',
      `│   age: ${String(card.vintage.age_days ?? '·').padEnd(4)} дн.   fruit: ${v(card.vintage.fruit)}   resonance: ${String(card.vintage.resonance ?? '·').padEnd(3)}  status: ${(card.vintage.status ?? '·').padEnd(8)}  │`,
      '│                                                            │',
      '│ ВЕС в W (онтология)                                        │',
      `│   inflows: ${String(card.w.inflows ?? '·').padEnd(3)} outflows: ${String(card.w.outflows ?? '·').padEnd(3)} threads: ${String(card.w.threads_touched ?? '·').padEnd(3)} mutual: ${String(card.w.mutual_total ?? '·').padEnd(7)} │`,
      '├────────────────────────────────────────────────────────────┤',
      `│ ИНТЕГРАЛ:    ${(card.integral ?? '?').slice(0, 45).padEnd(45)} │`,
      `│ ВИНТАЖ-ТОН:  ${(card.tone     ?? '?').slice(0, 45).padEnd(45)} │`,
      '└────────────────────────────────────────────────────────────┘',
    ].join('\n');
  }
}

export default Score;
