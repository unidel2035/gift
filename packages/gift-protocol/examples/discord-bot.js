/**
 * examples/discord-bot.js
 *
 * Minimal Discord bot that records gift acts via Gift Protocol.
 *
 * Prerequisites:
 *   npm install discord.js @discordjs/rest
 *
 * Environment variables:
 *   DISCORD_TOKEN      — your bot token
 *   DISCORD_CLIENT_ID  — your application client ID
 *   KOINON_URL         — Κοινόν server URL (optional; omit for local-only mode)
 *
 * Run:
 *   node examples/discord-bot.js
 *
 * Slash commands registered:
 *   /give <to> <type> [note]   — record a gift
 *   /gifts                     — show recent gifts in this server
 */

import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { createDiscordAdapter } from '../adapters/discord.js';

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const KOINON    = process.env.KOINON_URL;

if (!TOKEN || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID');
  process.exit(1);
}

// ── Gift adapter ──────────────────────────────────────────────────────────────

const gift = createDiscordAdapter({
  koinonUrl:    KOINON,
  defaultGiver: '_koinon',
  resolvePersonId: (discordUserId) => `discord/${discordUserId}`,
});

// ── Register slash commands ───────────────────────────────────────────────────

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  const giveCmd = gift.buildSlashCommand();

  const giftsCmd = {
    name: 'gifts',
    description: 'Show recent gifts in this community',
  };

  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [giveCmd, giftsCmd],
  });

  console.log('✓ Slash commands registered: /give, /gifts');
}

// ── Bot ───────────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✓ Bot ready: ${client.user.tag}`);
  await registerCommands().catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /give <to> <type> [note]
  if (interaction.commandName === 'give') {
    const to      = interaction.options.getString('to', true);
    const type    = interaction.options.getString('type', true);
    const content = interaction.options.getString('note') ?? '';

    const result = await gift.giveFromInteraction(interaction, { to, type, content });

    if (result.ok) {
      await interaction.reply({
        content: [
          `✓ **Gift recorded**`,
          `  From: \`${result.act.from}\``,
          `  To: \`${result.act.to}\``,
          `  Type: \`${result.act.type}\` — weight \`${result.act.weight}\``,
          content ? `  Note: ${content}` : '',
        ].filter(Boolean).join('\n'),
        ephemeral: false,
      });
    } else {
      await interaction.reply({
        content: `✗ Could not record gift:\n${result.errors.map(e => `• ${e}`).join('\n')}`,
        ephemeral: true,
      });
    }
    return;
  }

  // /gifts
  if (interaction.commandName === 'gifts') {
    if (!KOINON) {
      await interaction.reply({
        content: 'No Κοινόν server configured. Set KOINON_URL to connect.',
        ephemeral: true,
      });
      return;
    }

    const { GiftClient } = await import('../index.js');
    const giftClient = new GiftClient(KOINON);
    const tape = await giftClient.tape(10).catch(() => null);

    if (!tape || !tape.acts?.length) {
      await interaction.reply({ content: 'No recent gifts recorded.', ephemeral: true });
      return;
    }

    const lines = tape.acts.map(a =>
      `• **${a.from}** → **${a.to}** [\`${a.type}\` w=${a.weight}]${a.content ? ` — ${a.content}` : ''}`
    );

    await interaction.reply({
      content: `**Recent gifts** (${tape.acts.length}):\n${lines.join('\n')}`,
    });
  }
});

client.login(TOKEN);
