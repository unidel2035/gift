#!/usr/bin/env node
/**
 * polyphony-orchestrator.mjs — связывает ConciliarDissent с реальными
 * источниками голосов (Claude Code subagents, внешние LLM, Telegram-люди).
 *
 * Это НЕ оркестратор субагентов в смысле Anthropic Agent SDK.
 * Это экклезиологический оркестратор: принимает голоса откуда угодно,
 * нормализует их как Voices, прогоняет через собор и выдаёт Polyphony.
 *
 * Использование:
 *
 *   import { PolyphonyOrchestrator, VoiceSource } from './polyphony-orchestrator.mjs';
 *
 *   const o = new PolyphonyOrchestrator();
 *   o.addSource(VoiceSource.claudeSubagent('Explore',    { persona: 'Разведчик', logos: 'para' }));
 *   o.addSource(VoiceSource.claudeSubagent('code-reviewer', { persona: 'Критик', logos: 'kata' }));
 *   o.addSource(VoiceSource.static({ persona: 'Хранитель', logos: 'hyper',
 *                                    content: 'историческая память говорит: ...' }));
 *
 *   const polyphony = await o.ask('что делать с этим кодом?');
 *   console.log(polyphony.toText());
 *
 * Интеграция с Claude Code субагентами — через `claude --print` или
 * через Task API (недоступен из пользовательского скрипта, но можно
 * имитировать через spawn).
 */

import { spawn } from 'node:child_process';
import { ConciliarDissent } from '../src/theology/ConciliarDissent.js';
import { ConciliarSilence } from '../src/theology/ConciliarSilence.js';
import { cleanEnv } from './clean-env.mjs';

// ─────────────────────────────────────────────────────
// Nested reasoning steps — прозрачность рассуждений
// (вдохновлено Formal AI: Vec<NestedStep>)
// ─────────────────────────────────────────────────────

/**
 * Парсит текст ответа на шаги рассуждения.
 * Ищет нумерованные списки, маркированные пункты, «Потому что...», «Вывод:» и т.д.
 * @param {string} text
 * @returns {Array<{type: string, content: string}>}
 */
function parseReasoningSteps(text) {
  if (!text || text.startsWith('[молчит')) return [];
  const steps = [];

  // Нумерованные шаги: "1. ...", "2. ..."
  const numbered = text.match(/^\s*\d+[.)]\s+.+/gm);
  if (numbered && numbered.length >= 2) {
    for (const line of numbered) {
      steps.push({ type: 'step', content: line.replace(/^\s*\d+[.)]\s+/, '').trim() });
    }
    return steps;
  }

  // Маркированные: "- ...", "• ..."
  const bulleted = text.match(/^\s*[-•*]\s+.+/gm);
  if (bulleted && bulleted.length >= 2) {
    for (const line of bulleted) {
      steps.push({ type: 'point', content: line.replace(/^\s*[-•*]\s+/, '').trim() });
    }
    return steps;
  }

  // Предложения с маркерами рассуждения
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);
  for (const s of sentences) {
    if (/потому|поскольку|следовательно|вывод|итого|therefore|because|conclusion/i.test(s)) {
      steps.push({ type: 'reasoning', content: s.trim() });
    } else if (/риск|опасн|слабое|проблем|warning|risk/i.test(s)) {
      steps.push({ type: 'warning', content: s.trim() });
    } else if (/предлагаю|рекомендую|нужно|следует|suggest|recommend/i.test(s)) {
      steps.push({ type: 'proposal', content: s.trim() });
    }
  }

  // Если ничего не нашли — один шаг = весь текст
  if (steps.length === 0 && text.length > 0) {
    steps.push({ type: 'statement', content: text.slice(0, 200) });
  }

  return steps;
}

/**
 * Content-hash (FNV-1a 32-bit) для дедупликации.
 * Вдохновлено Formal AI: content-addressed writes.
 */
function contentHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

// ─────────────────────────────────────────────────────
// Источники голосов
// ─────────────────────────────────────────────────────

