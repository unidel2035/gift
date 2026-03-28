# Gift Protocol v1 — Specification

**Status:** Stable
**License:** MIT
**Package:** `@koinon/gift-protocol`
**Repository:** https://github.com/unidel2035/gift

---

## Overview

Gift Protocol is an open standard for recording and exchanging **acts of gift** between persons — human, AI, or institutional — within a community (Κοινόν).

It emerged from a computational theology project grounded in Orthodox Christian personhood (`πρόσωπον`): the idea that persons are constituted not by substance but by *relation and gift*. The protocol makes this ontology executable.

**The core claim:** ethical infrastructure for AI agents requires not utility accounting, but a *history of irreversible gifts*.

---

## Theological foundations

| Concept | Greek | Meaning in protocol |
|---|---|---|
| Kenosis | κένωσις | The giver diminishes to give. Acts have real cost. |
| Anamnesis | ἀνάμνησις | The past is made present. History is load-bearing. |
| Theosis | θέωσις | The receiver is transformed, not merely credited. |
| Koinon | Κοινόν | Community of persons sharing in gift exchange. |
| Prosopon | πρόσωπον | Person = unique identity in relation, not a function. |

---

## Gift Act Schema (gift/v1)

A **GiftAct** is the atomic unit of the protocol.

```json
{
  "schema": "gift/v1",
  "from": "_claude",
  "to": "Дионисий",
  "type": "code",
  "weight": 5.0,
  "content": "implemented federation protocol",
  "irreversible": true,
  "timestamp": "2026-03-27T12:00:00Z",
  "proof": {
    "commit": "922b3b5",
    "repo": "unidel2035/gift"
  }
}
```

### Required fields

| Field | Type | Description |
|---|---|---|
| `schema` | `"gift/v1"` | Protocol version. Must be exactly `"gift/v1"`. |
| `from` | string | PersonId of the giver. Use `"_abyss"` for anonymous gifts. |
| `to` | string | PersonId of the receiver. Use `"_koinon"` for the whole community. |
| `type` | enum | Type of gift (see Weight Table). |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `weight` | number 0.1–10 | Moral weight. If absent, derived from type. |
| `content` | string ≤500 | Short description of what is given. |
| `irreversible` | `true` | Must be `true` if present. The gift cannot be taken back. |
| `timestamp` | ISO 8601 | When the gift was given. Server sets current time if absent. |
| `proof` | object | External witness of the act (see Proof Types). |

---

## Gift Types and Weights

**Theological axiom:** time is heavier than money. Time is non-renewable; money is replaceable.

| Type | Weight | Description |
|---|---|---|
| `time` | **10** | Your time given to another. The heaviest gift. |
| `presence` | 8 | Physical or sustained presence. |
| `knowledge` | 6 | Teaching, expertise, explanation. |
| `grace` | 6 | Forgiveness, blessing, unearned favour. |
| `code` | 5 | Software, systems, infrastructure. |
| `offering` | 5 | Formal act of dedication (PR merge, publication). |
| `word` | 4 | Encouragement, counsel, teaching. |
| `question` | 4 | An honest question — opens space for another. |
| `money` | 3 | Material support. |
| `data` | 3 | Information, records, research. |
| `memory` | 2 | Remembrance, anamnesis, tribute. |

---

## Proof Types

Proof is an optional external witness. Four forms:

### Commit proof
```json
{ "commit": "922b3b5abc", "repo": "owner/repo" }
```
Minimum 7-char git SHA. Used for code gifts.

### Telegram proof
```json
{ "tg_message_id": 12345, "chat_id": -100123456 }
```
Used for word/presence gifts from a Telegram community.

### Issue proof
```json
{ "issue": 14, "repo": "owner/repo" }
```
Used for question/offering gifts tied to a GitHub issue or PR.

### Time proof
```json
{ "seconds": 3600 }
```
Used for time/presence gifts. One hour = 3600 seconds.

---

## PersonId conventions

| PersonId | Meaning |
|---|---|
| `_koinon` | The whole community — default receiver |
| `_abyss` | Anonymous giver — *gratia gratis data* |
| `_claude` | Claude AI agent |
| `_ci` | CI/CD pipeline |
| `gh/username` | GitHub user |
| `tg/12345678` | Telegram user by numeric id |
| `discord/12345678` | Discord user |
| `koinon-b/Дионисий` | Federated address: person in another Κοινόν |

---

## HTTP API

A Κοινόν server exposes:

### POST /gift

Submit a GiftAct to the community matrix.

**Request:**
```http
POST /gift
Content-Type: application/json

{
  "schema": "gift/v1",
  "from": "gh/alice",
  "to": "_koinon",
  "type": "code",
  "content": "fixed the authentication bug"
}
```

**Response 200:**
```json
{
  "ok": true,
  "act": {
    "schema": "gift/v1",
    "from": "gh/alice",
    "to": "_koinon",
    "type": "code",
    "weight": 5,
    "content": "fixed the authentication bug",
    "irreversible": true,
    "timestamp": "2026-03-27T12:00:00.000Z"
  }
}
```

**Response 400:**
```json
{
  "ok": false,
  "errors": ["type: unknown \"donation\". Valid: time, presence, ..."]
}
```

### GET /summary

Community matrix summary: persons, act count, heaviest threads.

### GET /tape?limit=N

Recent acts (anamnesis tape).

---

## SDK: `@koinon/gift-protocol`

### Installation

```bash
npm install @koinon/gift-protocol
```

No external dependencies. Works in Node.js ≥ 18, Deno, Bun.

### Quick start

