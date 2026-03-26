/**
 * IntegramV2Client — заглушка
 *
 * Полный клиент Integram V2 с поддержкой агентного слоя.
 * Реализуется по мере подключения к реальному Integram.
 *
 * Пока: no-op. GiftPersistence и agentLayer не падают,
 * но данные не сохраняются во внешней системе.
 */

export class IntegramV2Client {
  constructor(config = {}) {
    this._config = config;
    this._available = false;
  }

  isAvailable() { return false; }

  async createObject(type, data) { return null; }
  async getObject(type, id) { return null; }
  async updateObject(type, id, data) { return null; }
  async deleteObject(type, id) { return null; }
  async listObjects(type, filters) { return []; }
  async search(query) { return []; }
  async setReference(from, field, to) { return null; }
  async uploadFile(file, meta) { return null; }
}

export default IntegramV2Client;
