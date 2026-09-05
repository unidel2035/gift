#!/usr/bin/env node
/**
 * self-dev.mjs — режим саморазвития gift.
 *
 * Замкнутый контур, в котором gift CLI сам себя:
 *   1. ПРОБЛЕМАТИЗИРУЕТ  — снимает своё состояние (V-функция, тесты, proposals,
 *                          пустыни матрицы, метанойи) и формулирует самую
 *                          болезненную проблему как цель;
 *   2. ОЗАДАЧИВАЕТ      — GoalEngine.create() (проблема становится целью),
 *                          предложение логируется в proposals.json;
 *   3. РЕШАЕТ           — gift goal run: цикл plan→act→test→review→μετάνοια;
 *   4. РЕФЛЕКСИРУЕТ     — итог (включая метанойи) в insights.json и матрицу W.
 *
 * Проблематизация двухступенчатая:
 *   - детерминистская часть (findPains): сбор фактов без LLM — падающие тесты,
 *     pending-предложения, V-регресс, заброшенные пустыни, паузы в goals;
 *   - семантическая часть (claude --print): выбор самой болезненной проблемы
 *     из фактов и перевод её в objective + измеримый success-criteria.
 *
 * Ограничители саморазвития (чтобы не превратилось в саморазрушение):
 *   --max N          максимум итераций goal-цикла (default 6)
 *   --budget T       токен-бюджет на цель
 *   --dry-run        только проблематизация, без создания цели и прогона
 *   --no-run         создать цель, но не запускать (запуск вручную)
 *   --guard PATH     файлы/пути, которые нельзя трогать (default: критичное ядро)
 *
 * Использование:
 *   node utils/self-dev.mjs                 — полный цикл
 *   node utils/self-dev.mjs --dry-run       — только проблематизация (печать)
 *   node utils/self-dev.mjs --no-run        — создать цель и выйти
 *   node utils/self-dev.mjs --pains         — показать боли и выйти
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { GoalEngine } from '../src/goals/GoalEngine.js';
import { ClaudeExecutor } from '../src/goals/ClaudeExecutor.js';
import { MatrixRecorder } from '../src/goals/MatrixRecorder.js';
import { computeValue } from './compute-value.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOALS_DIR       = resolve(ROOT, 'data/goals');
const SNAP_PATH       = resolve(ROOT, 'data/sacred-history-W.json');
const PROPOSALS_FILE  = resolve(ROOT, 'data/proposals.json');
const INSIGHTS_FILE   = resolve(ROOT, 'data/insights.json');
const LOG_FILE        = resolve(ROOT, 'data/self-dev.log');
const GUARD_FILE      = resolve(ROOT, 'data/self-dev-guard.json');

// ── Ограждение: пути, которые саморазвитие не трогает ─────────────────────
const DEFAULT_GUARD = [
  'data/sacred-history-W.json',   // матрица W — не переписывать напрямую
  'data/lessons.json',            // уроки — только через lessons.mjs
  'bin/',                         // CLI-вход
  '.env', '.git/', 'node_modules/',
];
function loadGuard() {
  if (existsSync(GUARD_FILE)) {
    try { return JSON.parse(readFileSync(GUARD_FILE, 'utf8')); } catch {}
  }
  return DEFAULT_GUARD;
}

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt  = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i+1] ? Number(args[i+1]) : d; };
const MAX_STEPS   = opt('--max', 6);
const BUDGET      = args.includes('--budget') ? Number(args[args.indexOf('--budget') + 1]) : null;
const DRY_RUN     = flag('--dry-run');
const NO_RUN      = flag('--no-run');
const PAINS_ONLY  = flag('--pains');
const QUIET       = flag('--quiet');

function log(msg) {
  if (QUIET) return;
  console.log(msg);
}
function logFile(msg) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

// ── 1. ПРОБЛЕМАТИЗАЦИЯ: детерминистский сбор болей ─────────────────────────

/** Упавшие тесты: node --test, разбор хвоста вывода. */
function findFailingTests() {
  const r = spawnSync('node', ['--test', 'tests/*.test.js'], {
    cwd: ROOT, timeout: 300_000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true, // glob раскрывается шеллом
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const failed = [];
  const re = /not ok \d+ - (.+)/g;
  let m;
  while ((m = re.exec(out))) failed.push(m[1].trim().slice(0, 120));
  const m2 = out.match(/# fail (\d+)/);
  return { count: m2 ? Number(m2[1]) : (r.status ? 1 : 0), names: failed.slice(0, 8), raw: out.slice(-1500) };
}

/** Pending-предложения старше 7 дней — сигналы, что ideas не доходят до дел. */
function findStaleProposals() {
  if (!existsSync(PROPOSALS_FILE)) return [];
  const now = Date.now();
  const WEEK = 7 * 24 * 3600 * 1000;
  try {
    return JSON.parse(readFileSync(PROPOSALS_FILE, 'utf8'))
      .filter(p => p.status === 'pending' && (now - Date.parse(p.created)) > WEEK)
      .map(p => ({ id: p.id, text: String(p.text).slice(0, 100), ageDays: Math.floor((now - Date.parse(p.created)) / 86400000) }))
      .slice(0, 8);
  } catch { return []; }
}

/** Заброшенные goals: paused дольше 14 дней или failed. */
function findStalledGoals() {
  const engine = new GoalEngine({ root: GOALS_DIR });
  const now = Date.now();
  const out = [];
  for (const g of engine.list()) {
    const ageDays = Math.floor((now - Date.parse(g.updatedAt)) / 86400000);
    if (g.status === 'failed') out.push({ id: g.id, status: g.status, reason: g.failReason || '', objective: g.objective.slice(0, 80) });
    else if (g.status === 'paused' && ageDays >= 14) out.push({ id: g.id, status: g.status, reason: g.pauseReason || '', objective: g.objective.slice(0, 80) });
  }
  return out.slice(0, 8);
}

/** V-регресс: сравнение двух последних срезов value-history. */
function findValueDrop({ histPath = resolve(ROOT, 'data/value-history.json') } = {}) {
  if (!existsSync(histPath)) return null;
  try {
    const hist = JSON.parse(readFileSync(histPath, 'utf8'));
    if (hist.length < 2) return null;
    const a = hist[hist.length - 2], b = hist[hist.length - 1];
    const dE = (b.V?.E ?? 0) - (a.V?.E ?? 0);
    const dD = (b.V?.D ?? 0) - (a.V?.D ?? 0);
    const dT = (b.V?.T ?? 0) - (a.V?.T ?? 0);
    if (dE < 0 || dT < 0) {
      return { dE, dD, dT, prevTs: a.ts, nowTs: b.ts };
    }
    return null;
  } catch { return null; }
}

/** Полный снимок болей. */
function collectPains() {
  const pains = { ts: new Date().toISOString(), failingTests: null, staleProposals: [], stalledGoals: [], valueDrop: null, V: null };
  try { pains.V = computeValue().V; } catch {}
  pains.failingTests  = findFailingTests();
  pains.staleProposals = findStaleProposals();
  pains.stalledGoals   = findStalledGoals();
  pains.valueDrop      = findValueDrop();
  return pains;
}

function painsToText(p) {
  const L = [];
  L.push(`Состояние gift на ${p.ts}`);
  if (p.V) L.push(`V = { E:${p.V.E?.toFixed(1)}, D:${(p.V.D ?? 0).toFixed(3)}, M:${p.V.M ?? 0}, T:${p.V.T?.toFixed(1)}, S:${p.V.S} }`);
  if (p.valueDrop) L.push(`РЕГРЕСС ценности: dE=${p.valueDrop.dE?.toFixed(1)} dT=${p.valueDrop.dT?.toFixed(1)} (с ${p.valueDrop.prevTs} по ${p.valueDrop.nowTs})`);
  if (p.failingTests?.count) {
    L.push(`ПАДАЮТ ТЕСТЫ: ${p.failingTests.count}`);
    for (const n of p.failingTests.names) L.push(`  - ${n}`);
  }
  if (p.staleProposals.length) {
    L.push(`ЗАБРОШЕННЫЕ ПРЕДЛОЖЕНИЯ (pending > 7 дней): ${p.staleProposals.length}`);
    for (const s of p.staleProposals) L.push(`  - #${s.id} (${s.ageDays}д): ${s.text}`);
  }
  if (p.stalledGoals.length) {
    L.push(`ЗАСТРЯВШИЕ ЦЕЛИ: ${p.stalledGoals.length}`);
    for (const g of p.stalledGoals) L.push(`  - ${g.id} [${g.status}] ${g.reason}: ${g.objective}`);
  }
  if (!p.valueDrop && !p.failingTests?.count && !p.staleProposals.length && !p.stalledGoals.length) {
    L.push('Явных болей не найдено. Посмотри глубже: качество кода, документация, незакрытые пустоты в матрице W, непокрытые тестами модули utils/.');
  }
  return L.join('\n');
}

// ── 2. ОЗАДАЧИВАНИЕ: LLM переводит боль в цель ────────────────────────────
const GUARD_LIST = loadGuard();
const GUARD_TEXT = GUARD_LIST.map(g => `  - ${g}`).join('\n');

const FORMULATE_PROMPT = pains => `Ты — часть системы саморазвития gift (CLI-инструмент). Твоя задача — не решать проблемы, а СФОРМУЛИРОВАТЬ одну цель.

Факты о состоянии системы:
${pains}

Выбери ОДНУ самую болезненную и при этом РЕШАЕМУЮ проблему (маленький шаг, часы а не недели).
Сформулируй цель так, чтобы её можно было проверить автоматически.

Ответь СТРОГО в этом формате (без markdown):
OBJECTIVE: <что сделать, одно предложение>
SUCCESS: <измеримое условие успеха, проверяемое командой или файлом>

Жёсткие ограничения:
- НЕ трогай: ${GUARD_LIST.join('; ')}
- цель должна быть выполнима за ${MAX_STEPS} итераций силами одного агента с shell-доступом;
- SUCCESS должен быть проверяемым (файл существует, тест проходит, команда возвращает 0).`;

/** Формулировка цели через claude --print. Возвращает {objective, success} или null. */
function formulateGoal(painsText) {
  const r = spawnSync('claude', ['--print', '--dangerously-skip-permissions'], {
    input: FORMULATE_PROMPT(painsText),
    cwd: ROOT, encoding: 'utf8', timeout: 300_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) return null;
  const text = r.stdout || '';
  const obj = (text.match(/OBJECTIVE:\s*(.+)/) || [])[1]?.trim();
  const suc = (text.match(/SUCCESS:\s*(.+)/) || [])[1]?.trim();
  if (!obj || !suc) return null;
  return { objective: obj.slice(0, 300), successCriteria: suc.slice(0, 300) };
}

// ── 3. РЕШЕНИЕ: запуск goal-цикла ──────────────────────────────────────────
async function runGoal(id) {
  const engine = new GoalEngine({
    root: GOALS_DIR,
    executor: new ClaudeExecutor({ cwd: ROOT, testCommand: ['node', '--test', 'tests/*.test.js'] }),
    recorder: new MatrixRecorder({ snapPath: SNAP_PATH, agentId: '_selfdev' }),
  });
  return engine.run(id);
}

// ── 4. РЕФЛЕКСИЯ: итог в insights.json + лог ───────────────────────────────
function reflect(goalId, pains, result, { insightsPath = INSIGHTS_FILE } = {}) {
  const line = {
    type: 'insight',
    content: `self-dev ${goalId}: ${result.status}` +
      (result.iteration ? `, итераций ${result.iteration}` : '') +
      (result.failReason ? ` (${result.failReason})` : ''),
    weight: result.status === 'done' ? 6 : 3,
    ts: new Date().toISOString(),
    source: 'self-dev',
  };
  try {
    const arr = existsSync(insightsPath) ? JSON.parse(readFileSync(insightsPath, 'utf8')) : [];
    if (!arr.some(i => i.content === line.content)) {
      arr.push(line);
      arr.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
      writeFileSync(insightsPath, JSON.stringify(arr, null, 2));
    }
  } catch (e) { logFile(`insights write failed: ${e.message}`); }
  logFile(`goal ${goalId} → ${result.status}, iter=${result.iteration ?? '?'}`);
  return line;
}

// ── proposals: логирование проблемы как предложения ────────────────────────
function logProposal(text, cat = 'self-dev', { proposalsPath = PROPOSALS_FILE } = {}) {
  try {
    const arr = existsSync(proposalsPath) ? JSON.parse(readFileSync(proposalsPath, 'utf8')) : [];
    const id = arr.length ? Math.max(...arr.map(p => p.id)) + 1 : 1;
    arr.push({ id, text: text.slice(0, 300), cat, status: 'pending', created: new Date().toISOString() });
    writeFileSync(proposalsPath, JSON.stringify(arr, null, 2));
    return id;
  } catch { return null; }
}

// ── Главный цикл ───────────────────────────────────────────────────────────
// при импорте в тестах main() не запускается (см. SELF_DEV_NO_MAIN внизу)
async function main() {
  log(`\n▶ self-dev: цикл саморазвития gift`);
  logFile('── цикл начат ──');

  // 1. Проблематизация
  log('  1. Проблематизация: собираю состояние…');
  const pains = collectPains();
  const painsText = painsToText(pains);
  log(painsText.split('\n').map(l => `     ${l}`).join('\n'));
  if (PAINS_ONLY) { console.log(painsText); process.exit(0); }
  if (DRY_RUN) {
    log('\n  --dry-run: цель не создаю. Формулировка (что сделал бы LLM):');
    const g = formulateGoal(painsText);
    if (g) { log(`     OBJECTIVE: ${g.objective}`); log(`     SUCCESS:   ${g.successCriteria}`); }
    else    { log('     (claude недоступен — формулировка не состоялась)'); }
    process.exit(0);
  }

  // 2. Озадачивание
  log('  2. Озадачивание: формулирую цель…');
  const formulated = formulateGoal(painsText);
  if (!formulated) {
    log('     (claude недоступен или ответ не распознан — выхожу)');
    logFile('formulate: claude fail');
    process.exit(0);
  }
  const engine = new GoalEngine({ root: GOALS_DIR });
  const goal = engine.create({
    objective: formulated.objective,
    successCriteria: formulated.successCriteria,
    maxIterations: MAX_STEPS,
    tokenBudget: BUDGET,
    meta: { origin: 'self-dev', painsAt: pains.ts },
  });
  const pid = logProposal(formulated.objective);
  log(`     цель ${goal.id}: ${formulated.objective}`);
  log(`     успех: ${formulated.successCriteria}`);
  if (pid) log(`     предложение #${pid} записано в proposals`);

  if (NO_RUN) {
    log(`\n  запуск вручную: gift goal run ${goal.id}`);
    process.exit(0);
  }

  // 3. Решение
  log(`  3. Решение: запускаю goal-цикл (max ${MAX_STEPS} итераций)…\n`);
  let result;
  try {
    result = await runGoal(goal.id);
  } catch (e) {
    log(`     ошибка прогона: ${e.message}`);
    logFile(`run fail: ${e.message}`);
    process.exit(1);
  }

  // 4. Рефлексия
  log('  4. Рефлексия: записываю итог…');
  const insight = reflect(goal.id, pains, result);
  log(`     ${insight.content}`);

  log(`\n${result.status === 'done' ? '✦ саморазвитие состоялось' : '↻ цель не дожата — опыт записан, вернусь в следующий цикл'}\n`);
  process.exit(result.status === 'done' ? 0 : 1);
}

// экспорт чистых функций — для тестов
export { collectPains, painsToText, findStaleProposals, findStalledGoals, findValueDrop, loadGuard, reflect, logProposal, FORMULATE_PROMPT, DEFAULT_GUARD };

if (!process.env.SELF_DEV_NO_MAIN) {
  main().catch(e => { console.error(e); process.exit(1); });
}
