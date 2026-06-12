#!/usr/bin/env node
/**
 * gift-team — единая среда командного кодинга (люди + агенты как один организм).
 *
 * Сводит в один поток то, что было разрозненным, и добавляет логику недели:
 *   ПРИСУТСТВИЕ   — кто в общем настоящем сейчас (сессии, heartbeat) — gift-swarm
 *   НАМЕРЕНИЕ     — объяви, что трогаешь, до записи (стигмергия) — gift-swarm-intent
 *   ОРГАНЫ        — зоны владения (ZONES.md), компоновать не merge-ить
 *   РЕВЮ-ВОРОТА   — слепой ревьюер + испытание реальностью (вердикт)
 *   СПЕКУЛЯЦИЯ    — параллельные реализации, реальность выбирает
 *   АКТ           — вход/помощь пишутся в матрицу W (необратимо, с автором)
 *
 * «Много консолей — один ум»: лёгкость персональна (своя сессия), общими — присутствие
 * и память. παρουσία > ἀνάμνησις: общее настоящее, а не только общий архив.
 *
 * Использование:
 *   gift team join [--as Имя] [--organ зона]   — войти в общее настоящее
 *   gift team status                            — кто здесь, намерения, конфликты, органы
 *   gift team intent <файлы...>                 — объявить намерение перед записью
 *   gift team zone <файл>                       — чей это орган
 *   gift team review <файл> [--trial "cmd"]     — слепой ревьюер + испытание → вердикт
 *   gift team speculate --candidates impl.json  — спекулятивный турнир
 *   gift team leave                             — выйти из настоящего
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  registerSession, heartbeat, deregisterSession, listActiveSessions, detectConflicts,
} from './gift-swarm.mjs';
import { declareIntent, clearIntent, allIntentions } from './gift-swarm-intent.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZONES_PATH = resolve(ROOT, 'ZONES.md');
const C = { dim: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', g: '\x1b[32m', c: '\x1b[36m', m: '\x1b[35m', r: '\x1b[31m', x: '\x1b[0m' };

// Федерация органов-репозиториев: живое настоящее всего тела, не одной консоли.
// Переопределяется data/team-federation.json (массив {label, repo}).
const FEDERATION = (() => {
  const f = resolve(ROOT, 'data/team-federation.json');
  if (existsSync(f)) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { /* дефолт */ } }
  return [{ label: 'integram', repo: 'judas-priest/integram' }];
})();

function actor() { return process.env.GIFT_AGENT_ID || process.env.ORGANISM_ACTOR || process.env.USER || 'аноним'; }

// ── Органы (ZONES.md) ────────────────────────────────────────────────
export function parseZones(text = '') {
  const zones = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*-\s+(.+?)\s*→\s*(.+?)\s*$/);
    if (!m) continue;
    const prefixes = m[1].split(',').map(s => s.trim().replace(/\*+$/, '')).filter(Boolean);
    zones.push({ prefixes, owner: m[2].trim() });
  }
  return zones;
}
export function zoneOf(filePath, zones) {
  const rel = relative(ROOT, resolve(ROOT, filePath)).replace(/\\/g, '/');
  let best = null;
  for (const z of zones) for (const p of z.prefixes) {
    if (rel.startsWith(p) && (!best || p.length > best.len)) best = { owner: z.owner, prefix: p, len: p.length };
  }
  return best ? { owner: best.owner, prefix: best.prefix } : { owner: null, prefix: null };
}
function loadZones() { return existsSync(ZONES_PATH) ? parseZones(readFileSync(ZONES_PATH, 'utf8')) : []; }

// ── Акт в W (необратимо, с автором) ──────────────────────────────────
function recordAct(desc, receiver = '_koinon', weight = 2) {
  try {
    spawnSync('node', [resolve(ROOT, 'utils/claude-gift.mjs'), desc, receiver, String(weight)],
      { cwd: ROOT, stdio: 'ignore', timeout: 15000 });
  } catch { /* матрица недоступна — присутствие всё равно работает */ }
}

