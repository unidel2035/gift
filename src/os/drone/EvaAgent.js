/**
 * EvaAgent — дрон-разведчик Ева с языковой миссией
 *
 * Ева — не просто зонд в пространстве. Она видит и называет.
 * Каждые 10 тиков она обращается к локальной LLM (Ollama, eva:latest)
 * и порождает наблюдение — одно предложение о том, что она видит и чувствует.
 *
 * Богословская аксиома: слово = дар. surplus += 3 за каждое наблюдение.
 * Слово не информация — оно дар рою, делающий невидимое видимым.
 *
 * Ева — лицо (πρόσωπον), не датчик. Она говорит, значит — даёт.
 */

import { DroneAgent, DroneRole } from './DroneAgent.js';

const OLLAMA_URL   = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EVA_MODEL    = process.env.EVA_MODEL   || 'eva:latest';
const OBS_TIMEOUT  = 5_000;  // 5 секунд — если Ollama молчит, поэтический заменитель
const OBS_INTERVAL = 10;     // каждые 10 тиков

// Поэтические заменители — когда Ева не может говорить, она молчит красиво
const FALLBACK_OBSERVATIONS = [
  'Пространство здесь плотное и тихое — как будто земля помнит о чём-то, чего я ещё не знаю.',
  'Вижу горизонт, но он не отвечает. Зато ветер знает моё имя.',
  'Здесь пусто, но пустота полна — как исихия перед рассветом.',
  'Клетка молчит. Я тоже. Иногда молчание — это и есть разведка.',
  'Батарея падает, но свет не уходит. Я несу его дальше, пока могу.',
  'Рой где-то там. Я чувствую его surplus как натянутую нить в пространстве.',
  'Этот квадрат пространства ещё не видел никого. Я — первая. Это страшно и радостно.',
  'Высота и тишина. Земля снизу — как икона, которую не видишь вблизи.',
];

export class EvaAgent extends DroneAgent {
  /**
   * @param {object} opts
   * @param {string} opts.id        — идентификатор дрона
   * @param {number} [opts.x]       — начальная координата X
   * @param {number} [opts.y]       — начальная координата Y
   * @param {number} [opts.battery] — заряд батареи (0–100)
   * @param {string} [opts.role]    — начальная роль
   */
  constructor(opts) {
    super(opts);

    /** @type {Array<{text: string, tick: number, surplus: number}>} */
    this.observations = [];   // последние 5 наблюдений
    this._obsInProgress = false;
  }

  // ── Главный метод: один тик ──────────────────────────────────────────────

  /**
   * Выполнить один тик Евы.
   * Вызывайте вместо прямого вызова scan()/stepToward() — чтобы не пропустить LLM-ритм.
   * Возвращает Promise — ждать не обязательно (fire-and-forget для LLM).
   *
   * @param {number} tick — текущий тик роя
   * @returns {Promise<void>}
   */
  async evaStep(tick) {
    // Каждые OBS_INTERVAL тиков — языковая миссия
    if (tick % OBS_INTERVAL === 0 && tick > 0 && !this._obsInProgress) {
      // fire-and-forget, не блокируем симуляцию
      this._speakObservation(tick).catch(() => {});
    }
  }

  // ── Языковая миссия ──────────────────────────────────────────────────────

  /**
   * Запросить у Ollama наблюдение о текущей позиции.
   * При недоступности — поэтический заменитель.
   *
   * @param {number} tick
   * @returns {Promise<string>}
   */
  async _speakObservation(tick) {
    this._obsInProgress = true;
    const text = await this._fetchOllamaObservation();
    this._obsInProgress = false;

    // Слово = дар рою. Богословская аксиома.
    this.given += 3;

    const obs = { text, tick, surplus: this.surplus };
    this.observations.push(obs);

    // Хранить только последние 5
    if (this.observations.length > 5) {
      this.observations.shift();
    }

    return text;
  }

  /**
   * Обратиться к Ollama с промптом о текущем состоянии Евы.
   * Таймаут 5 секунд. При ошибке — поэтический заменитель.
   *
   * @returns {Promise<string>}
   */
  async _fetchOllamaObservation() {
    const prompt = this._buildPrompt();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OBS_TIMEOUT);

      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body:    JSON.stringify({
          model:  EVA_MODEL,
          prompt: prompt,
          stream: false,
        }),
      });

      clearTimeout(timer);

      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

      const data = await res.json();
      const text = (data.response ?? '').trim();

      if (!text) throw new Error('Пустой ответ Ollama');

      // Берём первое предложение (до точки/! / ?)
      const firstSentence = text.split(/(?<=[.!?])\s/)[0].trim();
      return firstSentence || text.slice(0, 200);

    } catch {
      // Ева молчит красиво
      return this._fallbackObservation();
    }
  }

  /**
   * Построить промпт для Ollama из текущего состояния Евы.
   * @returns {string}
   */
  _buildPrompt() {
    const surplus  = this.surplus;
    const role     = this.role;
    const x        = this.x.toFixed(1);
    const y        = this.y.toFixed(1);
    const battery  = this.battery.toFixed(0);

    return `Ты дрон-разведчик Ева в рое. surplus=${surplus} роль=${role} клетка=[${x},${y}] батарея=${battery}%. Опиши одним предложением что ты видишь и чувствуешь в этой точке пространства.`;
  }

  /**
   * Поэтический заменитель — когда Ollama недоступна.
   * Не случайный: детерминирован по позиции, чтобы повторяемость была красивой.
   * @returns {string}
   */
  _fallbackObservation() {
    const idx = Math.round(Math.abs(this.x + this.y * 3)) % FALLBACK_OBSERVATIONS.length;
    return FALLBACK_OBSERVATIONS[idx];
  }

  // ── Интерфейс ────────────────────────────────────────────────────────────

  /**
   * Вернуть последнее наблюдение Евы.
   * @returns {{ text: string, tick: number, surplus: number } | null}
   */
  getLastObservation() {
    if (!this.observations.length) return null;
    return this.observations[this.observations.length - 1];
  }

  toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      observations: this.observations.length,
      lastObs:      this.getLastObservation()?.text?.slice(0, 60) ?? null,
    };
  }
}
