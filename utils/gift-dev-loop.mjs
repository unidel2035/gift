#!/usr/bin/env node
/**
 * gift-dev-loop.mjs
 *
 * Оркестратор цикла разработки.
 * Читает открытые issues с меткой gift-ready.
 * Для каждого — запускает агента (Claude или внешний).
 *
 * Агенты регистрируются в матрице W как лица.
 * Каждый акт — дар от конкретного агента.
 *
 * Запуск: node utils/gift-dev-loop.mjs [--once]
 * Или через /schedule для повторного запуска.
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP   = resolve(ROOT, 'data/sacred-history-W.json');
const ONCE   = process.argv.includes('--once');

// ── Реестр агентов ─────────────────────────────────────────────────────────
// Каждый агент — лицо в матрице
const AGENTS = {
  '_claude':   { name: 'Claude',     type: 'llm',      weight: 4 },
  '_codex':    { name: 'Codex',      type: 'llm',      weight: 3 },
  '_ci':       { name: 'CI',         type: 'machine',  weight: 2 },
  '_reviewer': { name: 'Reviewer',   type: 'llm',      weight: 3 },
};

// ── Матрица ────────────────────────────────────────────────────────────────
async function loadMem() {
  const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
  if (!existsSync(SNAP)) return new GiftMemory(Object.keys(AGENTS));
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  return GiftMemory.fromSnapshot(snap);
}

function saveMem(mem) {
  writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
}

function recordAct(mem, giverId, receiverId, type, content, weight, linkedIssue) {
  mem._idx(giverId);
  mem._idx(receiverId);
  mem.receive({ giverId, receiverId, weight, type, content, linkedIssue, irreversible: true });
}

// ── GitHub issues ──────────────────────────────────────────────────────────
function getReadyIssues() {
  try {
    const raw = execSync(
      'gh issue list --label gift-ready --state open --json number,title,body,assignees --limit 10',
      { cwd: ROOT }
    ).toString();
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function assignIssue(number, agent) {
  try {
    execSync(`gh issue edit ${number} --add-assignee ${agent} 2>/dev/null`, { cwd: ROOT });
  } catch {}
}

function closeIssue(number, comment) {
  try {
    execSync(`gh issue comment ${number} --body "${comment}" 2>/dev/null`, { cwd: ROOT });
    execSync(`gh issue close ${number} 2>/dev/null`, { cwd: ROOT });
  } catch {}
}

// ── Оркестратор ───────────────────────────────────────────────────────────
async function orchestrate() {
  const issues = getReadyIssues();
  if (!issues.length) {
    console.log('[оркестратор] Нет issues с меткой gift-ready');
    return;
  }

  const mem = await loadMem();
  console.log(`[оркестратор] Открытых issues: ${issues.length} | Лиц в матрице: ${mem.n}`);

  for (const issue of issues) {
    const { number, title, body } = issue;
    console.log(`\n── Issue #${number}: ${title}`);

    // Выбрать агента (простая эвристика — можно усложнить)
    const agentId = pickAgent(title, body);
    const agent   = AGENTS[agentId];
    console.log(`   Агент: ${agent.name} (${agentId})`);

    // Записать в матрицу: агент берёт задачу
    recordAct(mem, agentId, 'Дионисий', 'presence',
      `берёт issue #${number}: ${title}`, agent.weight, number);

    // Запустить агента
    const result = await runAgent(agentId, number, title, body);

    if (result.success) {
      // Дар выполнен
      recordAct(mem, agentId, 'Дионисий', 'code',
        `выполнил #${number}: ${result.summary}`, agent.weight + 1, number);
      closeIssue(number, `✦ Выполнено агентом ${agent.name}: ${result.summary}`);
      console.log(`   ✦ Выполнено: ${result.summary}`);
    } else {
      // Кенозис — не получилось
      recordAct(mem, agentId, '_koinon', 'kenosis',
        `кенозис по #${number}: ${result.error}`, 1, number);
      console.log(`   ✗ Кенозис: ${result.error}`);
    }

    saveMem(mem);
  }

  console.log(`\n[оркестратор] Готово. Актов: ${mem.actsCount}`);
}

// ── Выбор агента ──────────────────────────────────────────────────────────
function pickAgent(title, body = '') {
  const text = (title + ' ' + body).toLowerCase();
  if (text.includes('тест') || text.includes('test')) return '_ci';
  if (text.includes('review') || text.includes('проверь')) return '_reviewer';
  return '_claude'; // по умолчанию
}

// ── Запуск агента ─────────────────────────────────────────────────────────
async function runAgent(agentId, issueNumber, title, body) {
  if (agentId === '_claude') {
    return runClaudeAgent(issueNumber, title, body);
  }
  if (agentId === '_ci') {
    return runCIAgent(issueNumber);
  }
  // Для других агентов — заглушка (можно подключить внешние API)
  return { success: false, error: `агент ${agentId} ещё не подключён` };
}

async function runClaudeAgent(issueNumber, title, body) {
  try {
    // Claude Code в режиме агента: читает issue, пишет код, делает коммит
    const prompt = [
      `GitHub Issue #${issueNumber}: ${title}`,
      body ? `\nОписание:\n${body}` : '',
      `\nЗадача: реализовать описанное. Завершить коммитом в формате:`,
      `gift(Дионисий): [краткое описание] (closes #${issueNumber})`,
    ].join('');

    // Запускаем claude в режиме --print (не интерактивный)
    const r = spawnSync('claude', ['--print', prompt], {
      cwd: ROOT, timeout: 120_000,
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });

    if (r.status === 0) {
      return { success: true, summary: `issue #${issueNumber} закрыт` };
    }
    return { success: false, error: r.stderr?.slice(0, 200) || 'ошибка' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function runCIAgent(issueNumber) {
  try {
    const r = spawnSync('npm', ['test'], {
      cwd: ROOT, timeout: 60_000,
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    if (r.status === 0) return { success: true, summary: 'тесты прошли' };
    return { success: false, error: 'тесты упали' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Точка входа ───────────────────────────────────────────────────────────
await orchestrate();

if (!ONCE) {
  console.log('\n[оркестратор] Жду 5 минут до следующего цикла...');
  setTimeout(async () => {
    await orchestrate();
  }, 5 * 60 * 1000);
}
