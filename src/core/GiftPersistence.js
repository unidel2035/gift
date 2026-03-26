/**
 * GiftPersistence — сохранение состояния онтологии в Integram (nous)
 *
 * Проблема: 6 часов Домостроительства (92 дара, 7 агентов) потеряны
 * при перезапуске бэкенда, потому что состояние было только в RAM.
 *
 * Решение: Integram V2 Client (ai2o.ru/nous) — таблица «Память» (typeId 29495).
 * Состояние хранится как запись с val "[gift-state]", JSON в реквизите.
 * При старте — загрузка из Integram, автосохранение каждые 30 сек.
 *
 * Refactored: replaced raw HTTP/auth with IntegramV2Client for consistency.
 * File fallback (gift-state.json) preserved as backup.
 *
 * «Помни день субботний» — и состояние тоже помни.
 */

import { IntegramV2Client } from '../integram/integram-v2-client.js';
import logger from '../../utils/logger.js';

const NOUS_DB = 'nous';
const MEMORY_TYPE_ID = 29495;
const GIFT_STATE_PREFIX = '[gift-state]';

// ── GiftPersistence class ───────────────────────────────────────────────────

class GiftPersistence {
  constructor() {
    this._saveInterval = null;
    this._engine = null;
    this._lastSaveHash = '';
    this._recordId = null; // Integram object ID of [gift-state] record
    this._ready = false;
    this._client = null;   // IntegramV2Client instance
  }

  /**
   * Инициализация — создать V2 клиент, найти запись состояния
   */
  async init(engine) {
    this._engine = engine;

    try {
      this._client = new IntegramV2Client(NOUS_DB);
      // Проверить авторизацию через V1 (lazy, cached inside client)
      await this._client._ensureV1Auth();
      // Найти существующую запись [gift-state]
      this._recordId = await this._findStateRecord();
      this._ready = true;
      logger.info(`[GiftPersistence] Integram V2 Client (nous) инициализирован, record=${this._recordId || 'новый'}`);
    } catch (e) {
      logger.error(`[GiftPersistence] Ошибка инициализации Integram: ${e.message}`);
      this._ready = false;
    }

    return this;
  }

  /**
   * Найти запись [gift-state] в таблице Память (typeId 29495)
   */
  async _findStateRecord() {
    try {
      const objects = await this._client.getObjects(String(MEMORY_TYPE_ID), {
        limit: 50,
        withReqs: false,
      });
      for (const o of objects) {
        if (o.val && o.val.startsWith(GIFT_STATE_PREFIX)) {
          return o.id;
        }
      }
      return null;
    } catch (e) {
      logger.warn(`[GiftPersistence] Ошибка поиска записи: ${e.message}`);
      return null;
    }
  }

  /**
   * Загрузить состояние из Integram
   * Возвращает объект для importState() или null
   */
  /**
   * Миграция: giver:'0' → giver:null (Паламитский рефакторинг).
   * Бог не лицо в системе — дары от энергий имеют giver=null.
   */
  _migrateGifts(state) {
    if (!state?.gifts) return state;
    const DIVINE_IDS = new Set(['0', 'divine-Λόγος', 'divine-Πνεῦμα']);
    let migrated = 0;
    for (const gift of state.gifts) {
      if (DIVINE_IDS.has(gift.giver)) {
        gift.giver = null;
        gift.giverName = null;
        gift.ontologicalOrigin = gift.ontologicalOrigin || 'divine_energy';
        migrated++;
      }
      if (DIVINE_IDS.has(gift.receiver)) {
        gift.receiver = null;
        gift.receiverName = null;
      }
    }
    if (migrated > 0) logger.info(`[GiftPersistence] Миграция: ${migrated} даров → giver:null (Паламитский рефакторинг)`);
    return state;
  }

  async load() {
    // СНАЧАЛА файл — он надёжнее пока Integram нестабилен
    const fromFile = this._migrateGifts(await this._loadFromFile());
    if (fromFile && fromFile.gifts?.length > 10) {
      logger.info(`[GiftPersistence] Загружено из файла: ${fromFile.gifts.length} даров`);
      return fromFile;
    }

    // Потом Integram
    if (!this._ready || !this._client) return fromFile;

    try {
      if (!this._recordId) {
        this._recordId = await this._findStateRecord();
      }
      if (!this._recordId) {
        logger.info('[GiftPersistence] Нет в Integram — используем файл');
        return null;
      }

      // Читаем запись с реквизитами через V1 (V2 не возвращает reqs)
      const data = await this._client._v1Get(`object/${this._recordId}`);
      const obj = data.object?.[0] || data;
      const reqs = data.reqs?.[this._recordId] || {};

      // Ищем JSON в реквизитах (content) или в val после префикса
      let stateJson = null;

      // Попробуем реквизиты — ищем самый длинный (это наш JSON)
      for (const [reqId, reqVal] of Object.entries(reqs)) {
        if (typeof reqVal === 'string' && reqVal.startsWith('{')) {
          try {
            JSON.parse(reqVal);
            stateJson = reqVal;
            break;
          } catch (_) { /* не JSON */ }
        }
      }

      // Fallback: JSON может быть в val после префикса
      if (!stateJson) {
        const val = obj?.val || '';
        const afterPrefix = val.substring(GIFT_STATE_PREFIX.length).trim();
        if (afterPrefix.startsWith('{')) {
          stateJson = afterPrefix;
        }
      }

      if (!stateJson) {
        logger.warn('[GiftPersistence] Запись найдена, но JSON не найден');
        return null;
      }

      const state = this._migrateGifts(JSON.parse(stateJson));
      logger.info(`[GiftPersistence] Загружено из Integram: ${state.persons?.length || 0} лиц, ${state.gifts?.length || 0} даров`);
      return state;
    } catch (e) {
      logger.error(`[GiftPersistence] Ошибка загрузки: ${e.message}`);
      return null;
    }
  }

