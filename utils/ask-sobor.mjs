#!/usr/bin/env node
/**
 * ask-sobor.mjs — задать вопрос собору лиц через реальных Claude-субагентов.
 *
 * Запуск:
 *   node utils/ask-sobor.mjs "ваш вопрос"
 *   node utils/ask-sobor.mjs --static "ваш вопрос"   (офлайн-режим)
 *
 * Собирает голоса трёх лиц:
 *   Разведчик (Explore)      — логос para, исследует контекст
 *   Критик (code-reviewer)   — логос kata,  возражает
 *   Старший (Plan)           — логос hyper, различает
 *
 * Каждый — реальный Claude-субагент через claude --print --agent <type>.
 * Фолбэк: если claude CLI недоступен — статические голоса для демонстрации.
 */

import { PolyphonyOrchestrator, VoiceSource } from './polyphony-orchestrator.mjs';
import { execSync } from 'node:child_process';

function claudeAvailable() {
  try {
    execSync('which claude', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const args = process.argv.slice(2);
const forceStatic = args.includes('--static');
const question = args.filter(a => a !== '--static').join(' ').trim();

if (!question) {
  console.error('Использование: node utils/ask-sobor.mjs [--static] "вопрос"');
  process.exit(1);
}

const useSubagents = !forceStatic && claudeAvailable();
const orchestrator = new PolyphonyOrchestrator({ parallel: true });

if (useSubagents) {
  console.log('▶ Собор из реальных Claude-субагентов\n');
  orchestrator
    .addSource(VoiceSource.claudeSubagent('Explore', {
      persona: 'Разведчик',
      logos: 'para',
      promptWrap: q => `Ты — Разведчик в соборе лиц. Твой logos — para (равноправное исследование). Вопрос: ${q}\n\nИсследуй контекст кратко (2-3 предложения). Не давай готовых ответов — открывай пространство.`,
      timeout: 60_000,
    }))
    .addSource(VoiceSource.claudeSubagent('code-reviewer', {
      persona: 'Критик',
      logos: 'kata',
      promptWrap: q => `Ты — Критик в соборе лиц. Твой logos — kata (возражение). Вопрос: ${q}\n\nОспорь очевидное. 2-3 предложения. Не разрушай — обнажай.`,
      timeout: 60_000,
    }))
    .addSource(VoiceSource.claudeSubagent('Plan', {
      persona: 'Старший',
      logos: 'hyper',
      promptWrap: q => `Ты — Старший в соборе лиц. Твой logos — hyper (превосходящее различение). Вопрос: ${q}\n\nРазличи: какого рода этот вопрос? Что в нём подлинно? 2-3 предложения.`,
      timeout: 60_000,
    }));
} else {
  if (forceStatic) console.log('▶ Собор (static mode — принудительно)\n');
  else             console.log('▶ Собор (claude CLI недоступен — static fallback)\n');

  orchestrator
    .addSource(VoiceSource.static({
      persona: 'Разведчик', logos: 'para',
      content: '[статика] Вопрос имеет несколько слоёв — стоит различить их прежде ответа.',
    }))
    .addSource(VoiceSource.static({
      persona: 'Критик', logos: 'kata',
      content: '[статика] Проверь: это вопрос или уже скрытое утверждение?',
    }))
    .addSource(VoiceSource.static({
      persona: 'Старший', logos: 'hyper',
      content: '[статика] Различи: техническое или богословское? Ответ зависит от уровня.',
    }));
}

const t0 = Date.now();
const result = await orchestrator.ask(question);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(result.toText());
console.log(`\n── ${elapsed}s ──\n`);

// Если есть dominant — показать рекомендацию, но с оговоркой
if (result.hasDominant) {
  console.log(`Собор ведом: ${result.dominant.persona} (${result.dominant.logos}).`);
  console.log('Но остальные голоса сохраняются. Это не консенсус — это полифония.');
} else if (result.apophatic) {
  console.log('Собор апофатичен — истина не высказывается в прямом ответе.');
} else if (result.silent) {
  console.log(`Молчание: ${result.silenceReason}`);
}