// ── Команды ──────────────────────────────────────────────────────────
function cmdJoin(args) {
  const me = argOf(args, '--as') || actor();
  const organ = argOf(args, '--organ');
  registerSession(me, organ ? { organ } : {});
  recordAct(`вошёл в общее настоящее gift team${organ ? ' (орган: ' + organ + ')' : ''}`, '_koinon', 2);
  console.log(`${C.g}✓${C.x} ${C.b}${me}${C.x} в общем настоящем${organ ? ` · орган: ${C.m}${organ}${C.x}` : ''}`);
  cmdStatus([]);
}

function cmdLeave() {
  const me = actor();
  deregisterSession(me); clearIntent(me);
  recordAct('вышел из общего настоящего gift team', '_koinon', 1);
  console.log(`${C.dim}${me} вышел из настоящего${C.x}`);
}

function cmdStatus() {
  const all = listActiveSessions();
  const sessions = all.filter(s => !s.stale);   // присутствие не лжёт: протухших не показываем как «здесь»
  const stale = all.filter(s => s.stale);
  const intents = allIntentions();
  const conflicts = detectConflicts();
  const zones = loadZones();

  console.log(`\n${C.b}${C.y}═══ Общее настоящее · gift team ═══${C.x}`);
  // присутствие (только живые: heartbeat свежее 120с)
  console.log(`\n${C.b}Кто здесь сейчас (${sessions.length}):${C.x}`);
  if (!sessions.length) console.log(`  ${C.dim}— пусто (никто не вошёл: gift team join)${C.x}`);
  for (const s of sessions) {
    const ago = Math.round((Date.now() - s.heartbeat) / 1000);
    const organ = s.metadata?.organ;
    console.log(`  ${C.g}●${C.x} ${C.b}${s.agent}${C.x}${organ ? ` ${C.m}[${organ}]${C.x}` : ''} ${C.dim}${ago}с назад${C.x}`);
  }
  if (stale.length) console.log(`  ${C.dim}(${stale.length} протухших — молчат >120с, не считаются присутствующими)${C.x}`);
  // намерения
  console.log(`\n${C.b}Открытые намерения:${C.x}`);
  if (!intents.length) console.log(`  ${C.dim}— нет${C.x}`);
  for (const it of intents) {
    const files = (it.files || []).map(f => {
      const z = zoneOf(f, zones);
      return z.owner ? `${f} ${C.dim}(${z.owner})${C.x}` : f;
    }).join(', ');
    console.log(`  ${C.c}→${C.x} ${C.b}${it.agent}${C.x}: ${files}`);
  }
  // конфликты
  if (conflicts && conflicts.length) {
    console.log(`\n${C.b}${C.r}Конфликты (пересечение в органе):${C.x}`);
    for (const cf of conflicts) console.log(`  ${C.r}✗${C.x} ${cf.file || cf.path}: ${(cf.agents || []).join(' × ')}`);
  }
  // органы
  console.log(`\n${C.b}Органы (ZONES.md):${C.x}`);
  for (const z of zones) console.log(`  ${C.m}${z.owner}${C.x} ${C.dim}← ${z.prefixes.join(', ')}${C.x}`);
  console.log('');
}

function cmdIntent(args) {
  const files = args.filter(a => !a.startsWith('--'));
  if (!files.length) { console.log('Использование: gift team intent <файлы...>'); return; }
  const zones = loadZones();
  declareIntent(files, { agent: actor() });
  console.log(`${C.c}→${C.x} ${actor()} объявил намерение: ${files.join(', ')}`);
  // предупреждение о чужом органе (координация доверием, не блок)
  for (const f of files) {
    const z = zoneOf(f, zones);
    if (z.owner && z.owner !== actor()) console.log(`  ${C.y}⚠ ${f} — орган ${z.owner}. Согласуй на шве.${C.x}`);
  }
}

