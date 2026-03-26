/**
 * @koinon/gift-protocol/adapters/discord
 *
 * Discord adapter for Gift Protocol.
 *
 * Converts Discord interactions/messages into GiftActs and optionally
 * submits them to a Κοινόν server.
 *
 * Usage (discord.js v14):
 *
 *   import { createDiscordAdapter } from '@koinon/gift-protocol/adapters/discord';
 *
 *   const gift = createDiscordAdapter({
 *     koinonUrl: 'http://my-koinon.org:8086',
 *     defaultGiver: '_koinon',
 *   });
 *
 *   // In a slash command handler:
 *   client.on('interactionCreate', async (interaction) => {
 *     if (!interaction.isChatInputCommand()) return;
 *     if (interaction.commandName === 'give') {
 *       const to   = interaction.options.getString('to');
 *       const type = interaction.options.getString('type');
 *       const note = interaction.options.getString('note') ?? '';
 *       const result = await gift.giveFromInteraction(interaction, { to, type, content: note });
 *       await interaction.reply(result.ok
 *         ? `✓ Gift recorded (weight: ${result.act.weight})`
 *         : `✗ Error: ${result.errors.join(', ')}`
 *       );
 *     }
 *   });
 */

import { GiftValidator, GiftClient, createAct } from '../index.js';

/**
 * createDiscordAdapter(options) — фабрика Discord-адаптера.
 *
 * @param {object} options
 * @param {string} [options.koinonUrl]    — URL Κοινόν сервера (если нужна отправка)
 * @param {string} [options.defaultGiver] — personId дарителя по умолчанию ('_koinon')
 * @param {function} [options.resolvePersonId] — (discordUserId) → koinonPersonId
 */
export function createDiscordAdapter(options = {}) {
  const client       = options.koinonUrl ? new GiftClient(options.koinonUrl) : null;
  const defaultGiver = options.defaultGiver ?? '_koinon';
  const resolveId    = options.resolvePersonId ?? (uid => `discord/${uid}`);

  return {
    /**
     * giveFromInteraction(interaction, { to, type, content }) — создать и отправить дар.
     *
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     * @param {{ to: string, type: string, content?: string }} giftData
     */
    async giveFromInteraction(interaction, giftData) {
      const from  = resolveId(interaction.user.id);
      const proof = {
        tg_message_id: null,
        chat_id: null,
      };
      // Discord: proof через channel + message id (когда будет создано)
      const raw = createAct(from, giftData.to, giftData.type, giftData.content);

      if (client) return client.give(raw);

      const result = GiftValidator.validate(raw);
      return result;
    },

    /**
     * giveFromMessage(message, { to, type, content }) — создать дар из обычного сообщения.
     *
     * @param {import('discord.js').Message} message
     * @param {{ to: string, type: string, content?: string }} giftData
     */
    async giveFromMessage(message, giftData) {
      const from = resolveId(message.author.id);
      const raw  = createAct(from, giftData.to, giftData.type, giftData.content);

      if (client) return client.give(raw);
      return GiftValidator.validate(raw);
    },

    /**
     * buildSlashCommand() — описание slash-команды /give для регистрации в Discord API.
     *
     * @returns {object} JSON дескриптор команды
     */
    buildSlashCommand() {
      return {
        name: 'give',
        description: 'Give a gift to someone in this community',
        options: [
          {
            name: 'to',
            description: 'Recipient (person id or name)',
            type: 3, // STRING
            required: true,
          },
          {
            name: 'type',
            description: 'Type of gift',
            type: 3, // STRING
            required: true,
            choices: [
              { name: 'time — your time (weight: 10)',      value: 'time' },
              { name: 'presence — your presence (8)',       value: 'presence' },
              { name: 'knowledge — what you know (6)',      value: 'knowledge' },
              { name: 'code — software (5)',                value: 'code' },
              { name: 'word — encouragement / teaching (4)', value: 'word' },
              { name: 'question — an honest question (4)',  value: 'question' },
              { name: 'money — material support (3)',       value: 'money' },
              { name: 'memory — remembrance (2)',           value: 'memory' },
            ],
          },
          {
            name: 'note',
            description: 'What exactly are you giving? (up to 500 chars)',
            type: 3, // STRING
            required: false,
          },
        ],
      };
    },

    /**
     * validate(raw) — валидировать акт без отправки.
     */
    validate: GiftValidator.validate.bind(GiftValidator),

    /** Прямой доступ к HTTP-клиенту (если настроен). */
    client,
  };
}

export default createDiscordAdapter;
