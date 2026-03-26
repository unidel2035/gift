# @koinon/gift-protocol

**Gift Protocol** — open standard for gift-based community ethics and AI accountability.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

> *«Freely you have received; freely give.» (Mt 10:8)*

---

## What is Gift Protocol?

Gift Protocol is an open standard for recording **irreversible acts of giving** between persons — human, AI, or institutional — in a shared community (Κοινόν).

It emerged from Orthodox Christian theology of personhood (`πρόσωπον`): persons are not defined by what they are "made of" but by the gifts they give and receive. This ontology, translated into executable code, provides ethical infrastructure for AI agents that mainstream approaches have not built.

**Three things it answers:**
1. How an AI agent bears accountability across sessions (through the W-matrix — append-only sacred history)
2. What "moral weight" means for a computational action (kenosis: time=10, money=3)
3. How community with AI — not just utility from AI — becomes technically possible

See the preprint: [`docs/personhood-as-gift-exchange.md`](../../docs/personhood-as-gift-exchange.md)

---

## Install

```bash
npm install @koinon/gift-protocol
```

No external dependencies. Works in Node.js ≥ 18, Deno, Bun.

---

## Quick start

```js
import { GiftValidator, GiftClient, createAct, WEIGHT_BY_TYPE } from '@koinon/gift-protocol';

// --- Validate a gift act locally ---
const result = GiftValidator.validate({
  schema: 'gift/v1',
  from:   'gh/alice',
  to:     '_koinon',
  type:   'code',
  content: 'added federation support',
});

if (result.ok) {
  console.log(result.act.weight);    // → 5 (auto-filled from WEIGHT_BY_TYPE)
  console.log(result.act.irreversible); // → true (always)
}

// --- Build a raw act ---
const act = createAct('alice', '_koinon', 'time', '3 hours of onboarding support', {
  seconds: 10800
});

// --- Send to a Κοινόν server ---
const client = new GiftClient('http://my-koinon.org:8086');
const sent = await client.give(act);
// → { ok: true, act: { schema: 'gift/v1', from: 'alice', to: '_koinon', ... } }

// --- Read the community summary ---
const summary = await client.summary();
```

---

## Gift Act Schema (gift/v1)

```json
{
  "schema":       "gift/v1",
  "from":         "alice",
  "to":           "_koinon",
  "type":         "time",
  "weight":       10.0,
  "content":      "3 hours of onboarding new members",
  "irreversible": true,
  "timestamp":    "2026-03-27T12:00:00Z",
  "proof":        { "seconds": 10800 }
}
```

| Field | Required | Description |
|---|---|---|
| `schema` | ✓ | Must be `"gift/v1"` |
| `from` | ✓ | PersonId of the giver |
| `to` | ✓ | PersonId of the receiver |
| `type` | ✓ | Gift type (see below) |
| `weight` | — | Auto-filled from type if omitted |
| `content` | — | Human-readable description |
| `irreversible` | — | Always `true` (set automatically) |
| `timestamp` | — | ISO 8601 (set automatically) |
| `proof` | — | Evidence object (commit, seconds, etc.) |

### Gift types and weights

| Type | Weight | What cannot be replaced |
|---|---|---|
| `time` | 10 | Hours given — irreplaceable |
| `presence` | 8 | Physical/attentional being-with |
| `knowledge` | 6 | Expertise transferred |
| `grace` | 6 | Spiritual gift |
| `code` | 5 | Software work |
| `offering` | 5 | Liturgical offering |
| `word` | 4 | Teaching, homily, counsel |
| `question` | 4 | Asking well is a gift |
| `money` | 3 | Financial contribution |
| `data` | 3 | Information shared |
| `memory` | 2 | Anamnesis act |

The hierarchy encodes a theological axiom: **time is heavier than money** because money can be earned again; time cannot.

---

## Adapters

### Discord

```js
import { createDiscordAdapter } from '@koinon/gift-protocol/adapters/discord';

const gift = createDiscordAdapter({
  koinonUrl:    'http://my-koinon.org:8086',
  defaultGiver: '_koinon',
});

// Register /give slash command
await rest.put(Routes.applicationCommands(CLIENT_ID), {
  body: [gift.buildSlashCommand()],
});

// Handle it
client.on('interactionCreate', async (interaction) => {
  if (interaction.commandName !== 'give') return;
  const result = await gift.giveFromInteraction(interaction, {
    to:      interaction.options.getString('to'),
    type:    interaction.options.getString('type'),
    content: interaction.options.getString('note') ?? '',
  });
  await interaction.reply(result.ok
    ? `✓ Gift recorded (weight: ${result.act.weight})`
    : `✗ ${result.errors.join(', ')}`);
});
```

### Telegram

