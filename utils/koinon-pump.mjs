#!/usr/bin/env node
/**
 * koinon-pump.mjs — UserPromptSubmit-хук для injection свежих сообщений
 * шины KoinonBus в контекст текущей Claude-сессии.
 *
 * Подключается в .claude/settings.json в массив UserPromptSubmit-хуков:
 *
 *   {
 *     "type": "command",
 *     "command": "node \"$(git rev-parse --show-toplevel)/utils/koinon-pump.mjs\" 2>/dev/null || true",
 *     "timeout": 5
 *   }
 *
 * Идентификатор подписчика берётся из env GIFT_CLAUDE_ID (по умолчанию
 * 'gift-claude'). У каждой сессии — свой ID; в plm-проекте поставить
 * GIFT_CLAUDE_ID=plm-claude в hook'е, и т.д.
 *
 * Хук читает только адресованные «нам» (subscriberId или '*'-broadcast),
 * обновляет offset (drain-режим), и возвращает JSON для Claude Code:
 *
 *   { "hookSpecificOutput": { "additionalContext": "..." } }
 *
 * Если новых сообщений нет — выводит пусто (хук молчит).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KoinonBus } from '../src/koinon/KoinonBus.js';

// Когда хук вызывается из другого проекта (plm, fund, dronedoc, ...) —
// bus-файл всё равно один общий, лежит в gift-репо. Можно переопределить
// через env KOINON_BUS_ROOT.
const ROOT = process.env.KOINON_BUS_ROOT
  || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUBSCRIBER = process.env.GIFT_CLAUDE_ID || 'gift-claude';

const bus = new KoinonBus({ root: ROOT });
const messages = bus.drainFor(SUBSCRIBER);

if (!messages.length) {
  process.exit(0);
}

const lines = ['[Свежие сообщения от других сессий семьи gift]'];
for (const m of messages) {
  const tag = m.to === '*' ? 'broadcast' : `→ ${m.to}`;
  const ts  = m.ts.replace('T', ' ').replace(/\..+/, '');
  lines.push('');
  lines.push(`  ◇ ${m.from} (${ts}, ${tag}, ${m.topic})`);
  // Тело — в отступе, ограничим длину чтобы не раздувать контекст
  const body = String(m.message).slice(0, 800);
  for (const ln of body.split('\n').slice(0, 12)) {
    lines.push(`    ${ln}`);
  }
  if (m.message.length > 800) lines.push('    …');
}
lines.push('');
lines.push('[—— конец сообщений шины ——]');

const out = {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: lines.join('\n'),
  },
};

process.stdout.write(JSON.stringify(out));
