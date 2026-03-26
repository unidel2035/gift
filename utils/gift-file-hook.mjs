#!/usr/bin/env node
/**
 * gift-file-hook.mjs — PostToolUse хук для Write/Edit
 *
 * Читает tool_result из stdin (JSON).
 * Если записан .gift файл → переиндексирует его в векторное хранилище.
 * Работает инкрементально — только изменённый файл.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', async () => {
  try {
    const data     = JSON.parse(raw);
    const filePath = data?.tool_input?.file_path ?? '';

    // Только .gift файлы
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
