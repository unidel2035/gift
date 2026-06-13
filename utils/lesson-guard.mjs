#!/usr/bin/env node
/**
 * lesson-guard.mjs — PreToolUse-хук: память-рефлекс в точке действия.
 *
 * Перед каждым вызовом инструмента матчит его против уроков (lessons.mjs) и:
 *   enforce:"block" → блокирует (exit 2 + причина в stderr возвращается модели);
 *   enforce:"warn"  → впрыскивает напоминание (additionalContext), не блокируя.
 *
 * Так выстраданное решение действует САМО, не завися от того, вспомнит ли модель.
 * Тихо пропускает всё, если уроков нет или вход не распознан (не мешает работе).
 */
import { readFileSync } from 'node:fs';

let event = {};
try { event = JSON.parse(readFileSync('/dev/stdin', 'utf8') || '{}'); } catch { process.exit(0); }

const toolName = event.tool_name || event.toolName || '';
const toolInput = event.tool_input || event.toolInput || {};
if (!toolName) process.exit(0);

let matchLessons;
try { ({ matchLessons } = await import('./lessons.mjs')); } catch { process.exit(0); }

const hits = matchLessons(toolName, toolInput);
if (!hits.length) process.exit(0);

const fmt = (l) => `• [${l.id}] ${l.trigger}\n    НЕ: ${l.avoid}\n    А: ${l.do}${l.why ? `\n    (почему: ${l.why})` : ''}`;

const blocks = hits.filter(l => l.enforce === 'block');
if (blocks.length) {
  // exit 2 → инструмент НЕ выполняется, stderr возвращается модели как причина
  process.stderr.write(
    `⛔ lesson-guard: это действие нарушает выученное решение — пересмотри:\n\n` +
    blocks.map(fmt).join('\n\n') + `\n`);
  process.exit(2);
}

// warn → не блокируем, но всплываем правило в контекст модели
const ctx = `⚠ lesson-guard — выученные решения для этого действия (вспомни до выполнения):\n\n` +
  hits.map(fmt).join('\n\n');
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: ctx },
}));
process.exit(0);
