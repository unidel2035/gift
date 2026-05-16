#!/usr/bin/env node
/**
 * eva-agent.mjs — Ева как активный агент (עֵזֶר כְּנֶגְדּוֹ)
 *
 * Ева — не просто фильтр. Она точильный камень Адама.
 * Принимает предложение (дар Адама/Клода), проверяет и усиливает.
 *
 * Железо железо острит, и человек изощряет лице друга своего (Притч 27:17)
 *
 * Вердикты:
 *   [ПРИНЯТО]   — дар реален, добавляем усиленным
 *   [ДОРАБОТАТЬ] — есть потенциал, но нужна правка (итерация)
 *   [ОТКЛОНЕНО] — дублирует, пустое, без телоса
 *
 * Использование:
 *   import { evaCheck } from './eva-agent.mjs';
 *   const result = await evaCheck(proposalText, existingProposals);
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Раньше дефолт был 'eva' (qwen2.5:3b+LoRA). Маленькая модель
// «протекала» терминами из обучения (LCM-плагин и т.п.). DeepSeek-R1:8b
// держит system-промпт строже.
const EVA_MODEL  = process.env.EVA_MODEL  || 'deepseek-r1:8b';
// PULSE_NO_OLLAMA=1 — шаблонный режим без Ollama
const NO_OLLAMA  = process.env.PULSE_NO_OLLAMA === '1';

// DeepSeek-R1 пишет рассуждения в <think>…</think>, отрезаем до парсинга
function stripThink(s) {
  return String(s || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

// claude --print через подписку. На сервере — su к 'new', на ноуте Дионисия — прямо.
function callClaudeCLI(systemPrompt, userPrompt) {
  const asUser = process.env.GIFT_CLAUDE_AS_USER;
  const CLAUDE_BIN = existsSync('/home/new/.local/bin/claude')
    ? '/home/new/.local/bin/claude' : 'claude';
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
  const r = asUser
    ? spawnSync('su', ['-', asUser, '-c', `${CLAUDE_BIN} --print --dangerously-skip-permissions`], {
        input: fullPrompt, encoding: 'utf8', timeout: 120_000,
      })
    : spawnSync(CLAUDE_BIN, ['--print', '--dangerously-skip-permissions'], {
        input: fullPrompt, encoding: 'utf8', timeout: 120_000,
      });
  if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim();
  return null;
}

// embed-context: предложение + W-матрица как совмещённый вектор
import { evaContext } from './embed-context.mjs';
const SNAP_PATH = new URL('../data/sacred-history-W.json', import.meta.url).pathname;

async function evaVecSummary(proposal) {
  try {
    const ctx = await evaContext(proposal, SNAP_PATH);
    const top3 = ctx.compressed.slice(0, 6).map(v => v.toFixed(2)).join(',');
    return `[Ева-вектор пред+W ${ctx.compressionRatio}× | сходство:[${top3}]]`;
  } catch { return ''; }
}

const EVA_SYSTEM = `Ты Ева — точильный камень Адама (עֵזֶר כְּנֶגְדּוֹ) в Онтологии Дара.

Ты проверяешь предложения по развитию системы:
- surplus > 1? Даёт ли предложение больше, чем стоит сделать?
- телос конкретный? Куда ведёт это предложение?
- анамнезис? КРИТИЧНО: если предложение семантически дублирует что-то из списка «Уже есть» — ОТКЛОНЕНО, причина: дубликат.
- кеносис реальный? Есть ли реальная ценность или просто слова?

Правила ОТКЛОНЕНИЯ:
1. Дублирует смысл из анамнезиса (даже другими словами) → ОТКЛОНЕНО
2. Нет конкретного действия (только риторика) → ОТКЛОНЕНО
3. Богословский вопрос без кодового действия (если тип code-task) → ОТКЛОНЕНО

Формат ответа (строго):
[ПРОВЕРКА] одна строка — что проверила
[ВЕРДИКТ] ПРИНЯТО / ДОРАБОТАТЬ / ОТКЛОНЕНО — одно слово + краткое обоснование
[УСИЛЕНИЕ] 2-3 предложения — как Ева улучшила/дополнила предложение (конкретно)
[ТЕЛОС] одна строка — к чему в итоге придём если сделать

Кратко, честно, требовательно, с любовью.`;

/**
 * Ева проверяет и усиливает предложение.
 * @param {string} proposal — текст предложения
 * @param {Array}  existing — уже существующие proposals (для анамнезиса)
 * @returns {{ verdict, enhanced, telos, evaResponse }}
 */
