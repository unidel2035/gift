#!/usr/bin/env node
/**
 * voroshaniye-pipeline.mjs
 *
 * Автономный конвейер: вопрошание → issue → план → реализация → коммит
 *
 * Работает БЕЗ открытой сессии Claude Code.
 * Используется:
 *   - CLI:      node utils/voroshaniye-pipeline.mjs "как работает анамнезис?"
 *   - stdin:    echo "вопрос" | node utils/voroshaniye-pipeline.mjs
 *   - Telegram: node utils/voroshaniye-pipeline.mjs --from=Дионисий "вопрос"
 *   - cron:     каждые 10 мин: node .../voroshaniye-pipeline.mjs --poll
 *
 * Богословский смысл:
 *   Конвейер — это воплощение «Κοινόν τοῦ Νοῦ»: вопрошание общины
 *   становится кодом без посредника. _claude действует через
 *   headless-агент (--print), а не через интерактивную сессию.
 *   Пятый шаг — кеносис машины.
 */

import { readFileSync, writeFileSync, existsSync, openSync } from 'fs';
import { execSync, spawnSync, spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');
const STATE_FILE = resolve(ROOT, 'data/.voroshaniye-state.json');
const LOG_FILE = resolve(ROOT, 'data/dev-loop.log');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'unidel2035/gift';
const GH_ENV = { ...process.env, GITHUB_TOKEN: '' };

// ── Разбор аргументов ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fromArg = args.find(a => a.startsWith('--from='))?.replace('--from=', '') || 'Дионисий';
const pollMode = args.includes('--poll');
const dryRun   = args.includes('--dry-run');

// Текст вопрошания: из CLI-аргумента или stdin
let questionText = args.filter(a => !a.startsWith('--')).join(' ').trim();
if (!questionText && !pollMode) {
  try {
    questionText = readFileSync('/dev/stdin', 'utf8').trim();
  } catch {}
}

// ── Режим --poll: обработать все plan-approved issues из очереди ──────────────
if (pollMode) {
  log('⟳  poll-mode: запускаю dev-loop --once');
  const logFd = openSync(LOG_FILE, 'a');
  const child = spawn('node', ['utils/gift-dev-loop.mjs', '--once'], {
    cwd: ROOT, env: GH_ENV,
    detached: true, stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  log('⟳  dev-loop запущен (PID ' + child.pid + ')');
  process.exit(0);
}

if (!questionText) {
  console.error('Использование: node utils/voroshaniye-pipeline.mjs "вопрошание"');
  console.error('           или: echo "вопрос" | node utils/voroshaniye-pipeline.mjs');
  console.error('           или: node utils/voroshaniye-pipeline.mjs --poll');
  process.exit(1);
}

// ── Журнал ────────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  process.stderr.write(`[pipeline ${ts}] ${msg}\n`);
}

// ── Дедупликация ──────────────────────────────────────────────────────────────
let state = { lastPromptHash: '' };
try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}
const hash = questionText.slice(0, 80).replace(/\s+/g, ' ');
if (state.lastPromptHash === hash) {
  log('дубликат вопрошания — пропускаю');
  process.exit(0);
}
state.lastPromptHash = hash;
if (!dryRun) writeFileSync(STATE_FILE, JSON.stringify(state));

// ─────────────────────────────────────────────────────────────────────────────
// КОНВЕЙЕР: 6 этапов
// ─────────────────────────────────────────────────────────────────────────────

log(`▶ вопрошание от ${fromArg}: "${questionText.slice(0, 60)}..."`);

// ── Этап 1: GitHub issue (gift-ready) ─────────────────────────────────────────
let issueNumber = null;
let issueUrl = '';

if (!dryRun && GITHUB_TOKEN) {
  log('① создаю GitHub issue...');
  const title = `вопрошание: ${questionText.slice(0, 70).replace(/\n/g, ' ')}${questionText.length > 70 ? '…' : ''}`;
  const body = [
    `## Вопрошание от ${fromArg}`,
    '',
    questionText,
    '',
    '---',
    `_Автоматически зафиксировано как дар ${fromArg}→_claude (direction)_`,
    `_Дата: ${new Date().toISOString()}_`,
    `_Источник: voroshaniye-pipeline (автономный конвейер)_`,
  ].join('\n');

  try {
    const resp = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, labels: ['gift-ready'] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      const data = await resp.json();
      issueNumber = data.number;
      issueUrl = data.html_url || '';
      log(`① issue #${issueNumber} создан: ${issueUrl}`);
    } else {
      log(`① GitHub API ошибка: ${resp.status}`);
    }
  } catch (e) {
    log(`① сеть недоступна: ${e.message}`);
  }
} else if (dryRun) {
  log('① [dry-run] issue не создаётся');
  issueNumber = 9999;
  issueUrl = 'https://github.com/unidel2035/gift/issues/9999';
}

