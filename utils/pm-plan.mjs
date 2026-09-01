#!/usr/bin/env node
/**
 * pm-plan.mjs — план для задачи из Инеграм-PM.
 *
 *   node utils/pm-plan.mjs <id>       — написать план по задаче и ждать тебя
 *   node utils/pm-plan.mjs --backlog  — пройтись по стеллажу (до 10 задач)
 *
 * План пишется одним вызовом claude, кладётся комментарием в карточку,
 * карточка переезжает backlog → todo. Дальше слово за человеком: перетащил
 * в «В работе» = «да, делай».
 */
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pm = await import(resolve(ROOT, 'utils/pm.mjs'));

async function planOne(issue) {
  console.log(`план: #${issue.number} ${issue.title}`);
  const prompt = [
    `Задача #${issue.number}: ${issue.title}`,
    issue.description || '',
    `\nНапиши короткий план реализации (5-10 строк): какие файлы/модули тронуть, что получится, чем проверим.`,
    `Без вступлений и итогов — только план списком.`,
  ].join('\n');
  const r = spawnSync('claude', ['--print', '--output-format', 'json'], {
    input: prompt, cwd: ROOT, timeout: 300_000, encoding: 'utf8',
  });
  let plan = '', cost = 0;
  try {
    const d = JSON.parse(r.stdout);
    plan = (d.result || '').trim();
    cost = (d.usage?.input_tokens || 0) + (d.usage?.output_tokens || 0);
  } catch { plan = (r.stdout || '').trim(); }
  if (!plan) { console.log(`  ✗ пустой ответ (exit ${r.status})`); return false; }
  await pm.comment(issue.id, `План (черновик, ${cost} ток):\n${plan}`);
  await pm.updateIssue(issue.id, { status: 'todo' });
  console.log(`  ✓ план готов (${cost} ток) → ждёт тебя`);
  return true;
}

const [arg] = process.argv.slice(2);
if (arg === '--backlog') {
  const it = await pm.listIssues('?limit=100');
  const items = it.items || it;
  const raw = items.filter(i => i.status === 'backlog').slice(0, 10);
  console.log(`на стеллаже ${raw.length} задач — пишу планы`);
  let ok = 0;
  for (const i of raw) if (await planOne(i)) ok++;
  console.log(`готово: ${ok}/${raw.length}. Дальше — просмотри в Инеграме и перетащи достойные в «В работе».`);
} else if (arg) {
  const i = await pm.getIssue(arg);
  await planOne(i);
} else {
  console.log('использование: node utils/pm-plan.mjs <id> | --backlog');
}
