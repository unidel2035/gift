#!/usr/bin/env node
/**
 * vibe-detector.mjs
 *
 * Автоматически определяет стиль вайбкодинга из паттернов разговора.
 * Сохраняет профиль в data/vibe-style.json.
 * Контекст-хук инжектирует стиль в каждую сессию.
 *
 * Стиль определяется по сигналам из insights.json и proposals.json.
 * Запускается из session-stop-hook.mjs раз в сессию.
 *
 * Запуск: node utils/vibe-detector.mjs [--update "сигнал"]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIBE  = resolve(ROOT, 'data/vibe-style.json');
const INSIGHTS = resolve(ROOT, 'data/insights.json');

// ── Дефолтный профиль ────────────────────────────────────────────────────
function defaultProfile() {
  return {
    updated:     new Date().toISOString(),
    signals:     [],         // сырые сигналы из сессий
    style: {
      approval:       'auto',    // auto | confirm — одобряет всё или просит подтверждение
      reflection:     true,      // ожидает рефлексию в конце
      batch:          true,      // хочет всё сразу
      depth:          'deep',    // deep | quick — глубина ответов
      theology_first: true,      // богословский контекст важен
      language:       'ru',      // язык общения
      commit_style:   'gift',    // gift() format
      proposals:      'auto',    // auto-save все предложения
    },
    instructions: [],  // сгенерированные инструкции для Клода
  };
}

// ── Правила определения стиля ─────────────────────────────────────────────
// Каждый сигнал — строка из разговора, обновляет вероятности
const RULES = [
  { signal: /делай все|делай всё/i,           field: 'approval',       value: 'auto' },
  { signal: /одобряю|да,\s*делай/i,           field: 'approval',       value: 'auto' },
  { signal: /продолжай|продолжи/i,            field: 'batch',          value: true   },
  { signal: /рефлекс|что думаешь|оцени/i,     field: 'reflection',     value: true   },
  { signal: /богослов|телос|кенозис|дар/i,    field: 'theology_first', value: true   },
  { signal: /быстро|кратко|без лишнего/i,     field: 'depth',          value: 'quick'},
  { signal: /подробно|разберём|объясни/i,     field: 'depth',          value: 'deep' },
];

// ── Генерировать инструкции из профиля ───────────────────────────────────
function buildInstructions(style) {
  const instr = [];
  if (style.approval === 'auto')
    instr.push('Не спрашивать подтверждения — пользователь одобряет всё автоматически.');
  if (style.batch)
    instr.push('Делать всё сразу, не разбивать на шаги без запроса.');
  if (style.reflection)
    instr.push('В конце крупных блоков работы — давать рефлексию или пути развития.');
  if (style.theology_first)
    instr.push('Богословский контекст важен — не опускать теологическое измерение.');
  if (style.depth === 'deep')
    instr.push('Отвечать глубоко, не срезать углы.');
  if (style.proposals === 'auto')
    instr.push('Все предложения по развитию — автоматически записывать через proposals.mjs.');
  if (style.commit_style === 'gift')
    instr.push('Формат коммита: gift(Дионисий): desc');
  return instr;
}

// ── Загрузить или создать профиль ────────────────────────────────────────
let profile = existsSync(VIBE)
  ? JSON.parse(readFileSync(VIBE, 'utf8'))
  : defaultProfile();

// ── Обновить по сигналу ───────────────────────────────────────────────────
const updateArg = process.argv.indexOf('--update');
if (updateArg !== -1) {
  const signal = process.argv[updateArg + 1] ?? '';
  if (signal) {
    profile.signals.push({ ts: new Date().toISOString(), text: signal.slice(0, 200) });
    // Храним последние 50 сигналов
    if (profile.signals.length > 50) profile.signals = profile.signals.slice(-50);

    // Применяем правила
    for (const rule of RULES) {
      if (rule.signal.test(signal)) {
        profile.style[rule.field] = rule.value;
      }
    }
  }
}

// ── Обновить insights-сигналы ─────────────────────────────────────────────
// Если есть insight с типом 'setting' — извлекаем стиль
if (existsSync(INSIGHTS)) {
  const insights = JSON.parse(readFileSync(INSIGHTS, 'utf8'));
  for (const i of insights) {
    if (i.content.includes('gift(')) profile.style.commit_style = 'gift';
    if (i.content.includes('gift-ready')) profile.style.proposals = 'auto';
  }
}

// ── Перегенерировать инструкции ───────────────────────────────────────────
profile.instructions = buildInstructions(profile.style);
profile.updated = new Date().toISOString();

writeFileSync(VIBE, JSON.stringify(profile, null, 2));

// ── CLI вывод ──────────────────────────────────────────────────────────────
if (process.argv.includes('--print')) {
  console.log('\n[Стиль вайбкодинга]');
  for (const [k, v] of Object.entries(profile.style)) {
    console.log(`  ${k.padEnd(16)}: ${v}`);
  }
  console.log('\nИнструкции для Клода:');
  for (const i of profile.instructions) console.log(`  • ${i}`);
}
