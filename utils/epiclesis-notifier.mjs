#!/usr/bin/env node
/**
 * epiclesis-notifier — уведомляет подписчиков о новых эпиклезах.
 *
 * Сканирует data/epiclesis-inbox/ на свежие вопросы и шлёт
 * Telegram-уведомления подписчикам. Отвечают они через веб — это
 * односторонний notifier (не принимает ответы через TG, чтобы не
 * конфликтовать с getUpdates основного бота @gitdrondoc_bot).
 *
 * Формат уведомления:
 *   ⚡ Новая эпиклеза (призвание)
 *   «<текст вопроса>»
 *   → получатель: Дионисий
 *   Ответить: http://173.249.2.184:3701/#epiclesis/<id>
 *
 * Подписчики — в data/epiclesis-subscribers.json:
 *   [{ "chat_id": 123456789, "name": "Дионисий", "lang": "ru" }]
 *
 * Дионисию узнать свой chat_id: написать /start @userinfobot,
 * скопировать id, добавить в файл.
 *
 * Запуск (cron или systemd timer):
 *   node utils/epiclesis-notifier.mjs              — одноразовый скан
 *   node utils/epiclesis-notifier.mjs --daemon     — polling каждые 60 сек
 *
 * Env:
 *   TG_BOT_TOKEN  — токен Telegram-бота
 *   GIFT_PUBLIC   — базовый URL для ссылок (default http://173.249.2.184:3701)
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = join(ROOT, 'data', 'epiclesis-inbox');
const OUTBOX = join(ROOT, 'data', 'epiclesis-outbox');
const SUBS_FILE = join(ROOT, 'data', 'epiclesis-subscribers.json');
const STATE_FILE = join(ROOT, 'data', 'epiclesis-notified.json');

const BOT_TOKEN = process.env.TG_BOT_TOKEN ||
  '8239906212:AAEIg3SixR0W4PlRk6-qCvtBAVvod0uv_h0';   // @gitdrondoc_bot fallback
const TG_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const PUBLIC_URL = process.env.GIFT_PUBLIC || 'http://173.249.2.184:3701';

const DAEMON = process.argv.includes('--daemon');
const DRY = process.argv.includes('--dry-run');
const INTERVAL = 60_000;

function loadState() {
  if (!existsSync(STATE_FILE)) return { notified: {} };
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { notified: {} }; }
}
function saveState(s) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
function loadSubscribers() {
  if (!existsSync(SUBS_FILE)) return [];
  try { return JSON.parse(readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}

async function tgSend(chat_id, text) {
  if (DRY) { console.log(`[dry] TG → ${chat_id}: ${text.slice(0, 80)}...`); return { ok: true }; }
  const r = await fetch(`${TG_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });
  return r.json();
}

function loadInbox() {
  if (!existsSync(INBOX)) return [];
  return readdirSync(INBOX)
    .filter(f => f.endsWith('.question.json'))
    .map(f => {
      try {
        const r = JSON.parse(readFileSync(join(INBOX, f), 'utf8'));
        // проверяем, не отвечено ли
        const ansFile = join(OUTBOX, `${r.id}.answer.json`);
        r._answered = existsSync(ansFile);
        return r;
      } catch { return null; }
    })
    .filter(Boolean);
}

function fmtNotify(q) {
  const recip = q.recipient ? `→ получатель: <b>${q.recipient}</b>\n` : '';
  return [
    `⚡ <b>Новая эпиклеза</b> (призвание)`,
    ``,
    `«${(q.question || '').slice(0, 800)}»`,
    ``,
    recip.trim(),
    `<a href="${PUBLIC_URL}/chat">ответить через веб</a>`,
    ``,
    `<i>или в терминале:</i> <code>gift epiclesis answer ${q.id} "..."</code>`,
  ].filter(Boolean).join('\n');
}

async function scan() {
  const state = loadState();
  const subs = loadSubscribers();
  const queue = loadInbox();

  const unanswered = queue.filter(q => !q._answered);
  const fresh = unanswered.filter(q => !state.notified[q.id]);

  console.log(`[${new Date().toISOString()}] очередь: ${queue.length}, неотвечено: ${unanswered.length}, новых для уведомления: ${fresh.length}, подписчиков: ${subs.length}`);

  if (!fresh.length) return;
  if (!subs.length) {
    console.log('⚠ Подписчиков нет. Добавь в data/epiclesis-subscribers.json:');
    console.log('  [{"chat_id": 123456789, "name": "Дионисий"}]');
    console.log('  (узнать chat_id — написать /start @userinfobot в Telegram)');
    return;
  }

  for (const q of fresh) {
    const text = fmtNotify(q);
    for (const sub of subs) {
      try {
        const res = await tgSend(sub.chat_id, text);
        if (res.ok) {
          console.log(`  ✓ уведомлён ${sub.name || sub.chat_id} о ${q.id}`);
        } else {
          console.log(`  ✗ ${sub.name}: ${res.description || 'unknown error'}`);
        }
      } catch (e) {
        console.log(`  ✗ ${sub.name}: ${e.message}`);
      }
    }
    state.notified[q.id] = {
      at: new Date().toISOString(),
      recipients: subs.map(s => s.chat_id),
    };
  }
  saveState(state);
}

// Main
if (DAEMON) {
  console.log(`▶ epiclesis-notifier daemon (poll ${INTERVAL / 1000}s)`);
  while (true) {
    try { await scan(); } catch (e) { console.error('scan error:', e.message); }
    await new Promise(r => setTimeout(r, INTERVAL));
  }
} else {
  await scan();
}