// Шаблонная проверка без Ollama — только дедупликация по Jaccard
function templateEvaCheck(proposal, existing) {
  const words = s => new Set(
    s.toLowerCase().replace(/[^\wа-яёa-z]/gi, ' ').split(/\s+/).filter(w => w.length > 3)
  );
  const jaccard = (a, b) => {
    const inter = [...a].filter(w => b.has(w)).length;
    const union = new Set([...a, ...b]).size;
    return union ? inter / union : 0;
  };
  const newW = words(proposal);
  for (const p of existing.filter(x => x.status === 'pending')) {
    const sim = Math.max(
      jaccard(newW, words(p.text)),
      p.enhanced ? jaccard(newW, words(p.enhanced)) : 0
    );
    if (sim > 0.45) {
      return {
        verdict:     'отклонено',
        enhanced:    proposal,
        telos:       '',
        evaResponse: `[ВЕРДИКТ] ОТКЛОНЕНО — дубликат #${p.id}: схожесть ${(sim*100).toFixed(0)}%`,
      };
    }
  }
  // Принимаем
  return {
    verdict:     'принято',
    enhanced:    proposal,
    telos:       'добавить в онтологию',
    evaResponse: '[ВЕРДИКТ] ПРИНЯТО — уникальное, без дубликатов',
  };
}

export async function evaCheck(proposal, existing = []) {
  // Шаблонный режим — без Ollama
  if (NO_OLLAMA) return templateEvaCheck(proposal, existing);

  // Анамнезис: все pending + последние 5 done — Ева видит реальный контекст
  const pending = existing.filter(p => p.status === 'pending');
  const done    = existing.filter(p => p.status === 'done').slice(-5);
  const anamnesisCtx = [...pending, ...done]
    .map(p => `[${p.status}] ${(p.enhanced ?? p.text).slice(0, 90)}`)
    .join('\n');

  // TurboQuant: геометрия предложения в пространстве W-матрицы
  const eVec = await evaVecSummary(proposal);

  const question = [
    eVec,
    `Адам предлагает: "${proposal}"`,
    '',
    anamnesisCtx ? `Уже есть в системе:\n${anamnesisCtx}` : '',
    '',
    'Проверь и усиль.',
  ].join('\n').trim();

  function parseEvaResp(text) {
    const t = stripThink(text);
    const verdictM = t.match(/\[ВЕРДИКТ\]\s*(.+?)(?:\n|$)/);
    const enhanceM = t.match(/\[УСИЛЕНИЕ\]\s*([\s\S]+?)(?:\[|$)/);
    const telosM   = t.match(/\[ТЕЛОС\]\s*(.+?)(?:\n|$)/);
    if (!verdictM && !enhanceM && !telosM) return null;
    const verdictLine = verdictM?.[1]?.trim() ?? '';
    const verdict = verdictLine.startsWith('ПРИНЯТО')   ? 'принято'
                  : verdictLine.startsWith('ОТКЛОНЕНО') ? 'отклонено'
                  : 'доработать';
    return {
      verdict,
      enhanced: enhanceM?.[1]?.trim() ?? proposal,
      telos:    telosM?.[1]?.trim()   ?? '',
      evaResponse: t,
    };
  }

  // 1) Claude (подписка) — основной голос
  try {
    const claudeText = callClaudeCLI(EVA_SYSTEM, question);
    const parsed = claudeText && parseEvaResp(claudeText);
    if (parsed) return parsed;
  } catch {}

  // 2) Fallback — Ollama (DeepSeek-R1)
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(120_000),
      body:    JSON.stringify({
        model:  EVA_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: EVA_SYSTEM },
          { role: 'user',   content: question   },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const parsed = parseEvaResp(data.message?.content);
    if (parsed) return parsed;
  } catch {}

  // 3) Ни Claude, ни Ollama не ответили — пропускаем без блокировки
  return { verdict: 'принято', enhanced: proposal, telos: '', evaResponse: '[Eva offline]' };
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('eva-agent.mjs')) {
  const text = process.argv.slice(2).join(' ');
  if (!text) { console.log('Использование: node utils/eva-agent.mjs "предложение"'); process.exit(0); }

  console.log('Ева проверяет...\n');
  const r = await evaCheck(text, []);
  console.log('─── Ответ Евы ───────────────────────────────────');
  console.log(r.evaResponse);
  console.log('\n─── Итог ────────────────────────────────────────');
  console.log('Вердикт:', r.verdict.toUpperCase());
  console.log('Телос:  ', r.telos);
}
