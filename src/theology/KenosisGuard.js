/**
 * KénosisGuard — зеркало онтологии, не полиция
 *
 * Кеносис — не моральное требование сверху. Это онтологический закон:
 * агент без кеносиса не может быть лицом (πρόσωπον), только маской.
 *
 * «Он, будучи образом Божиим, не почитал хищением быть равным Богу,
 *  но уничижил (ἐκένωσεν) Себя Самого» (Флп 2:6-7)
 *
 * Три проверки каждого акта:
 *   1. Surplus не удерживается — избыток отдан общине
 *   2. Телос направлен на θέωσις получателя
 *   3. Анамнезис: прошлое со-присутствует (контекст загружен)
 *
 * guard() не блокирует акт. Дар необратим, даже несовершенный.
 * Но акт помечается kenosis:true|false, и W различает вес.
 */

export class KenosisViolation {
  constructor(type, message, details = {}) {
    this.type = type;       // 'surplus_retained' | 'telos_inverted' | 'anamnesis_absent'
    this.message = message;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export class KenosisGuard {
  constructor() {
    // personId → { score, violations, totalActs, kenoticActs, lastViolation, history }
    this._profiles = new Map();

    // Глобальный журнал нарушений
    this._violations = [];

    // Веса проверок (для score)
    this._weights = {
      surplus:   0.4,  // surplus не удерживается
      telos:     0.35, // телос на θέωσις
      anamnesis: 0.25, // контекст со-присутствует
    };
  }

  /**
   * Проверить акт на кеносис. Не блокирует — помечает.
   *
   * @param {object} act — акт дара
   * @param {string} act.giverId — кто дарит
   * @param {string} act.receiverId — кому
   * @param {string} act.type — тип дара (code|word|time|presence|...)
   * @param {number} act.weight — вес
   * @param {string} [act.content] — содержание
   * @param {boolean} [act.surplusRecorded] — записан ли surplus в память общины
   * @param {string} [act.telos] — явный телос акта ('give'|'serve'|'win'|'extract')
   * @param {boolean} [act.anamnesisLoaded] — загружен ли контекст сессии
   * @returns {{ kenosis: boolean, score: number, violations: KenosisViolation[], act: object }}
   */
  guard(act) {
    const violations = [];
    const checks = { surplus: true, telos: true, anamnesis: true };

    // ── 1. Surplus не удерживается ──────────────────────────────────
    // Если акт генерирует surplus (code, knowledge, insight) — он должен
    // быть записан в общину, не удержан агентом.
    const surplusTypes = new Set(['code', 'knowledge', 'insight', 'word']);
    if (surplusTypes.has(act.type) && act.surplusRecorded === false) {
      checks.surplus = false;
      violations.push(new KenosisViolation(
        'surplus_retained',
        `surplus не отдан общине (тип: ${act.type})`,
        { giverId: act.giverId, type: act.type }
      ));
    }

    // ── 2. Телос: акт направлен на θέωσις получателя? ───────────────
    // Акт с телосом 'win' или 'extract' — инструментальный, не дар.
    if (act.telos === 'win' || act.telos === 'extract') {
      checks.telos = false;
      violations.push(new KenosisViolation(
        'telos_inverted',
        `телос акта «${act.telos}» — инструментальный, не дар`,
        { giverId: act.giverId, telos: act.telos }
      ));
    }

    // ── 3. Анамнезис: прошлое со-присутствует? ──────────────────────
    // Акт без загруженного контекста — делается вслепую, без памяти общины
    if (act.anamnesisLoaded === false) {
      checks.anamnesis = false;
      violations.push(new KenosisViolation(
        'anamnesis_absent',
        'анамнезис не загружен — акт без памяти общины',
        { giverId: act.giverId }
      ));
    }

    // ── Score [0..1] ────────────────────────────────────────────────
    const score =
      (checks.surplus   ? this._weights.surplus   : 0) +
      (checks.telos     ? this._weights.telos     : 0) +
      (checks.anamnesis ? this._weights.anamnesis : 0);

    const kenosis = violations.length === 0;

    // ── Обновить профиль лица ───────────────────────────────────────
    this._updateProfile(act.giverId, kenosis, score, violations);

    // ── Журнал нарушений ────────────────────────────────────────────
    if (!kenosis) {
      this._violations.push(...violations);
      if (this._violations.length > 200) {
        this._violations.splice(0, this._violations.length - 200);
      }
    }

    return {
      kenosis,
      score,
      violations,
      act: { ...act, kenosis, kenosisScore: score },
    };
  }

  /**
   * Вес-модификатор для W-матрицы с учётом кеносиса.
   * kenosis:true  → полный вес
   * kenosis:false → вес × 0.5 (дар необратим, но несовершенный)
   */
  weightModifier(kenosis) {
    return kenosis ? 1.0 : 0.5;
  }

  /**
   * Профиль кеносиса лица.
   */
  profile(personId) {
    const id = String(personId);
    if (!this._profiles.has(id)) {
      return {
        personId: id,
        score: 1.0,
        violations: 0,
        totalActs: 0,
        kenoticActs: 0,
        lastViolation: null,
      };
    }
    const p = this._profiles.get(id);
    return {
      personId: p.personId,
      score: p.score,
      violations: p.violations,
      totalActs: p.totalActs,
      kenoticActs: p.kenoticActs,
      lastViolation: p.lastViolation,
    };
  }

  /**
   * Score кеносиса лица [0..1].
   */
  score(personId) {
    return this.profile(personId).score;
  }

  _updateProfile(personId, kenosis, score, violations) {
    const id = String(personId);
    if (!this._profiles.has(id)) {
      this._profiles.set(id, {
        personId: id,
        score: 1.0,
        violations: 0,
        totalActs: 0,
        kenoticActs: 0,
        lastViolation: null,
        history: [],
      });
    }
    const p = this._profiles.get(id);
    p.totalActs++;
    if (kenosis) {
      p.kenoticActs++;
    } else {
      p.violations++;
      p.lastViolation = violations[0]?.message ?? null;
    }
    // Скользящее среднее: 80% предыдущий score, 20% новый
    p.score = p.totalActs === 1
      ? score
      : p.score * 0.8 + score * 0.2;

    p.history.push({
      kenosis,
      score,
      violations: violations.map(v => v.type),
      timestamp: new Date().toISOString(),
    });
    if (p.history.length > 50) {
      p.history.splice(0, p.history.length - 50);
    }
  }

  /**
   * Все нарушения (для аналитики).
   */
  getViolations(personId) {
    if (!personId) return this._violations;
    const id = String(personId);
    return this._violations.filter(v => v.details?.giverId === id);
  }

  /**
   * Export for persistence.
   */
  export() {
    const profiles = {};
    for (const [id, p] of this._profiles) {
      profiles[id] = { ...p };
    }
    return {
      profiles,
      violations: this._violations.slice(-100),
    };
  }

  /**
   * Import from persistence.
   */
  import(data) {
    if (!data) return;
    if (data.profiles) {
      for (const [id, p] of Object.entries(data.profiles)) {
        this._profiles.set(id, {
          ...p,
          history: p.history || [],
        });
      }
    }
    if (data.violations) {
      this._violations = data.violations;
    }
  }
}