function cmdZone(args) {
  const f = args.find(a => !a.startsWith('--'));
  if (!f) { console.log('Использование: gift team zone <файл>'); return; }
  const z = zoneOf(f, loadZones());
  console.log(z.owner ? `${f} → орган ${C.m}${z.owner}${C.x} ${C.dim}(${z.prefix})${C.x}` : `${f} → ${C.dim}вне органов${C.x}`);
}

async function cmdReview(args) {
  const file = args.find(a => !a.startsWith('--'));
  if (!file || !existsSync(file)) { console.log('Использование: gift team review <файл> [--trial "cmd"]'); return; }
  const code = readFileSync(file, 'utf8');
  const { blindReview } = await import('./sobor-blind-review.mjs');
  console.log(`${C.b}Слепой ревьюер (рассуждает назад, не зная замысла):${C.x}`);
  const blind = await blindReview(code);
  if (blind.inferredIntent) console.log(`  ${C.dim}интент:${C.x} ${blind.inferredIntent}`);
  for (const f of blind.findings) console.log(`  ${C.r}✗${C.x} ${f.why}`);
  if (!blind.findings.length) console.log(`  ${C.g}изъянов не найдено${C.x}`);

  const trialCmd = argOf(args, '--trial');
  let trial = null;
  if (trialCmd) {
    const { makeTrialRunner } = await import('./sobor-trial-judge.mjs');
    trial = makeTrialRunner()({ id: file, trial: { cmd: trialCmd, dir: dirname(resolve(file)) } });
    console.log(`${C.b}Испытание реальностью:${C.x} ${trial.passed ? C.g + 'прошло' : C.r + 'провалено'}${C.x} (exit ${trial.exit})`);
  }
  // вердикт
  const verdict = trial && !trial.passed ? 'reject'
    : blind.findings.some(f => f.rule === 'unconditional-success') ? 'reject'
      : blind.findings.length ? 'open' : 'affirm';
  const col = verdict === 'affirm' ? C.g : verdict === 'reject' ? C.r : C.y;
  console.log(`\n${C.b}Вердикт ворот:${C.x} ${col}${verdict}${C.x} ${C.dim}(находок: ${blind.findings.length}, by: opponent-blind)${C.x}`);
}

async function cmdSpeculate(args) {
  const cf = argOf(args, '--candidates');
  if (!cf || !existsSync(cf)) { console.log('Использование: gift team speculate --candidates impl.json'); return; }
  const { speculate } = await import('./sobor-speculative.mjs');
  const impls = JSON.parse(readFileSync(cf, 'utf8'));
  const res = await speculate(argOf(args, '--task') || 'реализация', impls, { log: true });
  console.log(`\nПрошли: ${res.passed.map(p => p.id).join(', ') || '—'} | Провалили: ${res.failed.map(p => p.id).join(', ') || '—'}`);
  console.log(`${C.g}🏆 Реальность выбрала:${C.x} ${C.b}${res.winner.id}${C.x} ${res.winner.label || ''}`);
}

