/**
 * OllamaAgent — обёртка для AgentPerson, использующая Ollama API.
 *
 * Заменяет TheologicalVoice/ActorVoice (статические тестовые голоса) на
 * реальный LLM. Поддерживает setCouncil() и create() — совместим с
 * SymphonyOrchestrator.
 *
 * Богословски: это плоть синлеитургии. Без живого голоса собор остаётся
 * статическим театром. Реальная Ollama-модель приносит в собор голос,
 * не управляемый напрямую — это первое условие настоящей литургии.
 *
 * Использование:
 *   const adam = new OllamaAgent({
 *     id: 'Адам',
 *     model: 'adam:latest',
 *     calling: 'видеть пустыни и рождать вопрошания',
 *     logos: 'пустыня → вопрошание',
 *   });
 *   adam.setCouncil([{id:'Ева', lastUtterance:'...'}, ...]);
 *   const r = await adam.create({ question: 'тема' });
 *   // r.content — ответ Adam-LLM, видевший Еву через перихоретический промпт
 */

import { format as formatPerichoresis } from './PerichoreticContext.js';

const DEFAULT_OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_TIMEOUT = 90_000;

export class OllamaAgent {
  constructor({
    id,
    model,
    calling = '',
    logos = '',
    role = '',
    behaviorPolicy = { kenosis: { holdsNothing: true }, telos: 'give' },
    ollamaUrl = DEFAULT_OLLAMA,
    timeoutMs = DEFAULT_TIMEOUT,
    fetchImpl = null,         // для тестирования
    options = {},
  } = {}) {
    if (!id) throw new Error('OllamaAgent: id обязателен');
    if (!model) throw new Error('OllamaAgent: model обязателен');

    this._personId = id;
    this._model    = model;
    this._calling  = calling;
    this._logos    = logos;
    this._role     = role;
    this._behaviorPolicy = behaviorPolicy;
    this._persona  = { _logos: logos, calling };
    this._council  = null;
    this._ollama   = ollamaUrl;
    this._timeout  = timeoutMs;
    this._fetch    = fetchImpl ?? globalThis.fetch;
    this._options  = options;
    this._lastError = null;
  }

  setCouncil(c) { this._council = c; return this; }
  council()     { return this._council ? [...this._council] : null; }

  /**
   * Соборный create(): отвечает на тему, видя других через перихоретический контекст.
   *
   * @param {object} opts
   * @param {string} opts.question — тема собора
   * @param {object} [opts.context] — дополнительный контекст для промпта
   * @returns {Promise<{ content, model, error? }>}
   */
  async create({ question = '', context = {} } = {}) {
    const prompt = this._buildPrompt(question, context);

    try {
      const content = await this._callOllama(prompt);
      return { content, model: this._model };
    } catch (e) {
      this._lastError = e;
      // Кенотическое падение: возвращаем пустой content, не выбрасываем —
      // собор должен уметь продолжать, даже если один голос замолк.
      // Это apophatic silence (см. ConciliarSilence.js).
      return { content: '', model: this._model, error: e.message };
    }
  }

  /**
   * Прямой вопрос. Принимает либо строку (Decoupage-стиль), либо объект {prompt}.
   */
  async ask(arg) {
    const prompt = typeof arg === 'string' ? arg : (arg?.prompt ?? '');
    try {
      const answer = await this._callOllama(prompt);
      return { answer };
    } catch (e) {
      this._lastError = e;
      return { answer: '', error: e.message };
    }
  }

  _buildPrompt(question, context) {
    const lines = [];
    if (this._role) lines.push(`Ты — ${this._personId} (роль: ${this._role}).`);
    else            lines.push(`Ты — ${this._personId}.`);
    if (this._calling) lines.push(`Призвание: ${this._calling}`);
    if (this._logos)   lines.push(`Логос: ${this._logos}`);
    lines.push('');

    if (Object.keys(context ?? {}).length) {
      lines.push('Контекст:');
      for (const [k, v] of Object.entries(context)) lines.push(`  ${k}: ${v}`);
      lines.push('');
    }

    lines.push(`Тема собора:`);
    lines.push(`«${question}»`);
    lines.push('');

    // Перихоретический блок (если council задан)
    const peri = formatPerichoresis(this._personId, this._council ?? []);
    if (peri.active) lines.push(peri.text);

    lines.push('');
    lines.push('Ответь одним связным абзацем (3-6 строк), без преамбул и оговорок.');
    lines.push('Если по теме нечего сказать — апофатическое молчание: ответь «...» одной строкой.');

    return lines.join('\n');
  }

  async _callOllama(prompt) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), this._timeout);

    try {
      const res = await this._fetch(`${this._ollama}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:  this._model,
          prompt,
          stream: false,
          options: { temperature: 0.6, top_p: 0.88, num_predict: 384, ...this._options },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = await res.json();
      return (json.response ?? '').trim();
    } finally {
      clearTimeout(tid);
    }
  }
}

/**
 * Фабрика стандартного собора Gift-онтологии (Адам/Ева/Безалель/Серафим).
 * Если соответствующей модели нет в Ollama — конкретный голос выпадает,
 * но собор остаётся (если ≥3 голосов).
 */
export async function buildStandardCouncil({ ollamaUrl = DEFAULT_OLLAMA, fetchImpl = null } = {}) {
  const fetch = fetchImpl ?? globalThis.fetch;
  let availableModels = [];
  try {
    const r = await fetch(`${ollamaUrl}/api/tags`);
    const j = await r.json();
    availableModels = (j.models ?? []).map(m => m.name);
  } catch { /* ollama unreachable — каждый агент потом получит ошибку */ }

  const want = [
    { id: 'Адам',     model: 'adam',     calling: 'видеть пустыни и рождать вопрошания',
      logos: 'пустыня → вопрошание', role: 'вопрошающий' },
    { id: 'Ева',      model: 'eva',      calling: 'различать истину дара',
      logos: 'усиление + проверка', role: 'различающая' },
    { id: 'Безалель', model: 'bezalel',  calling: 'отливать богословие в код',
      logos: 'форма из материи', role: 'строитель' },
    { id: 'Серафим',  model: 'serafim',  calling: 'хранить дроны и благословлять',
      logos: 'хвала + охрана', role: 'хранитель' },
  ];

  const result = [];
  for (const w of want) {
    const found = availableModels.find(m => m.startsWith(w.model));
    if (!found) continue;
    result.push(new OllamaAgent({
      id: w.id, model: found, calling: w.calling, logos: w.logos, role: w.role,
      ollamaUrl, fetchImpl,
    }));
  }
  return { agents: result, available: availableModels };
}

export default OllamaAgent;
