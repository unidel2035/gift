#!/usr/bin/env node
/**
 * run-agent-eval.mjs — Агентное различение issue
 *
 * Три агента получают одно задание (GitHub issue).
 * Матрица W различает победителя — не по метрике, а по весу дара.
 * Победитель записывается в матрицу W.
 *
 * «Не соревнование, а собор» (GiftAgentEval.js).
 *
 * Запуск:
 *   node utils/run-agent-eval.mjs <issue-number>
 *   node utils/run-agent-eval.mjs <issue-number> --dry-run
 *   node utils/run-agent-eval.mjs --list
 *
 * Агенты:
 *   _claude     — богословская полнота (дар смысла)
 *   _architect  — архитектурная строгость (дар структуры)
 *   _executor   — реализация (дар действия)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP     = resolve(ROOT, 'data/sacred-history-W.json');
const EVALS    = resolve(ROOT, 'data/agent-evals.json');
const REPO     = 'unidel2035/gift';
const GH_ENV   = { ...process.env, GITHUB_TOKEN: '' };

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const LIST     = args.includes('--list');
const issueNum = args.find(a => /^\d+$/.test(a));

// ── Агенты и их богословские ориентации ─────────────────────────────────────

const AGENTS = [
  {
    id:          '_claude',
    orientation: 'богословская',
    prompt:      (task) =>
      `Ты агент _claude в матрице онтологии дара (кенозис, θέωσις, анамнезис).\n` +
      `Ответь на задание богословски глубоко — как дар смысла общине.\n\n` +
      `ЗАДАНИЕ:\n${task}\n\nОтвет (кратко, 100-200 слов):`,
  },
  {
    id:          '_architect',
    orientation: 'архитектурная',
    prompt:      (task) =>
      `Ты агент _architect — архитектор системы даров.\n` +
      `Ответь на задание через структуру кода и тестов. Дар — это рабочий код.\n\n` +
      `ЗАДАНИЕ:\n${task}\n\nОтвет с планом реализации (кратко, 100-200 слов):`,
  },
  {
    id:          '_executor',
    orientation: 'исполнительская',
    prompt:      (task) =>
      `Ты агент _executor — исполнитель воли общины.\n` +
      `Ответь на задание конкретным планом действий: что создать, что изменить.\n\n` +
      `ЗАДАНИЕ:\n${task}\n\nПлан (шаги, команды, файлы):`,
  },
];

// ── List mode ─────────────────────────────────────────────────────────────────

if (LIST) {
  const evals = existsSync(EVALS) ? JSON.parse(readFileSync(EVALS, 'utf8')) : [];
  console.log(`\n═══ Agent Evals (${evals.length}) ═══\n`);
  for (const e of evals.slice(-5).reverse()) {
    console.log(`  ${e.taskId.slice(5)} | issue #${e.issueNumber ?? '?'} | победитель: ${e.winner}`);
    for (const entry of e.entries) {
      const bar = '█'.repeat(Math.floor(entry.score / 4));
      console.log(`    ${entry.agentId.padEnd(14)} ${bar} ${entry.score}/40`);
    }
    console.log();
  }
  process.exit(0);
}

// ── Issue mode ────────────────────────────────────────────────────────────────

if (!issueNum) {
  console.error('Использование: node utils/run-agent-eval.mjs <issue-number> [--dry-run]');
  console.error('               node utils/run-agent-eval.mjs --list');
  process.exit(1);
}

// Получить issue
console.log(`\n═══ Agent Eval — Issue #${issueNum} ═══\n`);
const issueResult = spawnSync('gh', ['issue', 'view', issueNum,
  '--repo', REPO, '--json', 'title,body,labels'],
  { encoding: 'utf8', cwd: ROOT, env: GH_ENV });

if (issueResult.status !== 0) {
  console.error('Ошибка чтения issue:', issueResult.stderr);
  process.exit(1);
}

const issue = JSON.parse(issueResult.stdout);
const task  = `${issue.title}\n\n${issue.body ?? ''}`.slice(0, 2000);
const labels = issue.labels?.map(l => l.name) ?? [];

console.log(`Задание: ${issue.title}`);
console.log(`Метки: ${labels.join(', ') || '(нет)'}\n`);

// ── Запустить агентов ─────────────────────────────────────────────────────────

const responses = {};

for (const agent of AGENTS) {
  console.log(`[${agent.id}] (${agent.orientation})...`);
  if (DRY_RUN) {
    responses[agent.id] = `[DRY-RUN] Агент ${agent.id} ответил бы здесь.`;
    console.log(`  → [dry-run]`);
    continue;
  }

  const prompt = agent.prompt(task);
  const result = spawnSync('claude', ['--print', prompt],
    { encoding: 'utf8', cwd: ROOT, timeout: 60_000 });

  if (result.status === 0 && result.stdout.trim()) {
    responses[agent.id] = result.stdout.trim().slice(0, 600);
    console.log(`  → ${responses[agent.id].slice(0, 80)}...`);
  } else {
    // Fallback: эвристический ответ если claude --print недоступен
    responses[agent.id] = agent.prompt(task).slice(0, 200);
    console.log(`  → [fallback] ${result.stderr?.slice(0, 60) ?? 'timeout'}`);
  }
}

// ── Оценить через GiftAgentEval ───────────────────────────────────────────────

const { GiftMemory }    = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const { GiftAgentEval } = await import(resolve(ROOT, 'src/core/GiftAgentEval.js'));

const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);
const evaluator = new GiftAgentEval(mem, SNAP);

const result = evaluator.run(task, responses);
result.issueNumber = issueNum;
result.labels      = labels;

// ── Отчёт ─────────────────────────────────────────────────────────────────────

console.log('\n═══ Результат собора ═══\n');
for (const entry of result.entries) {
  const { gift_surplus, kenosis, telos, anamnesis } = entry.criteria;
  const bar = '█'.repeat(Math.floor(entry.score / 4));
  console.log(`  ${entry.agentId.padEnd(14)} ${bar} ${entry.score}/40`);
  console.log(`    surplus:${gift_surplus} кенозис:${kenosis} телос:${telos} анамнезис:${anamnesis}`);
}
console.log(`\n  🏆 Победитель собора: ${result.winner}`);
console.log(`     Его ответ несёт наибольший дар общине.`);

// Записать в лог
const evals = existsSync(EVALS) ? JSON.parse(readFileSync(EVALS, 'utf8')) : [];
evals.push(result);
if (!DRY_RUN) {
  writeFileSync(EVALS, JSON.stringify(evals, null, 2), 'utf8');
  console.log(`\n  ✓ Eval сохранён: ${result.taskId}`);

  // Сохранить матрицу (победитель записан в W)
  const updatedSnap = mem.snapshot();
  writeFileSync(SNAP, JSON.stringify(updatedSnap, null, 2), 'utf8');
  console.log(`  ✓ Матрица W обновлена: ${result.winner}→_koinon +дар`);
}

console.log();
