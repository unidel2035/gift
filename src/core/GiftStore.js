/**
 * GiftStore — persistence layer for gifts via Integram
 *
 * Replaces JSON file persistence with Integram table "ДарыОнтологии".
 * Same IntegramClient pattern as GiftChronicle.
 *
 * Each gift is an Integram object with requisites for all gift fields.
 * The in-memory _gifts[] array in GiftEngine serves as a read cache;
 * GiftStore is the source of truth.
 */

import { IntegramClient, REQUISITE_TYPES } from '../integram/integram-client.js';
import logger from '../../utils/logger.js';

const TABLE_NAME = 'ДарыОнтологии';
const INTEGRAM_SERVER = process.env.INTEGRAM_SERVER || 'https://ai2o.ru';
const INTEGRAM_DB     = process.env.INTEGRAM_DB     || 'my';
const INTEGRAM_LOGIN  = process.env.INTEGRAM_LOGIN  || 'd';
const INTEGRAM_PASS   = process.env.INTEGRAM_PASS   || 'd';

// Column definitions: alias → { key (internal), type }
const COLUMNS = [
  { alias: 'Дающий',         key: 'giverName',   type: REQUISITE_TYPES.SHORT },
  { alias: 'Принимающий',    key: 'receiverName', type: REQUISITE_TYPES.SHORT },
  { alias: 'Содержание',     key: 'content',      type: REQUISITE_TYPES.LONG },
  { alias: 'Статус',         key: 'status',       type: REQUISITE_TYPES.SHORT },
  { alias: 'Телос',          key: 'telos',        type: REQUISITE_TYPES.SHORT },
  { alias: 'Слой',           key: 'layer',        type: REQUISITE_TYPES.SHORT },
  { alias: 'Цена',           key: 'cost',         type: REQUISITE_TYPES.SHORT },
  { alias: 'ВремяСоздания',  key: 'createdAt',    type: REQUISITE_TYPES.SHORT },
  { alias: 'ВремяПринятия',  key: 'acceptedAt',   type: REQUISITE_TYPES.SHORT },
];

export class GiftStore {
  constructor() {
    this.client = new IntegramClient(INTEGRAM_SERVER, INTEGRAM_DB);
    this._typeId = null;
    this._reqs = {};        // key → requisiteId
    this._ready = false;
    // Map: internal gift id → Integram object id (for updates)
    this._idMap = new Map();
  }

  // ─────────────────────────────────────────────
  // INIT — authenticate, find or create table
  // ─────────────────────────────────────────────

  async init() {
    try {
      await this.client.authenticate(INTEGRAM_LOGIN, INTEGRAM_PASS);

      const existing = await this._findExistingTable();
      if (existing) {
        this._typeId = existing.id;
        this._reqs = existing.reqs;
        this._ready = true;
        logger.info(`[GiftStore] Found existing table id=${this._typeId}`);
        return;
      }

      // Create table with all columns
      const colDefs = COLUMNS.map(c => ({
        requisiteTypeId: c.type,
        alias: c.alias,
      }));

      const result = await this.client.createTableWithColumns(TABLE_NAME, colDefs);
      this._typeId = result.typeId;

      for (const col of result.columns) {
        const colDef = COLUMNS.find(c => c.alias === col.alias);
        if (colDef) this._reqs[colDef.key] = col.id;
      }

      this._ready = true;
      logger.info(`[GiftStore] Created table "${TABLE_NAME}" id=${this._typeId}`);
    } catch (e) {
      logger.warn(`[GiftStore] Init failed (offline?): ${e.message}`);
      this._ready = false;
    }
  }

  async _findExistingTable() {
    try {
      const dict = await this.client.getDictionary();
      for (const [id, name] of Object.entries(dict)) {
        if (name === TABLE_NAME) {
          const struct = await this.client.getTableStructure(Number(id));
          const reqs = {};
          for (const col of (struct.columns || [])) {
            const colDef = COLUMNS.find(c => c.alias === col.alias);
            if (colDef) reqs[colDef.key] = col.id;
          }
          return { id: Number(id), reqs };
        }
      }
    } catch { /* table not found */ }
    return null;
  }

  // ─────────────────────────────────────────────
  // WRITE — save new gift / update existing
  // ─────────────────────────────────────────────