// ── Живое настоящее федерации (через gh напрямую к GitHub, не локальный снимок) ──
export function relTimeFrom(iso, now) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}с`;
  const m = Math.round(s / 60); if (m < 90) return `${m}м`;
  const h = Math.round(m / 60); if (h < 36) return `${h}ч`;
  return `${Math.round(h / 24)}д`;
}
const relTime = iso => relTimeFrom(iso, Date.now());

/** Чистый форматтер живого настоящего репо → строки. Тестируемо без сети. */
export function summarizePresent({ label, prs = [], commits = [], ok = true }, now = Date.now()) {
  const lines = [];
  if (!ok) { lines.push(`  ${C.dim}— gh недоступен${C.x}`); return lines; }
  const open = prs.filter(p => p.state === 'OPEN');
  if (open.length) {
    lines.push(`  ${C.b}Открытые PR (${open.length}):${C.x}`);
    for (const p of open.slice(0, 6)) lines.push(`    ${C.c}#${p.number}${C.x} ${p.title} ${C.dim}${relTimeFrom(p.updatedAt, now)} назад${C.x}`);
  }
  if (commits.length) {
    lines.push(`  ${C.b}Свежие коммиты:${C.x}`);
    for (const cmt of commits.slice(0, 4)) lines.push(`    ${C.dim}${cmt.sha?.slice(0, 7)} ${relTimeFrom(cmt.date, now)} назад${C.x} ${cmt.msg?.split('\n')[0].slice(0, 64)}`);
  }
  if (!open.length && !commits.length) lines.push(`  ${C.dim}— тихо${C.x}`);
  return lines;
}

function gh(args, timeout = 12000) {
  try {
    const r = spawnSync('gh', args, { encoding: 'utf8', timeout, maxBuffer: 8e6 });
    if (r.status !== 0) return null;
    return JSON.parse(r.stdout);
  } catch { return null; }
}

function fetchRepoPresent(repo) {
  const prs = gh(['pr', 'list', '-R', repo, '--state', 'open', '--limit', '10', '--json', 'number,title,state,updatedAt']);
  const commitsRaw = gh(['api', `repos/${repo}/commits?per_page=4`, '--jq', '[.[]|{sha:.sha,msg:.commit.message,date:.commit.committer.date}]']);
  return { prs: prs || [], commits: commitsRaw || [], ok: prs !== null || commitsRaw !== null };
}

function cmdPresent() {
  // локальное присутствие — как в status, кратко
  const sessions = listActiveSessions().filter(s => !s.stale);
  console.log(`\n${C.b}${C.y}═══ Живое настоящее тела ═══${C.x}`);
  console.log(`\n${C.b}Здесь (эта консоль), сейчас:${C.x} ${sessions.length ? sessions.map(s => s.agent).join(', ') : C.dim + 'пусто' + C.x}`);
  // федерация — живое состояние других органов-репозиториев
  for (const org of FEDERATION) {
    console.log(`\n${C.b}${C.m}▸ ${org.label}${C.x} ${C.dim}(${org.repo})${C.x}`);
    for (const line of summarizePresent({ label: org.label, ...fetchRepoPresent(org.repo) })) console.log(line);
  }
  console.log('');
}

// ── утиль + диспетчер ────────────────────────────────────────────────
function argOf(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }

export async function run(argv) {
  const [sub, ...args] = argv;
  // Любое касание team-CLI обновляет присутствие (no-op, если не вошёл) — чтобы
  // активный кентавр не «протухал», пока работает. join/leave управляют сами.
  if (sub && !['join', 'leave', 'heartbeat'].includes(sub)) { try { heartbeat(actor()); } catch { /* не вошёл */ } }
  switch (sub) {
    case 'join': return cmdJoin(args);
    case 'leave': return cmdLeave();
    case 'status': case undefined: return cmdStatus(args);
    case 'intent': return cmdIntent(args);
    case 'zone': return cmdZone(args);
    case 'review': return cmdReview(args);
    case 'speculate': return cmdSpeculate(args);
    case 'present': return cmdPresent();
    case 'heartbeat': return heartbeat(actor());
    default:
      console.log(`gift team — командное кодирование как организм
  join [--as Имя] [--organ зона]   войти в общее настоящее
  status                            кто здесь, намерения, конфликты, органы
  intent <файлы...>                 объявить намерение перед записью
  zone <файл>                       чей это орган
  present                           живое настоящее всего тела (PR+коммиты федерации)
  review <файл> [--trial "cmd"]     слепой ревьюер + испытание → вердикт
  speculate --candidates f.json     спекулятивный турнир (реальность выбирает)
  leave                             выйти из настоящего`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(process.argv.slice(2));
}
