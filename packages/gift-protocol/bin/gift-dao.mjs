#!/usr/bin/env node
/**
 * gift-dao — CLI для Gift Protocol DAO
 *
 * Команды:
 *   gift-dao init <name>           — инициализировать новую DAO
 *   gift-dao add --from A --to B --type code [--content "..."] — записать акт
 *   gift-dao report [--out file.md] — сгенерировать Markdown-отчёт
 *
 * «Freely you have received; freely give.» (Mt 10:8)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Импортируем из локального index.js (работает как npm-пакет или из репозитория)
const __dir = dirname(fileURLToPath(import.meta.url));
const { GiftValidator, GiftLocalStore, WEIGHT_BY_TYPE } = await import(`${__dir}/../index.js`);

// ── Парсинг аргументов ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

const flags = parseFlags(args.slice(1));

// ── Конфиг DAO ───────────────────────────────────────────────────────────────

const CONFIG_FILE = resolve(process.cwd(), 'gift-dao.config.json');

async function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    console.error('Error: gift-dao.config.json not found. Run: gift-dao init <name>');
    process.exit(1);
  }
  return JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
}

// ── КОМАНДА: init ─────────────────────────────────────────────────────────────

async function cmdInit(name) {
  if (!name) {
    console.error('Usage: gift-dao init <dao-name>');
    process.exit(1);
  }

  const slug = name.toLowerCase().replace(/\s+/g, '-');
  const historyFile = resolve(process.cwd(), 'sacred-history.json');
  const configFile = CONFIG_FILE;

  if (existsSync(configFile)) {
    console.error('Error: gift-dao.config.json already exists. DAO already initialised.');
    process.exit(1);
  }

  const now = new Date().toISOString();

  // Три начальных акта — пример для онбординга
  const initialActs = [
    Object.freeze({
      schema: 'gift/v1',
      from: '_koinon',
      to: slug,
      type: 'grace',
      weight: 6,
      content: `DAO "${name}" initialised — welcome to the community of gift`,
      irreversible: true,
      timestamp: now,
    }),
    Object.freeze({
      schema: 'gift/v1',
      from: 'Alice',
      to: slug,
      type: 'time',
      weight: 10,
      content: 'Drafted the founding charter',
      irreversible: true,
      timestamp: now,
    }),
    Object.freeze({
      schema: 'gift/v1',
      from: 'Bob',
      to: 'Alice',
      type: 'word',
      weight: 4,
      content: 'Reviewed and blessed the charter',
      irreversible: true,
      timestamp: now,
    }),
  ];

  await writeFile(historyFile, JSON.stringify(initialActs, null, 2), 'utf8');

  const config = {
    name,
    slug,
    historyFile: './sacred-history.json',
    topN: 10,
    createdAt: now,
  };
  await writeFile(configFile, JSON.stringify(config, null, 2), 'utf8');

  console.log(`✓ DAO "${name}" initialised.`);
  console.log(`  sacred-history.json  — ${initialActs.length} example acts`);
  console.log(`  gift-dao.config.json — configuration`);
  console.log('');
  console.log('Next steps:');
  console.log('  gift-dao report                            — view current state');
  console.log('  gift-dao add --from Alice --to Bob --type code --content "..."');
}

// ── КОМАНДА: add ──────────────────────────────────────────────────────────────

async function cmdAdd() {
  const config = await loadConfig();
  const historyFile = resolve(process.cwd(), config.historyFile ?? 'sacred-history.json');

  const { from, to, type, content, weight } = flags;

  if (!from || !to || !type) {
    console.error('Usage: gift-dao add --from <person> --to <person> --type <type> [--content "..."] [--weight N]');
    console.error('');
    console.error('Types:', Object.keys(WEIGHT_BY_TYPE).join(', '));
    process.exit(1);
  }

  const raw = {
    schema: 'gift/v1',
    from,
    to,
    type,
    irreversible: true,
    ...(content ? { content } : {}),
    ...(weight ? { weight: parseFloat(weight) } : {}),
  };

  const store = new GiftLocalStore(historyFile, { topN: config.topN ?? 5 });
  const result = await store.give(raw);

  if (!result.ok) {
    console.error('Validation errors:');
    for (const e of result.errors) console.error(' ·', e);
    process.exit(1);
  }

  const { act } = result;
  console.log(`✓ Gift recorded: ${act.from} → ${act.to} [${act.type}, weight=${act.weight}]`);
  if (act.content) console.log(`  "${act.content}"`);
}

// ── КОМАНДА: report ───────────────────────────────────────────────────────────

async function cmdReport() {
  const config = await loadConfig();
  const historyFile = resolve(process.cwd(), config.historyFile ?? 'sacred-history.json');

  if (!existsSync(historyFile)) {
    console.error(`Error: ${historyFile} not found.`);
    process.exit(1);
  }

  const store = new GiftLocalStore(historyFile, { topN: config.topN ?? 5 });
  const markdown = await store.report();

  const outFile = flags.out;
  if (outFile) {
    const absOut = resolve(process.cwd(), outFile);
    await mkdir(dirname(absOut), { recursive: true });
    await writeFile(absOut, markdown, 'utf8');
    console.log(`✓ Report written to ${absOut}`);
  } else {
    console.log(markdown);
  }
}

// ── Диспетчер ─────────────────────────────────────────────────────────────────

switch (command) {
  case 'init':
    await cmdInit(args[1]);
    break;
  case 'add':
    await cmdAdd();
    break;
  case 'report':
    await cmdReport();
    break;
  default:
    console.log('gift-dao — Gift Protocol CLI');
    console.log('');
    console.log('Commands:');
    console.log('  gift-dao init <name>                        Init a new DAO');
    console.log('  gift-dao add --from A --to B --type code    Record a gift act');
    console.log('  gift-dao report [--out report.md]           Generate Markdown report');
    console.log('');
    console.log('Gift types:', Object.keys(WEIGHT_BY_TYPE).join(', '));
    if (command && command !== '--help' && command !== '-h') {
      console.error(`\nUnknown command: "${command}"`);
      process.exit(1);
    }
    break;
}
