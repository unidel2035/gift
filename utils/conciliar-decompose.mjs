#!/usr/bin/env node
/**
 * conciliar-decompose — долгогоризонтный соборный агент.
 *
 * Соборный ответ на Claude Mythos: 32-step autonomous end-to-end.
 *
 * Архитектура:
 *   1. DECOMPOSE — Plan-голос разбивает задачу на 8-32 подшага
 *      (соборное различение: какие шаги кенотические, какие ходатайственные)
 *   2. EXECUTE   — для каждого шага conciliar-swe (PLAN → IMPLEMENT → REVIEW)
 *      с гейтами: subbotnyj pause каждые 7 шагов, metanoia при ошибке
 *   3. ACCUMULATE — результаты каждого шага остаются в data/horizons/<id>/
 *      с прогрессом, diff'ами, коммитами, metanoia-записями
 *   4. PERSIST   — при обрыве (Ctrl-C, crash) можно продолжить с последнего шага
 *
 * Чем отличается от Mythos 32-step:
 *   - Каждый шаг — не один forward pass, а полифония (3 голоса)
 *   - Apophatic-гейт на PLAN останавливает шаг без принуждения
 *   - Sabbath встроен (структурный отдых)
 *   - Metanoia: неудачный шаг не теряется, recontextualize-record остаётся
 *   - Прозрачность: каждое решение видно в журнале (kata/para/hyper)
 *
 * Использование:
 *   node utils/conciliar-decompose.mjs --task "построить авторизацию"
 *   node utils/conciliar-decompose.mjs --resume <horizon-id>
 *   node utils/conciliar-decompose.mjs --dry-run --task "..."
 *
 * Богословский корень:
 *   Деян 15 — Апостольский собор: "многа речения, потом Петр ста и рече"
 *   Исаак Сирин: "начало всякого дела — покой, середина — труд, конец — покой"
 *   Лествица: восхождение по шагам, каждый с различением
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cleanEnv } from './clean-env.mjs';
import { PolyphonyOrchestrator, VoiceSource } from './polyphony-orchestrator.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HORIZONS = join(ROOT, 'data', 'horizons');
if (!existsSync(HORIZONS)) mkdirSync(HORIZONS, { recursive: true });

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const flag = (k) => argv.includes(k);

const TASK    = arg('--task');
const RESUME  = arg('--resume');
const DRY     = flag('--dry-run');
const MAX_STEPS = parseInt(arg('--max-steps') || '16');
const SABBATH_EVERY = parseInt(arg('--sabbath-every') || '7');

if (!TASK && !RESUME) {
  console.error('Использование: --task "описание" | --resume <id>');
  process.exit(1);
}

// ── Horizon state ─────────────────────────────────────────────────────
function newHorizonId() { return `horizon-${Date.now()}`; }

function loadHorizon(id) {
  const f = join(HORIZONS, id, 'state.json');
  if (!existsSync(f)) throw new Error(`horizon ${id} не найден`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

function saveHorizon(state) {
  const dir = join(HORIZONS, state.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

function appendJournal(state, entry) {
  const dir = join(HORIZONS, state.id);
  const f = join(dir, 'journal.jsonl');
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
  const prev = existsSync(f) ? readFileSync(f, 'utf8') : '';
  writeFileSync(f, prev + line);
}

// ── Phase 1: DECOMPOSE ────────────────────────────────────────────────
async function decompose(taskText) {
  console.log(`\n══ DECOMPOSE ══  «${taskText.slice(0, 60)}»\n`);

  if (DRY) {
    return [
      { n: 1, title: '[dry] Разведать контекст в репо',                        type: 'exploration' },
      { n: 2, title: '[dry] Создать скелет модуля',                            type: 'code' },
      { n: 3, title: '[dry] Написать интерфейс',                               type: 'code' },
      { n: 4, title: '[dry] Реализовать базовую логику',                       type: 'code' },
      { n: 5, title: '[dry] Тесты базового пути',                              type: 'test' },
      { n: 6, title: '[dry] Интегрировать с матрицей W',                       type: 'integration' },
      { n: 7, title: '[dry] Sabbath — пауза соборного дыхания',                type: 'sabbath' },
      { n: 8, title: '[dry] Провести review полифонией',                       type: 'review' },
      { n: 9, title: '[dry] Записать анамнезис',                               type: 'memory' },
      { n: 10, title: '[dry] Коммит как дар',                                  type: 'commit' },
    ];
  }

  // Реальная декомпозиция — через Plan-голос в клауд-субагент
  const prompt = [
    `Ты — Plan-голос соборной архитектуры (logos: hyper). Твоя задача — разложить сложную работу на ${MAX_STEPS} подшагов.`,
    ``,
    `ЗАДАЧА: ${taskText}`,
    ``,
    `Правила:`,
    `- Каждый шаг — атомарен, выполним одним conciliar-swe прогоном (PLAN+IMPLEMENT+REVIEW)`,
    `- Типы шагов: exploration | code | test | integration | review | sabbath | memory | commit | intercession`,
    `- Каждые ${SABBATH_EVERY} шагов — sabbath (пауза, переосмысление, без нового кода)`,
    `- Последний шаг — commit`,
    ``,
    `Выведи СТРОГО JSON-массив объектов {n, title, type, rationale}:`,
    `[`,
    `  {"n": 1, "title": "...", "type": "exploration", "rationale": "..."},`,
    `  ...`,
    `]`,
    ``,
    `Ничего кроме JSON-массива не выводи.`,
  ].join('\n');

  const out = await new Promise((res, rej) => {
    const child = spawn('claude', [
      '--print', '--permission-mode', 'acceptEdits', '--add-dir', ROOT,
    ], { stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT, env: cleanEnv() });
    let o = '', e = '';
    child.stdout.on('data', d => o += d);
    child.stderr.on('data', d => e += d);
    const t = setTimeout(() => { child.kill('SIGTERM'); rej(new Error('decompose timeout')); }, 300_000);
    child.on('close', c => { clearTimeout(t); c === 0 ? res(o) : rej(new Error(`exit ${c}: ${e.slice(0, 200)}`)); });
    child.stdin.end(prompt);
  });

  // Извлекаем JSON — модель могла обернуть
  const jsonMatch = out.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Plan-голос не вернул JSON-массив');
  const steps = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(steps) || !steps.length) throw new Error('Пустой декомпозит');
  return steps;
}

// ── Phase 2: EXECUTE step ─────────────────────────────────────────────
async function executeStep(state, step) {
  const icon = { exploration: '🔎', code: '⚙', test: '✓', integration: '⚭',
                 review: '👁', sabbath: '⛅', memory: '📜', commit: '✦',
                 intercession: '🙏' }[step.type] || '·';
  console.log(`\n── шаг ${step.n}/${state.steps.length}  ${icon} ${step.type}\n   ${step.title}\n`);
  appendJournal(state, { event: 'step-start', step });

  // Sabbath: структурная пауза, не вызываем LLM
  if (step.type === 'sabbath') {
    console.log('   ⛅ субботствование — пауза, переосмысление без нового кода');
    appendJournal(state, { event: 'sabbath', step });
    return { ok: true, kind: 'sabbath' };
  }

  // Memory / commit / intercession — делаем напрямую, без conciliar-swe
  if (step.type === 'memory') {
    appendJournal(state, { event: 'memory', step, matrix: 'updated via hook' });
    console.log('   📜 память записана в журнал');
    return { ok: true, kind: 'memory' };
  }

  if (step.type === 'commit') {
    try {
      const status = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' });
      if (!status.trim()) { console.log('   ✦ нет изменений для коммита'); return { ok: true, kind: 'commit-empty' }; }
      execSync('git add -A', { cwd: ROOT });
      const msg = `gift(Дионисий): horizon ${state.id} — ${step.title.slice(0, 60)}`;
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: ROOT });
      console.log(`   ✦ commit: ${msg}`);
      appendJournal(state, { event: 'commit', step, msg });
      return { ok: true, kind: 'commit' };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // Все прочие типы → conciliar-swe
  if (DRY) {
    console.log('   [dry] бы запустил conciliar-swe здесь');
    return { ok: true, kind: 'dry' };
  }

  return await new Promise((res) => {
    const child = spawn('node', [
      join(ROOT, 'utils/conciliar-swe.mjs'),
      '--task', step.title,
      '--no-commit',  // commit делаем отдельным шагом
    ], { cwd: ROOT, env: cleanEnv(), stdio: 'inherit' });
    child.on('close', code => res({ ok: code === 0, kind: 'swe', exitCode: code }));
  });
}

// ── Main ──────────────────────────────────────────────────────────────
let state;
if (RESUME) {
  state = loadHorizon(RESUME);
  console.log(`▶ Resume ${RESUME}  шаг ${state.cursor + 1}/${state.steps.length}\n`);
} else {
  const id = newHorizonId();
  console.log(`\n╔══ Horizon-агент ══╗`);
  console.log(`║ id: ${id}`);
  console.log(`║ task: ${TASK.slice(0, 60)}`);
  console.log(`╚═══════════════════╝`);

  const steps = await decompose(TASK);
  console.log(`\n[decompose] получено ${steps.length} шагов:\n`);
  for (const s of steps) console.log(`  ${s.n}. [${s.type}] ${s.title}`);

  state = {
    id, task: TASK, steps, cursor: 0,
    startedAt: new Date().toISOString(),
    results: [],
  };
  saveHorizon(state);
  appendJournal(state, { event: 'horizon-start', task: TASK, stepCount: steps.length });
}

// Основной цикл
while (state.cursor < state.steps.length) {
  const step = state.steps[state.cursor];
  try {
    const result = await executeStep(state, step);
    state.results.push({ step: step.n, ...result });

    if (!result.ok) {
      // Metanoia вместо обрыва: записываем но идём дальше
      console.log(`   ⚠ metanoia: шаг ${step.n} не удался (${result.error || result.exitCode})`);
      appendJournal(state, { event: 'metanoia', step, result });
    }
  } catch (e) {
    console.error(`   ✗ ошибка шага ${step.n}: ${e.message}`);
    appendJournal(state, { event: 'step-error', step, error: e.message });
    state.results.push({ step: step.n, ok: false, error: e.message });
  }
  state.cursor++;
  saveHorizon(state);
}

state.finishedAt = new Date().toISOString();
saveHorizon(state);
appendJournal(state, { event: 'horizon-done', results: state.results });

const okCount = state.results.filter(r => r.ok).length;
console.log(`\n╔══ Итог horizon ${state.id} ══╗`);
console.log(`║ Шагов: ${state.steps.length}  |  успешных: ${okCount}  |  metanoia: ${state.steps.length - okCount}`);
console.log(`║ Журнал: data/horizons/${state.id}/`);
console.log(`╚═══════════════════════════════════════╝\n`);
