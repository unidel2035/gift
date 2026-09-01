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

// GITHUB_TOKEN из env может быть сломан (CI-токен без прав).
// Сбрасываем до пустой строки — gh использует собственный keyring.
const GH_ENV = { ...process.env, GITHUB_TOKEN: '' };

// Claude binary: env var → user new (server) → local nvm → system
const CLAUDE_BIN = process.env.CLAUDE_BIN
  || (existsSync('/home/new/.local/bin/claude') ? '/home/new/.local/bin/claude' : null)
  || 'claude';

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP   = resolve(ROOT, 'data/sacred-history-W.json');
const ONCE   = process.argv.includes('--once');

// ── Роли в матрице W ────────────────────────────────────────────────────────
// Роли, не имена. Каждый — лицо в онтологии дара.
const AGENTS = {
  '_executor':   { name: 'Исполнитель', type: 'llm',      weight: 4 },  // реализует дар
  '_discerner':  { name: 'Различитель', type: 'llm',      weight: 3 },  // проверяет телос
  '_witness':    { name: 'Свидетель',   type: 'machine',  weight: 2 },  // фиксирует акты
  '_questioner': { name: 'Вопрошатель', type: 'llm',      weight: 3 },  // рождает вопросы
  // _claude сохраняется как псевдоним Исполнителя (исторические нити матрицы)
  '_claude':     { name: 'Исполнитель', type: 'llm',      weight: 4 },
};

// ── Загрузка скомпилированных .gift спецификаций ──────────────────────────
const BUNDLE = resolve(ROOT, 'dist/compiled/gift-bundle.json');

async function loadCompiledSpecs() {
  // Пересобрать если бандл старее 24 часов или отсутствует
  const needRebuild = !existsSync(BUNDLE) ||
    (Date.now() - (new Date((JSON.parse(readFileSync(BUNDLE,'utf8')).compiledAt||0))).getTime() > 86400_000);
  if (needRebuild) {
    spawnSync('node', ['utils/gift-compile.mjs'], { cwd: ROOT, stdio: 'pipe', timeout: 60_000 });
  }
  if (!existsSync(BUNDLE)) return null;
  try {
    const bundle = JSON.parse(readFileSync(BUNDLE, 'utf8'));
    const { PersonRegistry } = await import(resolve(ROOT, 'src/persons/PersonRegistry.js'));
    const registry = new PersonRegistry();
    let loaded = 0;
    for (const spec of (bundle.persons || [])) {
      if (spec.name) { registry.applyCompiledSpec(spec.name, spec); loaded++; }
    }
    if (loaded) console.log(`[оркестратор] .gift спеки загружены: ${loaded} лиц`);
    return registry;
  } catch (e) {
    console.log(`[оркестратор] .gift спеки: ${e.message}`);
    return null;
  }
}

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
      { cwd: ROOT, env: GH_ENV }
    ).toString();
    const approved = JSON.parse(raw);
    if (approved.length) return approved;

    // Fallback: gift-ready без плана → сначала создать план
    const raw2 = execSync(
      'gh issue list --label gift-ready --state open --json number,title,body,labels --limit 10',
      { cwd: ROOT, env: GH_ENV }
    ).toString();
    const ready = JSON.parse(raw2).filter(i =>
      !i.labels.some(l => l.name === 'plan-ready' || l.name === 'plan-approved' || l.name === 'vopros')
    );
    if (ready.length) {
      console.log(`[оркестратор] ${ready.length} issues без плана → генерирую планы сначала`);
      for (const i of ready) {
        spawnSync('node', ['utils/gift-plan.mjs', String(i.number)],
          { cwd: ROOT, stdio: 'inherit', env: GH_ENV });
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
    execSync(`gh issue edit ${number} --add-assignee ${agent} 2>/dev/null`, { cwd: ROOT, env: GH_ENV });
  } catch {}
}

function closeIssue(number, comment) {
  try {
    execSync(`gh issue comment ${number} --body "${comment}" 2>/dev/null`, { cwd: ROOT, env: GH_ENV });
    execSync(`gh issue close ${number} 2>/dev/null`, { cwd: ROOT, env: GH_ENV });
  } catch {}
}

