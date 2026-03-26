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
    // Только issues с plan-approved — план должен быть одобрен Дионисием
    const raw = execSync(
      'gh issue list --label plan-approved --state open --json number,title,body,labels --limit 10',
      { cwd: ROOT }
    ).toString();
    const approved = JSON.parse(raw);
    if (approved.length) return approved;

    // Fallback: gift-ready без плана → сначала создать план
    const raw2 = execSync(
      'gh issue list --label gift-ready --state open --json number,title,body,labels --limit 10',
      { cwd: ROOT }
    ).toString();
    const ready = JSON.parse(raw2).filter(i =>
      !i.labels.some(l => l.name === 'plan-ready' || l.name === 'plan-approved')
    );
    if (ready.length) {
      console.log(`[оркестратор] ${ready.length} issues без плана → генерирую планы сначала`);
      for (const i of ready) {
        spawnSync('node', ['utils/gift-plan.mjs', String(i.number)],
          { cwd: ROOT, stdio: 'inherit' });
      }
      console.log('[оркестратор] Планы созданы. Жду одобрения Дионисия.');
      return []; // не реализуем до одобрения
    }
    return [];
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
    // Найти релевантные спецификации
    const { searchSpecs, formatContext } = await import(resolve(ROOT, 'utils/spec-search.mjs'));
    const query   = `${title} ${body || ''}`;

    // Получаем все релевантные спеки — больше контекста = лучше агент
    // Claude имеет 200k окно; 20 спеков × ~500 токенов ≈ 10k — вписываемся
    const specs   = await searchSpecs(query, 20);
    const specCtx = formatContext(specs);

    if (specs.length) {
      console.log(`   Спецификации (${specs.length}): ${specs.slice(0,5).map(s => s.file).join(', ')}${specs.length>5?'...':''}`);
    }

    const prompt = [
      `GitHub Issue #${issueNumber}: ${title}`,
      body ? `\nОписание:\n${body}` : '',
      specCtx ? `\n${specCtx}` : '',
      `\nЗадача: реализовать описанное согласно спецификациям. Завершить коммитом:`,
      `gift(Дионисий): [краткое описание] (closes #${issueNumber})`,
    ].join('');

    // Запускаем claude в режиме --print (не интерактивный)
    // Петля самоисправления: до 3 попыток
    const MAX_ATTEMPTS = 3;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const attemptPrompt = attempt === 1
        ? prompt
        : `${prompt}\n\nПредыдущая попытка (${attempt-1}) завершилась ошибкой тестов:\n${lastError}\nИсправь и повтори.`;

      const r = spawnSync('claude', ['--print', attemptPrompt], {
        cwd: ROOT, timeout: 120_000,
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      });

      if (r.status !== 0) {
        return { success: false, error: r.stderr?.slice(0, 200) || 'ошибка' };
      }

      // Запускаем тесты
      console.log(`   Попытка ${attempt}/${MAX_ATTEMPTS} — запускаю тесты...`);
      const test = spawnSync('npm', ['test'], {
        cwd: ROOT, timeout: 60_000,
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      });

      if (test.status === 0) {
        return { success: true, summary: `issue #${issueNumber} закрыт (попытка ${attempt})` };
      }

      lastError = (test.stderr || test.stdout || '').slice(0, 500);
      console.log(`   ✗ Тесты упали (попытка ${attempt}): ${lastError.slice(0, 80)}...`);
    }

    return { success: false, error: `тесты не прошли после ${MAX_ATTEMPTS} попыток: ${lastError.slice(0, 200)}` };
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
