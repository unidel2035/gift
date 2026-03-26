/**
 * @koinon/gift-protocol — Gift Protocol SDK v1.0
 *
 * Открытый стандарт для экономики дара и этики ИИ-агентов.
 * Православное основание: κένωσις, θέωσις, ἀνάμνησις.
 *
 * «Всё из Него, Им и к Нему» (Рим 11:36)
 *
 * Использование:
 *   import { GiftValidator, GiftClient, WEIGHT_BY_TYPE } from '@koinon/gift-protocol';
 *   import discordAdapter from '@koinon/gift-protocol/adapters/discord';
 *   import telegramAdapter from '@koinon/gift-protocol/adapters/telegram';
 *   import githubAdapter from '@koinon/gift-protocol/adapters/github';
 */

// ── Базовые веса по типу (богословская аксиома) ──────────────────────────────
// Время невозобновляемо → вес 10.  Деньги восполняемы → вес 3.
export const WEIGHT_BY_TYPE = Object.freeze({
  time:      10,
  presence:  8,
  knowledge: 6,
  grace:     6,
  code:      5,
  offering:  5,
  word:      4,
  question:  4,
  money:     3,
  data:      3,
  memory:    2,
});

const VALID_TYPES = new Set(Object.keys(WEIGHT_BY_TYPE));

// ── GiftValidator ─────────────────────────────────────────────────────────────

/**
 * GiftValidator — валидатор актов дара по Gift Protocol v1.
 *
 * Нет внешних зависимостей. Работает в Node.js ≥ 18, Deno, Bun, браузере.
 * Богословские аксиомы, закодированные в валидаторе:
 *   — Дар необратим (irreversible: true)
 *   — Время тяжелее денег (WEIGHT_BY_TYPE: time=10, money=3)
 *   — Без лица нет дара (from и to — обязательны)
 */
export class GiftValidator {
  /**
   * Валидировать и обогатить акт дара.
   *
   * @param {unknown} raw — входной объект (из HTTP body, бота, CI)
   * @returns {{ ok: true, act: GiftAct } | { ok: false, errors: string[] }}
   */
  static validate(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, errors: ['act must be a non-null object'] };
    }

    if (raw.schema !== 'gift/v1') {
      errors.push(`schema: must be "gift/v1", got "${raw.schema}"`);
    }

    if (!raw.from || typeof raw.from !== 'string' || raw.from.trim() === '') {
      errors.push('from: required non-empty string (personId of giver)');
    }
    if (!raw.to || typeof raw.to !== 'string' || raw.to.trim() === '') {
      errors.push('to: required non-empty string (personId of receiver)');
    }
    if (!raw.type || typeof raw.type !== 'string') {
      errors.push('type: required string');
    } else if (!VALID_TYPES.has(raw.type)) {
      errors.push(`type: unknown "${raw.type}". Valid: ${[...VALID_TYPES].join(', ')}`);
    }

    if (raw.weight !== undefined) {
      if (typeof raw.weight !== 'number' || isNaN(raw.weight) || raw.weight < 0.1 || raw.weight > 10) {
        errors.push('weight: must be a number between 0.1 and 10');
      }
    }

    if (raw.content !== undefined) {
      if (typeof raw.content !== 'string') {
        errors.push('content: must be a string');
      } else if (raw.content.length > 500) {
        errors.push('content: max 500 characters');
      }
    }

    // Богословская аксиома: дар необратим
    if (raw.irreversible !== undefined && raw.irreversible !== true) {
      errors.push('irreversible: must be true. The gift is irreversible — a theological axiom, not a flag.');
    }

    if (raw.proof !== undefined) {
      errors.push(...GiftValidator._validateProof(raw.proof));
    }

    if (raw.timestamp !== undefined) {
      const d = new Date(raw.timestamp);
      if (isNaN(d.getTime())) {
        errors.push('timestamp: must be ISO 8601 (e.g. "2026-03-27T12:00:00Z")');
      }
    }

    if (errors.length > 0) return { ok: false, errors };

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

  static _validateProof(proof) {
    const errors = [];
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
      errors.push('proof: must be a non-null object');
      return errors;
    }

    if ('commit' in proof || 'repo' in proof) {
      if (!proof.commit || typeof proof.commit !== 'string' || proof.commit.length < 7)
        errors.push('proof.commit: must be string >= 7 chars (git SHA)');
      if (!proof.repo || typeof proof.repo !== 'string' || !proof.repo.includes('/'))
        errors.push('proof.repo: must be "owner/repo"');
      return errors;
    }
    if ('tg_message_id' in proof || 'chat_id' in proof) {
      if (!Number.isInteger(proof.tg_message_id))
        errors.push('proof.tg_message_id: must be integer');
      if (!Number.isInteger(proof.chat_id))
        errors.push('proof.chat_id: must be integer');
      return errors;
    }
    if ('issue' in proof) {
      if (!Number.isInteger(proof.issue) || proof.issue < 1)
        errors.push('proof.issue: must be positive integer');
      if (!proof.repo || typeof proof.repo !== 'string' || !proof.repo.includes('/'))
        errors.push('proof.repo: must be "owner/repo"');
      return errors;
    }
    if ('seconds' in proof) {
      if (typeof proof.seconds !== 'number' || proof.seconds < 1)
        errors.push('proof.seconds: must be number >= 1');
      return errors;
    }

    errors.push('proof: must contain one of: { commit+repo }, { tg_message_id+chat_id }, { issue+repo }, { seconds }');
    return errors;
  }
}

