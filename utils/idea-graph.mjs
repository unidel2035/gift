#!/usr/bin/env node
/**
 * idea-graph.mjs — апофатический двойник W: граф идей, развилок, недоделок из следа сессий.
 *
 * W хранит дары СОВЕРШЁННЫЕ; этот орган — дары ЗАМЫСЛЕННЫЕ (идеи), РАЗВИЛКИ (выборы) и
 * НЕДОДЕЛКИ (планы без исполнения = temporal fiктивность, Σ≠0 во времени). Майнит jsonl-след
 * (686 серий) по лексическим маркерам, связывает узлы, помечает статус: open/closed.
 *
 * Замыкание петли: идея «закрыта», если позже встречается её исполнение (коммит/«готово/
 * сделал/запушено») в той же или последующей серии. Открытые = недоделки (клиффхэнгеры).
 *
 * Чистые экстракторы тестируемы без диска. См. specs/apophatic-memory-idea-graph.gift.
 *
 * CLI:
 *   gift ideas               — открытые недоделки (висящие нити), свежие сверху
 *   gift ideas --all         — весь граф (идеи/развилки/планы)
 *   gift ideas forks         — только развилки (дороги не пройденные)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRACE_DIR = process.env.GIFT_TRACE_DIR
  || resolve(process.env.HOME || '/home/unidel', '.claude/projects/-home-unidel-gift');

// Маркеры (на репликах человека И ассистента — замысел рождается в диалоге).
const M = {
  plan:   /(давай (?:с)?делаем|нужно (?:с)?делать|план[:\s]|следующ\w+ шаг|потом (?:сделаю|вернёмся)|надо бы|стоит (?:сделать|добавить))/i,
  idea:   /(идея[:\s]|можно было бы|что если|а если|предлагаю|можно (?:вынести|сделать|добавить)|стоило бы)/i,
  fork:   /(или\b.{0,40}\bили|развилк|два (?:пути|варианта)|вместо .{0,30} можно|можно и так и так|либо .{0,30} либо)/i,
  done:   /(готово|сделал|сделано|запушено|закоммитил|реализова|закрыт|влит|done|тесты .*(зелён|pass)|✓)/i,
  drop:   /(не нужно|забей|отложим|потом|неважно|отмен|бросил|не будем)/i,
};

/** Достать текст реплики (user или assistant) из строки jsonl. */
export function turnText(line) {
  let o; try { o = JSON.parse(line); } catch { return null; }
  const role = o.type || o.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const c = o.message?.content ?? o.content ?? o.text;
  let t = typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p.text || '').join(' ') : '';
  t = (t || '').trim();
  if (!t || t.startsWith('[')) return null;
  // отсечь инъекции агент-персон (суб-сессии Адам/Ева/собор), это не замыслы диалога
  if (/^Ты\s+[А-ЯЁ]\w*\s*[—-]|^Ты\s+—|первый агент|точильный камень|Онтологии Дара\. Ты /.test(t)) return null;
  return { role, text: t };
}

/** Классифицировать реплику в тип узла (чистая). null если не узел. */
export function classify(text) {
  if (M.fork.test(text)) return 'fork';
  if (M.plan.test(text)) return 'plan';
  if (M.idea.test(text)) return 'idea';
  return null;
}
export const isClosure = (text) => M.done.test(text);
export const isDrop = (text) => M.drop.test(text);

/** Майнить один транскрипт → узлы {type, text, role, line}. Чистый разбор массива строк. */
export function mineLines(lines) {
  const nodes = []; let closures = 0;
  lines.forEach((ln, i) => {
    if (!ln) return;
    const t = turnText(ln); if (!t) return;
    if (isClosure(t.text)) closures++;
    const type = classify(t.text);
    if (type) nodes.push({ type, role: t.role, text: t.text.replace(/\s+/g, ' ').slice(0, 100), line: i });
  });
  return { nodes, closures };
}

/**
 * Статус узла: open (недоделка) если после него в серии НЕ было закрытия рядом.
 * Грубая эвристика на одну серию: план «закрыт», если позже встречается closure-маркер.
 */
function markStatus(nodes, lines) {
  // индексы строк-закрытий
  const closeAt = [];
  lines.forEach((ln, i) => { const t = turnText(ln); if (t && isClosure(t.text)) closeAt.push(i); });
  return nodes.map(n => {
    if (isDrop(n.text)) return { ...n, status: 'dropped' };
    const closedAfter = closeAt.some(c => c > n.line);   // было исполнение после замысла
    return { ...n, status: closedAfter ? 'closed' : 'open' };
  });
}

export function buildGraph({ limitFiles = 0 } = {}) {
  if (!existsSync(TRACE_DIR)) return [];
  let files = readdirSync(TRACE_DIR).filter(f => f.endsWith('.jsonl'))
    .map(f => resolve(TRACE_DIR, f))
    .sort((a, b) => statSync(b).mtime - statSync(a).mtime);
  if (limitFiles) files = files.slice(0, limitFiles);
  const out = [];
  for (const f of files) {
    let lines = [];
    try { lines = readFileSync(f, 'utf8').split('\n'); } catch { continue; }
    const { nodes } = mineLines(lines);
    for (const n of markStatus(nodes, lines))
      out.push({ ...n, episode: basename(f).slice(0, 8), date: statSync(f).mtime });
  }
  return out.sort((a, b) => b.date - a.date);
}

// ── CLI ───────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' };
const ICON = { plan: '▸', idea: '◆', fork: '⑂' };
const SCOL = { open: C.r, closed: C.dim, dropped: C.dim };
function fmtDate(d) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' }).format(d); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const sub = process.argv[2];
  // последние ~40 серий хватает для живого графа; --all = больше
  const g = buildGraph({ limitFiles: process.argv.includes('--all') ? 0 : 40 });
  let rows = g;
  let title = 'Граф идей (апофатический двойник W)';
  if (sub === 'forks') { rows = g.filter(n => n.type === 'fork'); title = 'Развилки (дороги не пройденные)'; }
  else if (!process.argv.includes('--all')) { rows = g.filter(n => n.status === 'open' && n.type !== 'idea'); title = 'Открытые недоделки (висящие нити)'; }
  console.log(`\n${C.b}${C.y}═══ ${title} ═══${C.x}`);
  const counts = g.reduce((m, n) => (m[n.status] = (m[n.status] || 0) + 1, m), {});
  const seen = new Set();
  rows = rows.filter(n => { const k = n.text.slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; });
  for (const n of rows.slice(0, 40)) {
    console.log(`  ${SCOL[n.status] || ''}${ICON[n.type] || '·'} ${n.text}${C.x} ${C.dim}${fmtDate(n.date)} ${n.episode} [${n.status}]${C.x}`);
  }
  console.log(`\n${C.dim}всего: open=${counts.open || 0} closed=${counts.closed || 0} dropped=${counts.dropped || 0} · открытые = недоделки = temporal fiктивность (Σ≠0)${C.x}\n`);
}
