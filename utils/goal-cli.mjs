#!/usr/bin/env node
/**
 * goal-cli.mjs — CLI вокруг GoalEngine. Подключается в bin/gift как `gift goal`.
 *
 * Команды:
 *   create "<objective>" --success "<criteria>" [--max N] [--budget T]
 *   run <id> [--steps N]            — запустить/возобновить (Ctrl+C → паузит)
 *   list [--status X]               — все цели
 *   status <id>                     — деталь
 *   pause <id>
 *   cancel <id>
 *   clear <id>
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoalEngine } from '../src/goals/GoalEngine.js';
import { ClaudeExecutor } from '../src/goals/ClaudeExecutor.js';
import { MatrixRecorder } from '../src/goals/MatrixRecorder.js';
import { computeValue } from './compute-value.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOALS_DIR = resolve(ROOT, 'data/goals');
const SNAP_PATH = resolve(ROOT, 'data/sacred-history-W.json');

const C = {
  b:    s => `\x1b[1m${s}\x1b[0m`,
  dim:  s => `\x1b[2m${s}\x1b[0m`,
  gold: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  green:s => `\x1b[32m${s}\x1b[0m`,
  red:  s => `\x1b[31m${s}\x1b[0m`,
};

const STATUS_COLOR = {
  pending:   C.dim,
  running:   C.cyan,
  paused:    C.gold,
  done:      C.green,
  failed:    C.red,
  cancelled: C.dim,
};

function fmtStatus(s) {
  const color = STATUS_COLOR[s] || (x => x);
  return color(s);
}

function getArg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function help() {
  console.log(`
${C.b('gift goal')} — long-horizon цели (gift-аналог Codex /goal)

  ${C.b('create')} ${C.dim('"<objective>" --success "<criteria>" [--max N] [--budget T]')}
                          создать цель. ${C.gold('--success обязателен')}
  ${C.b('run')}    <id> ${C.dim('[--steps N]')}    запустить/возобновить (Ctrl+C → пауза)
  ${C.b('list')}        ${C.dim('[--status pending|running|paused|done|failed]')}
  ${C.b('status')} <id>                деталь по цели
  ${C.b('pause')}  <id>
  ${C.b('cancel')} <id>
  ${C.b('clear')}  <id>                удалить state файл

${C.dim('Цикл итерации:')} plan → act → test → review → ${C.gold('μετάνοια')}
${C.dim('μετάνοια')} — на провале не retry, а рефлексия: «что я упустил».
${C.dim('State в')} data/goals/<id>.json ${C.dim('— переживает рестарт.')}
`);
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  help();
  process.exit(0);
}

// ── create ────────────────────────────────────────────────────────────────
if (cmd === 'create') {
  const objective = args.filter(a => !a.startsWith('--')).slice(0, 1)[0];
  const successCriteria = getArg(args, '--success');
  const maxIterations = Number(getArg(args, '--max')) || 32;
  const tokenBudget   = getArg(args, '--budget') ? Number(getArg(args, '--budget')) : null;

  if (!objective) { console.error('gift goal create "<objective>" --success "<criteria>"'); process.exit(1); }
  if (!successCriteria) {
    console.error(C.red('--success обязателен.') + ' Без явного условия успеха цикл не остановится.');
    process.exit(1);
  }

  const engine = new GoalEngine({ root: GOALS_DIR });
  const g = engine.create({ objective, successCriteria, maxIterations, tokenBudget });
  console.log(`${C.green('✦')} цель создана: ${C.cyan(g.id)}`);
  console.log(`  objective:  ${g.objective}`);
  console.log(`  success:    ${g.successCriteria}`);
  console.log(`  maxIter:    ${g.maxIterations}${tokenBudget ? `, budget=${tokenBudget}` : ''}`);
  console.log(C.dim(`\n  запусти: gift goal run ${g.id}`));
  process.exit(0);
}

// ── list ──────────────────────────────────────────────────────────────────
if (cmd === 'list') {
  const status = getArg(args, '--status');
  const engine = new GoalEngine({ root: GOALS_DIR });
  const all = engine.list({ status });
  if (!all.length) { console.log(C.dim('(нет целей)')); process.exit(0); }
  console.log();
  for (const g of all) {
    const obj = g.objective.length > 50 ? g.objective.slice(0, 47) + '...' : g.objective;
    const prog = `${g.iteration}/${g.maxIterations}`;
    console.log(`  ${C.cyan(g.id)}  ${fmtStatus(g.status).padEnd(20)} ${C.dim(prog.padStart(6))}  ${obj}`);
  }
  console.log();
  process.exit(0);
}

// ── status ────────────────────────────────────────────────────────────────
if (cmd === 'status') {
  const id = args[0];
  if (!id) { console.error('gift goal status <id>'); process.exit(1); }
  const engine = new GoalEngine({ root: GOALS_DIR });
  const g = engine.get(id);
  if (!g) { console.error(`цель ${id} не найдена`); process.exit(1); }
  console.log(`\n${C.b(C.cyan(g.id))}  ${fmtStatus(g.status)}`);
  console.log(`  objective:  ${g.objective}`);
  console.log(`  success:    ${g.successCriteria}`);
  console.log(`  iteration:  ${g.iteration}/${g.maxIterations}`);
  console.log(`  tokens:     ${g.tokensUsed}${g.tokenBudget ? `/${g.tokenBudget}` : ''}`);
  console.log(`  created:    ${C.dim(g.createdAt)}`);
  console.log(`  updated:    ${C.dim(g.updatedAt)}`);
  if (g.pauseReason) console.log(`  pause:      ${C.gold(g.pauseReason)}`);
  if (g.failReason)  console.log(`  fail:       ${C.red(g.failReason)}`);
  if (g.history.length) {
    console.log(`\n  ${C.b('история:')}`);
    for (const h of g.history.slice(-5)) {
      const v = h.review?.satisfied ? C.green('✓') : (h.test?.passed === false ? C.red('✗test') : C.gold('↻'));
      const planSnip = (h.plan?.text || '').split('\n')[0].slice(0, 60);
      console.log(`    ${v} ${h.n.toString().padStart(2)}. ${C.dim(planSnip)}`);
      if (h.metanoia?.text) {
        const m = h.metanoia.text.split('\n').filter(Boolean)[0].slice(0, 80);
        console.log(`       ${C.gold('μετάνοια:')} ${C.dim(m)}`);
      }
    }
  }
  console.log();
  process.exit(0);
}

// ── run ───────────────────────────────────────────────────────────────────
if (cmd === 'run') {
  const id = args[0];
  if (!id) { console.error('gift goal run <id>'); process.exit(1); }
  const maxSteps = Number(getArg(args, '--steps')) || Infinity;

  const engine = new GoalEngine({
    root: GOALS_DIR,
    executor: new ClaudeExecutor({ cwd: ROOT }),
    recorder: new MatrixRecorder({ snapPath: SNAP_PATH }),
    // valueProbe записывает V_before/V_after для каждой итерации — это
    // даёт post-mortem на конкретный шаг. Но фоновый шум от tg-актов
    // может сместить V между измерениями, поэтому проверка в GoalEngine
    // только информативная, satisfied не отменяет.
    valueProbe: () => computeValue(),
  });
  const g = engine.get(id);
  if (!g) { console.error(`цель ${id} не найдена`); process.exit(1); }

  // Ctrl+C → pause
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log(`\n${C.gold('⏸')} пауза (Ctrl+C). Состояние сохранено. ${C.dim('Ещё раз Ctrl+C для выхода.')}`);
    engine.pause(id, 'sigint');
  });

  console.log(`\n${C.b('▸ запуск')} ${C.cyan(id)}: ${g.objective}`);
  console.log(C.dim(`  условие успеха: ${g.successCriteria}`));
  console.log(C.dim(`  итераций: ${g.iteration}/${g.maxIterations}, max этого запуска: ${maxSteps === Infinity ? '∞' : maxSteps}`));
  console.log();

  await engine.run(id, {
    maxSteps,
    onStep: (state, step) => {
      const v = step.review.satisfied ? C.green('✓ SATISFIED') :
                (step.test.passed === false ? C.red('✗ test') : C.gold('↻ not yet'));
      const plan1 = (step.plan?.text || '').split('\n')[0].slice(0, 70);
      console.log(`  ${step.n.toString().padStart(2)}. ${v}  ${C.dim(plan1)}`);
      if (step.metanoia?.text) {
        const m = step.metanoia.text.split('\n').filter(Boolean)[0].slice(0, 80);
        console.log(`      ${C.gold('μετάνοια:')} ${C.dim(m)}`);
      }
    },
  });

  const final = engine.get(id);
  console.log(`\n${fmtStatus(final.status)}  итераций: ${final.iteration}/${final.maxIterations}, tokens: ${final.tokensUsed}`);
  if (final.status === 'paused') console.log(C.dim(`  возобновить: gift goal run ${id}`));
  process.exit(final.status === 'done' ? 0 : (final.status === 'failed' ? 1 : 0));
}

// ── pause / cancel / clear ────────────────────────────────────────────────
if (cmd === 'pause' || cmd === 'cancel' || cmd === 'clear') {
  const id = args[0];
  if (!id) { console.error(`gift goal ${cmd} <id>`); process.exit(1); }
  const engine = new GoalEngine({ root: GOALS_DIR });
  if (cmd === 'pause')  { const g = engine.pause(id);  console.log(`${C.gold('⏸')}  ${id} → ${fmtStatus(g.status)}`); }
  if (cmd === 'cancel') { const g = engine.cancel(id); console.log(`${C.red('✗')}  ${id} → ${fmtStatus(g.status)}`); }
  if (cmd === 'clear')  { engine.clear(id);            console.log(`${C.dim('—')}  ${id} удалён`); }
  process.exit(0);
}

console.error(`unknown subcommand: ${cmd}`);
help();
process.exit(1);
