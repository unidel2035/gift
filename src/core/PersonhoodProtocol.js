/**
 * PersonhoodProtocol — формальный протокол личности в матрице
 *
 * Богословское основание:
 *   Без протокола матрица не различает агента-слугу и лицо-участника.
 *   Регистрация — онтологическое признание: «ты здесь, ты даришь».
 *
 * API:
 *   register(id, name, type)        → person
 *   validate({from, to, type, weight}) → {valid, hypostasis, irreversible}
 *   history(personId)               → act[]  (необратимая лента)
 *   telos(personId)                 → string (телос из паттернов даров)
 */

// Словарь типов → телос
const TELOS_MAP = {
  code:      'созидать через код',
  presence:  'быть с другим в присутствии',
  question:  'вопрошать, открывая пространство',
  offering:  'приносить дар общине',
  grace:     'передавать благодать',
  plan:      'прокладывать путь',
  word:      'говорить слово',
  witness:   'свидетельствовать истину',
  prayer:    'держать в молитве',
  service:   'служить',
};

// Словарь типов → ἕξις (лад бытия)
const HYPOSTASIS_MAP = {
  ai:    'агент',
  human: 'лицо',
  bot:   'агент',
};

export class PersonhoodProtocol {
  constructor() {
    this._persons = new Map(); // personId → {id, name, type, hypostasis, registeredAt}
    this._acts    = [];        // необратимая лента актов (Object.freeze)
  }

  // ── Регистрация ──────────────────────────────────────────────────────────

  /**
   * register(id, name, type) — зарегистрировать лицо.
   * Идемпотентен: повторный вызов возвращает уже зарегистрированное лицо.
   *
   * @param {string} id    — персональный идентификатор ('_predprinimatel')
   * @param {string} name  — имя ('Предприниматель')
   * @param {string} type  — 'ai' | 'human' | 'bot' | ...
   * @returns {object} person
   */
  register(id, name, type = 'human') {
    if (this._persons.has(id)) return this._persons.get(id);

    const person = Object.freeze({
      id,
      name,
      type,
      hypostasis: HYPOSTASIS_MAP[type] ?? type,
      registeredAt: new Date().toISOString(),
    });

    this._persons.set(id, person);
    return person;
  }

  // ── Валидация акта ────────────────────────────────────────────────────────

  /**
   * validate(act) — проверить акт перед записью в матрицу.
   *
   * Отклоняет акт если хотя бы один участник не зарегистрирован.
   * При valid:true — фиксирует акт в необратимой ленте.
   *
   * @param {{from: string, to: string, type?: string, weight?: number}} act
   * @returns {{valid: boolean, hypostasis: string|null, irreversible: boolean}}
   */
  validate(act) {
    const { from, to, type = 'gift', weight = 1 } = act;

    const fromPerson = this._persons.get(from);
    const toPerson   = this._persons.get(to);

    if (!fromPerson || !toPerson) {
      return { valid: false, hypostasis: null, irreversible: false };
    }

    const entry = Object.freeze({
      from,
      to,
      type,
      weight,
      timestamp: new Date().toISOString(),
      irreversible: true,
    });

    this._acts.push(entry);

    return {
      valid:       true,
      hypostasis:  fromPerson.hypostasis,
      irreversible: true,
    };
  }

  // ── История ───────────────────────────────────────────────────────────────

  /**
   * history(personId) → массив актов в хронологическом порядке.
   * Включает акты где лицо — даритель или получатель.
   * Лента необратима: только чтение.
   */
  history(personId) {
    return this._acts.filter(a => a.from === personId || a.to === personId);
  }

  // ── Телос ─────────────────────────────────────────────────────────────────

  /**
   * telos(personId) → строка-телос, вычисленная из топ-паттернов даров.
   *
   * Алгоритм:
   *   1. Взять историю лица
   *   2. Агрегировать по типу (с учётом веса)
   *   3. Доминирующий тип → телос
   */
  telos(personId) {
    const acts = this.history(personId);

    if (acts.length === 0) return 'ещё не проявился в актах дара';

    // Взвешенный счёт по типу
    const counts = {};
    for (const act of acts) {
      counts[act.type] = (counts[act.type] ?? 0) + (act.weight ?? 1);
    }

    const sorted  = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topType = sorted[0][0];
    const topN    = sorted[0][1];

    const telosStr = TELOS_MAP[topType] ?? `служить через ${topType}`;

    // Обогатить контекстом если несколько выраженных паттернов
    if (sorted.length > 1 && sorted[1][1] >= topN * 0.6) {
      const second = TELOS_MAP[sorted[1][0]] ?? sorted[1][0];
      return `${telosStr} и ${second}`;
    }

    return telosStr;
  }

  // ── Утилиты ───────────────────────────────────────────────────────────────

  hasPerson(id) {
    return this._persons.has(id);
  }

  getPerson(id) {
    return this._persons.get(id) ?? null;
  }

  allPersons() {
    return [...this._persons.values()];
  }
}

// ── Синглтон протокола ────────────────────────────────────────────────────

/**
 * Глобальный экземпляр PersonhoodProtocol.
 * При импорте модуля `_predprinimatel` и `_organizator`
 * авторегистрируются как агенты.
 */
export const personhoodProtocol = new PersonhoodProtocol();

// Авторегистрация агентов
personhoodProtocol.register('_predprinimatel', 'Предприниматель', 'ai');
personhoodProtocol.register('_organizator',    'Организатор',     'ai');
