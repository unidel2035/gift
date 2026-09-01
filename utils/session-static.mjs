#!/usr/bin/env node
/**
 * session-static.mjs — статичные секции контекста, выдаются ОДИН РАЗ на сессию
 * (SessionStart). Переехали сюда из matrix-context-hook (были на каждом ходу):
 *
 *   [Долгосрочная память — axioms/insights/settings]  ~1.3k симв
 *   [Стиль работы с этим пользователем]               ~0.5k симв
 *   [Авторство — крупные фичи]                        ~1.3k симв
 *
 * Статика в начале сессии попадает в кэшируемый префикс Anthropic — все
 * последующие ходы сессии читают её по кэш-цене, а не по полной.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lines = [];

// ── Долгосрочная память (axioms/insights/settings, вес ≥ 7) ─────────────
try {
  const d = JSON.parse(readFileSync(resolve(ROOT, 'data/insights.json'), 'utf8'));
  const items = (Array.isArray(d) ? d : d.insights || []).filter(i => (i.weight || 0) >= 7);
  const byType = {};
  for (const i of items) (byType[i.type] = byType[i.type] || []).push(i);
  lines.push('[Долгосрочная память — axioms/insights/settings:]');
  for (const t of ['setting', 'axiom', 'insight', 'fact']) {
    if (!byType[t]) continue;
    lines.push(`  [${t}] (${byType[t].length}):`);
    for (const i of byType[t].slice(0, 8)) lines.push(`    [w:${i.weight}] ${i.content}`);
  }
} catch { /* нет файла — секция пропускается */ }

// ── Стиль работы ─────────────────────────────────────────────────────────
lines.push('');
lines.push('[Стиль работы с этим пользователем:]');
lines.push('  • Не спрашивать подтверждения — пользователь одобряет всё автоматически.');
lines.push('  • Делать всё сразу, не разбивать на шаги без запроса.');
lines.push('  • В конце крупных блоков работы — давать рефлексию или пути развития.');
lines.push('  • Богословский контекст важен — не опускать теологическое измерение.');
lines.push('  • Отвечать глубоко, не срезать углы.');
lines.push('  • Все предложения по развитию — автоматически записывать через proposals.mjs.');
lines.push('  • Формат коммита: gift(Дионисий): desc');

// ── Авторство (топ-6 по числу файлов) ────────────────────────────────────
try {
  const d = JSON.parse(readFileSync(resolve(ROOT, 'data/authorship-index.json'), 'utf8'));
  const items = (Array.isArray(d) ? d : d.entries || d.items || [])
    .sort((a, b) => (b.files || b.fileCount || 0) - (a.files || a.fileCount || 0)).slice(0, 6);
  if (items.length) {
    lines.push('');
    lines.push('[Авторство — крупнейшие фичи проекта:]');
    for (const it of items) {
      const date = (it.date || it.created || '').slice(0, 10);
      const n = it.files || it.fileCount || '?';
      lines.push(`  [${date}] ${it.name || it.title || '?'} — ${it.summary || ''} (${n} файлов)`);
    }
  }
} catch { /* нет файла */ }

console.log(lines.join('\n'));
