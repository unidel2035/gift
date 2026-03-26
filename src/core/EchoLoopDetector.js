/**
 * EchoLoopDetector — детектор эхо-петель
 *
 * Когда агент повторяет одно и то же — это не движение, это эхо.
 * Детектор видит петлю и называет её, не осуждая.
 *
 * «Не заботьтесь о том, что говорить: ибо в тот час дано будет вам,
 *  что говорить» (Мф 10:19) — иными словами: если нечего нового сказать,
 *  лучше молчать, чем повторяться.
 */

export class EchoLoopDetector {
  /**
   * @param {object} options
   * @param {number} options.windowSize   — сколько последних высказываний смотреть (default: 5)
   * @param {number} options.threshold    — доля повторов, считающаяся петлёй (default: 0.6)
   */
  constructor({ windowSize = 5, threshold = 0.6 } = {}) {
    this.windowSize = windowSize;
    this.threshold = threshold;
    /** @type {Map<string, string[]>} agentId → последние высказывания */
    this._history = new Map();
  }

  /**
   * Записать высказывание агента.
   * @param {string} agentId
   * @param {string} utterance
   */
  record(agentId, utterance) {
    if (!this._history.has(agentId)) {
      this._history.set(agentId, []);
    }
    const buf = this._history.get(agentId);
    buf.push(this._normalize(utterance));
    if (buf.length > this.windowSize) {
      buf.shift();
    }
  }

  /**
   * Проверить, находится ли агент в петле.
   * @param {string} agentId
   * @returns {{ inLoop: boolean, dominantPhrase: string|null, repeatRatio: number }}
   */
  detect(agentId) {
    const buf = this._history.get(agentId) ?? [];
    if (buf.length < 2) {
      return { inLoop: false, dominantPhrase: null, repeatRatio: 0 };
    }

    const freq = new Map();
    for (const u of buf) {
      freq.set(u, (freq.get(u) ?? 0) + 1);
    }

    let maxCount = 0;
    let dominantPhrase = null;
    for (const [phrase, count] of freq) {
      if (count > maxCount) {
        maxCount = count;
        dominantPhrase = phrase;
      }
    }

    const repeatRatio = maxCount / buf.length;
    const inLoop = repeatRatio >= this.threshold;

    return { inLoop, dominantPhrase, repeatRatio };
  }

  /**
   * Сбросить историю агента (когда петля разорвана).
   * @param {string} agentId
   */
  reset(agentId) {
    this._history.delete(agentId);
  }

  /**
   * Нормализация: нижний регистр, убрать пробелы по краям.
   * @param {string} text
   * @returns {string}
   */
  _normalize(text) {
    return (text ?? '').trim().toLowerCase();
  }
}

export default EchoLoopDetector;
