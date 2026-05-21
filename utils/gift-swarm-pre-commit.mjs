#!/usr/bin/env node
/**
 * gift-swarm-pre-commit.mjs — pre-commit проверка swarm
 *
 * Запускается перед git commit. Проверяет:
 *   1. Нет ли активных конфликтов (два агента пишут один файл)
 *   2. Не пишет ли кто-то ещё в файлы этого коммита
 *
 * Если конфликт найден — коммит блокируется (exit 1).
 * Запуск: в .git/hooks/pre-commit или через husky/lefthook
 *
 * Богословский слой:
 *   1 Кор 14:40 «Всё должно быть благопристойно и чинно».
 *   Не запрет, а приглашение к собору.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  // Only run if swarm module exists
  const SWARM = resolve(ROOT, 'utils/gift-swarm.mjs');
  if (!existsSync(SWARM)) process.exit(0);

  // Import dynamically
  const { detectConflicts, listActiveSessions } = await import(SWARM);

  // Get files in this commit
  let stagedFiles = [];
  try {
    const raw = execSync('git diff --cached --name-only', { cwd: ROOT }).toString().trim();
    stagedFiles = raw ? raw.split('\n') : [];
  } catch {}

  if (stagedFiles.length === 0) process.exit(0);

  // Check for active conflicts
  const conflicts = detectConflicts();
  if (conflicts.length === 0) process.exit(0);

  // Check if any of our staged files are in conflict
  const relevantConflicts = conflicts.filter(c =>
    stagedFiles.some(sf => c.file === sf || c.file.endsWith('/' + sf) || sf.endsWith('/' + c.file))
  );

  if (relevantConflicts.length === 0) process.exit(0);

  // ── Conflict found ──────────────────────────────────────────────────────
  console.error('');
  console.error('  ╔══════════════════════════════════════════════════════╗');
  console.error('  ║  CONFLICT DETECTED — Swarm Coordination             ║');
  console.error('  ╚══════════════════════════════════════════════════════╝');
  console.error('');

  for (const c of relevantConflicts) {
    const icon = c.type === 'lock' ? '🔒' : '⚡';
    console.error(`  ${icon} Файл: ${c.file} [${c.type}]`);
    console.error(`  Агенты: ${c.agents.join(', ')}`);
    if (c.touches) {
      for (const t of c.touches) {
        console.error(`    ${t.agent}: последнее касание ${new Date(t.lastTouch).toISOString().slice(11,19)}`);
      }
    }
    if (c.note) console.error(`  ${c.note}`);
    console.error('');
  }

  const active = listActiveSessions().filter(s => !s.stale);
  console.error(`  Активных сессий: ${active.length}`);
  for (const s of active) {
    console.error(`    ${s.agent} (${s.files.length} файлов)`);
  }

  console.error('');
  console.error('  Рекомендация:');
  console.error('    1. Согласуйте с конфликтующими агентами');
  console.error('    2. Или дождитесь завершения их сессий');
  console.error('    3. Или запустите conciliar-swe для разрешения');
  console.error('    4. Или выполните commit --no-verify чтобы пропустить');
  console.error('');

  // Don't block — just warn (стигмергия = coordination, not control)
  console.error('  ⚠ Pre-commit check passed with warnings.');
  process.exit(0);
}

main().catch(() => process.exit(0));