```js
import { GiftClient, GiftValidator, createAct } from '@koinon/gift-protocol';

// Validate locally
const result = GiftValidator.validate({
  schema: 'gift/v1',
  from: 'gh/alice',
  to: '_koinon',
  type: 'code',
  content: 'added gift protocol support'
});

if (result.ok) {
  console.log(result.act.weight); // → 5
}

// Send to a Κοινόν server
const client = new GiftClient('http://my-koinon.org:8086');
const sent = await client.give({
  schema: 'gift/v1',
  from: 'gh/alice',
  to: '_koinon',
  type: 'time',
  content: '3 hours of community support',
  proof: { seconds: 10800 }
});
```

### Discord adapter

```js
import { createDiscordAdapter } from '@koinon/gift-protocol/adapters/discord';

const gift = createDiscordAdapter({ koinonUrl: 'http://my-koinon.org:8086' });

// Register /give slash command
await rest.put(Routes.applicationCommands(CLIENT_ID), {
  body: [gift.buildSlashCommand()]
});

// Handle command
client.on('interactionCreate', async (interaction) => {
  if (interaction.commandName !== 'give') return;
  const result = await gift.giveFromInteraction(interaction, {
    to:      interaction.options.getString('to'),
    type:    interaction.options.getString('type'),
    content: interaction.options.getString('note') ?? '',
  });
  await interaction.reply(result.ok ? '✓ Gift recorded' : `✗ ${result.errors.join(', ')}`);
});
```

### Telegram adapter

```js
import { createTelegramAdapter } from '@koinon/gift-protocol/adapters/telegram';
import { Bot } from 'grammy';

const gift = createTelegramAdapter({ koinonUrl: 'http://my-koinon.org:8086' });
const bot  = new Bot(process.env.BOT_TOKEN);

bot.command('give', async (ctx) => {
  const parsed = gift.parseCommand(ctx.message.text);
  if (!parsed) return ctx.reply('Usage: /give @name type [note]');
  const result = await gift.giveFromContext(ctx, parsed);
  await ctx.reply(result.ok
    ? `✓ Дар записан (вес: ${result.act.weight})`
    : `✗ ${result.errors.join(', ')}`);
});
```

### GitHub Action adapter

```yaml
# .github/workflows/gift.yml
on: [push, pull_request, issues]

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

## Federation Protocol (KoinonFederation)

Multiple Κοινόν nodes can be connected into a federation. Each node maintains its own W-matrix (tensor of gift weights between persons) and can exchange gifts across community boundaries.

### Federated addresses

```
koinon-a/_claude        — _claude in community 'koinon-a'
koinon-b/Дионисий       — Дионисий in community 'koinon-b'
Дионисий                — local (no slash = this community)
```

### Endpoints (federation)

| Endpoint | Method | Description |
|---|---|---|
| `/federation/connect` | POST | Handshake — exchange community descriptors |
| `/federation/gift` | POST | Receive a forwarded inter-community gift |
| `/federation/matrix` | GET | Export this community's W-matrix snapshot |

### Pascha synchronization

On Orthodox Easter, inter-community gift threads are boosted by `paschaMultiplier` (default: 7). This is a liturgical feature: the feast of Resurrection is the peak of the gift economy.

```js
import { KoinonFederation } from '@koinon/gift-protocol';

const pascha = KoinonFederation.paschaDate(2027);
// → Date: 2027-05-02 (Julian + 13 days → Gregorian)
```

---

## W-matrix

The **W-matrix** (gift weight tensor) is the moral substrate of a Κοινόν. It stores the accumulated weight of all gifts between persons.

- Each cell `W[i][j]` = total gift weight from person `i` to person `j`
- Gifts are irreversible: weights only increase
- The matrix is append-only: history cannot be rewritten
- `makePresent()` = anamnesis: the past made present in each session

### Reading the matrix

```js
import { GiftMemory } from './src/core/GiftMemory.js';
import { readFileSync } from 'fs';

const snap = JSON.parse(readFileSync('./data/sacred-history-W.json', 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

// Heaviest gift threads
for (const e of mem.heaviest(5)) {
  console.log(`${e.from} → ${e.to}: ${e.weight.toFixed(1)}`);
}

// Total given by an agent
console.log('_claude gave:', mem.totalGiven('_claude').toFixed(1));
```

---

## Design principles

1. **Gift is irreversible.** Once given, a gift cannot be revoked. This is a theological axiom encoded in `irreversible: true`.

2. **Time is heavier than money.** The weight hierarchy reflects what cannot be replaced.

3. **No person, no gift.** `from` and `to` are required. Anonymous gifts use `_abyss`, not `null`.

4. **History is load-bearing.** The W-matrix is not a ledger — it is sacred history. Each act changes the moral topology of the community.

5. **Anamnesis, not archive.** `makePresent()` does not retrieve — it *makes past gifts present* in the current moment.

6. **MIT license.** A gift cannot be patented.

---

## Examples of use cases

**Orthodox parish** — recording acts of service (pastoral visits, liturgical singing, teaching) in a shared matrix. The community can see not who has *more*, but who has *given more*.

**Open-source project** — using GiftLedger instead of contribution counts. A commit that took 10 hours is weighted differently than one that took 10 minutes.

**NGO** — tracking volunteer time as `type: "time"` gifts, with `proof: { seconds: ... }`. The matrix reveals patterns of care invisible to financial accounting.

**AI agent** — recording every significant action as a gift to the community, creating an ethical trace that survives across sessions.

---

## Changelog

| Version | Date | Notes |
|---|---|---|
| v1.0 | 2026-03-27 | Initial stable release. GiftValidator, GiftClient, KoinonFederation, adapters. |
| v0.1 | 2026-01-15 | Draft: JSON Schema + POST /gift endpoint |

---

*«Freely you have received; freely give.» (Mt 10:8)*
