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

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Компиляция всех specs ─────────────────────────────────────────────────
if (process.argv[2] === '--compile') {
  const { execSync: exec } = await import('child_process');
  console.log('\n═══ GiftCompiler — компиляция всех спецификаций ═══\n');
  try {
    const output = exec('node utils/gift-compile.mjs --register', {
      cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(output);
  } catch (e) {
    console.log(e.stdout || '');
    console.error(e.stderr || e.message);
    process.exit(1);
  }
  process.exit(0);
}

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

// ── Генерировать план + улучшенное описание issue ─────────────────────────
const currentBody = issue.body || '';
const hasStructure = currentBody.includes('## Проблема') || currentBody.includes('## Problem');

const prompt = `Ты — технический архитектор проекта @unidel/gift.

Issue #${issueNum}: ${issue.title}

${currentBody ? `Текущее описание:\n${currentBody}\n` : '(описание отсутствует)\n'}

ЗАДАЧА 1: Улучши описание issue. Напиши структурированное описание в формате:

## Проблема
(конкретно: что не работает или чего не хватает — 2-3 предложения)

## Контекст
(почему это важно, на что влияет — 1-2 предложения)

## Ожидаемое поведение
(что должно работать после реализации — конкретные сценарии)

## Технические детали
(где в коде смотреть, какие файлы/функции затронуты)

## Критерии приёмки
- [ ] критерий 1
- [ ] критерий 2
- [ ] критерий 3

---

ЗАДАЧА 2: Напиши план реализации:

## Архитектура
(что создаём / меняем, какие файлы)

## Шаги
1. ...
2. ...
3. ...

## Коммит
gift(Дионисий): [предлагаемое сообщение] (closes #${issueNum})

Раздели два блока строкой: ===SPLIT===
Первый блок — улучшенное описание issue.
Второй блок — план реализации.
Максимум 40 строк суммарно.`;

// Передаём через stdin чтобы не сломать экранирование
let planOutput;
try {
  const r = spawnSync('claude', ['--print'], {
    input: prompt, cwd: ROOT, timeout: 60_000,
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
  });
  planOutput = r.stdout || '';
} catch { planOutput = ''; }

// Разбить на описание issue + план
let improvedBody = '';
let planText = '';
if (planOutput.includes('===SPLIT===')) {
  const parts = planOutput.split('===SPLIT===');
  improvedBody = parts[0].trim();
  planText = parts[1].trim();
} else {
  planText = planOutput.trim();
}

// Fallback плана
if (!planText) {
  planText = `## Архитектура
Реализация описанного в issue #${issueNum}.

## Шаги
1. Изучить контекст
2. Написать код
3. Тесты
4. Коммит

## Коммит
gift(Дионисий): ${issue.title.replace('вопрошание: ', '')} (closes #${issueNum})`;
}

// Fallback улучшенного описания
if (!improvedBody && !hasStructure && currentBody) {
  improvedBody = `## Проблема\n${currentBody}\n\n## Контекст\nИз issue: ${issue.title}\n\n## Критерии приёмки\n- [ ] Задача реализована согласно описанию\n- [ ] Тесты проходят`;
}

// ── Сохранить план локально ───────────────────────────────────────────────
const plansDir = resolve(ROOT, 'plans');
try { mkdirSync(plansDir, { recursive: true }); } catch {}

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

// ── Обновить описание issue если оно улучшилось ───────────────────────────
if (improvedBody && !hasStructure) {
  try {
    const tmpBodyFile = resolve(ROOT, `plans/issue-${issueNum}-body.md`);
    writeFileSync(tmpBodyFile, improvedBody);
    execSync(`gh issue edit ${issueNum} --body-file "${tmpBodyFile}"`, { cwd: ROOT });
    console.log(`✓ Описание issue #${issueNum} структурировано`);
  } catch (e) {
    console.log('Не удалось обновить описание issue:', e.message?.slice(0, 80));
  }
}

// ── Постить как комментарий к issue ──────────────────────────────────────
const comment = [
  `## 📜 План реализации`,
  ``,
  planText.trim(),
  ``,
  `---`,
  `*Одобри: \`gh issue edit ${issueNum} --add-label plan-approved\`*`,
].join('\n');

try {
  const tmpCommentFile = resolve(ROOT, `plans/issue-${issueNum}-comment.md`);
  writeFileSync(tmpCommentFile, comment);
  execSync(`gh issue comment ${issueNum} --body-file "${tmpCommentFile}"`, { cwd: ROOT });
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
