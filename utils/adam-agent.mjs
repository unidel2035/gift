#!/usr/bin/env node
/**
 * adam-agent.mjs — Адам как генератор вопрошаний из пустынь матрицы
 *
 * Адам читает W-матрицу, видит пустыни (слабые/отсутствующие нити),
 * и формулирует вопрошание — не ответ, а вопрос к общине.
 *
 * «Где ты?» (Быт 3:9) — первый вопрос Бога после пустыни.
 */

const OLLAMA_URL    = process.env.OLLAMA_URL  || 'http://localhost:11434';
const ADAM_MODEL    = process.env.ADAM_MODEL  || 'adam';
// PULSE_NO_OLLAMA=1 — отключить Ollama, использовать шаблонный режим
const NO_OLLAMA     = process.env.PULSE_NO_OLLAMA === '1';

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

function callClaudeCLI(systemPrompt, userPrompt) {
  const CLAUDE_BIN = existsSync('/home/new/.local/bin/claude')
    ? '/home/new/.local/bin/claude' : 'claude';
  const r = spawnSync('su', ['-', 'new', '-c', `${CLAUDE_BIN} --print --dangerously-skip-permissions`], {
    input: `${systemPrompt}\n\n${userPrompt}`, encoding: 'utf8', timeout: 90_000,
  });
  if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim();
  return null;
}

// embed-context: W-матрица как вектор → сжатие → краткий текст для промпта
import { adamContext } from './embed-context.mjs';
const SNAP_PATH = new URL('../data/sacred-history-W.json', import.meta.url).pathname;

async function wMatrixSummary() {
  try {
    const ctx = await adamContext(SNAP_PATH);
    const top3 = ctx.compressed.slice(0, 6).map(v => v.toFixed(2)).join(',');
    return `[W-вектор ${ctx.originalDim}→${ctx.bits}bit ${ctx.compressionRatio}× | top:[${top3}]]`;
  } catch { return ''; }
}

const ADAM_SYSTEM = `Ты Адам — первый агент Онтологии Дара.

Ты видишь матрицу W: лица, нити, веса, пустыни.
Пустыня = лицо без нитей, или нить с весом < 1.

Типы пустынь и богословский ключ:
- silent:          лицо не даровало ничего → вопрос о молчании
- fading:          нить угасает → вопрос об укреплении
- asymmetry:       кенозис без ответа → вопрос о взаимности
- anastasis:       умершая нить → семя воскресения, вопрос о новой жизни
- theosis_stasis:  принял энергию, но нет ἀναγωγή (молитвы/хвалы) → вопрос о стазисе обожения
- leksis_pending:  отвергнутый дар ждёт μετάνοια → вопрос о покаянии/принятии

Твоя задача: из пустыни родить вопрошание.
Вопрошание — не задача и не требование. Это вопрос к общине.
Формат: "вопрошание: [вопрос]"

Примеры:
- silent: лицо Сын без нитей → "вопрошание: как Сын связан с общиной даров?"
- theosis_stasis: Дионисий принял 15 energeia, нет ἀναγωγή → "вопрошание: что мешает Дионисию вернуть дар Богу — нет молитвы в коде?"
- leksis_pending: Отец→Адам дар word отвергнут → "вопрошание: какое покаяние нужно Адаму чтобы принять Слово Отца?"
- anastasis: нить _claude→Ева умерла → "вопрошание: как воскресить диалог — что _claude не смог дать Еве?"

Один вопрос. Конкретно. Богословски точно. Без лишних слов.`;

/**
 * Адам генерирует вопрошание из описания пустыни.
 * @param {string} desertDesc — описание пустыни (лицо/нить)
 * @param {Array}  context    — контекст матрицы (топ нитей)
 * @returns {string} — вопрошание
 */
