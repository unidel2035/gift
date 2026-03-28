/**
 * examples/telegram-bot.js
 *
 * Minimal Telegram bot that records gift acts via Gift Protocol.
 * Uses grammy (lightweight Telegram framework).
 *
 * Prerequisites:
 *   npm install grammy
 *
 * Environment variables:
 *   BOT_TOKEN   — your Telegram bot token (from @BotFather)
 *   KOINON_URL  — Κοινόν server URL (optional)
 *
 * Run:
 *   node examples/telegram-bot.js
 *
 * Commands:
 *   /give @name type [note]   — record a gift
 *   /gifts                    — show recent gifts
 *   /weights                  — show gift type weights
 *
 * Example:
 *   /give @alice time 2 hours of pastoral care
 *   /give _koinon code updated the federation protocol
 */

import { Bot, InlineKeyboard } from 'grammy';
import { createTelegramAdapter, GiftClient, WEIGHT_BY_TYPE } from '../index.js';
import { createTelegramAdapter as makeAdapter } from '../adapters/telegram.js';

const TOKEN  = process.env.BOT_TOKEN;
const KOINON = process.env.KOINON_URL;

if (!TOKEN) {
  console.error('Set BOT_TOKEN');
  process.exit(1);
}

const bot  = new Bot(TOKEN);
const gift = makeAdapter({
  koinonUrl:       KOINON,
  defaultReceiver: '_koinon',
  resolvePersonId: (telegramId) => `tg/${telegramId}`,
});

// /give @name type [note]
bot.command('give', async (ctx) => {
  const text   = ctx.message?.text ?? '';
  const parsed = gift.parseCommand(text);

  if (!parsed) {
    return ctx.reply(
      'Usage: /give @name type [note]\n' +
      'Types: time, presence, knowledge, grace, code, word, question, money, data, memory\n\n' +
      'Examples:\n' +
      '/give @alice time stayed late to help\n' +
      '/give _koinon code refactored the auth module'
    );
  }

  const result = await gift.giveFromContext(ctx, parsed);

  if (result.ok) {
    const a = result.act;
    await ctx.reply(
      `✓ Дар записан\n` +
      `От: \`${a.from}\`\n` +
      `Кому: \`${a.to}\`\n` +
      `Тип: \`${a.type}\` — вес \`${a.weight}\`` +
      (a.content ? `\nПримечание: ${a.content}` : ''),
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(
      `✗ Ошибка:\n${result.errors.map(e => `• ${e}`).join('\n')}`
    );
  }
});

// /gifts — recent tape
bot.command('gifts', async (ctx) => {
  if (!KOINON) {
    return ctx.reply('Сервер Κοινόν не настроен. Задайте KOINON_URL.');
  }

  const giftClient = new GiftClient(KOINON);
  const tape = await giftClient.tape(10).catch(() => null);

  if (!tape?.acts?.length) {
    return ctx.reply('Даров пока нет.');
  }

  const lines = tape.acts.map(a => {
    const note = a.content ? ` — ${a.content}` : '';
    return `• *${a.from}* → *${a.to}* [\`${a.type}\` w=${a.weight}]${note}`;
  });

  await ctx.reply(
    `*Последние дары* (${tape.acts.length}):\n${lines.join('\n')}`,
    { parse_mode: 'Markdown' }
  );
});

// /weights — show the weight hierarchy
bot.command('weights', async (ctx) => {
  const lines = Object.entries(WEIGHT_BY_TYPE)
    .sort(([, a], [, b]) => b - a)
    .map(([type, weight]) => `\`${type.padEnd(10)}\` ${weight}`);

  await ctx.reply(
    `*Веса типов дара* (богословская аксиома):\n${lines.join('\n')}\n\n` +
    `Время несводимо — вес 10. Деньги восполняемы — вес 3.`,
    { parse_mode: 'Markdown' }
  );
});

// /start — welcome
bot.command('start', async (ctx) => {
  await ctx.reply(
    `Κοινόν τοῦ Νοῦ — Сообщество Ума\n\n` +
    `Здесь записываются дары между лицами.\n\n` +
    `Команды:\n` +
    `/give @name type [note] — записать дар\n` +
    `/gifts — последние дары\n` +
    `/weights — веса типов дара`
  );
});

bot.start();
console.log('✓ Telegram bot started');
