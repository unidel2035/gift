#!/usr/bin/env node
/**
 * act-index-view.mjs — просмотр локального журнала актов
 *
 * Показывает провенанс: кто → кому, с каким issue, когда.
 *
 * Использование:
 *   node utils/act-index-view.mjs              — последние 20 актов
 *   node utils/act-index-view.mjs --issue 77   — акты по issue #77
 *   node utils/act-index-view.mjs --from _claude — акты от лица
 *   node utils/act-index-view.mjs --summary    — сводка по нитям
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACT_INDEX = resolve(ROOT, 'data/act-index.json');

if (!existsSync(ACT_INDEX)) {
  console.log('act-index.json не найден — актов ещё нет.');
  process.exit(0);
}

const acts = JSON.parse(readFileSync(ACT_INDEX, 'utf8'));

const args    = process.argv.slice(2);
const issueF  = args.includes('--issue')   ? Number(args[args.indexOf('--issue')   + 1]) : null;
const fromF   = args.includes('--from')    ? args[args.indexOf('--from')   + 1] : null;
const toF     = args.includes('--to')      ? args[args.indexOf('--to')     + 1] : null;
const summary = args.includes('--summary');
const limit   = args.includes('--limit')   ? Number(args[args.indexOf('--limit')   + 1]) : 20;

if (summary) {
  // Сводка: суммарный вес по нитям с провенансом issue
  const threads = {};
  const byIssue = {};
  for (const a of acts) {
    const key = `${a.from}→${a.to}`;
    threads[key] = (threads[key] || 0) + (a.weight || 0);
    if (a.linkedIssue) {
      byIssue[a.linkedIssue] = byIssue[a.linkedIssue] || [];
      byIssue[a.linkedIssue].push({ key, weight: a.weight, type: a.type });
    }
  }
  console.log('\n── Нити (суммарный вес) ──');
  for (const [k, w] of Object.entries(threads).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${w.toFixed(1)}`);
  }
  console.log('\n── По issue ──');
  for (const [n, entries] of Object.entries(byIssue).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 10)) {
    const total = entries.reduce((s, e) => s + e.weight, 0);
    console.log(`  #${n}: ${entries.map(e => `${e.key}(${e.type},${e.weight})`).join(' + ')} = ${total}`);
  }
  console.log(`\nВсего актов: ${acts.length}`);
  process.exit(0);
}

// Фильтрация
let filtered = acts;
if (issueF) filtered = filtered.filter(a => a.linkedIssue === issueF);
if (fromF)  filtered = filtered.filter(a => a.from === fromF);
if (toF)    filtered = filtered.filter(a => a.to   === toF);

const shown = filtered.slice(-limit);

console.log(`\n── Act-index (${shown.length}/${filtered.length} актов) ──`);
for (const a of shown) {
  const date    = a.ts.slice(0, 16).replace('T', ' ');
  const issue   = a.linkedIssue ? ` #${a.linkedIssue}` : '';
  const commit  = a.commit ? ` [${a.commit}]` : '';
  console.log(`  ${date}  ${a.from.padEnd(12)} →${a.to.padEnd(12)} [${a.type}] w=${a.weight}${issue}${commit}`);
  if (a.content) console.log(`    "${a.content.slice(0, 80)}"`);
}
console.log(`\nВсего в журнале: ${acts.length}`);