  /**
   * Save a new gift to Integram. Returns Integram object id.
   */
  async save(gift) {
    if (!this._ready) return null;
    try {
      const requisites = this._giftToRequisites(gift);
      const label = `${gift.giverName} → ${gift.receiverName}: ${(gift.content || '').slice(0, 60)}`;

      const result = await this.client.createObject(this._typeId, label, { requisites });
      const objectId = result?.id || result?.obj;

      if (objectId) {
        this._idMap.set(String(gift.id), Number(objectId));
        logger.info(`[GiftStore] Saved gift #${gift.id} → Integram obj=${objectId}`);
      }
      return objectId;
    } catch (e) {
      logger.warn(`[GiftStore] Save gift #${gift.id} failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Update an existing gift in Integram (status change, acceptedAt, etc.)
   */
  async update(gift) {
    if (!this._ready) return false;
    const objectId = this._idMap.get(String(gift.id));
    if (!objectId) {
      logger.warn(`[GiftStore] Update gift #${gift.id}: no Integram objectId mapped`);
      return false;
    }
    try {
      const requisites = this._giftToRequisites(gift);
      const label = `${gift.giverName} → ${gift.receiverName}: ${(gift.content || '').slice(0, 60)}`;

      await this.client.saveObject(objectId, this._typeId, label, requisites);
      logger.info(`[GiftStore] Updated gift #${gift.id} (obj=${objectId}) status=${gift.status}`);
      return true;
    } catch (e) {
      logger.warn(`[GiftStore] Update gift #${gift.id} failed: ${e.message}`);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // READ — load all gifts from Integram
  // ─────────────────────────────────────────────

  /**
   * Load all gifts from Integram, return as array of gift objects
   * compatible with GiftEngine._gifts format.
   */
  async loadAll() {
    if (!this._ready) return [];
    try {
      const result = await this.client.getAllObjects(this._typeId, {
        pageSize: 200,
        maxPages: 50,
      });

      const objects = result?.object || [];
      const gifts = [];

      for (const obj of objects) {
        const gift = this._objectToGift(obj);
        if (gift) {
          gifts.push(gift);
          // Track id mapping for future updates
          this._idMap.set(String(gift.id), Number(obj.id));
        }
      }

      logger.info(`[GiftStore] Loaded ${gifts.length} gifts from Integram`);
      return gifts;
    } catch (e) {
      logger.warn(`[GiftStore] loadAll failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Find gift by Integram object ID
   */
  async getById(objectId) {
    if (!this._ready) return null;
    try {
      const data = await this.client.getObjectEditData(Number(objectId));
      if (!data) return null;
      return this._objectToGift(data);
    } catch (e) {
      logger.warn(`[GiftStore] getById(${objectId}) failed: ${e.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // MAPPING — gift ↔ Integram requisites
  // ─────────────────────────────────────────────

  _giftToRequisites(gift) {
    const reqs = {};
    const map = {
      giverName:    gift.giverName || '',
      receiverName: gift.receiverName || '',
      content:      gift.content || '',
      status:       gift.status || 'offered',
      telos:        gift.telos || '',
      layer:        gift.layer || 'utilitas',
      cost:         gift.cost || '',
      createdAt:    gift.createdAt || '',
      acceptedAt:   gift.acceptedAt || '',
    };

    for (const [key, value] of Object.entries(map)) {
      const reqId = this._reqs[key];
      if (reqId && value) {
        reqs[reqId] = String(value);
      }
    }
    return reqs;
  }

  _objectToGift(obj) {
    if (!obj || !obj.id) return null;

    const get = (key) => {
      const reqId = this._reqs[key];
      if (!reqId) return null;
      // Integram stores requisite values in t{reqId} fields
      return obj[`t${reqId}`] || obj.requisites?.[reqId] || null;
    };

    // Use Integram object id as gift id (string)
    const gift = {
      id:            String(obj.id),
      giver:         get('giverName') || '',
      giverName:     get('giverName') || '',
      receiver:      get('receiverName') || '',
      receiverName:  get('receiverName') || '',
      content:       get('content') || obj.val || '',
      cost:          get('cost') || null,
      telos:         get('telos') || null,
      status:        get('status') || 'offered',
      freedom:       null,
      transforms:    { giver: null, receiver: null },
      anamnesisIds:  [],
      anonymous:     false,
      layer:         get('layer') || 'utilitas',
      createdAt:     get('createdAt') || null,
      acceptedAt:    get('acceptedAt') || null,
    };

    // Infer freedom from status
    if (gift.status === 'accepted') gift.freedom = true;
    if (gift.status === 'declined') gift.freedom = false;

    return gift;
  }
}

// Singleton
let _instance = null;
export function getGiftStore() {
  if (!_instance) _instance = new GiftStore();
  return _instance;
}
