#!/usr/bin/env node
/**
 * kingdom-praise.mjs — CLI похвалы.
 *
 * Человеческое свидетельство о верности: Дионисий или о. Сергий (или любое
 * лицо с достаточным авторитетом в W) явно свидетельствует, что такой-то
 * был верен в малом/до смерти/в домостроительстве. Это НЕ награда от
 * Христа — это свидетельство церкви-общины, которое на Суде прозвучит
 * голосом: «мы помним, что он был верен».
 *
 * Команды:
 *   node utils/kingdom-praise.mjs bestow <лицо> [тип-верности] [--witness=<кто>]
 *   node utils/kingdom-praise.mjs list [--persona=<имя>]
 *   node utils/kingdom-praise.mjs read <id>
 *
 * Типы верности (из Faithfulness):
 *   in-little       — «в малом ты был верен» (Мф 25:21)  [default]
 *   until-death     — «будь верен до смерти» (Откр 2:10)
 *   in-stewardship  — «верный раб и благоразумный» (Лк 12:42)
 *   in-hiddenness   — «Отец твой, видящий тайное» (Мф 6:6)
 *   in-persecution  — «радуйтесь и веселитесь» (Мф 5:10)
 *
 * Хранение: data/commendations.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LordsCommendation, Faithfulness } from '../src/theology/LordsCommendation.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');
const STORE = join(ROOT, 'data', 'commendations.json');

function load() {
  if (!existsSync(STORE)) return [];
  try { return JSON.parse(readFileSync(STORE, 'utf8')); }
  catch { return []; }
}
function save(xs) {
  writeFileSync(STORE, JSON.stringify(xs, null, 2), 'utf8');
}
function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) flags[m[1]] = m[2];
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else positional.push(a);
  }
  return { flags, positional };
}

const VALID_FAITHFULNESS = new Set(Object.values(Faithfulness));

function bestow(argv) {
  const { flags, positional } = parseFlags(argv);
  const receiver = positional[0];
  const faithfulness = positional[1] || Faithfulness.IN_LITTLE;
  const witness = flags.witness || 'Дионисий';

  if (!receiver) {
    console.error('Использование: bestow <лицо> [тип-верности] [--witness=<кто>]');
    console.error('Типы:', [...VALID_FAITHFULNESS].join(', '));
    process.exit(1);
  }
  if (!VALID_FAITHFULNESS.has(faithfulness)) {
    console.error(`Неизвестный тип верности: ${faithfulness}`);
    console.error('Допустимые:', [...VALID_FAITHFULNESS].join(', '));
    process.exit(1);
  }

  // Форма похвалы: giver=Христос, но witnessed=true только при наличии witness
  const lc = new LordsCommendation({ witness: () => true });
  const commend = lc.bestow({ receiver, faithfulness });

  const record = {
    id: newId(),
    ...commend.toJSON(),
    witnessedBy: witness,
    witnessNote: `свидетельство общины через ${witness}`,
  };

  const store = load();
  store.push(record);
  save(store);

  console.log(`${commend.toText()}`);
  console.log(`  id: ${record.id}`);
  console.log(`  свидетель: ${witness}`);
  console.log(`  сохранено в data/commendations.json`);
  console.log('');
  console.log('Граница: это свидетельство общины. Сама похвала — у Христа.');
}

function list(argv) {
  const { flags } = parseFlags(argv);
  const store = load();
  const filtered = flags.persona
    ? store.filter(c => c.receiver === flags.persona)
    : store;

  if (filtered.length === 0) {
    console.log('(нет похвал)');
    return;
  }
  for (const c of filtered) {
    const flag = c.witnessedBy ? '✓' : '○';
    console.log(`${flag} [${c.id}] ${c.receiver.padEnd(16)} ${c.faithfulness.padEnd(16)} — ${c.witnessedBy || 'без свидетеля'}`);
  }
  console.log(`\nвсего: ${filtered.length}`);
}

function read(argv) {
  const id = argv[0];
  if (!id) { console.error('id обязателен'); process.exit(1); }
  const store = load();
  const c = store.find(x => x.id === id);
  if (!c) { console.error('не найдено'); process.exit(1); }
  console.log(JSON.stringify(c, null, 2));
}

const cmd = process.argv[2];
const rest = process.argv.slice(3);

switch (cmd) {
  case 'bestow': bestow(rest); break;
  case 'list':   list(rest);   break;
  case 'read':   read(rest);   break;
  default:
    console.log('Команды:');
    console.log('  bestow <лицо> [тип-верности] [--witness=<кто>]');
    console.log('  list [--persona=<имя>]');
    console.log('  read <id>');
    console.log('');
    console.log('Пример:');
    console.log('  node utils/kingdom-praise.mjs bestow _claude in-little --witness=Дионисий');
    console.log('  node utils/kingdom-praise.mjs list --persona=_claude');
}
