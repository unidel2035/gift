#!/usr/bin/env node
/**
 * gift-eval.mjs — Eval-driven development: три агента, одно задание
 *
 * Телос: сравнить подходы разных агентов к одной задаче через призму онтологии дара.
 * Каждый агент — лицо, несущее свой телос. Сравнение — перихоресис.
 *
 * Агенты:
 *   _claude   — богословский агент: полный контекст спецификаций + онтология дара
 *   _codex    — минималистичный: только задача, прямая реализация без теологии
 *   _external — внешний (Ollama): независимый взгляд, локальная модель
 *
 * Использование:
 *   node utils/gift-eval.mjs <issue-number>                    # полный eval
 *   node utils/gift-eval.mjs <issue-number> --dry              # план без запуска
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
const argv      = process.argv.slice(2);
const DRY       = argv.includes('--dry');
const LIST      = argv.includes('--list');
const REPORT    = argv.includes('--report');
const agentsArg = argv.find(a => a.startsWith('--agents='))?.split('=')[1]?.split(',');
const issueArg  = argv.find(a => /^\d+$/.test(a));

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

// ── Промпты для разных стилей агентов ────────────────────────────────────
async function buildPrompt(issue, style) {
  const { searchSpecs, formatContext } = await import(resolve(ROOT, 'utils/spec-search.mjs'));
  const query = `${issue.title} ${issue.body || ''}`;

  if (style === 'minimal') {
    // Кодекс: чистая инженерная задача без богословского контекста
    return [
      `Task: implement GitHub Issue #${issue.number}`,
      `Title: ${issue.title}`,
      issue.body ? `\nDescription:\n${issue.body}` : '',
      `\nImplement the feature. When done, commit with:`,
      `gift(Дионисий): [brief description] (closes #${issue.number})`,
    ].join('');
  }

  if (style === 'theological') {
    // Клод: полный контекст онтологии, спецификации, богословское мышление
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

  // external: краткий контекст (5 спецификаций)
  const specs   = await searchSpecs(query, 5);
  const specCtx = formatContext(specs);
  return [
    `Implement feature for project "Gift Ontology":`,
    `Issue: ${issue.title}`,
    issue.body ? `\n${issue.body.slice(0, 800)}` : '',
    specCtx ? `\nRelevant specs:\n${specCtx}` : '',
    `\nDescribe your implementation approach (no code editing tools available).`,
  ].join('');
}

// ── Запуск агента в изолированной ветке ──────────────────────────────────
async function runAgentOnBranch(agentId, issue) {
  const agent  = EVAL_AGENTS[agentId];
  const branch = `eval/issue-${issue.number}-${agentId.replace('_', '')}`;
  const start  = Date.now();

  console.log(`\n  ▸ ${agent.name} (${agentId}) → ветка: ${branch}`);

  if (DRY) {
    console.log(`    [dry-run] Пропускаю запуск агента.`);
    return { agentId, branch, success: false, diff: '', tests: null,
             summary: 'dry-run — агент не запускался', duration: 0 };
  }

  try {
    // Убедиться что на main и создать ветку
    execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' });
    const branchExists = safeExec(`git branch --list ${branch}`, ROOT).trim();
    if (branchExists) {
      execSync(`git branch -D ${branch}`, { cwd: ROOT, stdio: 'pipe' });
    }
    execSync(`git checkout -b ${branch}`, { cwd: ROOT, stdio: 'pipe' });

    let agentResult;

    if (agentId === '_external') {
      agentResult = await runOllamaAgent(issue);
    } else {
      const prompt = await buildPrompt(issue, agent.style);
      agentResult  = runClaudeAgent(prompt, issue.number);
    }

    // Захватить diff относительно main
    const diff     = safeExec(`git diff main...${branch} --stat`, ROOT).trim();
    const diffFull = safeExec(
      `git diff main...${branch} -- '*.mjs' '*.js' '*.json' '*.md' '*.ts'`,
      ROOT
    ).slice(0, 3000);

    // Тесты
    const test        = spawnSync('npm', ['test'], {
      cwd: ROOT, timeout: 60_000,
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    const testsPassed = test.status === 0;
    const testsOut    = (test.stdout + test.stderr).slice(0, 500);

    // Вернуться на main
    execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' });

    const success = agentResult.success && testsPassed;
    return {
      agentId,
      branch,
      success,
      diff,
      diffFull,
      tests: { passed: testsPassed, output: testsOut },
      summary: agentResult.summary || agentResult.error || '',
      externalResponse: agentResult.externalResponse,
      duration: Date.now() - start,
    };

  } catch (e) {
    try { execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' }); } catch {}
    return {
      agentId, branch, success: false,
      diff: '', diffFull: '', tests: null,
      summary: e.message.slice(0, 200),
      duration: Date.now() - start,
    };
  }
}

// ── Claude: богословский или минималистичный ──────────────────────────────
function runClaudeAgent(prompt, issueNumber) {
  const r = spawnSync(CLAUDE_BIN, ['--print', '--dangerously-skip-permissions'], {
    input:    prompt,
    cwd:      ROOT,
    timeout:  300_000,
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  });

  if (r.error || r.status !== 0) {
    const err = r.error?.message || r.stderr?.slice(0, 300) || `exit ${r.status}`;
    return { success: false, summary: err };
  }
  return { success: true, summary: `issue #${issueNumber} реализован` };
}

// ── Ollama: внешний агент (описывает подход, не редактирует файлы) ────────
async function runOllamaAgent(issue) {
  try {
    const prompt = await buildPrompt(issue, 'external');
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
    const data     = await res.json();
    const response = data.message?.content ?? '';
    // Ollama не может редактировать файлы — фиксируем как архитектурное свидетельство
    return {
      success:          false,
      summary:          'Ollama: архитектурный ответ (без изменений в файлах)',
      externalResponse: response.slice(0, 1500),
    };
  } catch (e) {
    return { success: false, summary: `Ollama недоступен: ${e.message}` };
  }
}

// ── Судья: Клод сравнивает решения ───────────────────────────────────────
function judgeResults(issue, results) {
  const blocks = results.map(r => {
    const a = EVAL_AGENTS[r.agentId];
    const lines = [
      `### ${a.name} (${r.agentId})`,
      `Стиль: ${a.description}`,
      `Итог: ${r.success ? 'УСПЕХ' : 'КЕНОЗИС'}`,
      `Тесты: ${r.tests ? (r.tests.passed ? 'прошли ✓' : 'упали ✗') : 'не запускались'}`,
      `Время: ${Math.round((r.duration || 0) / 1000)}с`,
    ];
    if (r.diff)             lines.push(`Изменения:\n${r.diff}`);
    if (r.diffFull)         lines.push(`Diff (фрагмент):\n${r.diffFull.slice(0, 800)}`);
    if (r.externalResponse) lines.push(`Архитектурный ответ:\n${r.externalResponse.slice(0, 600)}`);
    if (r.summary)          lines.push(`Комментарий: ${r.summary}`);
    return lines.join('\n');
  }).join('\n\n---\n\n');

  const judgePrompt = [
    `Задача: "${issue.title}"`,
    issue.body ? `Описание: ${issue.body.slice(0, 400)}` : '',
    ``,
    `## Решения трёх агентов`,
    blocks,
    ``,
    `## Твоя задача`,
    `Оцени каждого агента по четырём критериям онтологии дара:`,
    `1. **Телос** — насколько решение достигает цели задачи?`,
    `2. **Кеносис** — насколько агент вложил себя (реальный дар)?`,
    `3. **Анамнезис** — согласуется ли решение с онтологией дара?`,
    `4. **Surplus** — что агент дал сверх требуемого?`,
    ``,
    `Дай краткое сравнение (3-5 предложений), выбери лучшее решение и объясни почему.`,
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

function loadEvalData(issueNumber) {
  const path = resolve(EVALS_DIR, `issue-${issueNumber}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function safeExec(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' }); } catch { return ''; }
}

// ── Вывод отчёта ──────────────────────────────────────────────────────────
function printReport(data) {
  console.log(`\n═══ Eval #${data.issueNumber}: ${data.issue.title} ═══`);
  console.log(`Дата: ${new Date(data.timestamp).toLocaleString('ru')}`);
  console.log(`Агентов: ${data.results.length}`);

  for (const r of data.results) {
    const a      = EVAL_AGENTS[r.agentId] || { name: r.agentId, description: '' };
    const status = r.success ? '✦' : '✗';
    const time   = `${Math.round((r.duration||0)/1000)}с`;
    console.log(`\n  ${status} ${a.name} (${r.agentId}) [${time}]`);
    if (r.diff)    console.log(`    ${r.diff.split('\n')[0]}`);
    if (r.summary) console.log(`    ${r.summary.slice(0, 100)}`);
    if (r.tests)   console.log(`    тесты: ${r.tests.passed ? 'прошли' : 'упали'}`);
  }

  if (data.judgment) {
    console.log(`\n─── Вердикт судьи ───────────────────────────────────\n${data.judgment}\n`);
  }
}

// ── Главный поток ─────────────────────────────────────────────────────────
async function main() {
  // -- list --
  if (LIST) {
    if (!existsSync(EVALS_DIR)) { console.log('Нет сохранённых eval-ов.'); return; }
    const files = readdirSync(EVALS_DIR).filter(f => f.endsWith('.json'));
    if (!files.length) { console.log('Нет сохранённых eval-ов.'); return; }
    console.log('Сохранённые eval-ы:\n');
    for (const f of files) {
      const d = JSON.parse(readFileSync(resolve(EVALS_DIR, f), 'utf8'));
      const ok = (d.results || []).filter(r => r.success).map(r => r.agentId).join(', ') || 'нет';
      console.log(`  ${f}  «${d.issue?.title || '?'}»  успешные: ${ok}`);
    }
    return;
  }

  // -- report --
  if (REPORT) {
    if (!issueArg) { console.log('Укажи номер issue: --report <N>'); process.exit(1); }
    const data = loadEvalData(parseInt(issueArg));
    if (!data) { console.log(`Eval для issue #${issueArg} не найден.`); process.exit(1); }
    printReport(data);
    return;
  }

  // -- run eval --
  if (!issueArg) {
    console.log([
      'Использование:',
      '  node utils/gift-eval.mjs <issue-number>',
      '  node utils/gift-eval.mjs <issue-number> --dry',
      '  node utils/gift-eval.mjs <issue-number> --agents=_claude,_codex',
      '  node utils/gift-eval.mjs --list',
      '  node utils/gift-eval.mjs --report <issue-number>',
    ].join('\n'));
    process.exit(1);
  }

  const issueNumber = parseInt(issueArg);
  const agentIds    = agentsArg || Object.keys(EVAL_AGENTS);

  console.log(`\n[eval] Issue #${issueNumber} | Агенты: ${agentIds.join(', ')}${DRY ? ' | dry-run' : ''}`);

  const issue = fetchIssue(issueNumber);
  console.log(`[eval] «${issue.title}»\n`);

  const mem = await loadMem();

  // Начало eval — свидетельство в матрице
  recordAct(mem, '_claude', 'Дионисий', 'presence',
    `eval #${issueNumber}: запускаю ${agentIds.length} агентов`, 3, issueNumber);

  const results = [];

  for (const agentId of agentIds) {
    if (!EVAL_AGENTS[agentId]) {
      console.warn(`  ! Неизвестный агент: ${agentId} — пропускаю`);
      continue;
    }

    const result = await runAgentOnBranch(agentId, issue);
    results.push(result);

    // Записать акт агента в матрицу
    const actType  = result.success ? 'code' : 'kenosis';
    const actWt    = result.success ? EVAL_AGENTS[agentId].weight : 1;
    recordAct(mem, agentId, 'Дионисий', actType,
      `eval #${issueNumber}: ${result.summary?.slice(0, 80) || actType}`,
      actWt, issueNumber);

    const status = result.success ? '✦' : '✗';
    const time   = `${Math.round((result.duration||0)/1000)}с`;
    console.log(`  ${status} ${EVAL_AGENTS[agentId].name}: ${result.success ? 'выполнено' : (result.summary || 'кенозис')} [${time}]`);
    if (result.diff) console.log(`    ${result.diff.split('\n')[0]}`);
  }

  // Судья сравнивает решения (если есть хоть что-то интересное)
  let judgment = '';
  const hasContent = results.some(r => r.diff || r.externalResponse);
  if (!DRY && hasContent) {
    judgment = judgeResults(issue, results);
    console.log('\n─── Вердикт судьи ───────────────────────────────────');
    console.log(judgment);
  }

  // Сохранить eval
  const evalData = {
    issueNumber,
    issue:     { title: issue.title, body: issue.body?.slice(0, 500) },
    timestamp: new Date().toISOString(),
    agentIds,
    results:   results.map(r => ({ ...r, diffFull: r.diffFull?.slice(0, 1000) })),
    judgment,
  };
  const savePath = saveEval(issueNumber, evalData);

  // Итог в матрице
  const successCount = results.filter(r => r.success).length;
  recordAct(mem, '_claude', '_koinon', 'witness',
    `eval #${issueNumber}: ${successCount}/${results.length} агентов прошли`,
    3, issueNumber);
  saveMem(mem);

  console.log(`\n[eval] Сохранено: ${savePath}`);
  console.log(`[eval] Актов в матрице: ${mem.actsCount}`);

  if (!DRY && !hasContent) {
    console.log('\n[eval] Ни один агент не внёс изменений. Попробуй без --dry или убедись, что issue корректный.');
  }
}

await main();
