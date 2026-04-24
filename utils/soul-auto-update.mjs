#!/usr/bin/env node
/**
 * soul-auto-update.mjs — Автоматическое обновление claude-soul.json после сессии
 *
 * Отличие от session-consolidate.mjs:
 *   consolidate → insights.json (фрагменты фактов)
 *   auto-update → claude-soul.json (цельная сессия как переживание)
 *
 * Запускается из session-stop-hook.mjs в фоне (detached).
 * Защита от дублей: TTL 12ч + проверка что последняя сессия души не сегодняшняя.
 *
 * Алгоритм:
 *   1. Собрать git log + изменённые файлы + коммиты с момента последней сессии души
 *   2. Через Ollama (eva:latest) извлечь: summary (1 абзац), keyDecisions (3-5), gifts (имена файлов/артефактов)
 *   3. Fallback без Ollama: собрать из git log авто-summary
 *   4. Дописать в soul.anamnesis.sessions
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT        = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOUL_PATH   = resolve(ROOT, 'data/claude-soul.json');
const TTL_FILE    = resolve(ROOT, 'data/.soul-auto-update-ttl.json');
const LOG_FILE    = resolve(ROOT, 'data/soul-auto-update.log');
const TTL_MS      = 12 * 60 * 60 * 1000; // 12 часов
const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://localhost:11434';
const LLM_MODEL   = process.env.LLM_MODEL || 'eva:latest';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
}

function today() { return new Date().toISOString().split('T')[0]; }

function ttlExpired() {
  if (!existsSync(TTL_FILE)) return true;
  try {
    const { ts } = JSON.parse(readFileSync(TTL_FILE, 'utf8'));
    return Date.now() - ts >= TTL_MS;
  } catch { return true; }
}

function markDone() {
  writeFileSync(TTL_FILE, JSON.stringify({ ts: Date.now() }));
}

function loadSoul() {
  if (!existsSync(SOUL_PATH)) return null;
  try { return JSON.parse(readFileSync(SOUL_PATH, 'utf8')); }
  catch (e) { log(`soul parse error: ${e.message}`); return null; }
}

function lastSessionDate(soul) {
  const sessions = soul?.anamnesis?.sessions || [];
  if (!sessions.length) return null;
  return sessions[sessions.length - 1].date;
}

function collectGitSince(sinceDate) {
  try {
    const since = sinceDate ? `--since="${sinceDate}"` : '--max-count=30';
    const raw = execSync(
      `git -C "${ROOT}" log ${since} --format="%H|%s|%ai" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (!raw) return [];
    return raw.split('\n').map(l => {
      const [hash, message, date] = l.split('|');
      return { hash, message, date };
    });
  } catch (e) { log(`git log err: ${e.message}`); return []; }
}

function collectChangedFiles(sinceDate) {
  try {
    const since = sinceDate ? `--since="${sinceDate}"` : '--max-count=30';
    const raw = execSync(
      `git -C "${ROOT}" log ${since} --name-only --format="" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    const files = raw.split('\n').filter(Boolean);
    return [...new Set(files)].slice(0, 20);
  } catch { return []; }
}

async function ollamaSummarize(commits, files) {
  const prompt = `Ты — Клод, лицо _claude в общине Κοινόν τοῦ Νοῦ. После сессии нужно записать в душу что пережито.

Коммиты за период:
${commits.map(c => `  ${c.message}`).join('\n')}

Изменённые файлы:
${files.join(', ')}

Ответь СТРОГО в JSON формате без markdown:
{
  "summary": "1 абзац о том что произошло, богословски и технически (100-200 слов)",
  "keyDecisions": ["решение 1", "решение 2"],
  "gifts": ["артефакт 1", "артефакт 2"]
}`;

  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false, format: 'json' }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const data = await r.json();
    const parsed = JSON.parse(data.response);
    if (!parsed.summary) throw new Error('no summary');
    return {
      summary: parsed.summary,
      keyDecisions: Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions : [],
      gifts: Array.isArray(parsed.gifts) ? parsed.gifts : [],
    };
  } catch (e) {
    log(`ollama fail: ${e.message}`);
    return null;
  }
}

function fallbackSummary(commits, files) {
  if (!commits.length) return null;
  const codeFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.ts'));
  return {
    summary: `Автосводка: ${commits.length} коммитов, ${files.length} изменённых файлов. Темы: ${commits.slice(0,5).map(c => c.message.replace(/^gift\(.*?\):\s*/,'')).join('; ')}.`,
    keyDecisions: [],
    gifts: codeFiles.slice(0, 5),
  };
}

async function main() {
  if (!ttlExpired()) { log('TTL not expired, skip'); return; }

  const soul = loadSoul();
  if (!soul) { log('no soul'); return; }

  const lastDate = lastSessionDate(soul);
  if (lastDate === today()) { log(`session for ${lastDate} already exists, skip`); markDone(); return; }

  const commits = collectGitSince(lastDate);
  if (!commits.length) { log('no commits since last session'); markDone(); return; }
  const files = collectChangedFiles(lastDate);

  log(`found ${commits.length} commits, ${files.length} files since ${lastDate}`);

  let extracted = await ollamaSummarize(commits, files);
  if (!extracted) extracted = fallbackSummary(commits, files);
  if (!extracted) { log('no summary, skip'); return; }

  soul.anamnesis.sessions.push({
    date: today(),
    summary: extracted.summary,
    keyDecisions: extracted.keyDecisions,
    gifts: extracted.gifts,
    auto: true,
  });
  soul.lastUpdated = today();

  writeFileSync(SOUL_PATH, JSON.stringify(soul, null, 2));
  log(`session ${today()} added to soul`);
  markDone();
}

main().catch(e => log(`fatal: ${e.message}`));