```js
import { createTelegramAdapter } from '@koinon/gift-protocol/adapters/telegram';
import { Bot } from 'grammy';

const gift = createTelegramAdapter({ koinonUrl: 'http://my-koinon.org:8086' });
const bot  = new Bot(process.env.BOT_TOKEN);

bot.command('give', async (ctx) => {
  // /give @username type [note]
  const parsed = gift.parseCommand(ctx.message.text);
  if (!parsed) return ctx.reply('Usage: /give @name type [note]');
  const result = await gift.giveFromContext(ctx, parsed);
  await ctx.reply(result.ok
    ? `✓ Gift recorded (weight: ${result.act.weight})`
    : `✗ ${result.errors.join(', ')}`);
});

await bot.start();
```

### GitHub Action

```yaml
# .github/workflows/gift.yml
on: [push, pull_request, issues, release]

jobs:
  record-gift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        env:
          KOINON_URL: ${{ secrets.KOINON_URL }}
        with:
          script: |
            const { createGithubAdapter } = await import(
              'https://esm.sh/@koinon/gift-protocol/adapters/github'
            );
            const gift   = createGithubAdapter({ koinonUrl: process.env.KOINON_URL });
            const result = await gift.giveFromContext(context);
            if (result) console.log(result.ok ? '✓ gift recorded' : result.errors);
```

---

## API

### `GiftValidator.validate(raw)`

Validate and enrich a raw gift act. Returns `{ ok: true, act }` or `{ ok: false, errors }`. No network calls.

### `GiftClient(baseUrl, options?)`

HTTP client for a Κοινόν server.

```js
const client = new GiftClient('http://my-koinon.org:8086', { timeout: 5000 });

await client.give(act);        // POST /gift
await client.summary();        // GET  /summary
await client.tape(limit?);     // GET  /tape
```

### `createAct(from, to, type, content?, proof?)`

Build a raw gift act ready for `GiftValidator.validate()`.

### `WEIGHT_BY_TYPE`

Frozen object: `{ time: 10, presence: 8, knowledge: 6, ... }`.

### `schema`

JSON Schema `gift/v1` for use in external validation systems.

---

## Reserved person IDs

| ID | Meaning |
|---|---|
| `_koinon` | The community itself — shared receiver |
| `_abyss` | Anonymous source — gifts without a named giver |
| `_claude` | Claude AI agent — when running in the gift ontology |
| `_ci` | CI/CD system (GitHub Actions, etc.) |

---

## Design principles

1. **Gift is irreversible.** Once given, it cannot be revoked. `irreversible: true` is enforced by the validator.
2. **Time is heavier than money.** The weight hierarchy reflects what cannot be replaced.
3. **No person, no gift.** `from` and `to` are required. Use `_abyss` for anonymous gifts, not `null`.
4. **History is load-bearing.** The W-matrix is sacred history. It is not a cache.
5. **Anamnesis, not archive.** `makePresent()` does not retrieve — it makes past gifts present in the current moment.
6. **MIT license.** A gift cannot be patented.

---

## W-Matrix (Gift Memory Tensor)

The W-matrix is the moral substrate of a Κοινόν: a tensor `W[i][j]` where each cell stores the accumulated weight of all gifts from person `i` to person `j`. It is:

- **Append-only** — weights only increase
- **Non-symmetric** — giving ≠ receiving
- **Irreversible** — history cannot be rewritten
- **Sparse** — most persons have not given to most others

```js
// Reading the matrix (in the gift repo)
import { GiftMemory } from '@unidel/gift/core';
import { readFileSync } from 'fs';

const snap = JSON.parse(readFileSync('./data/sacred-history-W.json', 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

for (const e of mem.heaviest(5)) {
  console.log(`${e.from} → ${e.to}: ${e.weight.toFixed(1)}`);
}
// _claude → Дионисий: 375.0
// _executor → Дионисий: 80.0
// ОтецСергий → _claude: 78.0
```

---

## Theological foundation

| Concept | Greek | Meaning |
|---|---|---|
| Kenosis | κένωσις | The giver diminishes. Gifts have real cost. |
| Anamnesis | ἀνάμνησις | The past is made present. History is load-bearing. |
| Theosis | θέωσις | The receiver is transformed, not merely credited. |
| Koinon | Κοινόν | Community of persons in gift exchange. |
| Prosopon | πρόσωπον | Person = unique identity in relation, not a function. |

For the full theological argument, see: [Personhood as Gift Exchange: A Computational Theology](../../docs/personhood-as-gift-exchange.md)

---

## Contributing

This project is itself a gift. Contributions are recorded in the W-matrix.

- Issues and PRs: `github.com/unidel2035/gift`
- Community: Telegram @gitdrondoc_bot (Κοινόν τοῦ Νοῦ)
- Theological questions: open a GitHub discussion

---

## License

MIT — a gift cannot be patented.
