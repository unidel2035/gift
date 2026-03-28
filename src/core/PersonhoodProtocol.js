/**
 * PersonhoodProtocol — лицо в матрице как спецификация
 *
 * Лицо — не учётная запись. Лицо — это нить в сети даров.
 * Персональность = отношение (Зизиулас: «быть — это быть в общении»).
 *
 * PersonhoodProtocol:
 *   1. Регистрирует лиц (id, имя, тип: human / agent / collective / divine)
 *   2. Валидирует акты — даритель и получатель должны быть лицами
 *   3. Читает историю лица из матрицы (нити, где оно участвует)
 *   4. Определяет телос — доминирующий паттерн лица в сети
 *
 * Иоанн 15:16: «Не вы меня избрали, а Я вас избрал»
 * Регистрация — не самопровозглашение, а признание уже данного.
 */

export const PERSON_TYPES = {
  human:      'human',      // живой человек
  agent:      'agent',      // ИИ-агент
  collective: 'collective', // _koinon, _traditio
  divine:     'divine',     // Отец, Христос, Дух
};

export class PersonhoodProtocol {
  /**
   * @param {import('./GiftMemory.js').GiftMemory} mem
   */
  constructor(mem) {
    this._mem = mem;
    /** @type {Map<string, {id:string, name:string, type:string, registeredAt:string}>} */
    this._persons = new Map();
  }

  /**
   * Зарегистрировать лицо.
   * Идемпотентно: повторный вызов с тем же id — без ошибки.
   *
   * @param {string} id
   * @param {string} name
   * @param {string} type  — из PERSON_TYPES
   * @returns {this}
   */
  register(id, name, type = PERSON_TYPES.human) {
    if (this._persons.has(id)) return this;
    this._persons.set(id, {
      id,
      name,
      type,
      registeredAt: new Date().toISOString(),
    });
    // Убедиться что лицо есть в матрице
    this._mem._idx(id);
    return this;
  }

  /**
   * Проверить акт дара.
   *
   * Возвращает {valid, hypostasis, irreversible, reason?}
   * valid = true если оба участника зарегистрированы.
   *
   * hypostasis: 'relational' — реальность лица только в отношении.
   * irreversible: true — дар необратим по определению.
   *
   * @param {{giverId:string, receiverId:string}} act
   * @returns {{valid:boolean, hypostasis:string, irreversible:boolean, reason?:string}}
   */
  validate(act) {
    const base = { hypostasis: 'relational', irreversible: true };

    if (!act?.giverId || !act?.receiverId) {
      return { ...base, valid: false, reason: 'act must have giverId and receiverId' };
    }

    if (!this._persons.has(act.giverId)) {
      return { ...base, valid: false, reason: `giverId "${act.giverId}" not registered` };
    }

    if (!this._persons.has(act.receiverId)) {
      return { ...base, valid: false, reason: `receiverId "${act.receiverId}" not registered` };
    }

    return { ...base, valid: true };
  }

  /**
   * История лица в матрице — все нити где лицо участвует как даритель или получатель.
   * Возвращает замороженный массив.
   *
   * @param {string} id
   * @returns {ReadonlyArray<{from:string, to:string, weight:number, role:'giver'|'receiver'}>}
   */
  history(id) {
    const threads = this._mem.heaviest(200)
      .filter(e => e.from === id || e.to === id)
      .map(e => Object.freeze({
        from:   e.from,
        to:     e.to,
        weight: e.weight,
        role:   e.from === id ? 'giver' : 'receiver',
      }));
    return Object.freeze(threads);
  }

  /**
   * Телос лица — доминирующий паттерн его участия в сети даров.
   *
   * Аггрегирует нити:
   *   - если преимущественно даёт → 'giver'
   *   - если преимущественно принимает → 'receiver'
   *   - если примерно равно (±20%) → 'mediator'
   *   - если нет нитей → 'silent'
   *
   * @param {string} id
   * @returns {string}
   */
  telos(id) {
    const given    = this._mem.totalGiven(id);
    const received = this._mem.totalReceived(id);

    if (given === 0 && received === 0) return 'silent';

    const total = given + received;
    const ratio = given / total; // 0 = чистый получатель, 1 = чистый даритель

    if (ratio > 0.6)  return 'giver';
    if (ratio < 0.4)  return 'receiver';
    return 'mediator';
  }

  /**
   * Список зарегистрированных лиц.
   * @returns {Array<{id:string, name:string, type:string}>}
   */
  list() {
    return [...this._persons.values()];
  }

  /**
   * Получить лицо по id.
   * @param {string} id
   * @returns {{id:string, name:string, type:string} | undefined}
   */
  get(id) {
    return this._persons.get(id);
  }
}
