/**
 * Person Registry — Axiom A1: Лицо несводимо
 *
 * Лицо — не роль, не актор, не user ID.
 * Лицо — тот, кто способен дарить.
 *
 * Онтологический порядок (ontologicalOrder):
 *   'source'  — Πηγή, Источник бытия. Не тварное лицо.
 *              Бог не нуждается в мире, но свободно дарит бытие.
 *   'person'  — тварное лицо, получившее бытие как дар.
 *              Способно дарить, потому что получило дар быть.
 *
 * «Всё из Него, Им и к Нему» (Рим 11:36)
 *
 * Storage: Integram (таблица "ЛичностиДара") + in-memory cache (Map).
 * Pattern: cache-aside — init() загружает всё из Integram, мутации пишут в оба слоя.
 */

import { IntegramClient, REQUISITE_TYPES } from '../integram/integram-client.js';
import logger from '../../utils/logger.js';

const TABLE_NAME = 'ЛичностиДара';
const INTEGRAM_SERVER = process.env.INTEGRAM_SERVER || 'https://ai2o.ru';
const INTEGRAM_DB     = process.env.INTEGRAM_DB     || 'my';
const INTEGRAM_LOGIN  = process.env.INTEGRAM_LOGIN  || 'd';
const INTEGRAM_PASS   = process.env.INTEGRAM_PASS   || 'd';

export class PersonRegistry {
  constructor() {
    this._persons = new Map();   // id → person (cache)
    this._nextId = 1;

    // Integram state
    this.client = new IntegramClient(INTEGRAM_SERVER, INTEGRAM_DB);
    this._typeId = null;         // ID таблицы "ЛичностиДара" в Integram
    this._reqs = {};             // { name, calling, description, registeredAt } → requisiteId
    this._ready = false;         // true after successful init()
  }

  // ─────────────────────────────────────────────
  // ИНИЦИАЛИЗАЦИЯ — идемпотентно создаём таблицу, загружаем кэш
  // ─────────────────────────────────────────────

  async init() {
    try {
      await this.client.authenticate(INTEGRAM_LOGIN, INTEGRAM_PASS);

      // Проверяем — таблица уже есть?
      const existing = await this._findExistingTable();
      if (existing) {
        this._typeId = existing.id;
        this._reqs = existing.reqs;
      } else {
        // Создаём таблицу с колонками
        const result = await this.client.createTableWithColumns(TABLE_NAME, [
          { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'Имя' },
          { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'Призвание' },
          { requisiteTypeId: REQUISITE_TYPES.LONG,  alias: 'Описание' },
          { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'ДатаРег' },
        ]);

        this._typeId = result.typeId;
        for (const col of result.columns) {
          const key = this._aliasToKey(col.alias);
          if (key) this._reqs[key] = col.id;
        }
        logger.info(`[PersonRegistry] Created table "${TABLE_NAME}" id=${this._typeId}`);
      }

      // Загружаем все записи из Integram в кэш
      await this._loadFromIntegram();
      this._ready = true;
      logger.info(`[PersonRegistry] Ready: ${this._persons.size} persons cached from Integram`);
    } catch (e) {
      logger.warn(`[PersonRegistry] Init failed (offline?): ${e.message} — working in memory-only mode`);
      // Работаем без Integram — чисто в памяти (backward compatible)
      this._ready = false;
    }
  }

  _aliasToKey(alias) {
    const map = {
      'Имя':       'name',
      'Призвание': 'calling',
      'Описание':  'description',
      'ДатаРег':   'registeredAt',
    };
    return map[alias] || null;
  }

  async _findExistingTable() {
    try {
      const dict = await this.client.getDictionary();
      for (const [id, name] of Object.entries(dict)) {
        if (name === TABLE_NAME) {
          const struct = await this.client.getTableStructure(Number(id));
          const reqs = {};
          for (const col of (struct.columns || [])) {
            const key = this._aliasToKey(col.alias);
            if (key) reqs[key] = col.id;
          }
          logger.info(`[PersonRegistry] Found existing table id=${id}`);
          return { id: Number(id), reqs };
        }
      }
    } catch { /* table not found */ }
    return null;
  }

  async _loadFromIntegram() {
    if (!this._typeId) return;
    try {
      const result = await this.client.getAllObjects(this._typeId, { pageSize: 200, maxPages: 5 });
      const objects = result?.object || (Array.isArray(result) ? result : []);
      const reqs = result?.reqs || {};

      for (const obj of objects) {
        const person = {
          id: String(obj.id),
          name:         this._getReq(obj, reqs, 'name') || obj.val || obj.text || '',
          calling:      this._getReq(obj, reqs, 'calling') || null,
          description:  this._getReq(obj, reqs, 'description') || null,
          registeredAt: this._getReq(obj, reqs, 'registeredAt') || null,
          giftsGiven: 0,
          giftsReceived: 0,
          giftsDeclined: 0,
          _integramId: obj.id,   // keep Integram object ID for updates
        };
        this._persons.set(person.id, person);
        // Track max ID for new registrations
        const numId = Number(obj.id);
        if (numId >= this._nextId) this._nextId = numId + 1;
      }
    } catch (e) {
      logger.warn(`[PersonRegistry] Failed to load from Integram: ${e.message}`);
    }
  }

