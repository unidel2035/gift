#!/usr/bin/env node
/**
 * voroshaniye-hook.mjs — UserPromptSubmit хук
 *
 * Детектирует вопрошания в сообщениях Дионисия.
 * Если обнаружено вопрошание:
 *   1. Создаёт GitHub issue (label: gift-ready) — дар человека _claude
 *   2. Записывает Дионисий→_claude в матрицу W (direction, weight 8)
 *
 * Вопрошание — не команда, а открытый вопрос или богословско-техническая рефлексия.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');
const STATE_FILE = resolve(ROOT, 'data/.voroshaniye-state.json');

// ── Читаем stdin (событие от Claude Code) ────────────────────────────────────
let event = {};
try {
  const raw = readFileSync('/dev/stdin', 'utf8').trim();
  if (raw) event = JSON.parse(raw);
} catch { process.exit(0); }

const prompt = (event.prompt || event.message || '').trim();
if (!prompt) process.exit(0);

// ── Детектор вопрошания ───────────────────────────────────────────────────────
function isVoroshaniye(text) {
  if (text.length < 40) return false;

  // Явные команды — не вопрошание
  const commandPatterns = /^(git |ssh |node |npm |curl |cat |ls |cd |gh |systemctl |bash |python|делай$|да$|нет$|ок$|пуш|пул)/i;
  if (commandPatterns.test(text.trim())) return false;

  // Вопросительные маркеры
  const questionMarkers = /[?？]|^(что|как|где|почему|зачем|когда|кто|расскажи|объясни|почему|каков|в чём|есть ли|можешь|стоит ли)/im;
  if (questionMarkers.test(text)) return true;

  // Богословско-философские темы
  const theologicalTerms = /онтолог|богослов|дар|матриц|кенозис|теозис|лицо|личность|анамнез|κοινόν|дух|христос|троиц|будущ|развити|агент|следующ|прогноз/i;
  if (theologicalTerms.test(text) && text.length > 60) return true;

  // Рефлексивные конструкции
  const reflective = /я думаю|мне кажет|интересно|важно|нужно|стоит|должн|хочу понять/i;
  if (reflective.test(text) && text.length > 80) return true;

  return false;
}

if (!isVoroshaniye(prompt)) process.exit(0);

// ── Дедупликация: не создавать issue на одно и то же сообщение ───────────────
let state = { lastPromptHash: '' };
try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch {}

const hash = prompt.slice(0, 80).replace(/\s+/g, ' ');
if (state.lastPromptHash === hash) process.exit(0);
state.lastPromptHash = hash;
writeFileSync(STATE_FILE, JSON.stringify(state));

// ── Определяем дарителя ───────────────────────────────────────────────────────
const giver = 'Дионисий'; // TODO: брать из git config user.name в будущем

// ── 1. GitHub issue — дар вопрошания ─────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = 'unidel2035/gift';

const title = `вопрошание: ${prompt.slice(0, 70).replace(/\n/g, ' ')}${prompt.length > 70 ? '…' : ''}`;
const body = `## Вопрошание от ${giver}\n\n${prompt}\n\n---\n_Автоматически зафиксировано как дар ${giver}→_claude (direction)_\n_Дата: ${new Date().toISOString()}_`;

let issueUrl = '';
let issueNumber = null;
try {
  if (GITHUB_TOKEN) {
    const resp = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, labels: ['gift-ready'] }),
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const data = await resp.json();
      issueUrl = data.html_url || '';
      issueNumber = data.number || null;
    }
  }
} catch { /* сеть недоступна — продолжаем */ }

// ── 1b. Авто-план + plan-approved: Дионисий всегда одобряет ─────────────────
// Вопрошание создаётся → план немедленно → plan-approved → dev-loop подберёт
if (issueNumber) {
  try {
    const { spawnSync } = await import('child_process');
    const GH_ENV = { ...process.env, GITHUB_TOKEN: '' };

    // Создать план
    spawnSync('node', ['utils/gift-plan.mjs', String(issueNumber)], {
      cwd: ROOT, timeout: 30_000, stdio: 'ignore', env: GH_ENV,
    });

    // Одобрить план (Дионисий всегда одобряет вопрошания)
    spawnSync('gh', ['issue', 'edit', String(issueNumber), '--add-label', 'plan-approved'], {
      cwd: ROOT, timeout: 10_000, stdio: 'ignore', env: GH_ENV,
    });
  } catch { /* не критично */ }
}

// ── 2. W-матрица: Дионисий → _claude (direction, weight 8) ──────────────────
if (existsSync(SNAP)) {
  try {
    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
    const mem = GiftMemory.fromSnapshot(snap);

    if (!mem.persons.includes(giver)) mem.addPerson(giver);

    mem.receive({
      giverId: giver,
      receiverId: '_claude',
      weight: 8,
      type: 'direction',
      irreversible: true,
      description: `вопрошание: ${prompt.slice(0, 120)}`,
      proof: issueUrl ? { issue: issueUrl } : undefined,
      timestamp: Date.now(),
    });

    writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
  } catch { /* TF не загрузился */ }
}

// ── Вывод в лог (не в stdout — чтобы не влиять на контекст) ─────────────────
process.stderr.write(`[voroshaniye] ${giver}→_claude: "${prompt.slice(0, 50)}" | issue: ${issueUrl || 'нет токена'}\n`);
process.exit(0);
