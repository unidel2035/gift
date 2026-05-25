#!/usr/bin/env node
/**
 * horizon-decomposer.mjs — Long-horizon decomposer (proposal #61)
 *
 * Разбивает сложный issue на шаги (до 32+), с checkpoint'ами между ними.
 * Каждый шаг — отдельный вызов claude --print с контекстом предыдущих.
 *
 * Принцип: не один гигантский prompt, а цепочка шагов с обратной связью.
 * После каждого шага — checkpoint: проверка тестов, commit, обновление W.
 *
 * Использование:
 *   node utils/horizon-decomposer.mjs <issue-number>
 *   node utils/horizon-decomposer.mjs --plan <issue-number>  (только план без выполнения)
 *
 * Интеграция:
 *   gift-dev-loop.mjs вызывает decompose() для issues с меткой 'long-horizon'
 *   или когда body issue содержит 5+ задач.
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HORIZONS_DIR = resolve(ROOT, 'data/horizons');
const CLAUDE_BIN = process.env.CLAUDE_BIN
  || (existsSync('/home/new/.local/bin/claude') ? '/home/new/.local/bin/claude' : null)
  || 'claude';
const GH_ENV = { ...process.env, GITHUB_TOKEN: '' };

if (!existsSync(HORIZONS_DIR)) mkdirSync(HORIZONS_DIR, { recursive: true });

// ── Декомпозиция ──────────────────────────────────────────────────────────

/**
 * Разбить issue на шаги через LLM.
 * @param {number} issueNumber
 * @param {string} title
 * @param {string} body
 * @returns {Array<{ step: number, title: string, description: string, test: string }>}
 */
export async function decompose(issueNumber, title, body) {
  const prompt = `Ты — архитектор. Разбей задачу на последовательные шаги (2-32).
Каждый шаг должен быть:
- Атомарным (один коммит)
- Тестируемым (можно проверить результат)
- Независимым от последующих (можно остановиться после любого)

Задача: Issue #${issueNumber}: ${title}
${body ? `Описание:\n${body}` : ''}

Ответь ТОЛЬКО в формате JSON (без markdown):
[
  { "step": 1, "title": "краткое название", "description": "что сделать", "test": "как проверить" },
  ...
]`;

  try {
    const result = spawnSync(CLAUDE_BIN, ['--print', '-p', prompt], {
      cwd: ROOT,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: GH_ENV,
    });

    const output = result.stdout?.toString() || '';
    // Извлечь JSON из ответа
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('[decomposer] Не удалось извлечь JSON из ответа LLM');
      return fallbackDecompose(title, body);
    }

    const steps = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(steps) || steps.length === 0) {
      return fallbackDecompose(title, body);
    }

    return steps.map((s, i) => ({
      step: i + 1,
      title: s.title || `Шаг ${i + 1}`,
      description: s.description || '',
      test: s.test || 'npm test',
    }));
  } catch (e) {
    console.log(`[decomposer] LLM ошибка: ${e.message}`);
    return fallbackDecompose(title, body);
  }
}

/**
 * Fallback: простая декомпозиция по строкам body.
 */
function fallbackDecompose(title, body) {
  if (!body) return [{ step: 1, title, description: title, test: 'npm test' }];

  // Ищем чеклист (- [ ] ...) или нумерованный список
  const items = body.match(/(?:^[-*]\s*\[.\]\s*|^\d+\.\s+).+/gm);
  if (items && items.length >= 2) {
    return items.map((item, i) => ({
      step: i + 1,
      title: item.replace(/^[-*]\s*\[.\]\s*|^\d+\.\s+/, '').trim(),
      description: item.trim(),
      test: 'npm test',
    }));
  }

  return [{ step: 1, title, description: body, test: 'npm test' }];
}

// ── Checkpoint: проверка после каждого шага ────────────────────────────────

/**
 * Checkpoint: запустить тесты и проверить результат.
 * @returns {{ passed: boolean, output: string }}
 */
