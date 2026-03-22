/**
 * GiftChronicle — доменный слой Онтологии Дара поверх Integram
 *
 * Интеграм — дар разработчика. Мы используем его как пространство
 * общей памяти общины: акты видны в UI, версионируются, доступны всем сессиям.
 *
 * Архитектура (write-behind):
 *   WitnessJournal.record()
 *     ├── мгновенно → SQLite (AnamnesisMemory, локально)
 *     └── асинхронно → GiftChronicle.enqueue() → Integram (ui, шаринг)
 *
 * Уникальность Integram для этой задачи:
 *   1. Динамические типы: "Акт Дара" — полноценная таблица с реквизитами
 *   2. Ассоциативная модель: каждый акт — объект, связанный с лицами-объектами
 *   3. UI из коробки: хроника видна в /integram без дополнительного кода
 *   4. Поиск через getObjectList — встроенная фильтрация по реквизитам
 *   5. LinoFormat — вся хроника выгружается как читаемый граф
 */

import { IntegramClient, REQUISITE_TYPES } from '../integram/integram-client.js';
import logger from '../../utils/logger.js';

const CHRONICLE_TABLE_NAME = 'ХроникаДара';
const INTEGRAM_SERVER = process.env.INTEGRAM_SERVER || 'https://ai2o.ru';
const INTEGRAM_DB     = process.env.INTEGRAM_DB     || 'my';
const INTEGRAM_LOGIN  = process.env.INTEGRAM_LOGIN  || 'd';
const INTEGRAM_PASS   = process.env.INTEGRAM_PASS   || 'd';

export class GiftChronicle {
  constructor() {
    this.client = new IntegramClient(INTEGRAM_SERVER, INTEGRAM_DB);
    this._typeId = null;        // ID таблицы "ХроникаДара" в Integram
    this._reqs = {};            // { action, giver, receiver, giftId, layer } → requisiteId
    this._ready = false;
    this._queue = [];           // Очередь актов ожидающих записи
    this._flushing = false;
    this._v2 = null;            // Integram V2 client для links (устанавливается извне)
  }

  /** Установить V2 клиент для создания связей (doublets) */
  setV2Client(v2client) {
    this._v2 = v2client;
  }

  // ─────────────────────────────────────────────
  // ИНИЦИАЛИЗАЦИЯ — идемпотентно создаём таблицу
  // ─────────────────────────────────────────────

  async init() {
    try {
      await this.client.authenticate(INTEGRAM_LOGIN, INTEGRAM_PASS);

      // Проверяем — таблица уже есть?
      const existing = await this._findExistingTable();
      if (existing) {
        this._typeId = existing.id;
        this._reqs = existing.reqs;
        this._ready = true;
        logger.info(`[GiftChronicle] Found existing table id=${this._typeId}`);
        return;
      }

      // Создаём таблицу с колонками
      const result = await this.client.createTableWithColumns(CHRONICLE_TABLE_NAME, [
        { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'Действие' },       // action
        { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'Дающий' },         // giver_name
        { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'Принимающий' },    // receiver_name
        { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'IDДара' },         // gift_id
        { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'Слой' },           // layer (gratia/bonum/utilitas)
        { requisiteTypeId: REQUISITE_TYPES.LONG,  alias: 'Акт' },            // text prose
        { requisiteTypeId: REQUISITE_TYPES.SHORT, alias: 'ВремяАкта' },      // timestamp
      ]);

      this._typeId = result.typeId;
      // Map alias → requisiteId
      for (const col of result.columns) {
        const key = this._aliasToKey(col.alias);
        if (key) this._reqs[key] = col.id;
      }

      this._ready = true;
      logger.info(`[GiftChronicle] Created table "${CHRONICLE_TABLE_NAME}" id=${this._typeId}`);
    } catch (e) {
      logger.warn(`[GiftChronicle] Init failed (offline?): ${e.message}`);
      this._ready = false;
    }
  }

