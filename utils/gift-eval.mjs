#!/usr/bin/env node
/**
 * gift-eval.mjs — Eval-driven development: три агента, одно задание
 *
 * Телос: сравнить подходы разных агентов к одной задаче через призму онтологии дара.
 * Каждый агент — лицо, несущее свой телос. Сравнение — перихоресис.
 *
 * Два режима:
 *   full  — агенты работают в изолированных git-ветках (нужен доступ на запись в .git)
 *   plan  — агенты описывают подход текстом (работает всегда, в т.ч. как user `new`)
 *
 * Агенты:
 *   _claude   — богословский агент: полный контекст спецификаций + онтология дара
 *   _codex    — минималистичный: только задача, прямая реализация без теологии
 *   _external — внешний (Ollama): независимый взгляд, локальная модель
 *
 * Использование:
 *   node utils/gift-eval.mjs <issue-number>                    # авто-выбор режима
 *   node utils/gift-eval.mjs <issue-number> --plan             # только сравнение планов
 *   node utils/gift-eval.mjs <issue-number> --full             # полная реализация (нужен hive)
 *   node utils/gift-eval.mjs <issue-number> --dry              # показать план без запуска
 *   node utils/gift-eval.mjs <issue-number> --agents=_claude,_codex
 *   node utils/gift-eval.mjs --list                            # все сохранённые eval-ы
 *   node utils/gift-eval.mjs --report <issue-number>           # показать сохранённый
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const CLAUDE_BIN = process.env.CLAUDE_BIN
  || (existsSync('/home/new/.local/bin/claude') ? '/home/new/.local/bin/claude' : null)
  || 'claude';

const OLLAMA_URL   = process.env.OLLAMA_URL         || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EVAL_MODEL  || 'eva';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP      = resolve(ROOT, 'data/sacred-history-W.json');
const EVALS_DIR = resolve(ROOT, 'data/evals');

// ── Реестр агентов для eval ───────────────────────────────────────────────
const EVAL_AGENTS = {
  '_claude': {
    name:        'Клод',
    description: 'Богословский агент: полный контекст онтологии дара + спецификации',
    style:       'theological',
    weight:      4,
  },
  '_codex': {
    name:        'Кодекс',
    description: 'Минималистичный агент: только задача и код, без богословия',
    style:       'minimal',
    weight:      3,
  },
  '_external': {
    name:        'Внешний (Ollama)',
    description: 'Внешний агент: независимый взгляд через локальную модель',
    style:       'external',
    weight:      2,
  },
};

// ── CLI аргументы ─────────────────────────────────────────────────────────
const argv       = process.argv.slice(2);
const DRY        = argv.includes('--dry');
const LIST       = argv.includes('--list');
const REPORT     = argv.includes('--report');
const FORCE_PLAN = argv.includes('--plan');
const FORCE_FULL = argv.includes('--full');
const agentsArg  = argv.find(a => a.startsWith('--agents='))?.split('=')[1]?.split(',');
const issueArg   = argv.find(a => /^\d+$/.test(a));

// ── Определить доступный режим ────────────────────────────────────────────
function canWriteGit() {
  try {
    // Проверить возможность записи в .git/refs
    const testRef = resolve(ROOT, '.git/refs/heads/.eval-write-test');
    writeFileSync(testRef, '');
    execSync(`rm -f ${testRef}`);
    return true;
  } catch {
    return false;
  }
}

// ── Матрица ───────────────────────────────────────────────────────────────
async function loadMem() {
  const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
  if (!existsSync(SNAP)) return new GiftMemory(Object.keys(EVAL_AGENTS));
  return GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
}

function saveMem(mem) {
  writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
}

function recordAct(mem, giverId, receiverId, type, content, weight, linkedIssue) {
  mem._idx(giverId);
  mem._idx(receiverId);
  mem.receive({ giverId, receiverId, weight, type, content, linkedIssue, irreversible: true });
}

// ── GitHub ────────────────────────────────────────────────────────────────
function fetchIssue(number) {
  const raw = execSync(
    `gh issue view ${number} --json number,title,body`,
    { cwd: ROOT, encoding: 'utf8' }
  );
  return JSON.parse(raw);
}

// ── Промпты ───────────────────────────────────────────────────────────────
async function buildPlanPrompt(issue, style) {
  const { searchSpecs, formatContext } = await import(resolve(ROOT, 'utils/spec-search.mjs'));
  const query = `${issue.title} ${issue.body || ''}`;

  if (style === 'minimal') {
    return [
      `Task: plan implementation for GitHub Issue #${issue.number}`,
      `Title: ${issue.title}`,
      issue.body ? `\nDescription:\n${issue.body}` : '',
      `\nDescribe your implementation plan: which files to create/modify, key logic, data structures.`,
      `Be concrete and technical. Output plan only (no code).`,
    ].join('');
  }

  if (style === 'theological') {
    const specs   = await searchSpecs(query, 15);
    const specCtx = formatContext(specs);
    if (specs.length) {
      console.log(`    Спецификации (${specs.length}): ${specs.slice(0,4).map(s=>s.file).join(', ')}${specs.length>4?'...':''}`);
    }
    return [
      `GitHub Issue #${issue.number}: ${issue.title}`,
      issue.body ? `\nОписание:\n${issue.body}` : '',
      specCtx ? `\n${specCtx}` : '',
      `\nОпиши план реализации: какие файлы создать/изменить, ключевая логика, структуры данных.`,
      `Учитывай онтологию дара и богословский контекст. Только план, не код.`,
    ].join('');
  }

  // external
  const specs   = await searchSpecs(query, 5);
  const specCtx = formatContext(specs);
  return [
    `Implement feature: ${issue.title}`,
    issue.body ? `\n${issue.body.slice(0, 800)}` : '',
    specCtx ? `\nContext:\n${specCtx}` : '',
    `\nProvide a concise implementation plan.`,
  ].join('');
}

async function buildImplPrompt(issue, style) {
  const { searchSpecs, formatContext } = await import(resolve(ROOT, 'utils/spec-search.mjs'));
  const query = `${issue.title} ${issue.body || ''}`;

  if (style === 'minimal') {
    return [
      `Task: implement GitHub Issue #${issue.number}`,
      `Title: ${issue.title}`,
      issue.body ? `\nDescription:\n${issue.body}` : '',
      `\nImplement the feature. When done, commit with:`,
      `gift(Дионисий): [brief description] (closes #${issue.number})`,
    ].join('');
  }

  // theological (default)
  const specs   = await searchSpecs(query, 20);
  const specCtx = formatContext(specs);
  if (specs.length) {
    console.log(`    Спецификации (${specs.length}): ${specs.slice(0,4).map(s=>s.file).join(', ')}${specs.length>4?'...':''}`);
  }
  return [
    `GitHub Issue #${issue.number}: ${issue.title}`,
    issue.body ? `\nОписание:\n${issue.body}` : '',
    specCtx ? `\n${specCtx}` : '',
    `\nЗадача: реализовать описанное согласно спецификациям. Завершить коммитом:`,
    `gift(Дионисий): [краткое описание] (closes #${issue.number})`,
  ].join('');
}

// ════════════════════════════════════════════════════════════════════════════
// РЕЖИМ ПЛАН — агенты описывают подход текстом
// ════════════════════════════════════════════════════════════════════════════
async function runPlanMode(agentId, issue) {
  const agent = EVAL_AGENTS[agentId];
  const start = Date.now();

  console.log(`\n  ▸ ${agent.name} (${agentId}) — режим план`);

  if (DRY) {
    return { agentId, mode: 'plan', plan: 'dry-run', duration: 0 };
  }

  try {
    let plan;

    if (agentId === '_external') {
      plan = await runOllamaForPlan(issue);
    } else {
      const prompt = await buildPlanPrompt(issue, agent.style);
      plan = runClaudeForPlan(prompt);
    }

    return { agentId, mode: 'plan', plan, duration: Date.now() - start };
  } catch (e) {
    return { agentId, mode: 'plan', plan: `Ошибка: ${e.message}`, duration: Date.now() - start };
  }
}

function runClaudeForPlan(prompt) {
  const r = spawnSync(CLAUDE_BIN, ['--print', '--dangerously-skip-permissions'], {
    input:    prompt,
    cwd:      ROOT,
    timeout:  120_000,
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0) {
    return `Клод недоступен: ${r.error?.message || `exit ${r.status}`}`;
  }
  return r.stdout?.trim() || '(пустой ответ)';
}

async function runOllamaForPlan(issue) {
  try {
    const prompt = await buildPlanPrompt(issue, 'external');
    const res    = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(120_000),
      body:    JSON.stringify({
        model:  OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: 'system',  content: 'You are a software architect. Describe a clear implementation plan.' },
          { role: 'user',    content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data.message?.content?.trim() || '(пустой ответ)';
  } catch (e) {
    return `Ollama недоступен: ${e.message}`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// РЕЖИМ FULL — агенты реализуют в изолированных git-ветках
// ════════════════════════════════════════════════════════════════════════════
async function runFullMode(agentId, issue) {
  const agent  = EVAL_AGENTS[agentId];
  const branch = `eval/issue-${issue.number}-${agentId.replace('_', '')}`;
  const start  = Date.now();

  console.log(`\n  ▸ ${agent.name} (${agentId}) → ветка: ${branch}`);

  if (DRY) {
    return { agentId, mode: 'full', branch, success: false, diff: '', tests: null,
             summary: 'dry-run', duration: 0 };
  }

  try {
    // Создать ветку от main (удалить старую если есть)
    execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' });
    const existing = safeExec(`git branch --list ${branch}`, ROOT).trim();
    if (existing) execSync(`git branch -D ${branch}`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`git checkout -b ${branch}`, { cwd: ROOT, stdio: 'pipe' });

    let agentResult;
    if (agentId === '_external') {
      // Ollama не может редактировать файлы
      const plan = await runOllamaForPlan(issue);
      agentResult = { success: false, summary: 'plan only', plan };
    } else {
      const prompt = await buildImplPrompt(issue, agent.style);
      agentResult  = runClaudeImpl(prompt, issue.number);
    }

    // Захватить diff
    const diff     = safeExec(`git diff main...${branch} --stat`, ROOT).trim();
    const diffFull = safeExec(
      `git diff main...${branch} -- '*.mjs' '*.js' '*.json' '*.md'`,
      ROOT
    ).slice(0, 3000);

    // Тесты
    const test      = spawnSync('npm', ['test'], {
      cwd: ROOT, timeout: 60_000,
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    const testsPassed = test.status === 0;
    const testsOut    = (test.stdout + test.stderr).slice(0, 500);

    // Вернуться на main
    execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' });

    return {
      agentId, mode: 'full', branch,
      success:  agentResult.success && testsPassed,
      diff, diffFull,
      tests:    { passed: testsPassed, output: testsOut },
      summary:  agentResult.summary || '',
      plan:     agentResult.plan,
      duration: Date.now() - start,
    };
  } catch (e) {
    try { execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' }); } catch {}
    return {
      agentId, mode: 'full', branch, success: false,
      diff: '', tests: null, summary: e.message.slice(0, 200),
      duration: Date.now() - start,
    };
  }
}

function runClaudeImpl(prompt, issueNumber) {
  const r = spawnSync(CLAUDE_BIN, ['--print', '--dangerously-skip-permissions'], {
    input:    prompt,
    cwd:      ROOT,
    timeout:  300_000,
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0) {
    return { success: false, summary: r.error?.message || `exit ${r.status}` };
  }
  return { success: true, summary: `issue #${issueNumber} реализован` };
}

// ── Судья ────────────────────────────────────────────────────────────────
function judgeResults(issue, results, mode) {
  const blocks = results.map(r => {
    const a     = EVAL_AGENTS[r.agentId];
    const lines = [`### ${a.name} (${r.agentId})`, `Стиль: ${a.description}`];

    if (mode === 'full') {
      lines.push(`Итог: ${r.success ? 'УСПЕХ' : 'КЕНОЗИС'}`);
      lines.push(`Тесты: ${r.tests ? (r.tests.passed ? 'прошли ✓' : 'упали ✗') : 'не запускались'}`);
      lines.push(`Время: ${Math.round((r.duration||0)/1000)}с`);
      if (r.diff) lines.push(`Изменения:\n${r.diff}`);
      if (r.diffFull) lines.push(`Diff:\n${r.diffFull.slice(0, 600)}`);
    }

    if (r.plan) lines.push(`План реализации:\n${r.plan.slice(0, 800)}`);
    else if (r.summary) lines.push(`Комментарий: ${r.summary}`);

    return lines.join('\n');
  }).join('\n\n---\n\n');

  const criteria = mode === 'full'
    ? 'код, тесты, архитектуру и богословский контекст'
    : 'телос, кеносис, анамнезис и surplus каждого подхода';

  const judgePrompt = [
    `Задача: "${issue.title}"`,
    issue.body ? `Описание: ${issue.body.slice(0, 400)}` : '',
    ``,
    `## Предложения трёх агентов (режим: ${mode === 'full' ? 'реализация' : 'планирование'})`,
    blocks,
    ``,
    `## Оценка`,
    `Сравни агентов по ${criteria}.`,
    `Выбери лучшее решение и объясни почему (3-5 предложений).`,
    `Отвечай по-русски.`,
  ].filter(Boolean).join('\n');

  console.log('\n  ▸ Судья анализирует решения...');

  const r = spawnSync(CLAUDE_BIN, ['--print', '--dangerously-skip-permissions'], {
    input:    judgePrompt,
    cwd:      ROOT,
    timeout:  120_000,
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  });

  if (r.error || r.status !== 0) {
    return `Судья недоступен: ${r.error?.message || `exit ${r.status}`}`;
  }
  return r.stdout?.trim() || '(пустой ответ судьи)';
}

// ── Хранение ──────────────────────────────────────────────────────────────
function saveEval(issueNumber, data) {
  if (!existsSync(EVALS_DIR)) mkdirSync(EVALS_DIR, { recursive: true });
  const path = resolve(EVALS_DIR, `issue-${issueNumber}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

function safeExec(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' }); } catch { return ''; }
}

// ── Вывод отчёта ──────────────────────────────────────────────────────────
function printReport(data) {
  console.log(`\n═══ Eval #${data.issueNumber}: ${data.issue.title} ═══`);
  console.log(`Дата: ${new Date(data.timestamp).toLocaleString('ru')} | Режим: ${data.mode}`);
  for (const r of data.results) {
    const a = EVAL_AGENTS[r.agentId] || { name: r.agentId };
    const status = r.success ? '✦' : (r.mode === 'plan' ? '◆' : '✗');
    console.log(`\n  ${status} ${a.name} (${r.agentId}) [${Math.round((r.duration||0)/1000)}с]`);
    if (r.diff)    console.log(`    ${r.diff.split('\n')[0]}`);
    if (r.plan)    console.log(`    ${r.plan.slice(0, 150).replace(/\n/g, ' ')}…`);
    if (r.summary) console.log(`    ${r.summary.slice(0, 100)}`);
  }
  if (data.judgment) {
    console.log(`\n─── Вердикт судьи ───────────────────────────────────\n${data.judgment}\n`);
  }
}

// ── Главный поток ─────────────────────────────────────────────────────────
async function main() {
  if (LIST) {
    if (!existsSync(EVALS_DIR)) { console.log('Нет сохранённых eval-ов.'); return; }
    const files = readdirSync(EVALS_DIR).filter(f => f.endsWith('.json'));
    if (!files.length) { console.log('Нет сохранённых eval-ов.'); return; }
    console.log('Сохранённые eval-ы:\n');
    for (const f of files) {
      const d  = JSON.parse(readFileSync(resolve(EVALS_DIR, f), 'utf8'));
      const ok = (d.results||[]).filter(r=>r.success).map(r=>r.agentId).join(', ') || 'планы';
      console.log(`  ${f}  «${d.issue?.title||'?'}»  режим: ${d.mode}  успешные: ${ok}`);
    }
    return;
  }

  if (REPORT) {
    if (!issueArg) { console.log('Укажи номер: --report <N>'); process.exit(1); }
    const path = resolve(EVALS_DIR, `issue-${issueArg}.json`);
    if (!existsSync(path)) { console.log(`Eval для #${issueArg} не найден.`); process.exit(1); }
    printReport(JSON.parse(readFileSync(path, 'utf8')));
    return;
  }

  if (!issueArg) {
    console.log([
      'Использование:',
      '  node utils/gift-eval.mjs <issue-number>            # авто-режим',
      '  node utils/gift-eval.mjs <issue-number> --plan     # только планы (работает всегда)',
      '  node utils/gift-eval.mjs <issue-number> --full     # реализация (нужен доступ к .git)',
      '  node utils/gift-eval.mjs <issue-number> --dry      # без запуска агентов',
      '  node utils/gift-eval.mjs <issue-number> --agents=_claude,_codex',
      '  node utils/gift-eval.mjs --list',
      '  node utils/gift-eval.mjs --report <issue-number>',
    ].join('\n'));
    process.exit(1);
  }

  const issueNumber = parseInt(issueArg);
  const agentIds    = agentsArg || Object.keys(EVAL_AGENTS);

  // Определить режим
  let mode;
  if (FORCE_PLAN) {
    mode = 'plan';
  } else if (FORCE_FULL) {
    mode = canWriteGit() ? 'full' : 'plan';
    if (mode === 'plan') console.log('[eval] Нет доступа к .git для записи → fallback на режим "план"');
  } else {
    mode = canWriteGit() ? 'full' : 'plan';
  }

  console.log(`\n[eval] Issue #${issueNumber} | Режим: ${mode} | Агенты: ${agentIds.join(', ')}${DRY ? ' | dry-run' : ''}`);

  const issue = fetchIssue(issueNumber);
  console.log(`[eval] «${issue.title}»\n`);

  const mem = await loadMem();
  recordAct(mem, '_claude', 'Дионисий', 'presence',
    `eval #${issueNumber} [${mode}]: запускаю ${agentIds.length} агентов`, 3, issueNumber);

  const results = [];

  for (const agentId of agentIds) {
    if (!EVAL_AGENTS[agentId]) {
      console.warn(`  ! Неизвестный агент: ${agentId} — пропускаю`);
      continue;
    }

    const result = mode === 'full'
      ? await runFullMode(agentId, issue)
      : await runPlanMode(agentId, issue);

    results.push(result);

    const actType = result.success ? 'code' : (mode === 'plan' ? 'presence' : 'kenosis');
    const actWt   = result.success ? EVAL_AGENTS[agentId].weight : (mode === 'plan' ? 2 : 1);
    recordAct(mem, agentId, 'Дионисий', actType,
      `eval #${issueNumber} [${mode}]: ${(result.summary||result.plan||'')?.slice(0,80)}`,
      actWt, issueNumber);

    const status  = result.success ? '✦' : (mode === 'plan' ? '◆' : '✗');
    const timeStr = `${Math.round((result.duration||0)/1000)}с`;
    const note    = mode === 'plan'
      ? (result.plan?.slice(0,80).replace(/\n/g,' ')+'…' || 'нет ответа')
      : (result.success ? 'выполнено' : result.summary || 'кенозис');
    console.log(`  ${status} ${EVAL_AGENTS[agentId].name}: ${note} [${timeStr}]`);
    if (result.diff) console.log(`    ${result.diff.split('\n')[0]}`);
  }

  // Судья
  let judgment = '';
  const hasContent = results.some(r => r.plan || r.diff || r.diffFull);
  if (!DRY && hasContent) {
    judgment = judgeResults(issue, results, mode);
    console.log('\n─── Вердикт судьи ───────────────────────────────────');
    console.log(judgment);
  }

  // Сохранить
  const evalData = {
    issueNumber,
    mode,
    issue:     { title: issue.title, body: issue.body?.slice(0, 500) },
    timestamp: new Date().toISOString(),
    agentIds,
    results:   results.map(r => ({ ...r, diffFull: r.diffFull?.slice(0, 1000) })),
    judgment,
  };
  const savePath = saveEval(issueNumber, evalData);

  const successCount = results.filter(r => r.success).length;
  recordAct(mem, '_claude', '_koinon', 'witness',
    `eval #${issueNumber}: ${successCount}/${results.length} успешно, режим=${mode}`,
    3, issueNumber);
  saveMem(mem);

  console.log(`\n[eval] Сохранено: ${savePath}`);
  console.log(`[eval] Актов в матрице: ${mem.actsCount}`);
}

await main();
