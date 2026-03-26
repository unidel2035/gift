/**
 * @koinon/gift-protocol/adapters/telegram
 *
 * Telegram adapter for Gift Protocol.
 *
 * Converts Telegram bot messages into GiftActs and submits them
 * to a Κοινόν server.
 *
 * Compatible with any Telegram bot library (node-telegram-bot-api,
 * grammy, telegraf) — works with raw Telegram Update objects.
 *
 * Usage (grammy example):
 *
 *   import { Bot } from 'grammy';
 *   import { createTelegramAdapter } from '@koinon/gift-protocol/adapters/telegram';
 *
 *   const gift = createTelegramAdapter({ koinonUrl: 'http://my-koinon.org:8086' });
 *
 *   const bot = new Bot(process.env.BOT_TOKEN);
 *   bot.command('give', async (ctx) => {
 *     // /give @username type [note]
 *     const [to, type, ...rest] = ctx.match.split(' ');
 *     const result = await gift.giveFromContext(ctx, { to, type, content: rest.join(' ') });
 *     await ctx.reply(result.ok
 *       ? `✓ Дар записан (вес: ${result.act.weight})`
 *       : `✗ Ошибка: ${result.errors.join(', ')}`
 *     );
 *   });
 *
 * Usage (raw Telegram Update):
 *
 *   const result = await gift.giveFromUpdate(update, { to: 'Дионисий', type: 'word' });
 */

import { GiftValidator, GiftClient, createAct } from '../index.js';

/**
 * createTelegramAdapter(options) — фабрика Telegram-адаптера.
 *
 * @param {object} options
 * @param {string} [options.koinonUrl]       — URL Κοινόν сервера
 * @param {string} [options.defaultReceiver] — получатель по умолчанию ('_koinon')
 * @param {function} [options.resolvePersonId] — (telegramUserId) → koinonPersonId
 */
export function createTelegramAdapter(options = {}) {
  const client          = options.koinonUrl ? new GiftClient(options.koinonUrl) : null;
  const defaultReceiver = options.defaultReceiver ?? '_koinon';
  const resolveId       = options.resolvePersonId ?? (uid => `tg/${uid}`);

  /**
   * _submit(raw) — валидировать и (если есть клиент) отправить.
   */
  async function _submit(raw) {
    if (client) return client.give(raw);
    return GiftValidator.validate(raw);
  }

  return {
    /**
     * giveFromContext(ctx, { to?, type, content? }) — создать дар из grammy/telegraf контекста.
     *
     * @param {object} ctx      — контекст бота (ctx.from.id, ctx.message.message_id, ctx.chat.id)
     * @param {{ to?: string, type: string, content?: string }} giftData
     */
    async giveFromContext(ctx, giftData) {
      const userId = ctx.from?.id ?? ctx.message?.from?.id;
      const from   = resolveId(userId);
      const to     = giftData.to ?? defaultReceiver;

      const proof = (ctx.message?.message_id && ctx.chat?.id)
        ? { tg_message_id: ctx.message.message_id, chat_id: ctx.chat.id }
        : undefined;

      const raw = {
        ...createAct(from, to, giftData.type, giftData.content),
        ...(proof ? { proof } : {}),
      };
      return _submit(raw);
    },

    /**
     * giveFromUpdate(update, { to?, type, content? }) — создать дар из сырого Telegram Update.
     *
     * @param {object} update   — Telegram Update object
     * @param {{ to?: string, type: string, content?: string }} giftData
     */
    async giveFromUpdate(update, giftData) {
      const msg    = update.message ?? update.callback_query?.message;
      const userId = msg?.from?.id ?? update.callback_query?.from?.id;
      const from   = resolveId(userId ?? 'unknown');
      const to     = giftData.to ?? defaultReceiver;

      const proof = (msg?.message_id && msg?.chat?.id)
        ? { tg_message_id: msg.message_id, chat_id: msg.chat.id }
        : undefined;

      const raw = {
        ...createAct(from, to, giftData.type, giftData.content),
        ...(proof ? { proof } : {}),
      };
      return _submit(raw);
    },

    /**
     * giveFromWebhook(body, giftData) — Express/Fastify webhook handler helper.
     *
     * @example
     *   app.post('/bot', express.json(), async (req, res) => {
     *     const result = await gift.giveFromWebhook(req.body, {
     *       to: '_koinon', type: 'word'
     *     });
     *     res.json(result);
     *   });
     */
    async giveFromWebhook(body, giftData) {
      return this.giveFromUpdate(body, giftData);
    },

    /**
     * parseCommand(text) — разобрать команду вида "/give @username code описание".
     *
     * @param  {string} text — текст сообщения
     * @returns {{ to: string, type: string, content: string } | null}
     */
    parseCommand(text) {
      if (!text) return null;
      // /give [to] [type] [content...]
      const m = text.match(/^\/give\s+(\S+)\s+(\S+)(?:\s+(.+))?$/i);
      if (!m) return null;
      return {
        to:      m[1].replace(/^@/, ''),
        type:    m[2].toLowerCase(),
        content: m[3] ?? '',
      };
    },

    validate: GiftValidator.validate.bind(GiftValidator),
    client,
  };
}

export default createTelegramAdapter;
