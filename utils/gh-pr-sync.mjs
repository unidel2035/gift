#!/usr/bin/env node
/**
 * gh-pr-sync.mjs
 * Читает последний открытый PR, записывает offering-акт в матрицу W.
 * Запускается автоматически после `gh pr create`.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

let pr;
try {
  const raw = execSync(
    'gh pr list --state open --limit 1 --json number,title,author',
    { cwd: ROOT }
  ).toString();
  const list = JSON.parse(raw);
  if (!list.length) process.exit(0);
  pr = list[0];
} catch { process.exit(0); }

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const mem = existsSync(SNAP)
  ? GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')))
  : new GiftMemory(['_claude', 'Дионисий']);

mem._idx('_claude'); mem._idx('_koinon');
mem.receive({
  giverId: '_claude', receiverId: '_koinon',
  weight: 5, type: 'offering',
  content: `PR #${pr.number}: ${pr.title}`,
  linkedIssue: parseInt(pr.title.match(/#(\d+)/)?.[1] ?? 0) || null,
  irreversible: true,
});

writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
console.log(`  ✦ offering PR #${pr.number}: "${pr.title}"`);