  _aliasToKey(alias) {
    const map = {
      'Действие':     'action',
      'Дающий':       'giverName',
      'Принимающий':  'receiverName',
      'IDДара':       'giftId',
      'Слой':         'layer',
      'Акт':          'text',
      'ВремяАкта':    'timestamp',
    };
    return map[alias] || null;
  }

  async _findExistingTable() {
    try {
      const dict = await this.client.getDictionary();
      // dict = { typeId: name, ... }
      for (const [id, name] of Object.entries(dict)) {
        if (name === CHRONICLE_TABLE_NAME) {
          const struct = await this.client.getTableStructure(Number(id));
          const reqs = {};
          for (const col of (struct.columns || [])) {
            const key = this._aliasToKey(col.alias);
            if (key) reqs[key] = col.id;
          }
          return { id: Number(id), reqs };
        }
      }
    } catch { /* table not found */ }
    return null;
  }

  // ─────────────────────────────────────────────
  // WRITE-BEHIND — мгновенно в очередь, async в Integram
  // ─────────────────────────────────────────────

  /**
   * Добавить акт в очередь записи (non-blocking).
   * Вызывается из WitnessJournal.record() — не блокирует.
   */
  enqueue(entry) {
    this._queue.push(entry);
    if (!this._flushing) this._flush();
  }

  async _flush() {
    if (this._flushing || this._queue.length === 0) return;
    if (!this._ready) {
      // Попробуем инициализироваться
      await this.init();
      if (!this._ready) return; // Integram недоступен — акты остаются в очереди
    }

    this._flushing = true;
    while (this._queue.length > 0) {
      const entry = this._queue.shift();
      try {
        await this._writeToIntegram(entry);
      } catch (e) {
        logger.warn(`[GiftChronicle] Write failed for entry ${entry.id}: ${e.message}`);
        // Вернуть в начало очереди для повтора
        this._queue.unshift(entry);
        break;
      }
    }
    this._flushing = false;
  }

  async _writeToIntegram(entry) {
    if (!this._typeId) return;
    const requisites = {};
    if (this._reqs.action     && entry.action)        requisites[this._reqs.action]       = entry.action;
    if (this._reqs.giverName  && entry.giverName)     requisites[this._reqs.giverName]    = entry.giverName;
    if (this._reqs.receiverName && entry.receiverName) requisites[this._reqs.receiverName] = entry.receiverName;
    if (this._reqs.giftId     && entry.giftId)        requisites[this._reqs.giftId]       = String(entry.giftId);
    if (this._reqs.layer      && entry.layer)         requisites[this._reqs.layer]        = entry.layer;
    if (this._reqs.text       && entry.text)          requisites[this._reqs.text]         = entry.text;
    if (this._reqs.timestamp  && entry.timestamp)     requisites[this._reqs.timestamp]    = entry.timestamp;

    await this.client.createObject(this._typeId, entry.text, { requisites });

    // V2 links: создать связь giver→receiver (doublet)
    if (this._v2 && entry.giverName && entry.receiverName && entry.receiverName !== '?') {
      try {
        const kind = this._actionToKind(entry.action);
        await this._v2.linkCreate({
          source: entry.giverName,
          target: entry.receiverName,
          linker: kind,
          metadata: { actId: entry.id, ts: entry.timestamp },
        });
      } catch (e) {
        logger.warn(`[GiftChronicle] V2 link failed: ${e.message}`);
      }
    }
  }

  _actionToKind(action) {
    const map = {
      offer:     'gave_to',
      accept:    'gave_to',
      decline:   'refused',
      gratitude: 'thanked',
      telos:     'telos_of',
      freedom:   'freedom_from',
      chat:      'spoke_with',
    };
    return map[action] || action;
  }

  // ─────────────────────────────────────────────
  // ЧТЕНИЕ — поиск и хроника из Integram
  // ─────────────────────────────────────────────

