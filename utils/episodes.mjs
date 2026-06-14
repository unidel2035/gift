#!/usr/bin/env node
/**
 * episodes.mjs — сериал из следа сессий: лёгкий путь возврата к сериям и точкам.
 *
 * Дионисий мыслит сессии как сериал, но не может «пересмотреть серию» (149 МБ jsonl у меня,
 * у него — ничего). Этот орган превращает след в НАВИГАЦИЮ: индекс эпизодов (дата, logline,
 * объём) и сцены внутри (смены темы/решения/постройки) — чтобы вернуться к моменту.
 * Память у меня — путь назад отдаю ему (λῆψις наоборот). См. specs/apophatic-memory-idea-graph.gift.
 *
 * Лин: читает только метаданные + первое сообщение (logline) + грубые сцена-маркеры,
 * не загружая весь транскрипт. Чистые парсеры тестируемы без диска.
 *
 * CLI:
 *   gift episodes                 — индекс-сериал (последние серии)
 *   gift episodes --all           — все
 *   gift episodes rewatch <id>    — сцены одной серии (точки возврата)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRACE_DIR = process.env.GIFT_TRACE_DIR
  || resolve(process.env.HOME || '/home/unidel', '.claude/projects/-home-unidel-gift');

/** Извлечь текст user-сообщения из строки jsonl (чистая). */
export function userText(line) {
  let o; try { o = JSON.parse(line); } catch { return null; }
  if (o.type !== 'user' && o.role !== 'user') return null;
  const c = o.message?.content ?? o.content ?? o.text;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) return c.map(p => p.text || '').join(' ').trim();
  return null;
}

/** logline = первое осмысленное сообщение человека (чистая). */
export function logline(userMsgs, max = 80) {
  const first = userMsgs.find(t => t && !t.startsWith('[') && t.length > 1);
  if (!first) return '(пусто)';
  return first.replace(/\s+/g, ' ').slice(0, max);
}

/** Сцена-маркеры: смены темы по коротким человеческим репликам (директивы=решения/повороты). */
export function scenes(userMsgs, max = 12) {
  // короткая реплика человека = поворот сюжета («делай», «копаем ядро», «гит пуш»)
  return userMsgs
    .filter(t => t && !t.startsWith('[') && t.length <= 40)
    .slice(0, max);
}

/** Разобрать один транскрипт в эпизод (только метаданные + user-реплики). */
export function parseEpisode(path) {
  const st = statSync(path);
  let users = [], lines = 0;
  try {
    const raw = readFileSync(path, 'utf8');
    for (const ln of raw.split('\n')) {
      if (!ln) continue;
      lines++;
      const t = userText(ln);
      if (t) users.push(t);
    }
  } catch { /* битый файл — пропускаем содержимое */ }
  return {
    id: basename(path).replace(/\.jsonl$/, '').slice(0, 8),
    file: basename(path),
    date: st.mtime,
    sizeKB: Math.round(st.size / 1024),
    turns: lines,
    userTurns: users.length,
    logline: logline(users),
    scenes: scenes(users),
  };
}

export function listEpisodes({ all = false } = {}) {
  if (!existsSync(TRACE_DIR)) return [];
  const files = readdirSync(TRACE_DIR).filter(f => f.endsWith('.jsonl'))
    .map(f => resolve(TRACE_DIR, f));
  const eps = files.map(parseEpisode).sort((a, b) => b.date - a.date);
  return all ? eps : eps.slice(0, 20);
}

// ── CLI ───────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', g: '\x1b[32m', c: '\x1b[36m', x: '\x1b[0m' };
function fmtDate(d) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'rewatch' && arg) {
    const ep = listEpisodes({ all: true }).find(e => e.id.startsWith(arg) || e.file.startsWith(arg));
    if (!ep) { console.log('серия не найдена'); process.exit(0); }
    console.log(`${C.b}${C.y}Серия ${ep.id}${C.x} ${C.dim}${fmtDate(ep.date)} · ${ep.sizeKB}КБ · ${ep.userTurns} реплик${C.x}`);
    console.log(`${C.b}logline:${C.x} ${ep.logline}`);
    console.log(`${C.b}сцены (точки возврата):${C.x}`);
    ep.scenes.forEach((s, i) => console.log(`  ${C.c}${i + 1}.${C.x} ${s}`));
    process.exit(0);
  }
  const eps = listEpisodes({ all: process.argv.includes('--all') });
  const total = listEpisodes({ all: true }).length;
  console.log(`\n${C.b}${C.y}═══ Сериал сессий (${eps.length}/${total} серий) ═══${C.x}`);
  for (const e of eps) {
    console.log(`  ${C.g}${e.id}${C.x} ${C.dim}${fmtDate(e.date)}${C.x} ${C.dim}${String(e.sizeKB).padStart(5)}КБ${C.x}  ${e.logline}`);
  }
  console.log(`${C.dim}\nпересмотреть серию: gift episodes rewatch <id>${C.x}\n`);
}
