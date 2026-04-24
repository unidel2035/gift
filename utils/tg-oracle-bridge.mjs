#!/usr/bin/env node
/**
 * tg-oracle-bridge.mjs — Мост HumanOracleInbox ↔ Telegram
 *
 * Эпиклеза (ἐπίκλησις) — призыв внешней благодати: когда собор СИЦ
 * не знает, он формирует вопрос в data/epiclesis-inbox/*.md, и этот
 * мост относит его в живую Telegram-общину, откуда ждёт ответ и
 * возвращает его в data/epiclesis-outbox/*.md с _fromAbyss:true.
 *
 * Развёртывание:
 *   Локально: node utils/tg-oracle-bridge.mjs --once    (один прогон)
 *   На сервере: systemd unit с ExecStart=... --watch    (цикл)
 *
 * Переменные окружения:
 *   TG_BOT_TOKEN    — токен бота (обязательно)
 *   TG_ORACLE_CHAT  — chat_id общины-оракула (обязательно)
 *   POLL_SEC        — интервал опроса в секундах (по умолчанию 30)
 *
 * Протокол inbox/outbox файла:
 *   id: epiclesis-<ts>-<tag>
 *   from: sic:<team> или _claude
 *   question: "..."
 *   context: "..."
 *   asked_at: ISO8601
 *   status: pending|asked|answered|timeout
 *   tg_message_id: <id>  (после отправки)
 *   answer: "..."        (после ответа)
 *   answered_by: @username
 *   answered_at: ISO8601
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INBOX  = resolve(ROOT, 'data/epiclesis-inbox');
const OUTBOX = resolve(ROOT, 'data/epiclesis-outbox');
const STATE  = resolve(ROOT, 'data/.epiclesis-state.json');
const LOG    = resolve(ROOT, 'data/epiclesis-bridge.log');

const TG_BOT_TOKEN   = process.env.TG_BOT_TOKEN   || '';
const TG_ORACLE_CHAT = process.env.TG_ORACLE_CHAT || '';
const POLL_SEC       = parseInt(process.env.POLL_SEC || '30', 10);
const TG_API         = `https://api.telegram.org/bot${TG_BOT_TOKEN}`;

const args = process.argv.slice(2);
const ONCE  = args.includes('--once');
const WATCH = args.includes('--watch');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { import('fs').then(({ appendFileSync }) => appendFileSync(LOG, line)); } catch {}
  console.log(msg);
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm = {};
  for (const ln of m[1].split('\n')) {
    const i = ln.indexOf(':');
    if (i > 0) fm[ln.slice(0, i).trim()] = ln.slice(i + 1).trim();
  }
  return { fm, body: m[2] };
}

function serialize(fm, body) {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

function ensureDirs() {
  mkdirSync(INBOX, { recursive: true });
  mkdirSync(OUTBOX, { recursive: true });
}

function loadState() {
  if (!existsSync(STATE)) return { lastUpdateId: 0, pending: {} };
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return { lastUpdateId: 0, pending: {} }; }
}
function saveState(s) { writeFileSync(STATE, JSON.stringify(s, null, 2)); }

async function tgSend(text, replyTo = null) {
  const body = { chat_id: TG_ORACLE_CHAT, text, parse_mode: 'Markdown' };
  if (replyTo) body.reply_to_message_id = replyTo;
  const r = await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`tg sendMessage: ${j.description}`);
  return j.result;
}

async function tgGetUpdates(offset) {
  const r = await fetch(`${TG_API}/getUpdates?offset=${offset}&timeout=0&allowed_updates=["message"]`);
  const j = await r.json();
  if (!j.ok) throw new Error(`tg getUpdates: ${j.description}`);
  return j.result;
}

// ── Шаг 1: разослать pending-вопросы в Telegram ──────────────────────────
async function askPendingQuestions(state) {
  const files = readdirSync(INBOX).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const p = join(INBOX, f);
    const { fm, body } = parseFrontmatter(readFileSync(p, 'utf8'));
    if (fm.status && fm.status !== 'pending') continue;

    const text = `🕯 *Эпиклеза*\n\n*От:* ${fm.from || 'unknown'}\n*Вопрос:* ${fm.question || body.trim().slice(0, 800)}${fm.context ? `\n\n_Контекст:_ ${fm.context}` : ''}\n\n(ответь реплаем — попадёт в outbox с пометкой _fromAbyss:true)`;
    try {
      const msg = await tgSend(text);
      fm.status = 'asked';
      fm.tg_message_id = String(msg.message_id);
      fm.asked_at = new Date().toISOString();
      writeFileSync(p, serialize(fm, body));
      state.pending[String(msg.message_id)] = fm.id || basename(f, '.md');
      log(`→ TG asked: ${basename(f)} as msg ${msg.message_id}`);
    } catch (e) {
      log(`✗ TG send failed for ${basename(f)}: ${e.message}`);
    }
  }
}

// ── Шаг 2: собрать ответы (reply на наши сообщения) ──────────────────────
async function collectAnswers(state) {
  const updates = await tgGetUpdates(state.lastUpdateId + 1);
  for (const u of updates) {
    state.lastUpdateId = Math.max(state.lastUpdateId, u.update_id);
    const msg = u.message;
    if (!msg?.reply_to_message) continue;
    const origId = String(msg.reply_to_message.message_id);
    const epiId = state.pending[origId];
    if (!epiId) continue;

    const inboxFile = readdirSync(INBOX).find(f =>
      readFileSync(join(INBOX, f), 'utf8').includes(`tg_message_id: ${origId}`)
    );
    if (!inboxFile) continue;

    const inboxPath = join(INBOX, inboxFile);
    const { fm, body } = parseFrontmatter(readFileSync(inboxPath, 'utf8'));
    fm.status = 'answered';
    fm.answer = (msg.text || '').replace(/\n/g, '  ');
    fm.answered_by = msg.from?.username ? `@${msg.from.username}` : `user_${msg.from?.id}`;
    fm.answered_at = new Date().toISOString();
    fm._fromAbyss = 'true';

    const outboxPath = join(OUTBOX, inboxFile);
    writeFileSync(outboxPath, serialize(fm, body + `\n\n## Ответ (_fromAbyss: true)\n\n${msg.text}\n\n— ${fm.answered_by}, ${fm.answered_at}\n`));
    // inbox-файл архивируем
    renameSync(inboxPath, inboxPath + '.answered');
    delete state.pending[origId];
    log(`← TG answered ${inboxFile}: ${fm.answered_by}`);
  }
}

async function tick() {
  ensureDirs();
  if (!TG_BOT_TOKEN || !TG_ORACLE_CHAT) {
    console.error('tg-oracle-bridge: TG_BOT_TOKEN и TG_ORACLE_CHAT обязательны');
    process.exit(2);
  }
  const state = loadState();
  try {
    await askPendingQuestions(state);
    await collectAnswers(state);
  } catch (e) {
    log(`tick err: ${e.message}`);
  }
  saveState(state);
}

async function main() {
  if (ONCE || (!ONCE && !WATCH)) {
    await tick();
    return;
  }
  // watch
  log(`tg-oracle-bridge watch: poll=${POLL_SEC}s`);
  while (true) {
    await tick();
    await new Promise(r => setTimeout(r, POLL_SEC * 1000));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
