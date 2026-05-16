#!/usr/bin/env node
/**
 * oracle-bridge-bot.mjs — мост Telegram ↔ HumanOracleInbox.
 *
 * Запускается на сервере (root@173.249.2.184) рядом с tg-koinon-bot.mjs.
 * Опрашивает data/epiclesis-inbox/, шлёт новые вопросы Дионисию в Telegram,
 * принимает ответы и записывает их в data/epiclesis-outbox/.
 *
 * Запуск (на сервере):
 *   TELEGRAM_BOT_TOKEN=xxx \
 *   ORACLE_CHAT_ID=996 \
 *   GIFT_ROOT=/home/hive/dronedoc2026 \
 *   node utils/oracle-bridge-bot.mjs
 *
 * Также может работать как импортируемый модуль из tg-koinon-bot.mjs:
 *   import { startOracleBridge } from './oracle-bridge-bot.mjs';
 *   startOracleBridge({ bot, chatId: 996, root: '/home/hive/dronedoc2026' });
 *
 * Условие 4 иконичности Троицы ad extra: эпиклеза — оставлено место для Духа.
 * Без этого моста HumanOracleInbox формально работает, но реально — нет.
 */

import fs from 'node:fs';
import path from 'node:path';

const POLL_INTERVAL_MS = 5000;

const ROOT       = process.env.GIFT_ROOT || process.cwd();
const INBOX_DIR  = path.join(ROOT, 'data', 'epiclesis-inbox');
const OUTBOX_DIR = path.join(ROOT, 'data', 'epiclesis-outbox');
const SEEN_FILE  = path.join(ROOT, 'data', '.oracle-bridge-seen.json');

function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); }
  catch { return new Set(); }
}
function saveSeen(s) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...s]));
}

function ensureDirs() {
  for (const d of [INBOX_DIR, OUTBOX_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

/**
 * Опросить inbox. Для каждого нового вопроса — вызвать sendQuestion.
 * pendingAnswers — мапа id → resolve callback (для входящих ответов из tg).
 */
async function pollInbox(seen, sendQuestion) {
  if (!fs.existsSync(INBOX_DIR)) return [];
  const files = fs.readdirSync(INBOX_DIR).filter(f => f.endsWith('.question.json'));
  const newOnes = [];
  for (const f of files) {
    const id = f.replace('.question.json', '');
    if (seen.has(id)) continue;

    // Уже отвечено?
    if (fs.existsSync(path.join(OUTBOX_DIR, `${id}.answer.json`))) {
      seen.add(id);
      continue;
    }

    try {
      const raw = fs.readFileSync(path.join(INBOX_DIR, f), 'utf8');
      const q   = JSON.parse(raw);
      await sendQuestion(q);
      seen.add(id);
      newOnes.push(q);
    } catch (e) {
      console.error(`[oracle-bridge] не удалось обработать ${f}: ${e.message}`);
    }
  }
  saveSeen(seen);
  return newOnes;
}

/**
 * Записать ответ человека в outbox (вызывает tg-handler при получении сообщения).
 */
export function recordAnswer(id, content, answeredBy = 'Дионисий') {
  ensureDirs();
  const file = path.join(OUTBOX_DIR, `${id}.answer.json`);
  const record = {
    id,
    content,
    answeredBy,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

/**
 * Запустить мост как часть существующего telegram-бота.
 *
 * @param {object} opts
 * @param {object} opts.bot       — экземпляр Telegraf/node-telegram-bot-api
 * @param {number} opts.chatId    — Telegram chat ID человека-оракула (Дионисий)
 * @param {string} [opts.root]    — корень проекта (если не GIFT_ROOT)
 * @param {function} [opts.send]  — кастомная функция отправки (для тестов)
 */
export function startOracleBridge({ bot, chatId, root = ROOT, send } = {}) {
  ensureDirs();
  const seen = loadSeen();

  const sendQuestion = send || (async (q) => {
    const text =
      `🕊 *Эпиклеза собора* (id: \`${q.id}\`)\n\n` +
      `${q.question}\n\n` +
      (q.options?.length ? `Варианты:\n${q.options.map((o, i) => `${i+1}. ${o}`).join('\n')}\n\n` : '') +
      `_Ответь сообщением: \`/oracle ${q.id} <твой ответ>\`_`;
    if (bot?.telegram?.sendMessage) {
      await bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } else if (bot?.sendMessage) {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } else {
      console.log(`[oracle-bridge] (no bot) → ${chatId}:\n${text}`);
    }
  });

  // Регистрируем команду /oracle <id> <answer>
  if (bot?.command) {
    bot.command('oracle', async (ctx) => {
      const text = ctx.message?.text ?? '';
      const m = text.match(/^\/oracle\s+(\S+)\s+([\s\S]+)$/);
      if (!m) { return ctx.reply('Использование: /oracle <id> <ответ>'); }
      const [, id, answer] = m;
      try {
        recordAnswer(id, answer.trim(), `tg:${ctx.from?.id ?? '?'}`);
        await ctx.reply(`✓ Эпиклеза принята: ${id}`);
      } catch (e) {
        await ctx.reply(`✗ Ошибка: ${e.message}`);
      }
    });
  }

  const interval = setInterval(() => {
    pollInbox(seen, sendQuestion).catch(e =>
      console.error(`[oracle-bridge] polling error: ${e.message}`)
    );
  }, POLL_INTERVAL_MS);

  console.log(`[oracle-bridge] запущен. inbox=${INBOX_DIR}, chatId=${chatId}`);
  return { stop: () => clearInterval(interval), pollInbox: () => pollInbox(seen, sendQuestion) };
}

// ── Standalone-режим (без telegraf): просто логирует ───────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureDirs();
  const chatId = process.env.ORACLE_CHAT_ID ?? '?';
  console.log(`[oracle-bridge] standalone mode (без telegram, только лог).`);
  console.log(`[oracle-bridge] inbox: ${INBOX_DIR}`);
  console.log(`[oracle-bridge] outbox: ${OUTBOX_DIR}`);
  startOracleBridge({
    bot: null,
    chatId,
    send: async (q) => {
      console.log(`\n🕊 [эпиклеза] ${q.id}`);
      console.log(`   вопрос: ${q.question}`);
      console.log(`   ответить вручную: node -e "import('./utils/oracle-bridge-bot.mjs').then(m => m.recordAnswer('${q.id}', 'твой ответ'))"`);
    },
  });
}