// ── GiftClient ────────────────────────────────────────────────────────────────

/**
 * GiftClient — HTTP-клиент для отправки актов дара в Κοινόν.
 *
 * @example
 *   const client = new GiftClient('http://my-koinon.org:8086');
 *   const result = await client.give({
 *     schema: 'gift/v1',
 *     from: '_claude',
 *     to: 'Дионисий',
 *     type: 'code',
 *     content: 'implemented gift protocol SDK'
 *   });
 */
export class GiftClient {
  /**
   * @param {string} baseUrl — URL сервера Κοινόν (без trailing slash)
   * @param {object} [options]
   * @param {number} [options.timeout=10000] — таймаут запроса (мс)
   */
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = options.timeout ?? 10_000;
  }

  /**
   * give(raw) — валидировать и отправить акт дара.
   *
   * @param {object} raw — сырой акт дара
   * @returns {Promise<{ ok: true, act: object, response: object } | { ok: false, errors: string[] }>}
   */
  async give(raw) {
    const result = GiftValidator.validate(raw);
    if (!result.ok) return result;

    try {
      const response = await this._post('/gift', result.act);
      return { ok: true, act: result.act, response };
    } catch (err) {
      return { ok: false, errors: [`Network error: ${err.message}`] };
    }
  }

  /**
   * summary() — получить сводку матрицы W.
   */
  async summary() {
    return this._get('/summary');
  }

  /**
   * tape(limit?) — получить ленту последних актов.
   */
  async tape(limit = 20) {
    return this._get(`/tape?limit=${limit}`);
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

// ── Утилиты ───────────────────────────────────────────────────────────────────

/**
 * createAct(from, to, type, content?, proof?) — собрать сырой акт.
 *
 * @param {string} from — personId дарителя
 * @param {string} to   — personId получателя
 * @param {string} type — тип дара (time | code | word | ...)
 * @param {string} [content] — описание дара
 * @param {object} [proof]   — доказательство (commit, telegram, issue, time)
 * @returns {object} сырой акт для GiftValidator.validate()
 */
export function createAct(from, to, type, content, proof) {
  return {
    schema: 'gift/v1',
    from,
    to,
    type,
    ...(content ? { content } : {}),
    irreversible: true,
    ...(proof ? { proof } : {}),
  };
}

/**
 * schema — JSON Schema для GiftAct (gift/v1).
 * Используется для валидации в сторонних системах.
 */
export const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'gift/v1',
  title: 'GiftAct',
  description: 'Gift Protocol v1 — open standard act of giving.',
  type: 'object',
  required: ['schema', 'from', 'to', 'type'],
  additionalProperties: false,
  properties: {
    schema:       { type: 'string', const: 'gift/v1' },
    from:         { type: 'string', minLength: 1 },
    to:           { type: 'string', minLength: 1 },
    type:         { type: 'string', enum: [...VALID_TYPES] },
    weight:       { type: 'number', minimum: 0.1, maximum: 10 },
    content:      { type: 'string', maxLength: 500 },
    irreversible: { type: 'boolean', const: true },
    timestamp:    { type: 'string', format: 'date-time' },
    proof:        { type: 'object' },
  },
};

