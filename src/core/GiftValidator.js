/**
 * GiftValidator — валидатор актов дара по Gift Protocol v0.1
 *
 * Нет внешних зависимостей. Работает в любой среде: сервер, CI, бот, браузер.
 * Валидирует структуру, обогащает умолчаниями, конвертирует в legacy-формат ленты.
 *
 * Богословская аксиома, закодированная в валидаторе:
 *   — Дар необратим (irreversible: true — не опциональное поле)
 *   — Время тяжелее денег (WEIGHT_BY_TYPE: time=10, money=3)
 *   — Без лица нет дара (from и to — обязательны)
 */

// ── Базовые веса по типу ───────────────────────────────────────────────────────
// Аксиома: время невозобновляемо → вес 10.
// Деньги восполняемы → вес 3.
const WEIGHT_BY_TYPE = {
  time:      10,
  presence:  8,
  knowledge: 6,
  code:      5,
  offering:  5,
  word:      4,
  question:  4,
  grace:     6,
  money:     3,
  data:      3,
  memory:    2,
};

const VALID_TYPES = new Set(Object.keys(WEIGHT_BY_TYPE));

export class GiftValidator {
  /**
   * Валидировать и обогатить акт дара.
   *
   * @param {unknown} raw — входной объект (из HTTP body, бота, CI)
   * @returns {{ ok: true, act: object } | { ok: false, errors: string[] }}
   */
  static validate(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, errors: ['act must be a non-null object'] };
    }

    // ── schema version ─────────────────────────────────────────────────────────
    if (raw.schema !== 'gift/v1') {
      errors.push(`schema: must be "gift/v1", got "${raw.schema}"`);
    }

    // ── required fields ────────────────────────────────────────────────────────
    if (!raw.from || typeof raw.from !== 'string' || raw.from.trim() === '') {
      errors.push('from: required non-empty string (personId дарителя)');
    }
    if (!raw.to || typeof raw.to !== 'string' || raw.to.trim() === '') {
      errors.push('to: required non-empty string (personId получателя)');
    }
    if (!raw.type || typeof raw.type !== 'string') {
      errors.push('type: required string');
    } else if (!VALID_TYPES.has(raw.type)) {
      errors.push(`type: unknown "${raw.type}". Valid: ${[...VALID_TYPES].join(', ')}`);
    }

    // ── optional weight ────────────────────────────────────────────────────────
    if (raw.weight !== undefined) {
      if (typeof raw.weight !== 'number' || isNaN(raw.weight) || raw.weight < 0.1 || raw.weight > 10) {
        errors.push('weight: must be a number between 0.1 and 10');
      }
    }

    // ── content length ─────────────────────────────────────────────────────────
    if (raw.content !== undefined) {
      if (typeof raw.content !== 'string') {
        errors.push('content: must be a string');
      } else if (raw.content.length > 500) {
        errors.push('content: max 500 characters');
      }
    }

    // ── irreversible — богословская аксиома ────────────────────────────────────
    if (raw.irreversible !== undefined && raw.irreversible !== true) {
      errors.push('irreversible: must be true. Дар необратим — это богословская аксиома, не флаг.');
    }

    // ── proof ──────────────────────────────────────────────────────────────────
    if (raw.proof !== undefined) {
      errors.push(...GiftValidator._validateProof(raw.proof));
    }

    // ── timestamp ──────────────────────────────────────────────────────────────
    if (raw.timestamp !== undefined) {
      const d = new Date(raw.timestamp);
      if (isNaN(d.getTime())) {
        errors.push('timestamp: must be ISO 8601 date-time (e.g. "2026-03-27T12:00:00Z")');
      }
    }

    if (errors.length > 0) return { ok: false, errors };

    // ── Обогащение умолчаниями ─────────────────────────────────────────────────
    const act = Object.freeze({
      schema:       'gift/v1',
      from:         raw.from.trim(),
      to:           raw.to.trim(),
      type:         raw.type,
      weight:       raw.weight ?? WEIGHT_BY_TYPE[raw.type] ?? 1,
      content:      (raw.content ?? raw.type).trim().slice(0, 500),
      irreversible: true,
      timestamp:    raw.timestamp ?? new Date().toISOString(),
      ...(raw.proof ? { proof: raw.proof } : {}),
    });

    return { ok: true, act };
  }

  /**
   * Конвертировать валидированный акт в legacy-формат ленты анамнезиса.
   * Используется сервером для записи в gift-anamnesis.json.
   */
  static toLegacy(act) {
    return {
      type:         act.type,
      weight:       act.weight,
      from:         act.from,
      to:           act.to,
      content:      act.content,
      proof:        act.proof ?? null,
      sealedAt:     act.timestamp,
      irreversible: true,
      living:       true,
    };
  }

  /**
   * Конвертировать валидированный акт в формат для GiftMemory.receive().
   * Используется при обновлении W-матрицы.
   */
  static toMemoryAct(act) {
    return {
      giverId:    act.from,
      receiverId: act.to,
      type:       act.type,
      weight:     act.weight,
      content:    act.content,
      timestamp:  act.timestamp,
    };
  }

  // ── Приватные хелперы ─────────────────────────────────────────────────────────

  static _validateProof(proof) {
    const errors = [];

    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
      errors.push('proof: must be a non-null object');
      return errors;
    }

    const hasKeys = (...keys) => keys.every(k => k in proof);

    // ProofCommit: { commit, repo }
    if (hasKeys('commit') || hasKeys('repo')) {
      if (!proof.commit || typeof proof.commit !== 'string' || proof.commit.length < 7) {
        errors.push('proof.commit: must be string >= 7 chars (git SHA)');
      }
      if (!proof.repo || typeof proof.repo !== 'string' || !proof.repo.includes('/')) {
        errors.push('proof.repo: must be "owner/repo"');
      }
      return errors;
    }

    // ProofTelegram: { tg_message_id, chat_id }
    if (hasKeys('tg_message_id') || hasKeys('chat_id')) {
      if (!Number.isInteger(proof.tg_message_id)) {
        errors.push('proof.tg_message_id: must be integer');
      }
      if (!Number.isInteger(proof.chat_id)) {
        errors.push('proof.chat_id: must be integer');
      }
      return errors;
    }

    // ProofIssue: { issue, repo }
    if (hasKeys('issue')) {
      if (!Number.isInteger(proof.issue) || proof.issue < 1) {
        errors.push('proof.issue: must be positive integer');
      }
      if (!proof.repo || typeof proof.repo !== 'string' || !proof.repo.includes('/')) {
        errors.push('proof.repo: must be "owner/repo"');
      }
      return errors;
    }

    // ProofTime: { seconds }
    if (hasKeys('seconds')) {
      if (typeof proof.seconds !== 'number' || isNaN(proof.seconds) || proof.seconds < 1) {
        errors.push('proof.seconds: must be number >= 1');
      }
      return errors;
    }

    errors.push('proof: must contain one of: { commit+repo }, { tg_message_id+chat_id }, { issue+repo }, { seconds }');
    return errors;
  }
}