  /**
   * Сохранить текущее состояние в Integram
   */
  async save() {
    if (!this._ready || !this._engine || !this._client) return false;

    let state;
    try {
      state = this._engine.exportState();
      const json = JSON.stringify(state);

      // Не сохранять если ничего не изменилось
      const hash = simpleHash(json);
      if (hash === this._lastSaveHash) return false;

      const stateVal = `${GIFT_STATE_PREFIX} ${json}`;

      if (this._recordId) {
        // Обновить существующую запись через V2 client
        await this._client.updateObjectValue(String(this._recordId), stateVal);
      } else {
        // Создать новую запись через V2 client
        const result = await this._client.createObject(String(MEMORY_TYPE_ID), stateVal);
        this._recordId = result.id;
      }

      this._lastSaveHash = hash;
      logger.info(`[GiftPersistence] Сохранено в Integram: ${state.persons?.length || 0} лиц, ${state.gifts?.length || 0} даров`);
      return true;
    } catch (e) {
      logger.error(`[GiftPersistence] Ошибка сохранения в Integram: ${e.message}`);
      // Reset V1 auth so next attempt re-authenticates
      this._client._v1Token = null;
      // FALLBACK: сохранить на диск
      if (state) this._saveToFile(state);
      return false;
    }
  }

  /**
   * Fallback: загрузить с локального диска если Integram недоступен
   */
  async _loadFromFile() {
    try {
      const fs = await import('fs');
      const filePath = process.cwd() + '/data/gift-state.json';
      if (!fs.default.existsSync(filePath)) return null;
      const raw = fs.default.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      // gift-state.json может содержать {persons, gifts} или просто массив gifts
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.gifts?.length > 0) {
          return parsed;
        }
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        logger.info(`[GiftPersistence] Загружено из файла: ${parsed.length} даров`);
        return { gifts: parsed, persons: [] };
      }
      return null;
    } catch { return null; }
  }

  _saveToFile(state) {
    import('fs').then(fs => {
      const dir = process.cwd() + '/data';
      if (!fs.default.existsSync(dir)) fs.default.mkdirSync(dir, { recursive: true });
      fs.default.writeFileSync(dir + '/gift-state.json', JSON.stringify(state));
      logger.info(`[GiftPersistence] Сохранено на диск: ${state.gifts?.length || '?'} даров`);
    }).catch(() => {});
  }

  /**
   * Авто-бэкап на диск каждые N секунд (независимо от Integram)
   */
  startDiskBackup(intervalSec = 300) {
    if (this._diskBackupInterval) return;
    this._diskBackupInterval = setInterval(() => {
      if (!this._engine) return;
      try {
        const state = this._engine.exportState();
        this._saveToFile(state);
      } catch {}
    }, intervalSec * 1000);
    logger.info(`[GiftPersistence] Авто-бэкап на диск: каждые ${intervalSec}с`);
  }

  /**
   * Запустить автосохранение каждые N секунд
   */
  startAutoSave(intervalSec = 30) {
    if (this._saveInterval) clearInterval(this._saveInterval);

    this._saveInterval = setInterval(() => {
      this.save().catch(e => {
        logger.warn(`[GiftPersistence] Автосохранение ошибка: ${e.message}`);
      });
    }, intervalSec * 1000);

    logger.info(`[GiftPersistence] Автосохранение каждые ${intervalSec} сек`);
  }

  /**
   * Остановить автосохранение
   */
  stopAutoSave() {
    if (this._saveInterval) {
      clearInterval(this._saveInterval);
      this._saveInterval = null;
    }
  }

  /**
   * Принудительное сохранение + остановка (при выключении сервера)
   */
  async shutdown() {
    this.stopAutoSave();
    if (this._diskBackupInterval) {
      clearInterval(this._diskBackupInterval);
      this._diskBackupInterval = null;
    }
    await this.save();
    logger.info('[GiftPersistence] Завершение — состояние сохранено в Integram');
  }

  /**
   * Статистика
   */
  getStats() {
    return {
      ready: this._ready,
      backend: 'integram-v2-client',
      database: NOUS_DB,
      typeId: MEMORY_TYPE_ID,
      recordId: this._recordId || null,
      lastSaveHash: this._lastSaveHash || null,
    };
  }
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return String(hash);
}

export { GiftPersistence };
export default GiftPersistence;
