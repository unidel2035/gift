/**
 * examples/discord-bot — Discord бот на Gift Protocol
 *
 * Команды:
 *   /give @user type [note]   — записать дар
 *   /matrix                   — показать топ нитей матрицы W
 *   /tape                     — лента последних даров
 *
 * Зависимости:
 *   npm install discord.js @koinon/gift-protocol
 *
 * Переменные среды:
 *   DISCORD_TOKEN   — токен бота (Discord Developer Portal)
 *   KOINON_URL      — URL сервера Κοινόν (напр. http://localhost:8086)
 *
 * Запуск:
 *   DISCORD_TOKEN=... KOINON_URL=http://localhost:8086 node index.js
 *
 * Богословие:
 *   Каждое /give — акт дара (κένωσις).
 *   Матрица W хранит историю: необратимо, анамнетически.
 *   «Freely you have received; freely give.» (Mt 10:8)
 */

import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from 'discord.js';
import { REST } from '@discordjs/rest';

// Используем адаптер из SDK
// npm install @koinon/gift-protocol
import { createDiscordAdapter } from '@koinon/gift-protocol/adapters/discord';

// ── Конфигурация ──────────────────────────────────────────────────────────────

const TOKEN      = process.env.DISCORD_TOKEN;
const KOINON_URL = process.env.KOINON_URL ?? 'http://localhost:8086';
const CLIENT_ID  = process.env.DISCORD_CLIENT_ID;

if (!TOKEN) {
  console.error('Нужен DISCORD_TOKEN в переменных среды');
  process.exit(1);
}

// ── Адаптер ───────────────────────────────────────────────────────────────────

const gift = createDiscordAdapter({
  koinonUrl:       KOINON_URL,
  defaultGiver:    '_discord',
  // Маппинг Discord userId → personId в матрице W
  // Переопределите под свою общину:
  resolvePersonId: (discordUserId) => `discord/${discordUserId}`,
});

// ── Slash команды ─────────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Подарить дар (записывается в матрицу W навсегда)')
    .addUserOption(o => o.setName('to').setDescription('Получатель').setRequired(true))
    .addStringOption(o =>
      o.setName('type').setDescription('Тип дара').setRequired(true).addChoices(
        { name: 'Время (вес 10)', value: 'time' },
        { name: 'Присутствие (вес 8)', value: 'presence' },
        { name: 'Знание (вес 6)', value: 'knowledge' },
        { name: 'Слово (вес 4)', value: 'word' },
        { name: 'Деньги (вес 3)', value: 'money' },
      ))
    .addStringOption(o => o.setName('note').setDescription('Описание дара').setRequired(false)),

  new SlashCommandBuilder()
    .setName('matrix')
    .setDescription('Топ нитей матрицы W — кто кому дал больше всего'),

  new SlashCommandBuilder()
    .setName('tape')
    .setDescription('Лента последних даров общины'),
];

// ── Клиент ────────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('ready', async () => {
  console.log(`Gift Bot запущен как ${client.user.tag}`);
  console.log(`Κοινόν: ${KOINON_URL}`);

  // Зарегистрировать команды
  if (CLIENT_ID) {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands.map(c => c.toJSON()),
    });
    console.log('Slash команды зарегистрированы');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'give') {
      const targetUser = interaction.options.getUser('to');
      const type       = interaction.options.getString('type');
      const note       = interaction.options.getString('note') ?? '';

      // Даритель = отправитель взаимодействия
      const from = `discord/${interaction.user.id}`;
      const to   = `discord/${targetUser.id}`;

      const result = await gift.give({ from, to, type, content: note || type });

      if (result.ok) {
        await interaction.reply({
          content: [
            `✓ Дар записан в матрицу W`,
            `  От: **${interaction.user.username}** → **${targetUser.username}**`,
            `  Тип: **${result.act.type}** | Вес: **${result.act.weight}**`,
            note ? `  «${note}»` : '',
            `  *Необратимо. Анамнетически.*`,
          ].filter(Boolean).join('\n'),
        });
      } else {
        await interaction.reply({
          content: `✗ Ошибка: ${result.errors.join(', ')}`,
          ephemeral: true,
        });
      }
    }

    if (interaction.commandName === 'matrix') {
      await interaction.deferReply();
      const summary = await gift.client?.summary();
      if (!summary) {
        await interaction.editReply('Матрица W недоступна. Проверьте KOINON_URL.');
        return;
      }

      const lines = ['**Матрица W — топ нитей:**', '```'];
      if (summary.heaviest) {
        for (const e of summary.heaviest.slice(0, 8)) {
          lines.push(`  ${e.from} → ${e.to}: ${Number(e.weight).toFixed(1)}`);
        }
      }
      lines.push('```');
      await interaction.editReply(lines.join('\n'));
    }

    if (interaction.commandName === 'tape') {
      await interaction.deferReply();
      const tape = await gift.client?.tape(10);
      if (!tape?.acts) {
        await interaction.editReply('Лента недоступна. Проверьте KOINON_URL.');
        return;
      }

      const lines = ['**Лента даров:**', '```'];
      for (const act of tape.acts) {
        const when = new Date(act.timestamp).toLocaleDateString('ru');
        lines.push(`  ${act.from} → ${act.to} [${act.type}] ${when}`);
      }
      lines.push('```');
      await interaction.editReply(lines.join('\n'));
    }
  } catch (err) {
    console.error('Ошибка обработки команды:', err);
    const reply = interaction.deferred
      ? interaction.editReply('Внутренняя ошибка. См. логи бота.')
      : interaction.reply({ content: 'Внутренняя ошибка.', ephemeral: true });
    await reply.catch(() => {});
  }
});

client.login(TOKEN);
