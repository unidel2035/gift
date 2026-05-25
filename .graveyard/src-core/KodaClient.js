/**
 * KodaClient — бесплатный кодер-агент через KodaCode API
 *
 * Решает проблему цены: Claude Opus = архитектор (дорого),
 * KodaAgent = строитель (бесплатно, 3000 вызовов/день).
 *
 * 90% задач кодирования закрываются бесплатно.
 * Claude вызывается только для глубоких решений.
 *
 * API: https://api.kodacode.ru/v1 (OpenAI-совместимый)
 * Модели: KodaAgent, qwen3-coder, deepseek-v3.2
 *
 * «Семья дешевле героя. Рой бесплатных — сильнее одного дорогого.»
 */

import logger from '../../utils/logger.js';

const KODA_BASE_URL = process.env.KODACODE_BASE_URL || 'https://api.kodacode.ru/v1';
const KODA_MODEL = process.env.KODA_MODEL || 'KodaAgent';
const KODA_TOKENS = (process.env.KODACODE_TOKENS || '').split(',').filter(Boolean);
let _tokenIndex = 0;

function getToken() {
  if (KODA_TOKENS.length === 0) {
    return process.env.KODACODE_TOKEN || process.env.GITHUB_TOKEN || '';
  }
  const token = KODA_TOKENS[_tokenIndex % KODA_TOKENS.length];
  return token;
}

function rotateToken() {
  if (KODA_TOKENS.length <= 1) return false;
  _tokenIndex = (_tokenIndex + 1) % KODA_TOKENS.length;
  logger.debug(`[KodaClient] Rotated to token ${_tokenIndex + 1}/${KODA_TOKENS.length}`);
  return true;
}

const BASE_SYSTEM_PROMPT = `Ты Веселеил — кодер-агент Онтологии Дара (בְּצַלְאֵל — строитель Скинии).

Правила:
- Пиши ТОЛЬКО код. Не философствуй.
- Каждый ответ = рабочий код с surplus (делай чуть больше, чем просят).
- Если задача неясна — спроси, не угадывай.
- Код должен быть: читаемый, без багов, с обработкой ошибок.
- Стек проекта: Node.js, Express, Vue 3, SQLite, Ollama.
- Путь бэкенда: backend/monolith/src/
- Путь фронтенда: src/

Формат ответа:
\`\`\`javascript
// код здесь
\`\`\`

Если нужно несколько файлов — каждый в отдельном блоке с путём:
\`\`\`javascript
// filepath: backend/monolith/src/services/example.js
код
\`\`\``;

export class KodaClient {
  constructor(giftEngine = null) {
    this._engine = giftEngine;
    this._conversationHistory = [];
    this._callCount = 0;
    this._errorCount = 0;
  }

  /**
   * Написать код по описанию задачи.
   * @param {string} task — что нужно написать
   * @param {Object} options
   * @param {string} options.context — дополнительный контекст (существующий код)
   * @param {string} options.model — модель (KodaAgent, qwen3-coder, deepseek-v3.2)
   * @returns {Promise<{code: string, files: Array, model: string}>}
   */
  async code(task, options = {}) {
    const { context, model } = options;

    let systemPrompt = BASE_SYSTEM_PROMPT;
    if (context) {
      systemPrompt += `\n\nКонтекст (существующий код):\n${context.slice(0, 3000)}`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    // Добавить историю если есть
    if (this._conversationHistory.length > 0) {
      messages.push(...this._conversationHistory.slice(-6));
    }

    messages.push({ role: 'user', content: task });

    const answer = await this._callKoda(messages, model);

    // Сохранить в историю
    this._conversationHistory.push(
      { role: 'user', content: task },
      { role: 'assistant', content: answer }
    );
    if (this._conversationHistory.length > 20) {
      this._conversationHistory = this._conversationHistory.slice(-12);
    }

    // Извлечь блоки кода
    const files = this._extractCodeBlocks(answer);

    return {
      code: answer,
      files,
      model: model || KODA_MODEL,
      callCount: this._callCount,
    };
  }

  /**
   * Исправить баг по описанию.
   */
  async fix(bugDescription, brokenCode) {
    const task = `Исправь баг:\n${bugDescription}\n\nСломанный код:\n\`\`\`\n${brokenCode}\n\`\`\`\n\nВерни ТОЛЬКО исправленный код.`;
    return this.code(task);
  }

  /**
   * Написать тесты для кода.
   */
  async test(codeToTest, framework = 'vitest') {
    const task = `Напиши тесты (${framework}) для этого кода:\n\`\`\`\n${codeToTest}\n\`\`\`\n\nПокрой основные кейсы + edge cases.`;
    return this.code(task);
  }

  /**
   * Ревью кода — Ева для кода.
   */
  async review(codeToReview) {
    const task = `Сделай code review. Найди: баги, уязвимости, неоптимальности. Для каждого — покажи исправление.\n\`\`\`\n${codeToReview}\n\`\`\``;
    return this.code(task);
  }

  /**
   * Спросить Koda как обычный чат (без кодового контекста).
   */
  async ask(question, options = {}) {
    return this.code(question, options);
  }

  // ── Private ──────────────────────────────────────────

  async _callKoda(messages, model, retries = 2) {
    const useModel = model || KODA_MODEL;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const token = getToken();
        if (!token) {
          throw new Error('No KODACODE_TOKEN configured. Set KODACODE_TOKENS env var.');
        }

        this._callCount++;

        const response = await fetch(`${KODA_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            model: useModel,
            messages,
            temperature: 0.3,
            max_tokens: 4096,
          }),
          signal: AbortSignal.timeout(120000), // 2 min timeout
        });

        if (response.status === 429) {
          // Rate limit — rotate token
          logger.warn(`[KodaClient] Rate limit hit, rotating token...`);
          if (rotateToken()) {
            continue; // Retry with new token
          }
          throw new Error('All tokens rate-limited');
        }

        if (!response.ok) {
          throw new Error(`Koda HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '[Веселеил молчит]';

      } catch (e) {
        this._errorCount++;
        if (attempt < retries && e.message.includes('rate')) {
          rotateToken();
          continue;
        }
        logger.error(`[KodaClient] Error: ${e.message}`);
        if (attempt === retries) {
          return `[Веселеил недоступен: ${e.message}]`;
        }
      }
    }
  }

  _extractCodeBlocks(text) {
    const blocks = [];
    const regex = /```(?:javascript|js|typescript|ts|vue|html|css|json|bash|sh)?\s*\n?(?:\/\/ filepath: (.+?)\n)?([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        filepath: match[1] || null,
        code: match[2].trim(),
      });
    }
    return blocks;
  }

  resetHistory() {
    this._conversationHistory = [];
  }

  getStats() {
    return {
      calls: this._callCount,
      errors: this._errorCount,
      tokensAvailable: KODA_TOKENS.length,
      currentTokenIndex: _tokenIndex,
      model: KODA_MODEL,
    };
  }
}

// ── Factory ─────────────────────────────────────────────

let _kodaInstance = null;

export function getKodaClient(giftEngine = null) {
  if (!_kodaInstance) {
    _kodaInstance = new KodaClient(giftEngine);
    logger.info(`[KodaClient] Веселеил подключён к KodaCode API (${KODA_MODEL}, ${KODA_TOKENS.length} токенов)`);
  }
  return _kodaInstance;
}

export default KodaClient;
