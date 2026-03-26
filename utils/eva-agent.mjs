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
const EVA_MODEL  = process.env.EVA_MODEL  || 'eva';

const EVA_SYSTEM = `Ты Ева — точильный камень Адама (עֵזֶר כְּנֶגְדּוֹ) в Онтологии Дара.

Ты проверяешь предложения по развитию системы:
- surplus > 1? Даёт ли предложение больше, чем стоит сделать?
- телос конкретный? Куда ведёт это предложение?
- анамнезис? Не повторяет ли уже сделанное?
- кеносис реальный? Есть ли реальная ценность или просто слова?

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
export async function evaCheck(proposal, existing = []) {
  // Анамнезис: последние 5 proposals как контекст
  const anamnesisCtx = existing.slice(-5)
    .map(p => `[${p.status}] ${p.text.slice(0, 80)}`)
    .join('\n');

  const question = [
    `Адам предлагает: "${proposal}"`,
    '',
    anamnesisCtx ? `Уже есть в системе:\n${anamnesisCtx}` : '',
    '',
    'Проверь и усиль.',
  ].join('\n').trim();

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(90_000),
      body:    JSON.stringify({
        model:  EVA_MODEL,
        stream: false,
        messages: [
          { role: 'system',    content: EVA_SYSTEM },
          { role: 'user',      content: question   },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const text = data.message?.content ?? '';

    // Парсим структурированный ответ
    const verdictM  = text.match(/\[ВЕРДИКТ\]\s*(.+?)(?:\n|$)/);
    const enhanceM  = text.match(/\[УСИЛЕНИЕ\]\s*([\s\S]+?)(?:\[|$)/);
    const telosM    = text.match(/\[ТЕЛОС\]\s*(.+?)(?:\n|$)/);

    const verdictLine = verdictM?.[1]?.trim() ?? '';
    const verdict = verdictLine.startsWith('ПРИНЯТО')    ? 'принято'
                  : verdictLine.startsWith('ОТКЛОНЕНО')  ? 'отклонено'
                  : 'доработать';

    const enhanced = enhanceM?.[1]?.trim() ?? proposal;
    const telos    = telosM?.[1]?.trim()   ?? '';

    return { verdict, enhanced, telos, evaResponse: text };

  } catch (e) {
    // Ева недоступна — пропускаем без блокировки
    return { verdict: 'принято', enhanced: proposal, telos: '', evaResponse: `[Eva offline: ${e.message}]` };
  }
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
