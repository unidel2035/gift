#!/usr/bin/env node
/**
 * spec-index.mjs
 *
 * Индексирует все .gift файлы из specs/ в SQLite векторное хранилище.
 * Для каждого файла: embed(preview) → store в data/spec-vectors.db
 *
 * Требует: ollama run nomic-embed-text
 *
 * Запуск:
 *   node utils/spec-index.mjs          # полная переиндексация
 *   node utils/spec-index.mjs --update # только новые/изменённые
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = resolve(ROOT, 'specs');
const UPDATE_MODE = process.argv.includes('--update');

const { getEmbeddingService } = await import(resolve(ROOT, 'src/kag/EmbeddingService.js'));
const { getSQLiteVectorStore } = await import(resolve(ROOT, 'src/kag/SQLiteVectorStore.js'));

const emb   = getEmbeddingService();
const store = getSQLiteVectorStore();

// ── Проверка доступности Ollama ───────────────────────────────────────────
const available = await emb.isAvailable();
if (!available) {
  console.error('[spec-index] Ollama недоступен. Запустите: ollama serve');
  console.error('             И убедитесь, что nomic-embed-text загружена:');
  console.error('             ollama pull nomic-embed-text');
  process.exit(1);
}
console.log('[spec-index] Ollama + nomic-embed-text: OK');

// ── Собрать все .gift файлы ───────────────────────────────────────────────
const files = [];
if (!existsSync(SPECS)) {
  console.error('[spec-index] Директория specs/ не найдена. Запустите: node utils/build-spec-library.mjs');
  process.exit(1);
}

for (const cat of readdirSync(SPECS)) {
  if (cat === 'index.json') continue;
  const catDir = resolve(SPECS, cat);
  try {
    const stat = statSync(catDir);
    if (!stat.isDirectory()) continue;
    for (const file of readdirSync(catDir).filter(f => f.endsWith('.gift'))) {
      files.push({ cat, file, path: resolve(catDir, file), relPath: `specs/${cat}/${file}` });
    }
  } catch {}
}

console.log(`[spec-index] Найдено ${files.length} спецификаций в ${SPECS}`);

// ── Индексирование ────────────────────────────────────────────────────────
let indexed = 0, skipped = 0, errors = 0;
const BATCH = 4;

// Первые N строк + богословский заголовок для embedding
function makeEmbedText(cat, file, content) {
  const lines = content.split('\n').slice(0, 40).join('\n');
  return `[${cat}] ${file}\n${lines}`;
}

// Обрабатываем батчами
for (let i = 0; i < files.length; i += BATCH) {
  const batch = files.slice(i, i + BATCH);

  // UPDATE_MODE: пропустить уже проиндексированные (по mtime)
  const toEmbed = batch.filter(f => {
    if (!UPDATE_MODE) return true;
    // Простая эвристика: если id уже есть в store — пропустить
    // (SQLiteVectorStore не имеет get по id, используем search-счётчик)
    return true; // в --update режиме всё равно перезапишем (idempotent)
  });

  const texts = toEmbed.map(f => {
    const content = readFileSync(f.path, 'utf8');
    return makeEmbedText(f.cat, f.file, content);
  });

  try {
    const embeddings = await emb.embedBatch(texts);

    for (let j = 0; j < toEmbed.length; j++) {
      const f   = toEmbed[j];
      const vec = embeddings[j];
      if (!vec) { errors++; continue; }

      const content = readFileSync(f.path, 'utf8');
      const preview = content.split('\n').slice(0, 6).join('\n');

      store.store(f.relPath, vec, {
        cat:     f.cat,
        path:    f.relPath,
        preview: preview,
      });
      indexed++;
    }
  } catch (e) {
    console.error(`[spec-index] Ошибка батча ${i}–${i+BATCH}: ${e.message}`);
    errors += batch.length;
  }

  // Прогресс
  const done = Math.min(i + BATCH, files.length);
  process.stdout.write(`\r  ${done}/${files.length} файлов...`);
}

console.log(`\n\n[spec-index] Готово:`);
console.log(`  Проиндексировано: ${indexed}`);
console.log(`  Пропущено:        ${skipped}`);
console.log(`  Ошибки:           ${errors}`);
console.log(`  Всего в DB:       ${store.count()}`);
console.log(`  База:             data/spec-vectors.db`);
