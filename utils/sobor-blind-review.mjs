#!/usr/bin/env node
/**
 * sobor-blind-review — слепой ревьюер собора (паттерн Cognition/Devin).
 *
 * Контринтуитивный, но эмпирически сильный приём: ревью-агенту НЕ дают спеку/замысел.
 * Он рассуждает НАЗАД от реализации — выводит, что код пытается делать, и судит
 * внутреннюю состоятельность. Так он ловит то, что замылено замыслом: информированный
 * ревьюер видит «соответствует спеке» и рационализирует странность; слепой видит саму
 * странность.
 *
 * Источник идеи: cognition.ai/blog/multi-agents-working («reviewer without shared context
 * reasons backward from the implementation»). Здесь — как линза собора (ворота-3).
 *
 * Два режима:
 *   blindReview(artifact)        — без замысла: вывести интент + найти спец-независимые изъяны
 *   informedReview(artifact,spec)— с замыслом: сверка со спекой
 *   diffReviews(blind, informed) — что слепой поймал сверх информированного (ценность)
 *
 * Офлайн-безопасно: без LLM работает на детерминированной эвристике спец-независимых
 * красных флагов (для CI/тестов).
 *
 * Запуск:
 *   node utils/sobor-blind-review.mjs <файл>            — слепой ревью файла
 *   node utils/sobor-blind-review.mjs --selftest
 */
import { existsSync, readFileSync } from 'node:fs';

let _callLLM = null;
async function llm(system, user, timeout = 40000) {
  if (_callLLM === null) {
    try { _callLLM = (await import('./sobor-coscientist.mjs')).callLLM; }
    catch { _callLLM = false; }
  }
  return _callLLM ? _callLLM(system, user, { timeout }) : null;
}

// ── Спец-независимые красные флаги (эвристика, детерминированно) ──────
// Это изъяны, которые видны БЕЗ знания замысла — именно их ловит слепой ревью.
const RED_FLAGS = [
  { rule: 'empty-catch', re: /catch\s*\([^)]*\)\s*\{\s*\}/, why: 'пустой catch — ошибка глотается молча' },
  { rule: 'swallowed-error', re: /catch\s*\([^)]*\)\s*\{\s*(\/\/[^\n]*)?\s*\}/, why: 'ошибка проглочена' },
  { rule: 'todo-left', re: /\b(TODO|FIXME|XXX|HACK)\b/, why: 'незавершённый маркер в коде' },
  { rule: 'hardcoded-secret', re: /(api[_-]?key|token|password|secret)\s*[:=]\s*['"][^'"]{6,}['"]/i, why: 'похоже на захардкоженный секрет' },
  { rule: 'console-debug', re: /console\.(log|debug)\(/, why: 'отладочный вывод оставлен' },
  { rule: 'eq-eq', re: /[^=!<>]==[^=]/, why: 'нестрогое сравнение == (вероятна ошибка приведения)' },
  { rule: 'always-true', re: /if\s*\(\s*(true|1)\s*\)/, why: 'условие всегда истинно — мёртвая ветка' },
  { rule: 'unreachable-after-return', re: /return[^\n]*\n\s*[^\s}][^\n]*\n/, why: 'возможный код после return' },
];

export function heuristicScan(artifact) {
  const findings = [];
  const lines = String(artifact || '').split('\n');
  for (const f of RED_FLAGS) {
    for (let i = 0; i < lines.length; i++) {
      if (f.re.test(lines[i])) {
        findings.push({ rule: f.rule, line: i + 1, why: f.why, snippet: lines[i].trim().slice(0, 80) });
        break; // одно срабатывание на правило — достаточно как сигнал
      }
    }
  }
  return findings;
}

const BLIND_SYSTEM = `Ты — слепой ревьюер. Тебе НЕ дают замысел/спеку. Перед тобой только артефакт (код/текст).
Рассуждай НАЗАД: сначала выведи, что это, по-твоему, пытается делать (инферированный интент),
потом суди ВНУТРЕННЮЮ состоятельность — без оглядки на чей-то замысел.
Ищи: противоречия, проглоченные ошибки, мёртвые ветки, странности, незавершённое, риск.
Ответь СТРОГО:
ИНТЕНТ: <одна фраза — что это делает>
ИЗЪЯНЫ:
- <изъян 1>
- <изъян 2>
(если изъянов нет — "ИЗЪЯНЫ: нет")`;

