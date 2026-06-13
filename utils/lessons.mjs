#!/usr/bin/env node
/**
 * lessons.mjs — память-РЕФЛЕКС кентавра (7-й слой памяти).
 *
 * Шесть слоёв памяти проекта — АРХИВ (W-веса, soul, insights, jsonl, auto-memory, GitHub):
 * пассивны, извлекаются по запросу. Этот слой — ПРОЦЕДУРНЫЙ: выстраданное РЕШЕНИЕ
 * («в ситуации X делай Y, не Z») срабатывает САМО в точке действия — через PreToolUse-хук
 * lesson-guard.mjs, который матчит предстоящий вызов против правил и впрыскивает/блокирует.
 *
 * Это анамнезис-как-ПРИСУТСТВИЕ, не анамнезис-как-архив: прошлое решение действует СЕЙЧАС,
 * у престола действия. Кентавр надёжен не когда ИИ «старается помнить», а когда среда
 * ПРИНУЖДАЕТ ранее принятое решение (тот же принцип, что вето дрона и заземление арены:
 * не доверяй памяти модели — принуждай кодом).
 *
 * Правило: { id, trigger, match:{tools:[],pattern:"regex"}, avoid, do, why, weight, enforce:"warn"|"block" }
 *
 * CLI:
 *   node utils/lessons.mjs list
 *   node utils/lessons.mjs add --id <id> --trigger "..." --tools Bash --pattern "regex" --avoid "..." --do "..." --why "..." [--enforce warn|block] [--weight N]
 *   node utils/lessons.mjs match --tool Bash --input "<команда>"     # что сработает
 *   node utils/lessons.mjs rm --id <id>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LESSONS_PATH = resolve(ROOT, 'data/lessons.json');

export function loadLessons() {
  if (!existsSync(LESSONS_PATH)) return [];
  try { const d = JSON.parse(readFileSync(LESSONS_PATH, 'utf8')); return Array.isArray(d) ? d : (d.lessons || []); }
  catch { return []; }
}
export function saveLessons(lessons) {
  writeFileSync(LESSONS_PATH, JSON.stringify(lessons, null, 2) + '\n');
}

export function addLesson(rule) {
  const lessons = loadLessons();
  const i = lessons.findIndex(l => l.id === rule.id);
  const full = {
    id: rule.id, trigger: rule.trigger || '', avoid: rule.avoid || '', do: rule.do || '',
    why: rule.why || '', weight: rule.weight ?? 5, enforce: rule.enforce === 'block' ? 'block' : 'warn',
    match: { tools: rule.match?.tools || [], pattern: rule.match?.pattern || '' },
  };
  if (i >= 0) lessons[i] = full; else lessons.push(full);
  saveLessons(lessons);
  return full;
}
export function removeLesson(id) {
  const lessons = loadLessons().filter(l => l.id !== id);
  saveLessons(lessons);
}

/**
 * Чистая функция матча: какие правила относятся к предстоящему действию.
 * Совпадение, если (нет фильтра tools ИЛИ tool в списке) И (нет pattern ИЛИ pattern найден в haystack).
 * haystack = tool + сериализованный input (команда Bash, путь и т.п.).
 */
export function matchLessons(toolName, toolInput, lessons = loadLessons()) {
  const hay = `${toolName || ''} ${typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {})}`;
  const out = [];
  for (const l of lessons) {
    const tools = l.match?.tools || [];
    if (tools.length && !tools.includes(toolName)) continue;
    const pat = l.match?.pattern || '';
    if (pat) {
      let re; try { re = new RegExp(pat, 'i'); } catch { continue; }
      if (!re.test(hay)) continue;
    }
    out.push(l);
  }
  return out.sort((a, b) => (b.weight || 0) - (a.weight || 0));
}

// ── CLI ───────────────────────────────────────────────────────────────
function arg(a, n, d) { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; }
const C = { dim: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', g: '\x1b[32m', r: '\x1b[31m', x: '\x1b[0m' };

export function run(argv) {
  const [cmd, ...a] = argv;
  if (cmd === 'list' || !cmd) {
    const ls = loadLessons();
    console.log(`${C.b}Уроки-рефлексы (${ls.length}):${C.x}`);
    for (const l of ls) {
      const tag = l.enforce === 'block' ? `${C.r}[БЛОК]${C.x}` : `${C.y}[напомнить]${C.x}`;
      console.log(`  ${tag} ${C.b}${l.id}${C.x} ${C.dim}(вес ${l.weight}, ${l.match.tools.join(',') || '*'})${C.x}`);
      console.log(`     триггер: ${l.trigger}`);
      console.log(`     ${C.r}не:${C.x} ${l.avoid}   ${C.g}а:${C.x} ${l.do}`);
    }
    return;
  }
  if (cmd === 'add') {
    const r = addLesson({
      id: arg(a, '--id'), trigger: arg(a, '--trigger'),
      match: { tools: (arg(a, '--tools', '') || '').split(',').filter(Boolean), pattern: arg(a, '--pattern', '') },
      avoid: arg(a, '--avoid'), do: arg(a, '--do'), why: arg(a, '--why'),
      enforce: arg(a, '--enforce', 'warn'), weight: Number(arg(a, '--weight', '5')),
    });
    console.log(`${C.g}✓${C.x} урок ${r.id} записан (${r.enforce})`);
    return;
  }
  if (cmd === 'match') {
    const m = matchLessons(arg(a, '--tool'), arg(a, '--input', ''));
    console.log(m.length ? `Сработает ${m.length}:` : 'Ничего не сработает');
    for (const l of m) console.log(`  ${l.enforce === 'block' ? '⛔' : '⚠'} ${l.id}: ${l.do}`);
    return;
  }
  if (cmd === 'rm') { removeLesson(arg(a, '--id')); console.log('удалён'); return; }
  console.log('Использование: lessons.mjs list|add|match|rm');
}

if (import.meta.url === `file://${process.argv[1]}`) run(process.argv.slice(2));
