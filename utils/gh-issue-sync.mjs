#!/usr/bin/env node
/**
 * gh-issue-sync.mjs
 *
 * Читает последний созданный GitHub issue.
 * Если заголовок: вопрошание: тема — записывает в матрицу W.
 *
 * Запускается автоматически после `gh issue create`.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

// Последний открытый issue
let issue;
try {
  const raw = execSync(
    'gh issue list --state open --limit 1 --json number,title,author',
    { cwd: ROOT }
  ).toString();
  const list = JSON.parse(raw);
  if (!list.length) process.exit(0);
  issue = list[0];
} catch {
  process.exit(0);
}

// Формат: вопрошание: тема
const m = issue.title.match(/^вопрошание:\s*(.+)$/i);
if (!m) process.exit(0);

const topic    = m[1].trim();
const giverId  = issue.author?.login === 'unidel2035' ? 'Дионисий' : (issue.author?.login ?? '_koinon');

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));

let mem;
if (existsSync(SNAP)) {
  mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
} else {
  mem = new GiftMemory(['Отец', 'Сын', 'Дух', '_claude', 'Дионисий']);
}

mem._idx(giverId);
mem._idx('_koinon');

mem.receive({
  giverId,
  receiverId:  '_koinon',
  weight:      5,
  type:        'question',
  content:     `вопрошание #${issue.number}: ${topic}`,
  linkedIssue: issue.number,
  irreversible: true,
});

if (!existsSync(resolve(ROOT, 'data'))) mkdirSync(resolve(ROOT, 'data'));
writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));

console.log(`  ✦ вопрошание #${issue.number}: "${topic}"`);
console.log(`    ${giverId} → _koinon | Актов: ${mem.actsCount}`);