  _getReq(obj, reqs, key) {
    const reqId = this._reqs[key];
    if (!reqId) return null;
    return obj[`t${reqId}`] || obj.requisites?.[reqId] || null;
  }

  // ─────────────────────────────────────────────
  // PUBLIC API — backward compatible
  // ─────────────────────────────────────────────

  /**
   * Register a person. A person has a name and a calling (telos).
   * Properties are minimal — a person is known by their gifts, not attributes.
   */
  /**
   * Register the Source — Πηγή. Called once in bootstrap.
   * registerSource/registerDivinePerson/getSource/isSource УДАЛЕНЫ.
   *
   * Паламитский рефакторинг: Бог непостижим по сущности.
   * Он действует через энергии (DivineEnergy.js).
   * PersonRegistry хранит только тварные лица.
   *
   * «Энергии неотделимы от сущности, но и несводимы к ней» (Палама)
   */

  register(name, { calling, description, ontologicalOrder } = {}) {
    // Person might already exist
    const existing = this.findByName(name);
    if (existing) return existing;

    const person = {
      id: String(this._nextId++),
      name,
      calling: calling || null,
      description: description || null,
      ontologicalOrder: ontologicalOrder || 'person',
      registeredAt: new Date().toISOString(),
      giftsGiven: 0,
      giftsReceived: 0,
      giftsDeclined: 0,
    };

    this._persons.set(person.id, person);

    // Persist to Integram (async, non-blocking)
    this._writeToIntegram(person).catch(e => {
      logger.warn(`[PersonRegistry] Failed to persist "${name}" to Integram: ${e.message}`);
    });

    return person;
  }

  resolve(nameOrId) {
    if (!nameOrId) return null;
    const id = String(nameOrId);
    // Try by ID
    if (this._persons.has(id)) return this._persons.get(id);
    // Try by name
    return this.findByName(nameOrId);
  }

  findByName(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    for (const p of this._persons.values()) {
      if (p.name && p.name.toLowerCase() === lower) return p;
    }
    return null;
  }

  get(id) {
    return this._persons.get(String(id));
  }

  all() {
    return [...this._persons.values()];
  }

  count() {
    return this._persons.size;
  }

  /**
   * Update gift counters for a person.
   */
  recordGift(personId, role) {
    const person = this._persons.get(String(personId));
    if (!person) return;
    if (role === 'giver') person.giftsGiven++;
    if (role === 'receiver') person.giftsReceived++;
    if (role === 'declined') person.giftsDeclined++;
  }

  // ─────────────────────────────────────────────
  // INTEGRAM PERSISTENCE
  // ─────────────────────────────────────────────

  async _writeToIntegram(person) {
    if (!this._ready || !this._typeId) return;

    const requisites = {};
    if (this._reqs.name        && person.name)         requisites[this._reqs.name]         = person.name;
    if (this._reqs.calling     && person.calling)       requisites[this._reqs.calling]      = person.calling;
    if (this._reqs.description && person.description)   requisites[this._reqs.description]  = person.description;
    if (this._reqs.registeredAt && person.registeredAt) requisites[this._reqs.registeredAt] = person.registeredAt;

    try {
      const result = await this.client.createObject(this._typeId, person.name, { requisites });
      // Store Integram object ID for future reference
      const integramId = result?.obj || result?.id;
      if (integramId) person._integramId = integramId;
    } catch (e) {
      logger.warn(`[PersonRegistry] Integram write failed for "${person.name}": ${e.message}`);
    }
  }

  /**
   * Apply compiled .gift spec to a person (behaviorPolicy, kenosis, telos).
   * Called after GiftCompiler.compile() to connect spec → runtime.
   */
  applyCompiledSpec(name, compiledSpec) {
    let person = this.findByName(name);
    if (!person) {
      person = this.register(name, {
        calling: compiledSpec.telos,
        description: compiledSpec.description,
      });
    }
    // Store compiled policy on person object
    person.behaviorPolicy  = compiledSpec.behaviorPolicy || null;
    person._compiledTelos  = compiledSpec.telos || person.calling;
    person._compiledAt     = compiledSpec.compiledAt || new Date().toISOString();
    return person;
  }

  /**
   * checkKenosis(name, act) — проверить акт на соответствие kenosis-политике лица.
   * @param {string} name — имя лица
   * @param {{ telos?: string, surplusRetained?: boolean }} act
   * @returns {{ allowed: boolean, violation: null | { type: string } }}
   */
  checkKenosis(name, act = {}) {
    const person = this.findByName(name);
    const policy = person?.behaviorPolicy;
    if (!policy?.kenosis?.enforced) return { allowed: true, violation: null };

    if (act.surplusRetained === true && policy.kenosis.holdsNothing) {
      return { allowed: false, violation: { type: 'surplus_retained' } };
    }
    if (act.telos && act.telos !== 'give' && policy.telos === 'θέωσις_of_recipient') {
      return { allowed: false, violation: { type: 'telos_inverted' } };
    }
    return { allowed: true, violation: null };
  }

  /**
   * Stats for diagnostics.
   */
  async stats() {
    return {
      ready: this._ready,
      server: INTEGRAM_SERVER,
      table: TABLE_NAME,
      typeId: this._typeId,
      cachedPersons: this._persons.size,
    };
  }
}

// Singleton factory
let _instance = null;
export function getPersonRegistry() {
  if (!_instance) _instance = new PersonRegistry();
  return _instance;
}