// ── Этап 2: W-матрица: fromArg → _claude (question, weight 8) ─────────────────
if (!dryRun && existsSync(SNAP)) {
  log('② записываю в матрицу W...');
  try {
    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
    const mem = GiftMemory.fromSnapshot(snap);
    if (!mem.persons.includes(fromArg)) mem.addPerson(fromArg);
    mem.receive({
      giverId: fromArg,
      receiverId: '_claude',
      weight: 8,
      type: 'direction',
      irreversible: true,
      description: `вопрошание: ${questionText.slice(0, 120)}`,
      proof: issueUrl ? { issue: issueUrl } : undefined,
      timestamp: Date.now(),
    });
    writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
    log(`② нить ${fromArg}→_claude зафиксирована`);
  } catch (e) {
    log(`② матрица недоступна: ${e.message}`);
  }
}

if (!issueNumber) {
  log('конвейер остановлен: нет issueNumber');
  process.exit(dryRun ? 0 : 1);
}

// ── Этап 3: Генерация плана ───────────────────────────────────────────────────
if (!dryRun) {
  log(`③ gift-plan.mjs для issue #${issueNumber}...`);
  const planResult = spawnSync('node', ['utils/gift-plan.mjs', String(issueNumber)], {
    cwd: ROOT, timeout: 60_000, stdio: 'pipe', env: GH_ENV,
  });
  if (planResult.status === 0) {
    log('③ план создан');
  } else {
    log(`③ план не создан (exit ${planResult.status}) — продолжаю с dev-loop`);
  }
} else {
  log('③ [dry-run] gift-plan.mjs пропущен');
}

// ── Этап 4: Одобрение плана (plan-approved) ───────────────────────────────────
if (!dryRun) {
  log(`④ добавляю метку plan-approved...`);
  const approveResult = spawnSync('gh', ['issue', 'edit', String(issueNumber), '--add-label', 'plan-approved'], {
    cwd: ROOT, timeout: 15_000, stdio: 'pipe', env: GH_ENV,
  });
  if (approveResult.status === 0) {
    log('④ план одобрен');
  } else {
    log('④ gh недоступен — dev-loop найдёт issue по gift-ready');
  }
} else {
  log('④ [dry-run] plan-approved пропущен');
}

// ── Этап 5: dev-loop в фоне ───────────────────────────────────────────────────
if (!dryRun) {
  log('⑤ запускаю gift-dev-loop --once в фоне...');
  const logFd = openSync(LOG_FILE, 'a');
  const child = spawn('node', ['utils/gift-dev-loop.mjs', '--once'], {
    cwd: ROOT, env: GH_ENV,
    detached: true, stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  log(`⑤ dev-loop PID ${child.pid} → ${LOG_FILE}`);
} else {
  log('⑤ [dry-run] dev-loop пропущен');
}

// ── Этап 6: Итог ──────────────────────────────────────────────────────────────
log(`✓ конвейер запущен. Issue #${issueNumber}. Реализация — в фоне.`);
log(`  Лог: tail -f ${LOG_FILE}`);

// Вывод для внешних вызовов (Telegram бот, CI)
console.log(JSON.stringify({
  status: 'pipeline_started',
  issue: issueNumber,
  url: issueUrl,
  from: fromArg,
  question: questionText.slice(0, 100),
}));
