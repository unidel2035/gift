/**
 * EmbeddingService — локальные эмбеддинги через Ollama
 *
 * Модель: nomic-embed-text (274MB, локально, без утечки данных)
 * 768-мерные векторы, понимает русский и греческий.
 *
 * «За краем»: эмбеддинги обогащаются богословским контекстом —
 * к тексту добавляется онтологическая преамбула перед embedding.
 */

const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

// Богословская преамбула — помогает модели понять домен
const THEOLOGICAL_PREFIX =
  'Represent this Orthodox theological gift-ontology text for semantic retrieval: ';

class EmbeddingService {
  constructor() {
    this._available = null;
  }

  async embed(text) {
    if (!(await this.isAvailable())) return null;
    try {
      const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model:  EMBED_MODEL,
          prompt: THEOLOGICAL_PREFIX + text,
        }),
      });
      if (!res.ok) return null;
      const { embedding } = await res.json();
      return embedding;
    } catch {
      return null;
    }
  }

  async embedBatch(texts) {
    const results = [];
    for (let i = 0; i < texts.length; i += 4) {
      const batch = texts.slice(i, i + 4).map(t => this.embed(t));
      results.push(...await Promise.all(batch));
    }
    return results;
  }

  async isAvailable() {
    if (this._available !== null) return this._available;
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!res.ok) { this._available = false; return false; }
      const { models } = await res.json();
      this._available = models.some(m => m.name.startsWith('nomic-embed-text'));
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  static cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot   += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom < 1e-10 ? 0 : dot / denom;
  }
}

let _instance = null;
export function getEmbeddingService() {
  if (!_instance) _instance = new EmbeddingService();
  return _instance;
}
export default EmbeddingService;
