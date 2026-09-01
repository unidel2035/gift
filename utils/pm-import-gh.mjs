#!/usr/bin/env node
/**
 * pm-import-gh.mjs — разовый переезд: открытые GitHub issues → Инеграм-PM.
 *
 * Правила:
 *   plan-approved БЕЗ признаков авто-вопрошания → in_progress (человек уже сказал «да»)
 *   авто-вопрошания (пустыни, «восстановить нить», метка vopros)  → backlog (медленный контур)
 *   остальные открытые gift-ready/plan-ready                       → backlog
 *
 * Идемпотентность: перед созданием ищет в PM «(gh #N)» в заголовке.
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GH_ENV = { ...process.env, GITHUB_TOKEN: '' };
const pm = await import(resolve(ROOT, 'utils/pm.mjs'));

const AUTO = /пустын|восстановить нить/i;
const isAuto = (i) => i.labels?.some(l => l.name === 'vopros') || AUTO.test(i.title || '');

const raw = execSync(
  'gh issue list --state open --json number,title,labels,url --limit 400',
  { cwd: ROOT, env: GH_ENV }
).toString();
const issues = JSON.parse(raw);

const existing = await pm.listIssues('?limit=100');
const have = new Set((existing.items || existing).map(i => i.title.match(/gh #(\d+)/)?.[1]).filter(Boolean));
console.log(`GitHub открытых: ${issues.length}, уже в PM: ${have.size}`);

let created = 0, skipped = 0, failed = 0;
for (const i of issues) {
  if (have.has(String(i.number))) { skipped++; continue; }
  const approved = i.labels.some(l => l.name === 'plan-approved') && !isAuto(i);
  const status = approved ? 'in_progress' : 'backlog';
  const labels = i.labels.map(l => l.name).filter(n => ['vopros', 'ontology', 'feat', 'code', 'spec', 'infra'].includes(n));
  try {
    await pm.createIssue({
      title: `${i.title.slice(0, 120)} (gh #${i.number})`,
      description: `Переезд из GitHub.\nИсточник: ${i.url}\nМетки: ${i.labels.map(l => l.name).join(', ') || '—'}`,
      status,
      labels: labels.length ? labels : null,
    });
    created++;
    process.stdout.write(`  ✓ #${i.number} → ${status}\n`);
  } catch (e) {
    failed++;
    console.log(`  ✗ #${i.number}: ${e.message?.slice(0, 80)}`);
  }
}
console.log(`\nитог: создано ${created}, уже были ${skipped}, ошибок ${failed}`);
