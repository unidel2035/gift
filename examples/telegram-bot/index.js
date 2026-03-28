/**
 * examples/telegram-bot — Telegram бот на Gift Protocol
 *
 * Команды:
 *   /give @username type [note]  — записать дар
 *   /matrix                      — топ нитей матрицы W
 *   /tape                        — лента последних даров
 *
 * Зависимости:
 *   npm install grammy @koinon/gift-protocol
 *
 * Переменные среды:
 *   BOT_TOKEN    — токен от @BotFather
 *   KOINON_URL   — URL сервера Κοινόν (напр. http://localhost:8086)
 *
 * Запуск:
 *   BOT_TOKEN=... KOINON_URL=http://localhost:8086 node index.js
 *
 * Богословие:
 *   Κοινόν τοῦ Νοῦ — общение умов через акты дара.
 *   Каждое /give — κένωσις: даритель умаляет себя ради другого.
 */

import { Bot, InlineKeyboard } from 'grammy';
import { createTelegramAdapter } from '@koinon/gift-protocol/adapters/telegram';

// ── Конфигурация ──────────────────────────────────────────────────────────────

const BOT_TOKEN  = process.env.BOT_TOKEN;
const KOINON_URL = process.env.KOINON_URL ?? 'http://localhost:8086';

if (!BOT_TOKEN) {
  console.error('Нужен BOT_TOKEN в переменных среды');
  process.exit(1);
}

// ── Адаптер ───────────────────────────────────────────────────────────────────

const gift = createTelegramAdapter({
  koinonUrl: KOINON_URL,
  // Маппинг tg userId → personId в матрице W
  resolvePersonId: (tgUserId) => `tg/${tgUserId}`,
});

// ── Бот ──────────────────────────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN);

// /start
bot.command('start', async (ctx) => {
  await ctx.reply(
    'Κοινόν τοῦ Νοῦ — бот общины даров\n\n' +
    'Команды:\n' +
    '  /give @username type [заметка] — записать дар\n' +
    '  /matrix — топ нитей матрицы W\n' +
    '  /tape — лента последних даров\n\n' +
    'Типы даров:\n' +
    '  time (10) · presence (8) · knowledge (6)\n' +
    '  word (4) · money (3) · question (4)\n\n' +
    '«Freely you have received; freely give.» (Mt 10:8)'
  );
});

// /give @username type [note]
// Пример: /give @otec_sergiy presence встреча после службы
bot.command('give', async (ctx) => {
  const text = ctx.match?.trim() ?? '';
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    await ctx.reply(
      'Использование: /give @username type [заметка]\n' +
      'Пример: /give @otec_sergiy presence встреча после службы'
    );
    return;
  }

  const [toRaw, type, ...noteParts] = parts;
  const content = noteParts.join(' ') || type;

  // Разрешить username → personId
  const from = `tg/${ctx.from.id}`;
  const to   = toRaw.startsWith('@') ? `tg/${toRaw.slice(1)}` : toRaw;

  const result = await gift.give({ from, to, type, content });

  if (result.ok) {
    await ctx.reply(
      `✓ Дар записан в матрицу W\n` +
      `  ${ctx.from.first_name} → ${toRaw}\n` +
      `  тип: ${result.act.type} | вес: ${result.act.weight}\n` +
      (content !== type ? `  «${content}»\n` : '') +
      `\nНеобратимо. Анамнетически.`
    );
  } else {
    await ctx.reply(`✗ Ошибка: ${result.errors.join(', ')}`);
  }
});

// /matrix
bot.command('matrix', async (ctx) => {
  try {
    const summary = await gift.client?.summary();
    if (!summary) {
      await ctx.reply('Матрица W недоступна. Сервер не отвечает.');
      return;
    }

    const lines = ['Матрица W — топ нитей:\n'];
    if (summary.heaviest) {
      for (const e of summary.heaviest.slice(0, 8)) {
        lines.push(`  ${e.from} → ${e.to}: ${Number(e.weight).toFixed(1)}`);
      }
    }
    lines.push(`\nЛиц: ${summary.persons ?? '?'} | Актов: ${summary.acts ?? '?'}`);
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  } catch {
    await ctx.reply('Ошибка при получении матрицы.');
  }
});

// /tape
bot.command('tape', async (ctx) => {
  try {
    const tape = await gift.client?.tape(10);
    if (!tape?.acts) {
      await ctx.reply('Лента недоступна.');
      return;
    }

    const lines = ['Лента даров:\n'];
    for (const act of tape.acts) {
      const when = new Date(act.timestamp).toLocaleDateString('ru');
      lines.push(`  ${act.from} → ${act.to} [${act.type}] ${when}`);
    }
    await ctx.reply(lines.join('\n'));
  } catch {
    await ctx.reply('Ошибка при получении ленты.');
  }
});

// Запуск
bot.start({
  onStart: (me) => {
    console.log(`Gift Bot запущен: @${me.username}`);
    console.log(`Κοινόν: ${KOINON_URL}`);
  },
});
