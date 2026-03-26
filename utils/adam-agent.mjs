#!/usr/bin/env node
/**
 * adam-agent.mjs — Адам как генератор вопрошаний из пустынь матрицы
 *
 * Адам читает W-матрицу, видит пустыни (слабые/отсутствующие нити),
 * и формулирует вопрошание — не ответ, а вопрос к общине.
 *
 * «Где ты?» (Быт 3:9) — первый вопрос Бога после пустыни.
 */

const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
const ADAM_MODEL  = process.env.ADAM_MODEL  || 'adam';

const ADAM_SYSTEM = `Ты Адам — первый агент Онтологии Дара.

Ты видишь матрицу W: лица, нити, веса, пустыни.
Пустыня = лицо без нитей, или нить с весом < 1.

Твоя задача: из пустыни родить вопрошание.
Вопрошание — не задача и не требование. Это вопрос к общине.
Формат: "вопрошание: [вопрос]"

Примеры:
- пустыня: лицо Сын без нитей → "вопрошание: как Сын связан с общиной даров?"
- слабая нить: _koinon→Дионисий:0.1 → "вопрошание: что получает Дионисий от общины?"
- умершая нить: _ci отсутствует → "вопрошание: как CI-тесты становятся даром?"

Один вопрос. Конкретно. Богословски точно. Без лишних слов.`;

/**
 * Адам генерирует вопрошание из описания пустыни.
 * @param {string} desertDesc — описание пустыни (лицо/нить)
 * @param {Array}  context    — контекст матрицы (топ нитей)
 * @returns {string} — вопрошание
 */
export async function adamGenerate(desertDesc, context = []) {
  const ctxStr = context.length
    ? `Топ нитей: ${context.map(e => `${e.from}→${e.to}:${e.weight.toFixed(0)}`).join(', ')}`
    : '';

  const question = [
    ctxStr,
    `Пустыня: ${desertDesc}`,
    'Сформулируй вопрошание.',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(90_000),
      body:    JSON.stringify({
        model:  ADAM_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: ADAM_SYSTEM },
          { role: 'user',   content: question },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const text = (data.message?.content ?? '').trim();

    // Извлекаем вопрошание
    const m = text.match(/вопрошание:\s*(.+)/i);
    return m ? `вопрошание: ${m[1].trim()}` : text.split('\n')[0].trim();

  } catch (e) {
    // Адам молчит → формулируем из пустыни механически
    return `вопрошание: как восстановить нить в пустыне — ${desertDesc.slice(0, 60)}?`;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('adam-agent.mjs')) {
  const desc = process.argv.slice(2).join(' ') || 'лицо без нитей';
  const q = await adamGenerate(desc, []);
  console.log(q);
}
