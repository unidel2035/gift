/**
 * OikosRegistry — Реестр домохозяйств
 *
 * День 5 Шестоднева хозяйства: Живые души.
 * Ойкосы — живые единицы хозяйствования, не механизмы.
 *
 * Расширение PersonRegistry.
 * Лица объединяются в ойкосы (домохозяйства) — единицы хозяйствования.
 *
 * Ойконом (οἰκονόμος) — не owner, а верный управитель (Лк 12:42).
 * Его задача — чтобы вверенное текло, а не копилось.
 *
 * Ойкос:
 *   - получает от Источника (creatio continua)
 *   - дарит другим ойкосам
 *   - принимает дары
 *   - высказывает нужды
 *   - благодарит вверх (евхаристия)
 */

class OikosRegistry {
  constructor(context) {
    this._eventBus = context.eventBus;
    this._persons = context.persons;
    this._oikoi = new Map(); // id → oikos
    this._nextId = 1;
  }

  /**
   * Register a new oikos (household).
   *
   * @param {object} data
   * @param {string} data.name — household name
   * @param {string[]} data.members — personIds
   * @param {string} data.oikonomos — personId of steward
   * @param {object} data.logos — { physis, telos }
   * @returns {object}
   */
  register(data) {
    const id = String(this._nextId++);
    const oikos = {
      id,
      name: data.name,
      members: data.members || [],
      oikonomos: data.oikonomos || (data.members && data.members[0]) || null,
      logos: {
        physis: data.logos?.physis || '',
        telos: data.logos?.telos || '',
      },
      entrusted: [],        // What is entrusted (property as stewardship)
      needsExpressed: [],   // Expressed needs
      giftsOffered: [],     // What this house can give
      createdAt: new Date().toISOString(),
    };

    this._oikoi.set(id, oikos);

    if (this._eventBus) {
      this._eventBus.emit('oikonomia:oikos_registered', {
        _eventType: 'oikonomia:oikos_registered',
        _timestamp: oikos.createdAt,
        oikos: this._toPublic(oikos),
      });
    }

    return this._toPublic(oikos);
  }

  /**
   * Get oikos by id.
   */
  get(id) {
    const oikos = this._oikoi.get(String(id));
    return oikos ? this._toPublic(oikos) : null;
  }

  /**
   * Find oikos by member.
   */
  findByMember(personId) {
    for (const oikos of this._oikoi.values()) {
      if (oikos.members.includes(String(personId))) {
        return this._toPublic(oikos);
      }
    }
    return null;
  }

  /**
   * List all oikoi.
   */
  list() {
    return Array.from(this._oikoi.values()).map(o => this._toPublic(o));
  }

  /**
   * Add a member to oikos.
   */
  addMember(oikosId, personId) {
    const oikos = this._oikoi.get(String(oikosId));
    if (!oikos) return { error: 'Ойкос не найден' };
    if (!oikos.members.includes(String(personId))) {
      oikos.members.push(String(personId));
    }
    return this._toPublic(oikos);
  }

  /**
   * Express a need from this oikos.
   *
   * Нужда — не зло, не недостаток. Нужда — открытость для дара.
   * Кто не нуждается — не может принять.
   *
   * @param {string} oikosId
   * @param {object} need — { content, logos, urgent, forWhom }
   */
  expressNeed(oikosId, need) {
    const oikos = this._oikoi.get(String(oikosId));
    if (!oikos) return { error: 'Ойкос не найден' };

    const expressed = {
      id: `need-${oikos.needsExpressed.length + 1}`,
      content: need.content,
      logos: need.logos || '',
      urgent: need.urgent || false,
      forWhom: need.forWhom || null,
      expressedAt: new Date().toISOString(),
      fulfilledAt: null,
      fulfilledBy: null,
    };

    oikos.needsExpressed.push(expressed);

    if (this._eventBus) {
      this._eventBus.emit('oikonomia:need_expressed', {
        _eventType: 'oikonomia:need_expressed',
        _timestamp: expressed.expressedAt,
        oikosId: oikos.id,
        oikosName: oikos.name,
        need: expressed,
      });
    }

    return expressed;
  }

  /**
   * Get unmet needs across all oikoi.
   */
  unmetNeeds() {
    const needs = [];
    for (const oikos of this._oikoi.values()) {
      for (const need of oikos.needsExpressed) {
        if (!need.fulfilledAt) {
          needs.push({
            ...need,
            oikosId: oikos.id,
            oikosName: oikos.name,
          });
        }
      }
    }
    return needs;
  }

  /**
   * Fulfill a need.
   */
  fulfillNeed(oikosId, needId, fulfilledBy) {
    const oikos = this._oikoi.get(String(oikosId));
    if (!oikos) return { error: 'Ойкос не найден' };
    const need = oikos.needsExpressed.find(n => n.id === needId);
    if (!need) return { error: 'Нужда не найдена' };
    need.fulfilledAt = new Date().toISOString();
    need.fulfilledBy = fulfilledBy;
    return need;
  }

  /**
   * Entrust something to an oikos.
   * Собственность — не владение, а ответственное попечение.
   */
  entrust(oikosId, item) {
    const oikos = this._oikoi.get(String(oikosId));
    if (!oikos) return { error: 'Ойкос не найден' };

    const entrusted = {
      id: `ent-${oikos.entrusted.length + 1}`,
      content: item.content,
      logos: item.logos || '',
      entrustedAt: new Date().toISOString(),
    };
    oikos.entrusted.push(entrusted);
    return entrusted;
  }

  /**
   * Declare what this oikos can offer.
   */
  declareGift(oikosId, gift) {
    const oikos = this._oikoi.get(String(oikosId));
    if (!oikos) return { error: 'Ойкос не найден' };

    const declared = {
      id: `gift-${oikos.giftsOffered.length + 1}`,
      content: gift.content,
      logos: gift.logos || '',
      declaredAt: new Date().toISOString(),
    };
    oikos.giftsOffered.push(declared);
    return declared;
  }

  _toPublic(oikos) {
    return { ...oikos };
  }

  toJSON() {
    const oikoi = [];
    for (const o of this._oikoi.values()) oikoi.push(o);
    return { oikoi, nextId: this._nextId };
  }

  fromJSON(data) {
    if (!data) return;
    this._oikoi.clear();
    for (const o of (data.oikoi || [])) {
      this._oikoi.set(o.id, o);
    }
    this._nextId = data.nextId || this._oikoi.size + 1;
  }
}

export { OikosRegistry };
export default OikosRegistry;
