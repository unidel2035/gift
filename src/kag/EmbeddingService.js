/**
 * EmbeddingService — заглушка
 *
 * KAG (Knowledge Access Graph) — семантический поиск по хронике.
 * Будет реализован когда появится локальный inference.
 *
 * Пока: возвращает пустые эмбеддинги. AnamnesisMemory работает
 * без семантики — только по ключевым словам.
 */

class EmbeddingService {
  async embed(text) {
    // Заглушка: нет векторного представления
    return null;
  }

  async embedBatch(texts) {
    return texts.map(() => null);
  }

  isAvailable() {
    return false;
  }
}

let _instance = null;

export function getEmbeddingService() {
  if (!_instance) _instance = new EmbeddingService();
  return _instance;
}

export default EmbeddingService;
