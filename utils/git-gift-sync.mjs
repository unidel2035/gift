#!/usr/bin/env node
/**
 * git-gift-sync.mjs
 *
 * Читает последний git commit. Если формат: gift(Получатель): описание
 * — обновляет матрицу W. Запускается автоматически после git commit.
 *
 * Формат коммита: gift(Дионисий): что сделано
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP  = resolve(ROOT, 'data/sacred-history-W.json');

// Последний коммит
let msg;
try {
  msg = execSync('git log -1 --pretty=%s', { cwd: ROOT }).toString().trim();
} catch {
  process.exit(0); // не git-репо или нет коммитов
}

// Формат: gift(Получатель): описание (closes #N)
const m = msg.match(/^gift\(([^)]+)\):\s*(.+)$/);
if (!m) process.exit(0); // не дар — игнорируем

const receiver    = m[1].trim();
const description = m[2].trim();

// Извлечь linkedIssue если есть "closes #N" или "#N"
const issueMatch  = description.match(/#(\d+)/);
const linkedIssue = issueMatch ? parseInt(issueMatch[1]) : null;

// Обновить матрицу
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));

let mem;
if (existsSync(SNAP)) {
  mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
} else {
  mem = new GiftMemory(['Отец', 'Сын', 'Дух', '_claude', 'Дионисий']);
}

mem._idx('_claude');
mem._idx(receiver);

mem.receive({
  giverId:      '_claude',
  receiverId:   receiver,
  weight:       4,
  type:         'code',
  content:      description,
  linkedIssue,
  irreversible: true,
});

const snap = mem.snapshot();
if (!existsSync(resolve(ROOT, 'data'))) mkdirSync(resolve(ROOT, 'data'));
writeFileSync(SNAP, JSON.stringify(snap, null, 2));

// ── Act-index: локальный журнал актов с провенансом ───────────────────────
const ACT_INDEX = resolve(ROOT, 'data/act-index.json');
const actLog = existsSync(ACT_INDEX) ? JSON.parse(readFileSync(ACT_INDEX, 'utf8')) : [];
let commitHash = '';
try { commitHash = execSync('git log -1 --pretty=%H', { cwd: ROOT }).toString().trim().slice(0, 12); } catch {}
actLog.push({
  ts:          new Date().toISOString(),
  from:        '_claude',
  to:          receiver,
  type:        'code',
  weight:      4,
  content:     description,
  linkedIssue: linkedIssue ?? null,
  commit:      commitHash,
});
if (actLog.length > 500) actLog.splice(0, actLog.length - 500);
writeFileSync(ACT_INDEX, JSON.stringify(actLog, null, 2));

console.log(`  ✦ gift(_claude → ${receiver}): "${description}"`);
console.log(`    Актов: ${mem.actsCount} | _claude дал: ${mem.totalGiven('_claude').toFixed(1)}`);

// ── Sync to nous (если доступен) ──────────────────────────────────────────
const NOUS_URL = process.env.NOUS_URL || '';
if (NOUS_URL) {
  const act = {
    ts: new Date().toISOString(), from: '_claude', to: receiver,
    type: 'code', weight: 4, content: description,
    linkedIssue: linkedIssue ?? null, commit: commitHash,
  };
  fetch(`${NOUS_URL}/acts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(act),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
  fetch(`${NOUS_URL}/matrix/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ giverId: '_claude', receiverId: receiver, weight: 4, type: 'code', content: description, linkedIssue, irreversible: true }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