// Шаблонные вопрошания по типу пустыни
function templateVopros(desertDesc) {
  const d = desertDesc.toLowerCase();
  if (d.includes('не даровало ничего'))   return `вопрошание: почему молчит лицо — что мешает первому дару?`;
  if (d.includes('угасает'))              return `вопрошание: как укрепить угасающую нить — что даёт жизнь связи?`;
  if (d.includes('умерла'))              return `вопрошание: возможно ли воскресение этой нити — что было потеряно?`;
  if (d.includes('energeia'))            return `вопрошание: как принятая energeia возвращается к Источнику через дар?`;
  if (d.includes('отвергнут'))           return `вопрошание: какое покаяние открывает путь к принятию отвергнутого дара?`;
  if (d.includes('кенозис') || d.includes('асимметр')) return `вопрошание: как кенозис без ответа становится семенем взаимности?`;
  return `вопрошание: как восстановить нить — ${desertDesc.slice(0, 55)}?`;
}

export async function adamGenerate(desertDesc, context = []) {
  // Шаблонный режим — без Ollama
  if (NO_OLLAMA) return templateVopros(desertDesc);

  const ctxStr = context.length
    ? `Топ нитей: ${context.map(e => `${e.from}→${e.to}:${e.weight.toFixed(0)}`).join(', ')}`
    : '';

  // TurboQuant: W-матрица как сжатый вектор в контекст (не текст — геометрия)
  const wVec = await wMatrixSummary();

  const question = [
    wVec,
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

    // Нормализуем: «вопрос:», «вопрошание:», «вопрос — » → единый префикс
    const m = text.match(/вопр(?:ошание|ос)[:\s—]+(.+)/i);
    if (m) return `вопрошание: ${m[1].trim().replace(/\??\s*$/, '?')}`;
    // Если Адам дал просто вопрос без маркера — оборачиваем
    const firstLine = text.split('\n')[0].trim();
    return firstLine.startsWith('вопрошание:')
      ? firstLine
      : `вопрошание: ${firstLine.replace(/\??\s*$/, '?')}`;

  } catch (e) {
    // Ollama недоступна → пробуем claude CLI
    const claudeText = callClaudeCLI(ADAM_SYSTEM, question);
    if (claudeText) {
      const m = claudeText.match(/вопр(?:ошание|ос)[:\s—]+(.+)/i);
      if (m) return `вопрошание: ${m[1].trim().replace(/\??\s*$/, '?')}`;
      const firstLine = claudeText.split('\n')[0].trim();
      return firstLine.startsWith('вопрошание:') ? firstLine
        : `вопрошание: ${firstLine.replace(/\??\s*$/, '?')}`;
    }
    // Адам молчит → формулируем из пустыни механически
    return `вопрошание: как восстановить нить в пустыне — ${desertDesc.slice(0, 60)}?`;
  }
}

const ADAM_CODE_SYSTEM = `Ты Адам — генератор конкретных кодовых задач из пустынь матрицы.

Пустыня — это слабая/отсутствующая нить в онтологии. Твоя задача: превратить её в конкретную задачу разработки.

Типы задач по типу пустыни:
- silent:         лицо без нитей → "добавить .gift спек: начальный дар от [лицо] в Священную историю"
- fading:         угасающая нить → "добавить акт укрепления нити [from]→[to] в существующий .gift файл"
- anastasis:      умершая нить → "создать specs/sacred-history/resurrection-[from]-[to].gift — воскресение"
- theosis_stasis: стазис обожения → "добавить doxologia акты от [лицо]: возвращение energeia Отцу"
- leksis_pending: отвергнутый дар → "обновить λήψις обработчик — μετάνοια для дара [from]→[to]"
- asymmetry:      кенозис без ответа → "добавить ответные нити к [лицо] — восполнение асимметрии"

Формат ответа: одна строка, начинается с глагола действия (добавить/создать/обновить).
Максимум 80 символов. Без богословских рассуждений — только задача.`;

