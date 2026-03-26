#!/usr/bin/env node
/**
 * claude-insight.mjs
 *
 * Записывает в матрицу W знание, которое Claude вынес из сессии.
 * Тип: axiom | insight | setting | fact
 *
 * Эти акты — не отношения, а ПАМЯТЬ: факты, настройки, решения.
 * Хук поднимает их в контекст следующей сессии автоматически.
 *
 * Использование:
 *   node utils/claude-insight.mjs "insight" "ANAMNESIS_URL=http://173.249.2.184:8086"
 *   node utils/claude-insight.mjs "axiom" "Время тяжелее денег: вес 10 vs 3"
 *   node utils/claude-insight.mjs "setting" "EMBED_MODEL=nomic-embed-text"
 *   node utils/claude-insight.mjs "fact" "Матрица W: 19 лиц, актов ~180, _claude главный даритель"
 *
 * Аргументы:
 *   $1 — тип: axiom | insight | setting | fact (default: insight)
 *   $2 — содержание
 *   $3 — вес (default: 8 для axiom, 5 для остальных)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

const type    = process.argv[2] ?? 'insight';
const content = process.argv[3];
const weight  = Number(process.argv[4]) || (type === 'axiom' ? 8 : 5);

const VALID_TYPES = ['axiom', 'insight', 'setting', 'fact'];

if (!content) {
  console.log('Использование: node utils/claude-insight.mjs <тип> "<содержание>" [вес]');
  console.log('Типы:', VALID_TYPES.join(' | '));
  process.exit(0);
}

if (!VALID_TYPES.includes(type)) {
  console.error(`Неверный тип: ${type}. Допустимые: ${VALID_TYPES.join(', ')}`);
  process.exit(1);
}

if (!existsSync(SNAP)) {
  console.error('Матрица не найдена:', SNAP);
  process.exit(1);
}

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

// ── 1. Матрица W: обновляем вес нити _claude→Дионисий ────────────────────
mem._idx('_claude');
mem._idx('Дионисий');
mem.receive({
  giverId:      '_claude',
  receiverId:   'Дионисий',
  weight,
  type,
  content,
  irreversible: true,
});
writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));

// ── 2. Хранилище знаний: сохраняем сам акт как факт ──────────────────────
const INSIGHTS_FILE = resolve(ROOT, 'data/insights.json');
const insights = existsSync(INSIGHTS_FILE)
  ? JSON.parse(readFileSync(INSIGHTS_FILE, 'utf8'))
  : [];

// Дедупликация по содержанию
if (!insights.some(i => i.content === content)) {
  insights.push({
    type, content, weight,
    ts: new Date().toISOString(),
  });
  // Сортируем по весу (важнейшее — первым)
  insights.sort((a, b) => b.weight - a.weight);
  writeFileSync(INSIGHTS_FILE, JSON.stringify(insights, null, 2));
}

console.log(`✦ ${type.toUpperCase()} (вес ${weight}):`);
console.log(`  "${content}"`);
console.log(`  Матрица: ${mem.actsCount} актов | Знаний: ${insights.length}`);