const INFORMED_SYSTEM = `Ты — информированный ревьюер. Тебе дан ЗАМЫСЕЛ и артефакт.
Суди: реализует ли артефакт замысел, всё ли покрыто, нет ли расхождения со спекой.
Ответь СТРОГО:
ИЗЪЯНЫ:
- <изъян 1>
(если нет — "ИЗЪЯНЫ: нет")`;

function parseFindings(out) {
  if (!out) return null;
  const idx = out.search(/ИЗЪЯНЫ/i);
  const body = idx >= 0 ? out.slice(idx) : out;
  return body.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim())
    .filter(l => l && !/^ИЗЪЯНЫ/i.test(l) && !/^нет$/i.test(l) && l.length > 4);
}

/** Слепой ревью: без замысла. Возвращает {inferredIntent, findings, mode}. */
export async function blindReview(artifact) {
  const out = await llm(BLIND_SYSTEM, `Артефакт:\n${artifact}`);
  if (out) {
    const intentLine = out.split('\n').find(l => /ИНТЕНТ/i.test(l));
    return {
      mode: 'llm',
      inferredIntent: intentLine ? intentLine.replace(/.*ИНТЕНТ:\s*/i, '').trim() : null,
      findings: (parseFindings(out) || []).map(f => ({ rule: 'reasoned', why: f })),
    };
  }
  // офлайн: спец-независимые красные флаги
  return { mode: 'heuristic', inferredIntent: null, findings: heuristicScan(artifact) };
}

/** Информированный ревью: со спекой. Возвращает {findings, mode}. */
export async function informedReview(artifact, spec) {
  const out = await llm(INFORMED_SYSTEM, `Замысел: ${spec}\n\nАртефакт:\n${artifact}`);
  if (out) return { mode: 'llm', findings: (parseFindings(out) || []).map(f => ({ rule: 'spec', why: f })) };
  // офлайн: информированный сверяет наличие ключевых слов спеки в артефакте (грубо)
  const missing = String(spec || '').toLowerCase().split(/\W+/).filter(w => w.length > 4)
    .filter(w => !String(artifact).toLowerCase().includes(w)).slice(0, 3);
  return { mode: 'heuristic', findings: missing.map(w => ({ rule: 'spec', why: `спека упоминает «${w}», в артефакте не найдено` })) };
}

/** Что слепой поймал сверх информированного — главная ценность приёма. */
export function diffReviews(blind, informed) {
  const infoText = (informed.findings || []).map(f => f.why.toLowerCase());
  const onlyBlind = (blind.findings || []).filter(b =>
    !infoText.some(t => t.includes(b.why.toLowerCase().slice(0, 20)) || b.why.toLowerCase().includes(t.slice(0, 20))));
  return { onlyBlind, blindCount: (blind.findings || []).length, informedCount: (informed.findings || []).length };
}

// ── CLI / самопроверка ───────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) {
    // артефакт со спец-независимым изъяном, которого нет в спеке
    const code = `function save(data) {
  try { db.write(data); } catch (e) {}
  console.log("saved");
  return true;
}`;
    const spec = 'функция сохраняет данные в базу и возвращает результат';
    const blind = await blindReview(code);
    const informed = await informedReview(code, spec);
    const d = diffReviews(blind, informed);
    console.log('Слепой ревью (режим:', blind.mode + '):');
    blind.findings.forEach(f => console.log('  ✗', f.rule, '—', f.why));
    console.log('Информированный (режим:', informed.mode + '):', informed.findings.length, 'изъянов');
    console.log('\nСлепой поймал СВЕРХ информированного:', d.onlyBlind.length);
    d.onlyBlind.forEach(f => console.log('  →', f.why));
    // слепой должен поймать пустой catch — спека про него молчит
    const caughtEmptyCatch = blind.findings.some(f => f.rule === 'empty-catch' || /catch|ошибк/i.test(f.why));
    console.log(caughtEmptyCatch ? '\n✓ selftest passed (слепой ловит спец-независимый изъян)' : '\n✗ selftest FAILED');
    process.exit(caughtEmptyCatch ? 0 : 1);
  }
  const file = process.argv[2];
  if (!file || !existsSync(file)) { console.log('Использование: node utils/sobor-blind-review.mjs <файл> | --selftest'); process.exit(0); }
  const artifact = readFileSync(file, 'utf8');
  const blind = await blindReview(artifact);
  console.log(`Слепой ревью ${file} (режим: ${blind.mode}):`);
  if (blind.inferredIntent) console.log('  инферированный интент:', blind.inferredIntent);
  if (!blind.findings.length) console.log('  изъянов не найдено');
  for (const f of blind.findings) console.log(`  ✗ [${f.rule}]${f.line ? ' стр.' + f.line : ''} ${f.why}`);
}