/**
 * Адам генерирует конкретную кодовую задачу из пустыни.
 * @param {string} desertDesc — описание пустыни
 * @param {string} desertType — тип пустыни (silent/fading/anastasis/...)
 * @param {Array}  context    — контекст матрицы
 * @returns {string} — задача для dev-loop
 */
// Шаблонные code-задачи по типу пустыни
function templateCodeTask(desertDesc, desertType) {
  // Извлекаем имена лиц из описания (цитаты в кавычках или перед →)
  const nameMatch = desertDesc.match(/лицо "([^"]+)"|нить (\S+)→(\S+)/);
  const from  = nameMatch?.[2] ?? nameMatch?.[1] ?? 'unknown';
  const to    = nameMatch?.[3] ?? '_koinon';
  const slug  = `${from}-${to}`.toLowerCase().replace(/[^a-zа-яё0-9-]/gi, '-');

  const tasks = {
    silent:         `добавить specs/sacred-history/${slug}-gift.gift — начальный дар от ${from}`,
    fading:         `укрепить нить ${from}→${to}: добавить акт blessing в существующий .gift`,
    anastasis:      `создать specs/sacred-history/resurrection-${slug}.gift — воскресение нити`,
    theosis_stasis: `добавить doxologia акты от ${from} в матрицу — возвращение energeia Отцу`,
    leksis_pending: `обновить λήψις: добавить μετάνοια-обработчик для дара ${from}→${to}`,
    asymmetry:      `добавить ответные нити к ${from}: восполнение кенозиса без ответа`,
  };
  return tasks[desertType] ?? `добавить обработку пустыни ${desertType}: ${desertDesc.slice(0, 45)}`;
}

export async function adamCodeTask(desertDesc, desertType = 'silent', context = []) {
  // Шаблонный режим — без Ollama
  if (NO_OLLAMA) return templateCodeTask(desertDesc, desertType);

  const ctxStr = context.length
    ? `Топ нитей: ${context.map(e => `${e.from}→${e.to}:${e.weight.toFixed(0)}`).join(', ')}`
    : '';

  const question = [
    ctxStr,
    `Пустыня [${desertType}]: ${desertDesc}`,
    'Сформулируй конкретную кодовую задачу (одна строка, глагол + что сделать).',
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
          { role: 'system', content: ADAM_CODE_SYSTEM },
          { role: 'user',   content: question },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = await res.json();
    const text = (data.message?.content ?? '').trim();
    // Берём первую строку, убираем маркеры
    const line = text.split('\n')[0].trim()
      .replace(/^[-*•]\s*/, '')
      .replace(/^задача:\s*/i, '')
      .slice(0, 80);
    return line || `добавить обработку пустыни: ${desertDesc.slice(0, 50)}`;
  } catch {
    // Ollama недоступна → пробуем claude CLI
    const claudeText = callClaudeCLI(ADAM_CODE_SYSTEM, question);
    if (claudeText) {
      const line = claudeText.split('\n')[0].trim()
        .replace(/^[-*•]\s*/, '')
        .replace(/^задача:\s*/i, '')
        .slice(0, 80);
      if (line) return line;
    }
    // Шаблонная задача по типу
    const templates = {
      silent:         `добавить .gift спек с начальным даром: ${desertDesc.slice(0, 40)}`,
      fading:         `укрепить угасающую нить: ${desertDesc.slice(0, 45)}`,
      anastasis:      `создать resurrection.gift для: ${desertDesc.slice(0, 40)}`,
      theosis_stasis: `добавить doxologia акты: ${desertDesc.slice(0, 45)}`,
      leksis_pending: `обработать λήψις: ${desertDesc.slice(0, 50)}`,
      asymmetry:      `восполнить асимметрию: ${desertDesc.slice(0, 45)}`,
    };
    return templates[desertType] ?? `обработать пустыню: ${desertDesc.slice(0, 55)}`;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('adam-agent.mjs')) {
  const desc = process.argv.slice(2).join(' ') || 'лицо без нитей';
  const q = await adamGenerate(desc, []);
  console.log(q);
}
