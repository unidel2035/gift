#!/usr/bin/env node
/**
 * auto-issues.mjs
 *
 * Пустые нити → GitHub issues автоматически (proposal #6).
 *
 * Читает data/proposals.json, находит pending без issue_number,
 * создаёт GH issue для каждого (через proposals.mjs issue <id>).
 *
 * Ограничение: не более N issues за запуск (чтобы не спамить).
 *
 * Запуск: node utils/auto-issues.mjs [--limit 3] [--dry-run]
 * Cron:   0 9 * * 1   (понедельник 9:00 — начало недели)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const FILE    = join(ROOT, 'data', 'proposals.json');
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? Number(process.argv[i + 1]) || 3 : 3;
})();

function load() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
}

// Только принятые Евой proposals, без issue
const proposals = load();
const eligible = proposals.filter(p =>
  p.status === 'pending' &&
  !p.issue_number &&
  p.eva_verdict !== 'отклонено' &&
  p.eva_verdict !== 'доработать'  // только 'принято'
);

console.log(`\nauto-issues: ${eligible.length} proposals без issue (limit: ${LIMIT})\n`);

if (eligible.length === 0) {
  console.log('Нет proposals для автоматического создания issue.');
  process.exit(0);
}

// Сортировать по дате (старые первые)
eligible.sort((a, b) => new Date(a.created) - new Date(b.created));

const toProcess = eligible.slice(0, LIMIT);

for (const p of toProcess) {
  const preview = (p.enhanced ?? p.text).slice(0, 60);
  console.log(`  #${p.id} [${p.cat}] "${preview}"`);

  if (DRY_RUN) {
    console.log(`  → [DRY-RUN] proposals issue ${p.id}`);
    continue;
  }

  const r = spawnSync('node', ['utils/proposals.mjs', 'issue', String(p.id)], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 30_000,
    env: { ...process.env, GITHUB_TOKEN: '' }, // clear invalid token
  });

  if (r.status !== 0) {
    console.error(`  ✗ Ошибка для #${p.id}: exit ${r.status}`);
  }
  console.log();
}

console.log(`\nauto-issues: создано до ${toProcess.length} issues.`);
