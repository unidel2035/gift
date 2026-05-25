#!/usr/bin/env node
/**
 * gift-commit-hook.mjs — post-commit хук
 *
 * Парсит коммит формата:  gift(Дионисий): что сделано (closes #N)
 * Записывает акт в:
 *   1. Матрица W  — gift/data/sacred-history-W.json
 *   2. Nous acts  — nous/data/acts.json  (с linkedIssue, linkedCommit)
 *   3. Nous anamnesis — nous/data/anamnesis.json
 *
 * Формат коммита:
 *   gift(получатель): описание
 *   gift(получатель): описание (closes #42)
 *   gift(получатель): описание (#42)
 *
 * Обычные коммиты (без gift(...):) — игнорируются.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOUS_DATA = resolve(ROOT, '../nous/data');
const SNAP_PATH = resolve(ROOT, 'data/sacred-history-W.json');

// ─── Читать сообщение последнего коммита ───────────────
let commitMsg, commitHash, commitAuthor;
try {
  commitMsg    = execSync('git log -1 --pretty=%B', { cwd: ROOT, encoding: 'utf8' }).trim();
  commitHash   = execSync('git log -1 --pretty=%H', { cwd: ROOT, encoding: 'utf8' }).trim().slice(0, 12);
  commitAuthor = execSync('git log -1 --pretty=%an', { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  process.exit(0); // не git репо — молчим
}

// ─── Парсить формат gift(...): ... ────────────────────
// gift(Получатель): описание (closes #42)
const match = commitMsg.match(/^gift\(([^)]+)\):\s*(.+)/s);
if (!match) process.exit(0); // не gift-коммит

const receiver    = match[1].trim();
const description = match[2].replace(/\s*\(?(closes|refs?|#)\s*#?\d+\)?/gi, '').trim();
const issueMatch  = commitMsg.match(/#(\d+)/);
const linkedIssue = issueMatch ? Number(issueMatch[1]) : null;

// ─── Определить дарителя ──────────────────────────────
// Если автор коммита — _claude (из конфига или env), иначе gh/автор
const isClaudeCommit = commitMsg.includes('Co-Authored-By: Claude') ||
                       process.env.GIT_AUTHOR_NAME?.includes('claude') ||
                       commitAuthor.toLowerCase().includes('claude');
const giverId = isClaudeCommit ? '_claude' : `gh/${commitAuthor.replace(/\s+/g, '-').toLowerCase()}`;

// ─── Слой 1: Матрица W ────────────────────────────────
try {
  const { GiftMemory } = await import('../src/core/GiftMemory.js');
  let mem;
  try {
    mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP_PATH, 'utf8')));
  } catch {
    mem = new GiftMemory(['_claude', '_koinon', '_abyss']);
  }

  mem.receive({
    giverId,
    receiverId: receiver === '_koinon' ? '_koinon' : receiver,
    weight: 4,
    type: 'code',
    content: description,
    irreversible: true,
  });

  writeFileSync(SNAP_PATH, JSON.stringify(mem.snapshot(), null, 2));
  process.stderr.write(`[gift-hook] W-матрица: ${giverId} → ${receiver} (code, 4)\n`);
} catch (e) {
  process.stderr.write(`[gift-hook] матрица: ${e.message}\n`);
}

// ─── Слой 2: Nous acts ────────────────────────────────
const actsPath = resolve(NOUS_DATA, 'acts.json');
if (existsSync(NOUS_DATA)) {
  try {
    let acts = [];
    try { acts = JSON.parse(readFileSync(actsPath, 'utf8')); } catch {}

    const act = {
      from:       giverId,
      to:         receiver,
      type:       'code',
      weight:     4,
      content:    description,
      irreversible: true,
      ts:         new Date().toISOString(),
      linkedCommit: commitHash,
      ...(linkedIssue ? { linkedIssue } : {}),
    };

    acts.push(act);
    if (acts.length > 2000) acts.splice(0, acts.length - 2000);
    writeFileSync(actsPath, JSON.stringify(acts, null, 2));
    process.stderr.write(`[gift-hook] Nous acts: #${acts.length}${linkedIssue ? ' (issue #' + linkedIssue + ')' : ''}\n`);
  } catch (e) {
    process.stderr.write(`[gift-hook] nous acts: ${e.message}\n`);
  }

  // ─── Слой 3: Nous anamnesis ──────────────────────────
  const anamPath = resolve(NOUS_DATA, 'anamnesis.json');
  try {
    let tape = [];
    try { tape = JSON.parse(readFileSync(anamPath, 'utf8')); } catch {}

    tape.push({
      type:     'code-gift',
      giver:    giverId,
      receiver,
      content:  `${description}${linkedIssue ? ' (→ #' + linkedIssue + ')' : ''}`,
      commit:   commitHash,
      ...(linkedIssue ? { linkedIssue } : {}),
      ts:       new Date().toISOString(),
    });

    if (tape.length > 1000) tape.splice(0, tape.length - 1000);
    writeFileSync(anamPath, JSON.stringify(tape, null, 2));
    process.stderr.write(`[gift-hook] Nous anamnesis: лента = ${tape.length}\n`);
  } catch (e) {
    process.stderr.write(`[gift-hook] nous anamnesis: ${e.message}\n`);
  }
}

process.stderr.write(`[gift-hook] ✓ ${giverId} → ${receiver}: "${description}"${linkedIssue ? ' #' + linkedIssue : ''}\n`);