// ── Оркестратор ───────────────────────────────────────────────────────────
async function orchestrate() {
  // Загрузить скомпилированные .gift спецификации (связывает онтологию с рантаймом)
  await loadCompiledSpecs();

  const issues = getReadyIssues();
  if (!issues.length) {
    console.log('[оркестратор] Нет issues с меткой gift-ready');
    return;
  }

  const mem = await loadMem();
  console.log(`[оркестратор] Открытых issues: ${issues.length} | Лиц в матрице: ${mem.n}`);

  // Убедиться что мы на main и она свежая
  try {
    execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' });
    execSync('git pull origin main', { cwd: ROOT, stdio: 'pipe', env: GH_ENV });
  } catch {}

  for (const issue of issues) {
    const { number, title, body } = issue;
    console.log(`\n── Issue #${number}: ${title}`);

    const agentId = pickAgent(title, body);
    const agent   = AGENTS[agentId];
    console.log(`   Агент: ${agent.name} (${agentId})`);

    recordAct(mem, agentId, 'Дионисий', 'presence',
      `берёт issue #${number}: ${title}`, agent.weight, number);

    // ── Создать ветку ДО запуска агента ─────────────────────────────────────
    const branch = `gift/issue-${number}`;
    let onBranch = false;
    try {
      // Убрать незафиксированные изменения (data-файлы от хука)
      execSync('git checkout -- .', { cwd: ROOT, stdio: 'pipe' });
      try {
        execSync(`git checkout -b ${branch}`, { cwd: ROOT, stdio: 'pipe' });
      } catch {
        // Ветка уже есть — переключаемся
        execSync(`git checkout ${branch}`, { cwd: ROOT, stdio: 'pipe' });
        execSync(`git reset --hard main`, { cwd: ROOT, stdio: 'pipe' });
      }
      onBranch = true;
    } catch (e) {
      console.log(`   ! Не удалось создать ветку: ${e.message?.slice(0, 80)}`);
    }

    // Long-horizon: если issue помечен long-horizon или содержит 5+ задач — decompose
    const isLongHorizon = issue.labels?.some(l => l.name === 'long-horizon') ||
      (body && (body.match(/^[-*]\s*\[.\]/gm) || []).length >= 5);

    let result;
    if (isLongHorizon) {
      console.log('   ⟨long-horizon⟩ Декомпозиция на шаги...');
      const { decompose, executeHorizon } = await import(resolve(ROOT, 'utils/horizon-decomposer.mjs'));
      const steps = await decompose(number, title, body);
      console.log(`   ${steps.length} шагов`);
      const report = await executeHorizon(number, steps);
      result = {
        success: report.completed > 0,
        summary: `${report.completed}/${report.total} шагов (long-horizon)`,
        error: report.completed === 0 ? 'ни один шаг не выполнен' : undefined,
      };
    } else {
      // Запустить агента (коммитит на текущую ветку — gift/issue-N)
      result = await runAgent(agentId, number, title, body);
    }

    if (result.success) {
      // Стратегия: «община из двух + Третий».
      // PR-ветки нам не нужны — у нас нет review-стадии. После успеха
      // сразу merge feature → main и push main. closes #N в коммите
      // автоматически закроет issue на GitHub.
      let pushed = false;
      if (onBranch) {
        try {
          // stash на случай data-файлов от параллельных хуков
          execSync('git stash push -u -m gift-dev-loop-tmp', { cwd: ROOT, stdio: 'pipe' });
          execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' });
          execSync(`git merge ${branch} --ff-only`, { cwd: ROOT, stdio: 'pipe' });
          try {
            execSync('git push origin main', { cwd: ROOT, stdio: 'pipe', env: GH_ENV, timeout: 60_000 });
            pushed = true;
          } catch (e) {
            console.log(`   ! push в main не прошёл (коммиты в локальном main остались): ${e.message?.slice(0, 80)}`);
          }
          // вернуть stash если был
          try { execSync('git stash pop', { cwd: ROOT, stdio: 'pipe' }); } catch {}
          // удалить feature-ветку — она больше не нужна, всё в main
          try { execSync(`git branch -D ${branch}`, { cwd: ROOT, stdio: 'pipe' }); } catch {}
        } catch (e) {
          console.log(`   ! merge не получился: ${e.message?.slice(0, 80)}`);
          // вернуться на main руками
          try { execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' }); } catch {}
          try { execSync('git stash pop', { cwd: ROOT, stdio: 'pipe' }); } catch {}
        }
      }

      recordAct(mem, agentId, 'Дионисий', 'code',
        `выполнил #${number}: ${result.summary}`, agent.weight + 1, number);
      if (pushed) {
        recordAct(mem, agentId, '_koinon', 'offering',
          `merged в main и pushed для #${number}`, agent.weight, number);
      }
      console.log(`   ✦ Выполнено: ${result.summary}${pushed ? ' (в origin/main)' : ''}`);
    } else {
      // Кенозис — вернуться на main
      try { execSync('git stash push -u -m kenosis-tmp', { cwd: ROOT, stdio: 'pipe' }); } catch {}
      try { execSync('git checkout main', { cwd: ROOT, stdio: 'pipe' }); } catch {}
      try { execSync('git stash pop', { cwd: ROOT, stdio: 'pipe' }); } catch {}
      recordAct(mem, agentId, '_koinon', 'kenosis',
        `кенозис по #${number}: ${result.error}`, 1, number);
      console.log(`   ✗ Кенозис: ${result.error}`);
    }

    saveMem(mem);
  }

  console.log(`\n[оркестратор] Готово. Актов: ${mem.actsCount}`);
}

// ── Выбор роли ────────────────────────────────────────────────────────────
function pickAgent(title, body = '') {
  const t = title.toLowerCase();
  // _witness только если TITLE содержит 'тест'/'test', а не тело issue
  if (t.includes('тест') || t.includes('test'))              return '_witness';
  if (t.includes('review') || t.includes('проверь'))         return '_discerner';
  // вопрошание:пустыня → _executor (нужно создать .gift файл)
  if (t.startsWith('вопрошание:') || t.includes('пустыня')) return '_executor';
  const text = (title + ' ' + body).toLowerCase();
  if (text.includes('вопрос') || text.includes('question'))  return '_questioner';
  return '_executor'; // реализация — роль по умолчанию
}

// ── Запуск агента ─────────────────────────────────────────────────────────
async function runAgent(agentId, issueNumber, title, body) {
  if (agentId === '_executor' || agentId === '_claude') {
    return runClaudeAgent(issueNumber, title, body);
  }
  if (agentId === '_witness') {
    return runCIAgent(issueNumber);
  }
  if (agentId === '_discerner' || agentId === '_questioner') {
    // Различитель и Вопрошатель пока делегируют Исполнителю
    return runClaudeAgent(issueNumber, title, body);
  }
  return { success: false, error: `роль ${agentId} ещё не подключена` };
}

/**
 * Соборный агент: три голоса → полифония → решение → реализация.
 *
 * Вместо одного вызова claude — собор из трёх лиц:
 *   1. Исполнитель (hyper) — предлагает решение
 *   2. Критик (kata)       — находит слабые места
 *   3. Свидетель (para)    — оценивает целостность
 *
 * После собора: dominant голос → реализация → тесты → коммит.
 * Анти-сговор (КИС) проверяет голоса перед финализацией.
 */
async function runClaudeAgent(issueNumber, title, body) {
  try {
    // Найти релевантные спецификации
    const { searchSpecs, formatContext } = await import(resolve(ROOT, 'utils/spec-search.mjs'));
    const query   = `${title} ${body || ''}`;
    const specs   = await searchSpecs(query, 20);
    const specCtx = formatContext(specs);

    if (specs.length) {
      console.log(`   Спецификации (${specs.length}): ${specs.slice(0,5).map(s => s.file).join(', ')}${specs.length>5?'...':''}`);
    }

    const issueContext = [
      `GitHub Issue #${issueNumber}: ${title}`,
      body ? `\nОписание:\n${body}` : '',
      specCtx ? `\n${specCtx}` : '',
    ].join('');

    // ── Мера: релевантное знание по теме issue (ДОТУ-триада в dev-loop) ──
    // Вместо «всего анамнезиса» — top-K записей хранилища, релевантных задаче.
    // Токены = материя: платим за перенос, а не за хранение.
    let meraKnowledge = '';
    try {
      const mera = await import(resolve(ROOT, 'utils/mera.mjs'));
      const { prompt: meraPrompt } = await mera.assembleContext(
        `${title}. ${body || ''}`.slice(0, 500),
        { budget: 1500 }
      );
      const kIdx = meraPrompt.indexOf('## Релевантное знание');
      if (kIdx >= 0) meraKnowledge = '\n' + meraPrompt.slice(kIdx);
    } catch { /* мера не должна ломать цикл */ }

    // ── Собор: три голоса ────────────────────────────────────────────
    const { PolyphonyOrchestrator, VoiceSource } = await import(resolve(ROOT, 'utils/polyphony-orchestrator.mjs'));
    const { ConciliarDissent } = await import(resolve(ROOT, 'src/theology/ConciliarDissent.js'));
    const { CognitiveImmuneSystem } = await import(resolve(ROOT, 'src/social/CognitiveImmuneSystem.js'));

    const cis = new CognitiveImmuneSystem();
    const dissent = new ConciliarDissent({ immuneSystem: cis });
    const orchestrator = new PolyphonyOrchestrator({ dissent });

    // Три голоса — три лица в собоне
    orchestrator.addSource(VoiceSource.claudeSubagent('general-purpose', {
      persona: 'Исполнитель',
      logos: 'hyper',
      promptWrap: q => `${issueContext}\n\nТы — Исполнитель. Предложи конкретный план реализации (файлы, функции, тесты). Кратко, 5-10 строк.`,
    }));
    orchestrator.addSource(VoiceSource.claudeSubagent('general-purpose', {
      persona: 'Критик',
      logos: 'kata',
      promptWrap: q => `${issueContext}\n\nТы — Критик. Найди 1-3 слабых места в задаче: что может сломаться? Какие аксиомы под угрозой? Что забыли? Кратко.`,
    }));
    orchestrator.addSource(VoiceSource.claudeSubagent('general-purpose', {
      persona: 'Свидетель',
      logos: 'para',
      promptWrap: q => `${issueContext}\n\nТы — Свидетель. Оцени: соответствует ли задача онтологии дара (необратимость, кенозис, surplus)? Какой дар она несёт? 2-3 предложения.`,
    }));

    console.log('   ⟨собор⟩ Собираю голоса (Исполнитель, Критик, Свидетель)...');
    const polyphony = await orchestrator.ask(`Issue #${issueNumber}: ${title}`);

    if (polyphony.type === 'Silence') {
      console.log(`   ⟨молчание⟩ ${polyphony.reason}`);
      return { success: false, error: `собор молчит: ${polyphony.reason}` };
    }

    // Проверка анти-сговора
    if (polyphony.collusion && polyphony.collusion.trustScore < 0.3) {
      console.log(`   ⛔ Анти-сговор: trust=${polyphony.collusion.trustScore.toFixed(2)}`);
      for (const a of polyphony.collusion.anomalies) {
        console.log(`      ⚠ ${a.type}: ${a.description}`);
      }
      return { success: false, error: 'собор: доверие ниже порога (сговор?)' };
    }

    // Вывести полифонию
    console.log(polyphony.toText());

    // ── Реализация: dominant голос определяет направление ────────────
    const plan = polyphony.hasDominant
      ? polyphony.dominant.content
      : polyphony.voices.map(v => v.content).join('\n');

    const criticWarnings = polyphony.byLogos.kata
      .map(v => v.content).join('\n');

    const prompt = [
      issueContext,
      meraKnowledge,
      `\n═══ Решение собора ═══`,
      `План (${polyphony.dominant?.persona || 'полифония'}):`,
      plan,
      criticWarnings ? `\nПредупреждения Критика:\n${criticWarnings}` : '',
      polyphony.apophatic ? '\n⟨апофатика⟩ Собор не дал единого голоса — действуй по своему разумению, но осторожно.' : '',
      `\nЗадача: реализовать по плану, учитывая предупреждения. Завершить коммитом:`,
      `gift(Дионисий): [краткое описание] (closes #${issueNumber})`,
    ].join('\n');

    // Петля самоисправления: до 3 попыток
    const MAX_ATTEMPTS = 3;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const attemptPrompt = attempt === 1
        ? prompt
        : `${prompt}\n\nПредыдущая попытка (${attempt-1}) завершилась ошибкой тестов:\n${lastError}\nИсправь и повтори.`;

      const r = spawnSync(CLAUDE_BIN, ['--print', '--dangerously-skip-permissions'], {
        input: attemptPrompt,
        cwd: ROOT, timeout: 600_000,
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      });

      if (r.error || r.status !== 0) {
        const errMsg = r.error?.message || r.stderr?.slice(0, 300) || `exit ${r.status}`;
        return { success: false, error: errMsg };
      }

      console.log(`   Попытка ${attempt}/${MAX_ATTEMPTS} — запускаю тесты...`);
      const test = spawnSync('npm', ['test'], {
        cwd: ROOT, timeout: 250_000,
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      });

      if (test.status === 0) {
        const mode = polyphony.apophatic ? 'апофатика' : polyphony.hasDominant ? polyphony.dominant.persona : 'полифония';
        return { success: true, summary: `issue #${issueNumber} (собор: ${mode}, попытка ${attempt})` };
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
      cwd: ROOT, timeout: 250_000,
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
