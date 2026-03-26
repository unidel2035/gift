/**
 * SQLiteVectorStore — заглушка
 *
 * Локальное векторное хранилище для семантического поиска.
 * Будет реализовано с локальным inference (без утечки данных).
 *
 * Пока: no-op. AnamnesisMemory продолжает работать через хронику.
 */

class SQLiteVectorStore {
  async store(id, embedding, metadata) {
    return null;
  }

  async search(embedding, topK = 5) {
    return [];
  }

  async delete(id) {
    return null;
  }

  isAvailable() {
    return false;
  }
}

let _instance = null;

export function getSQLiteVectorStore(dbPath) {
  if (!_instance) _instance = new SQLiteVectorStore();
  return _instance;
}

export default SQLiteVectorStore;
