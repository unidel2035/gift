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
          return { persona, logos, content: out.trim() };
        } catch (e) {
          return { persona, logos, content: `[молчит: ${e.message}]` };
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
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });

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
   */
  async ask(question, { quorum, sabbath } = {}) {
    // Сначала проверяем: вообще можем говорить?
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

    // Собираем голоса
    const voices = this.parallel
      ? await Promise.all(this.sources.map(s => s.collect(question)))
      : await this._collectSequential(question);

    // Строим Polyphony
    const polyphony = await this.dissent.assemble(voices);
    return polyphony;
  }

  async _collectSequential(question) {
    const out = [];
    for (const s of this.sources) out.push(await s.collect(question));
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