// ── KoinonFederation ──────────────────────────────────────────────────────────

/**
 * KoinonFederation — утилиты протокола соборности между Κοινόν-узлами.
 *
 * Соборность: единство не в единоначалии, а в общности даров.
 * Несколько узлов (приходы, НКО, open-source проекты) обмениваются
 * дарами через границы своих общин.
 *
 * Формат межобщинного адреса: "koinon-id/person-id"
 *   "koinon-dion/_claude"   — _claude в общине 'koinon-dion'
 *   "Дионисий"              — локальный (без "/" = эта община)
 *
 * Пасхальная синхронизация: в день Православной Пасхи
 * межобщинные нити умножаются на paschaMultiplier (default: 7).
 *
 * Источник: Дионисий Ареопагит, О церковной иерархии —
 *   «Иерархия есть священный чин, знание и деятельность,
 *    по возможности уподобляющиеся Богоначалию»
 */
export class KoinonFederation {
  /**
   * parseAddr(addr) — разобрать межобщинный адрес.
   *
   * @param {string} addr — напр. "koinon-a/_claude" или "_claude"
   * @returns {{ koinon: string|null, person: string }}
   *
   * @example
   *   KoinonFederation.parseAddr('koinon-a/_claude')
   *   // → { koinon: 'koinon-a', person: '_claude' }
   *   KoinonFederation.parseAddr('Дионисий')
   *   // → { koinon: null, person: 'Дионисий' }
   */
  static parseAddr(addr) {
    if (!addr) return { koinon: null, person: null };
    const slash = addr.indexOf('/');
    if (slash < 0) return { koinon: null, person: addr };
    return { koinon: addr.slice(0, slash), person: addr.slice(slash + 1) };
  }

  /**
   * federatedId(koinonId, personId) — собрать межобщинный адрес.
   *
   * @param {string} koinonId — id общины ('koinon-a')
   * @param {string} personId — локальный personId ('_claude')
   * @returns {string} 'koinon-a/_claude'
   */
  static federatedId(koinonId, personId) {
    return `${koinonId}/${personId}`;
  }

  /**
   * paschaDate(year) — вычислить дату Православной Пасхи (Григорианский календарь).
   *
   * Алгоритм: Юлианская Пасха по методу Гаусса + 13 дней разницы юл./грег.
   *
   * @param {number} year — год (напр. 2027)
   * @returns {Date}
   *
   * @example
   *   KoinonFederation.paschaDate(2027)
   *   // → Date: 2 May 2027 (Gregorian)
   */
  static paschaDate(year) {
    const a = year % 4;
    const b = year % 7;
    const c = year % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31); // 3=март, 4=апрель
    const day   = ((d + e + 114) % 31) + 1;

    // Julian → Gregorian: +13 дней (XXI век)
    const julian = new Date(year, month - 1, day);
    julian.setDate(julian.getDate() + 13);
    return julian;
  }

  /**
   * isPascha(date?) — является ли дата Православной Пасхой.
   *
   * @param {Date} [date] — дата для проверки (default: сегодня)
   * @returns {boolean}
   */
  static isPascha(date = new Date()) {
    const pascha = KoinonFederation.paschaDate(date.getFullYear());
    return date.getMonth() === pascha.getMonth() &&
           date.getDate()  === pascha.getDate();
  }
}

// Default export: convenience object
export default { GiftValidator, GiftClient, KoinonFederation, createAct, WEIGHT_BY_TYPE, schema };