function checkpoint() {
  try {
    const result = spawnSync('npm', ['test'], {
      cwd: ROOT,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = result.stdout?.toString() || '';
    const passed = result.status === 0;
    return { passed, output: output.slice(-500) };
  } catch (e) {
    return { passed: false, output: e.message };
  }
}

// ── Выполнение цепочки шагов ──────────────────────────────────────────────

/**
 * Выполнить все шаги последовательно с checkpoint'ами.
 * @param {number} issueNumber
 * @param {Array} steps — шаги из decompose()
 * @returns {{ completed: number, total: number, results: Array }}
 */
export async function executeHorizon(issueNumber, steps) {
  const horizonId = `horizon-${issueNumber}-${Date.now()}`;
  const horizonDir = resolve(HORIZONS_DIR, horizonId);
  mkdirSync(horizonDir, { recursive: true });

  const results = [];
  let completed = 0;

  // Сохранить план
  writeFileSync(
    resolve(horizonDir, 'plan.json'),
    JSON.stringify({ issueNumber, steps, startedAt: new Date().toISOString() }, null, 2)
  );

  for (const step of steps) {
    console.log(`\n  ── Шаг ${step.step}/${steps.length}: ${step.title}`);

    // Контекст предыдущих шагов
    const prevContext = results.length > 0
      ? `\nУже выполнены:\n${results.map(r => `  ✓ Шаг ${r.step}: ${r.title} — ${r.summary}`).join('\n')}`
      : '';

    const prompt = `Issue #${issueNumber}, шаг ${step.step}/${steps.length}: ${step.title}

${step.description}
${prevContext}

Проверка: ${step.test}

Сделай ТОЛЬКО этот шаг. Завершить коммитом:
gift(Дионисий): ${step.title} (шаг ${step.step}/${steps.length}, closes #${issueNumber})`;

    try {
      const result = spawnSync(CLAUDE_BIN, ['--print', '-p', prompt], {
        cwd: ROOT,
        timeout: 300_000,
        maxBuffer: 2 * 1024 * 1024,
        env: GH_ENV,
      });

      const output = result.stdout?.toString() || '';
      const success = result.status === 0;

      // Checkpoint
      const check = checkpoint();

      const stepResult = {
        step: step.step,
        title: step.title,
        success: success && check.passed,
        summary: output.slice(-200).replace(/\n/g, ' ').trim(),
        testsPassed: check.passed,
        completedAt: new Date().toISOString(),
      };

      results.push(stepResult);

      if (stepResult.success) {
        completed++;
        console.log(`     ✓ Тесты: pass`);
      } else {
        console.log(`     ✗ ${check.passed ? 'Claude ошибка' : 'Тесты: fail'}`);
        // Записать checkpoint и остановиться
        writeFileSync(
          resolve(horizonDir, 'checkpoint.json'),
          JSON.stringify({
            stoppedAt: step.step,
            reason: check.passed ? 'claude error' : 'tests failed',
            results,
            testOutput: check.output,
          }, null, 2)
        );
        console.log(`     ⛔ Остановлен на шаге ${step.step}. Checkpoint сохранён.`);
        break;
      }
    } catch (e) {
      console.log(`     ✗ Ошибка: ${e.message?.slice(0, 100)}`);
      results.push({
        step: step.step,
        title: step.title,
        success: false,
        summary: e.message?.slice(0, 200),
        completedAt: new Date().toISOString(),
      });
      break;
    }
  }

  // Финальный отчёт
  const report = {
    horizonId,
    issueNumber,
    completed,
    total: steps.length,
    results,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(resolve(horizonDir, 'report.json'), JSON.stringify(report, null, 2));

  return report;
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const planOnly = args.includes('--plan');
  const issueNumber = parseInt(args.find(a => /^\d+$/.test(a)));

  if (!issueNumber) {
    console.log('Использование: node utils/horizon-decomposer.mjs [--plan] <issue-number>');
    process.exit(1);
  }

  // Получить issue из GitHub
  let title, body;
  try {
    const raw = execSync(`gh issue view ${issueNumber} --json title,body`, {
      cwd: ROOT, env: GH_ENV,
    }).toString();
    const issue = JSON.parse(raw);
    title = issue.title;
    body = issue.body;
  } catch {
    console.log(`Не удалось получить issue #${issueNumber} из GitHub`);
    process.exit(1);
  }

  console.log(`\n═══ Horizon Decomposer — Issue #${issueNumber} ═══`);
  console.log(`  ${title}\n`);

  const steps = await decompose(issueNumber, title, body);

  console.log(`Декомпозиция: ${steps.length} шагов`);
  for (const s of steps) {
    console.log(`  ${s.step}. ${s.title}`);
  }

  if (planOnly) {
    console.log('\n--plan: только план, без выполнения.');
    writeFileSync(
      resolve(HORIZONS_DIR, `plan-${issueNumber}.json`),
      JSON.stringify({ issueNumber, title, steps }, null, 2)
    );
    return;
  }

  console.log('\nЗапускаю выполнение...');
  const report = await executeHorizon(issueNumber, steps);
  console.log(`\n═══ Результат: ${report.completed}/${report.total} шагов выполнено ═══`);
}

// Запуск из CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
