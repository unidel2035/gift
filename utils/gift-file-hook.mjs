#!/usr/bin/env node
/**
 * gift-file-hook.mjs — PostToolUse хук для Write/Edit
 *
 * 1. Swarm-блокировка: захватывает блокировку на записанный файл
 * 2. Индексация .gift файлов
 * 3. Логирование конфликтов
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', async () => {
  try {
    const data     = JSON.parse(raw);
    const filePath = data?.tool_input?.file_path ?? '';
    if (!filePath) process.exit(0);

    const agentId = process.env.GIFT_AGENT_ID || '_claude';

    // ── 0. Pre-write intent check ────────────────────────────────────────────
    try {
      const INTENT_MOD = resolve(ROOT, 'utils/gift-swarm-intent.mjs');
      const NOTIFY_MOD = resolve(ROOT, 'utils/gift-swarm-notify.mjs');
      if (existsSync(INTENT_MOD)) {
        const { checkIntent } = await import(INTENT_MOD);
        const conflicts = checkIntent(filePath);
        if (conflicts.length > 0) {
          for (const c of conflicts) {
            process.stderr.write(`[swarm] 📢 ${c.agent} тоже собирается трогать ${c.file}\n`);
          }
        }
      }
      // Post-write: check for overlaps and notify
      if (existsSync(NOTIFY_MOD)) {
        // Schedule check after write completes (async, don't block)
        setTimeout(() => {
          import(NOTIFY_MOD).then(m => {
            m.checkAndNotify ? m.checkAndNotify() : null;
          }).catch(() => {});
        }, 2000).unref();
      }
    } catch {}

    // ── 1. Swarm: acquire lock + release old ────────────────────────────────
    try {
      const { acquireLock, checkLock, releaseLock, detectConflicts } =
        await import(resolve(ROOT, 'utils/gift-swarm.mjs'));

      // Check if this file was locked by someone else
      const existing = checkLock(filePath);
      if (existing && existing.agent !== agentId && !existing.stale) {
        process.stderr.write(`[swarm] ⚠ файл занят: ${existing.agent} пишет ${existing.file}\n`);
      }

      // Release any previous lock by this agent on this file, then acquire
      releaseLock(filePath, agentId);
      const result = acquireLock(filePath, agentId);

      if (result.acquired) {
        // Schedule release after a short delay (lock = "recently written")
        setTimeout(() => {
          import(resolve(ROOT, 'utils/gift-swarm.mjs')).then(m => {
            m.releaseLock(filePath, agentId);
          }).catch(() => {});
        }, 30_000).unref();
      }
    } catch {
      // Swarm не загрузился — продолжаем без блокировки
    }

    // ── 2. Только .gift файлы ──────────────────────────────────────────────
    if (!filePath.endsWith('.gift')) process.exit(0);

    // Найти относительный путь относительно specs/
    const rel = filePath.includes('/specs/')
      ? filePath.slice(filePath.indexOf('/specs/') + 1)
      : null;

    if (!rel) process.exit(0);

    const { getEmbeddingService }  = await import(resolve(ROOT, 'src/kag/EmbeddingService.js'));
    const { getSQLiteVectorStore } = await import(resolve(ROOT, 'src/kag/SQLiteVectorStore.js'));
    const { readFileSync }         = await import('fs');

    const emb   = getEmbeddingService();
    const store = getSQLiteVectorStore();

    if (!(await emb.isAvailable())) process.exit(0);

    const content  = readFileSync(filePath, 'utf8');
    const cat      = rel.split('/')[1] ?? 'uncategorized';
    const preview  = content.split('\n').slice(0, 6).join('\n');
    const embedText = `[${cat}] ${filePath.split('/').pop()}\n${content.split('\n').slice(0, 40).join('\n')}`;

    const vec = await emb.embed(embedText);
    if (vec) {
      store.store(rel, vec, { cat, path: rel, preview });
      process.stderr.write(`[gift-file-hook] проиндексировано: ${rel}\n`);
    }
  } catch {
    // молчим
  }
});