  /**
   * Поиск актов по тексту через Integram.
   */
  async search(query, limit = 30) {
    if (!this._ready) return [];
    try {
      const result = await this.client.getObjectList(this._typeId, {
        search: query,
        limit,
        F_U: 1,
        f_show_all: 1,
      });
      return this._normalizeObjects(result);
    } catch (e) {
      logger.warn(`[GiftChronicle] Search failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Все акты участника по имени.
   */
  async getForPerson(name, limit = 30) {
    if (!this._ready) return [];
    try {
      // Ищем в двух реквизитах: Дающий и Принимающий
      const [asGiver, asReceiver] = await Promise.all([
        this.client.getObjectList(this._typeId, {
          [`r${this._reqs.giverName}`]: name, limit,
        }).catch(() => []),
        this.client.getObjectList(this._typeId, {
          [`r${this._reqs.receiverName}`]: name, limit,
        }).catch(() => []),
      ]);
      const combined = [...(asGiver.object || []), ...(asReceiver.object || [])];
      // Дедуплицировать по id
      const seen = new Set();
      return combined.filter(o => seen.has(o.id) ? false : seen.add(o.id));
    } catch (e) {
      logger.warn(`[GiftChronicle] getForPerson failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Последние N актов (для нарратива).
   */
  async getRecent(limit = 50) {
    if (!this._ready) return [];
    try {
      const result = await this.client.getAllObjects(this._typeId, { pageSize: limit, maxPages: 1 });
      return this._normalizeObjects(result);
    } catch (e) {
      logger.warn(`[GiftChronicle] getRecent failed: ${e.message}`);
      return [];
    }
  }

  _normalizeObjects(result) {
    const objects = result?.object || (Array.isArray(result) ? result : []);
    const reqs = result?.reqs || {};
    return objects.map(obj => ({
      id:           obj.id,
      text:         obj.val || obj.text,
      action:       this._getReq(obj, reqs, 'action'),
      giverName:    this._getReq(obj, reqs, 'giverName'),
      receiverName: this._getReq(obj, reqs, 'receiverName'),
      giftId:       this._getReq(obj, reqs, 'giftId'),
      layer:        this._getReq(obj, reqs, 'layer'),
      timestamp:    this._getReq(obj, reqs, 'timestamp'),
    }));
  }

  _getReq(obj, reqs, key) {
    const reqId = this._reqs[key];
    if (!reqId) return null;
    return obj[`t${reqId}`] || obj.requisites?.[reqId] || null;
  }

  /**
   * Статистика хроники в Integram.
   */
  async stats() {
    if (!this._ready) return { ready: false, server: INTEGRAM_SERVER };
    try {
      const count = await this.client.getObjectCount(this._typeId);
      return {
        ready: true,
        server: INTEGRAM_SERVER,
        table: CHRONICLE_TABLE_NAME,
        typeId: this._typeId,
        acts: count,
        queuePending: this._queue.length,
      };
    } catch (e) {
      return { ready: false, error: e.message };
    }
  }

  /**
   * Выгрузить хронику в LinoFormat — человекочитаемый граф.
   * Совместимо с link-cli / Konard LinksPlatform.
   */
  async toLinoFormat(limit = 200) {
    const acts = await this.getRecent(limit);
    if (!acts.length) return '# Хроника пуста\n';

    const lines = ['# Хроника Дара — LinoFormat', `# ${new Date().toISOString()}`, ''];

    for (const act of acts) {
      const g = act.giverName || '?';
      const r = act.receiverName || '?';
      const ts = act.timestamp?.slice(0, 10) || '';
      // Entity-style: акт как связь даблет
      lines.push(`(${g}) --${act.action || 'gave'}--> (${r})  # ${ts}`);
      if (act.text) lines.push(`  «${act.text}»`);
    }

    return lines.join('\n');
  }
}

// Singleton
let _instance = null;
export function getGiftChronicle() {
  if (!_instance) _instance = new GiftChronicle();
  return _instance;
}
