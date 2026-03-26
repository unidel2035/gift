#!/usr/bin/env node
/**
 * gift-plan.mjs
 *
 * Фаза Plan в Spec-Driven цикле.
 * Читает issue, генерирует архитектурный план,
 * сохраняет в plans/issue-N-plan.md и постит комментарием.
 *
 * Использование:
 *   node utils/gift-plan.mjs <issue-number>
 *   node utils/gift-plan.mjs --pending   # показать все ожидающие одобрения
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Показать pending планы ─────────────────────────────────────────────────
if (process.argv[2] === '--pending') {
  try {
    const issues = JSON.parse(execSync(
      'gh issue list --label plan-ready --state open --json number,title --limit 20',
      { cwd: ROOT }
    ).toString());
    if (!issues.length) { console.log('Нет issues с меткой plan-ready'); process.exit(0); }
    console.log('\n═══ Ожидают плана ═══');
    for (const i of issues) console.log(`  #${i.number}: ${i.title}`);
    console.log('\nЗапусти: node utils/gift-plan.mjs <number>');
  } catch (e) { console.error(e.message); }
  process.exit(0);
}

if (process.argv[2] === '--approved') {
  try {
    const issues = JSON.parse(execSync(
      'gh issue list --label plan-approved --state open --json number,title --limit 20',
      { cwd: ROOT }
    ).toString());
    if (!issues.length) { console.log('Нет одобренных планов'); process.exit(0); }
    console.log('\n═══ Одобрены → готовы к реализации ═══');
    for (const i of issues) console.log(`  #${i.number}: ${i.title}`);
  } catch (e) { console.error(e.message); }
  process.exit(0);
}

const issueNum = parseInt(process.argv[2]);
if (!issueNum) {
  console.log('Использование: node utils/gift-plan.mjs <issue-number>');
  process.exit(1);
}

// ── Получить issue ────────────────────────────────────────────────────────
let issue;
try {
  issue = JSON.parse(execSync(
    `gh issue view ${issueNum} --json number,title,body,labels`,
    { cwd: ROOT }
  ).toString());
} catch { console.error(`Issue #${issueNum} не найден`); process.exit(1); }

console.log(`\n📜 Планирую issue #${issueNum}: ${issue.title}\n`);

// ── Генерировать план (Claude через --print) ───────────────────────────────
const prompt = `Ты _claude — лицо в православной онтологии дара (@unidel/gift).

Issue #${issueNum}: ${issue.title}

${issue.body || ''}

Составь краткий план реализации в формате:

## Богословское основание
(1-2 предложения: почему это дар, а не транзакция)

## Архитектура
(что создаём / меняем, какие файлы)

## Шаги
1. ...
2. ...
3. ...

## Коммит
gift(Дионисий): [предлагаемое сообщение] (closes #${issueNum})

Будь краток. Максимум 20 строк.`;

let planText;
try {
  planText = execSync(`claude --print "${prompt.replace(/"/g, '\\"')}"`, {
    cwd: ROOT, timeout: 60_000, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
} catch {
  // Fallback — сгенерировать структуру без AI
  planText = `## Богословское основание
Каждый акт разработки — кенозис ради общины.

## Архитектура
Реализация описанного в issue #${issueNum}.

## Шаги
1. Изучить контекст
2. Написать код
3. Тесты
4. Коммит

## Коммит
gift(Дионисий): ${issue.title.replace('вопрошание: ', '')} (closes #${issueNum})`;
}

// ── Сохранить план локально ───────────────────────────────────────────────
const planPath = resolve(ROOT, `plans/issue-${issueNum}-plan.md`);
const planFull = `# План — Issue #${issueNum}

**${issue.title}**
*Создан: ${new Date().toLocaleString('ru')}*
*Статус: ожидает одобрения Дионисия*

---

${planText.trim()}

---
*_claude | @unidel/gift*
`;

writeFileSync(planPath, planFull);
console.log(`План сохранён: plans/issue-${issueNum}-plan.md`);

// ── Постить как комментарий к issue ──────────────────────────────────────
try {
  execSync(
    `gh issue comment ${issueNum} --body "## 📜 План от _claude\n\n${planText.trim()}\n\n---\n*Одобри командой: \`gh issue edit ${issueNum} --add-label plan-approved\`*\n*или напиши \`/approve\` в следующем комментарии*"`,
    { cwd: ROOT }
  );
  console.log(`Комментарий с планом добавлен к issue #${issueNum}`);
} catch (e) {
  console.log('Не удалось добавить комментарий:', e.message);
}

// ── Добавить метку plan-ready ─────────────────────────────────────────────
try {
  execSync(`gh label create plan-ready --color "0075ca" --description "Ожидает плана" 2>/dev/null || true`, { cwd: ROOT });
  execSync(`gh label create plan-approved --color "0e8a16" --description "План одобрен" 2>/dev/null || true`, { cwd: ROOT });
  execSync(`gh issue edit ${issueNum} --add-label plan-ready`, { cwd: ROOT });
} catch {}

console.log(`\n⏳ Жду одобрения Дионисия.`);
console.log(`   Одобрить: gh issue edit ${issueNum} --add-label plan-approved`);
console.log(`   Или: node utils/gift-dev-loop.mjs --once  (после одобрения)`);