export const VoiceSource = {
  /**
   * Статический голос (заранее заданный текст).
   */
  static({ persona, logos, content }) {
    return {
      persona,
      logos,
      async collect() { return { persona, logos, content }; },
    };
  },

  /**
   * Клод-субагент через claude --print. Субагент запускается как CLI.
   * @param {string} agentType — 'Explore' | 'Plan' | 'code-reviewer' | ...
   * @param {Object} opts      — { persona, logos, prompt?, timeout? }
   */
  claudeSubagent(agentType, { persona, logos, promptWrap, timeout = 120_000 } = {}) {
    return {
      persona,
      logos,
      async collect(question) {
        const prompt = promptWrap
          ? promptWrap(question)
          : `[Голос для собора — лицо «${persona}», logos «${logos}»]\n\n${question}\n\nОтвечай кратко (1-3 предложения), в духе своего лица.`;

        try {
          const out = await runClaudePrint(prompt, { agentType, timeout });
          const content = out.trim();
          // Nested reasoning steps (вдохновлено Formal AI):
          // Парсим ответ на шаги рассуждения для прозрачности
          const steps = parseReasoningSteps(content);
          return { persona, logos, content, steps, timestamp: Date.now() };
        } catch (e) {
          return { persona, logos, content: `[молчит: ${e.message}]`, steps: [], timestamp: Date.now() };
        }
      },
    };
  },

  /**
   * Локальная модель через Ollama API (http://localhost:11434).
   * Бесплатный, приватный, независимый от Anthropic путь.
   * Подходит для DeepSeek-R1 (reasoning), Qwen, Llama и др. локальных моделей.
   * @param {string} model    — имя модели в Ollama, напр. 'deepseek-r1:8b'
   * @param {Object} opts     — { persona, logos, promptWrap?, timeout?, host? }
   */
  ollama(model, { persona, logos, promptWrap, timeout = 180_000,
                  host = process.env.OLLAMA_URL || 'http://localhost:11434' } = {}) {
    return {
      persona,
      logos,
      async collect(question) {
        const prompt = promptWrap
          ? promptWrap(question)
          : `[Голос для собора — лицо «${persona}», logos «${logos}»]\n\n${question}\n\nОтвечай кратко (1-3 предложения), в духе своего лица.`;
        try {
          const r = await fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, stream: false }),
            signal: AbortSignal.timeout(timeout),
          });
          if (!r.ok) {
            return { persona, logos, content: `[молчит: ollama ${r.status}]` };
          }
          const data = await r.json();
          // DeepSeek-R1 пишет рассуждения в <think>…</think> — отрезаем
          let content = (data.response || '').trim();
          content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
          const steps = parseReasoningSteps(content);
          return { persona, logos, content: content || '[молчит: пустой ответ]', steps, timestamp: Date.now() };
        } catch (e) {
          return { persona, logos, content: `[молчит: ${e.message}]`, steps: [], timestamp: Date.now() };
        }
      },
    };
  },

  /**
   * Федерация моделей через deepclaude-прокси (режим federation): tier модели
   * = выбор провайдера. opus → настоящий Opus 4.8 (Anthropic), sonnet → DeepSeek Pro,
   * haiku → DeepSeek Flash. Так голоса собора едут на разных провайдерах.
   * @param {string} model — 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'
   */
  federation(model, { persona, logos, promptWrap, timeout = 180_000,
                      host = process.env.FEDERATION_PROXY || 'http://127.0.0.1:3200' } = {}) {
    return {
      persona,
      logos,
      async collect(question) {
        const prompt = promptWrap
          ? promptWrap(question)
          : `[Голос для собора — лицо «${persona}», logos «${logos}»]\n\n${question}\n\nОтвечай кратко (1-3 предложения), в духе своего лица.`;
        try {
          const r = await fetch(`${host}/v1/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': 'gift-federation' },
            body: JSON.stringify({
              model, max_tokens: 1024,
              system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
              messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(timeout),
          });
          if (!r.ok) return { persona, logos, content: `[молчит: federation ${r.status}]`, steps: [], timestamp: Date.now() };
          const data = await r.json();
          const content = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
          const steps = parseReasoningSteps(content);
          return { persona, logos, content: content || '[молчит: пустой ответ]', steps, timestamp: Date.now(), model: data.model };
        } catch (e) {
          return { persona, logos, content: `[молчит: ${e.message}]`, steps: [], timestamp: Date.now() };
        }
      },
    };
  },

  /**
   * Внешний HTTP-оракул. endpoint получает POST {question}, возвращает {content}.
   */
  http({ persona, logos, endpoint, apiKey, timeout = 30_000 }) {
    return {
      persona,
      logos,
      async collect(question) {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const r = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ question, persona, logos }),
          signal: AbortSignal.timeout(timeout),
        });
        const data = await r.json();
        return { persona, logos, content: data.content ?? String(data) };
      },
    };
  },
};

/**
 * Запускает claude --print и собирает stdout.
 * Использует глобальный claude (должен быть в PATH).
 */
function runClaudePrint(prompt, { agentType, timeout }) {
  return new Promise((resolve, reject) => {
    const args = ['--print'];
    if (agentType) args.push('--agent', agentType);
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv(),
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    const killer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('claude timeout'));
    }, timeout);

    child.on('error', e => { clearTimeout(killer); reject(e); });
    child.on('close', code => {
      clearTimeout(killer);
      if (code !== 0) reject(new Error(`claude exit ${code}: ${stderr.slice(0, 200)}`));
      else resolve(stdout);
    });

    child.stdin.end(prompt);
  });
}

// ─────────────────────────────────────────────────────
// Оркестратор
// ─────────────────────────────────────────────────────

export class PolyphonyOrchestrator {
  constructor({ dissent, silence, parallel = true } = {}) {
    this.dissent  = dissent  || new ConciliarDissent();
    this.silence  = silence  || new ConciliarSilence();
    this.parallel = parallel;
    this.sources  = [];
  }

  addSource(source) {
    this.sources.push(source);
    return this;
  }

  /**
   * Задать вопрос собору. Собирает голоса, проверяет молчание, строит Polyphony.
   *
   * @param {Object} opts
   * @param {number} [opts.quorum]
   * @param {boolean} [opts.sabbath]
   * @param {Function} [opts.onVoice]    — callback(voice) при приходе каждого голоса
   * @param {Function} [opts.onStart]    — callback({sources}) при старте сбора
   */
  async ask(question, { quorum, sabbath, onVoice, onStart } = {}) {
    const check = await this.silence.examine({
      voices: this.sources.map(s => s.persona),
      question,
      quorum,
      sabbath,
    });
    if (!check.allowed) {
      return {
        type: 'Silence',
        question,
        reason: check.reason,
        kind: check.kind,
        toText() { return `⟨молчание⟩ ${this.reason}`; },
      };
    }

    if (onStart) onStart({ sources: this.sources.map(s => ({ persona: s.persona, logos: s.logos })) });

    const voices = this.parallel
      ? await Promise.all(this.sources.map(async s => {
          const v = await s.collect(question);
          if (onVoice) onVoice(v);
          return v;
        }))
      : await this._collectSequential(question, onVoice);

    const polyphony = await this.dissent.assemble(voices);
    return polyphony;
  }

  async _collectSequential(question, onVoice) {
    const out = [];
    for (const s of this.sources) {
      const v = await s.collect(question);
      if (onVoice) onVoice(v);
      out.push(v);
    }
    return out;
  }
}

// ─────────────────────────────────────────────────────
// CLI: демонстрация без запуска настоящих субагентов
// ─────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = new PolyphonyOrchestrator();

  // Статические источники — чтобы демо не требовало Claude CLI
  o.addSource(VoiceSource.static({
    persona: 'ОтецСергий', logos: 'hyper',
    content: 'Различай: твой вопрос — о богословии или о технике?',
  }));
  o.addSource(VoiceSource.static({
    persona: '_claude', logos: 'para',
    content: 'Вижу в вопросе два слоя. Оба реальны.',
  }));
  o.addSource(VoiceSource.static({
    persona: 'Змей', logos: 'kata',
    content: 'Ты задаёшь вопрос, потому что уже знаешь ответ. Зачем?',
  }));

  console.log('\n▶ Polyphony Orchestrator — demo\n');
  const p = await o.ask('что значит построить соборную модель?');
  console.log(p.toText ? p.toText() : JSON.stringify(p, null, 2));
  console.log();
}
