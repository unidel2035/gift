#!/usr/bin/env node
/**
 * memory-compact.mjs — Архивариус auto-memory
 *
 * Переносит устаревшие файлы из ~/.claude/projects/-home-unidel-gift/memory/
 * в memory/archive/YYYY-MM/ и обновляет MEMORY.md индекс.
 *
 * Кандидаты на архивацию:
 *   — project-файлы со статусом "не начат" / "застопорилась" старше N дней
 *   — файлы не изменённые > 90 дней (кроме base)
 *   — файлы явно помеченные archived: true во frontmatter
 *
 * Запуск:
 *   node utils/memory-compact.mjs           # dry-run, показать план
 *   node utils/memory-compact.mjs --apply   # выполнить
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { homedir } from 'os';

const MEMORY_DIR = resolve(homedir(), '.claude/projects/-home-unidel-gift/memory');
const INDEX_FILE = resolve(MEMORY_DIR, 'MEMORY.md');
const ARCHIVE_DIR = resolve(MEMORY_DIR, 'archive');

const APPLY = process.argv.includes('--apply');
const STALE_DAYS = 90;
const WIP_STALE_DAYS = 30;

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const [k, ...v] = line.split(':');
    if (k && v.length) fm[k.trim()] = v.join(':').trim();
  }
  return fm;
}

function daysOld(file) {
  return (Date.now() - statSync(file).mtimeMs) / (1000 * 60 * 60 * 24);
}

function shouldArchive(file, content, fm) {
  if (fm.archived === 'true') return { yes: true, reason: 'помечен archived: true' };
  const age = daysOld(file);
  if (age > STALE_DAYS) return { yes: true, reason: `не менялся ${age.toFixed(0)} дней (>90)` };

  if (fm.type === 'project' && age > WIP_STALE_DAYS) {
    const body = content.toLowerCase();
    if (body.includes('не начат') || body.includes('застопор')) {
      return { yes: true, reason: `project "не начат/застопорилась" ${age.toFixed(0)} дней (>30)` };
    }
  }
  return { yes: false };
}

function listMemoryFiles() {
  return readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
    .map(f => resolve(MEMORY_DIR, f));
}

function archiveMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function updateIndex(archivedFiles) {
  if (!archivedFiles.length) return;
  if (!existsSync(INDEX_FILE)) return;
  let idx = readFileSync(INDEX_FILE, 'utf8');

  for (const f of archivedFiles) {
    const name = basename(f);
    const re = new RegExp(`^- \\[.*\\]\\(${name.replace(/\./g,'\\.')}\\).*$\\n?`, 'm');
    idx = idx.replace(re, '');
  }

  if (!idx.includes('## Архив')) {
    idx += `\n## Архив\n- [archive/](archive/) — устаревшие или завершённые записи по месяцам\n`;
  }
  writeFileSync(INDEX_FILE, idx);
}

function main() {
  if (!existsSync(MEMORY_DIR)) { console.error('memory dir not found'); process.exit(1); }

  const files = listMemoryFiles();
  const plan = [];

  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    const fm = parseFrontmatter(content);
    const decision = shouldArchive(f, content, fm);
    if (decision.yes) plan.push({ file: f, reason: decision.reason });
  }

  console.log(`\n═══ memory-compact (${APPLY ? 'APPLY' : 'DRY-RUN'}) ═══\n`);
  console.log(`Просмотрено: ${files.length}`);
  console.log(`К архивации: ${plan.length}\n`);

  if (!plan.length) {
    console.log('  Архивировать нечего — все файлы свежие.\n');
    return;
  }

  for (const p of plan) console.log(`  → ${basename(p.file)}  (${p.reason})`);

  if (!APPLY) {
    console.log('\n  Dry-run. Для выполнения: node utils/memory-compact.mjs --apply\n');
    return;
  }

  const targetDir = resolve(ARCHIVE_DIR, archiveMonth());
  mkdirSync(targetDir, { recursive: true });

  const archived = [];
  for (const p of plan) {
    const dest = resolve(targetDir, basename(p.file));
    renameSync(p.file, dest);
    archived.push(p.file);
    console.log(`  ✓ ${basename(p.file)} → archive/${archiveMonth()}/`);
  }

  updateIndex(archived);
  console.log(`\n  Архивировано: ${archived.length}. MEMORY.md обновлён.\n`);
}

main();
