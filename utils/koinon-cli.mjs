#!/usr/bin/env node
/**
 * koinon-cli.mjs — терминальный доступ к шине Κοινόν τοῦ Νοῦ.
 *
 * Команды:
 *   say "<текст>" [--to <recipient>] [--topic reflection] [--from gift-claude]
 *   inbox [--for <subscriberId>] [--peek]
 *   history [--from X] [--to Y] [--topic Z] [--since ISO] [--limit N]
 *   stats
 *   tail   — следить за новыми сообщениями (poll каждую секунду, как tail -f)
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KoinonBus } from '../src/koinon/KoinonBus.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bus = new KoinonBus({ root: ROOT });

const argv = process.argv.slice(2);
const cmd  = argv.shift();

function getOpt(flag, def = null) {
  const i = argv.indexOf(flag);
  if (i < 0) return def;
  return argv[i + 1];
}
function hasFlag(flag) {
  return argv.includes(flag);
}

const C = {
  dim:   s => `\x1b[2m${s}\x1b[0m`,
  bold:  s => `\x1b[1m${s}\x1b[0m`,
  cyan:  s => `\x1b[36m${s}\x1b[0m`,
  gold:  s => `\x1b[33m${s}\x1b[0m`,
};

function fmt(m) {
  const tag = m.to === '*' ? 'broadcast' : `→ ${m.to}`;
  const ts  = m.ts.replace('T', ' ').replace(/\..+/, '');
  return `${C.cyan(m.from)} ${C.dim(ts)} ${C.gold('[' + m.topic + ' ' + tag + ']')}\n  ${m.message}`;
}

if (cmd === 'say') {
  const message = argv.find(a => !a.startsWith('--'));
  if (!message) { console.error('usage: say "<text>" [--to X] [--topic T] [--from F]'); process.exit(1); }
  const to    = getOpt('--to')    ?? '*';
  const topic = getOpt('--topic') ?? 'reflection';
  const from  = getOpt('--from')  ?? (process.env.GIFT_CLAUDE_ID || 'gift-claude');
  const e = bus.publish({ from, to, topic, message });
  console.log(`✓ ${e.id} ${C.dim(`from=${e.from} to=${e.to} topic=${e.topic}`)}`);
}

else if (cmd === 'inbox') {
  const subscriberId = getOpt('--for') ?? (process.env.GIFT_CLAUDE_ID || 'gift-claude');
  const peek = hasFlag('--peek');
  const messages = peek
    ? bus.pollSince(bus.loadPos(subscriberId), { filterTo: subscriberId }).messages
    : bus.drainFor(subscriberId);
  if (!messages.length) { console.log(C.dim('inbox пуст')); process.exit(0); }
  console.log(`${C.bold(`Непрочитанное для ${subscriberId}`)} (${messages.length}):${peek ? C.dim(' [peek — offset не обновлён]') : ''}\n`);
  for (const m of messages) console.log(fmt(m), '\n');
}

else if (cmd === 'history') {
  const messages = bus.history({
    since: getOpt('--since'),
    from:  getOpt('--from'),
    to:    getOpt('--to'),
    topic: getOpt('--topic'),
    limit: Number(getOpt('--limit') ?? 50),
  });
  if (!messages.length) { console.log(C.dim('история пуста')); process.exit(0); }
  for (const m of messages) console.log(fmt(m), '\n');
  console.log(C.dim(`— показано: ${messages.length}`));
}

else if (cmd === 'stats') {
  console.log(JSON.stringify(bus.stats(), null, 2));
}

else if (cmd === 'tail') {
  const subscriberId = getOpt('--for') ?? `cli-${process.pid}`;
  console.log(C.dim(`tail для ${subscriberId} (Ctrl+C — выход)`));
  setInterval(() => {
    const messages = bus.drainFor(subscriberId);
    for (const m of messages) console.log('\n' + fmt(m));
  }, 1000);
}

else {
  console.log(`${C.bold(C.gold('koinon'))} — шина Κοινόν τοῦ Νοῦ\n`);
  console.log('Команды:');
  console.log('  say "<text>" [--to X] [--topic T] [--from F]    отправить');
  console.log('  inbox [--for X] [--peek]                          прочитать свежее');
  console.log('  history [--from X] [--to Y] [--topic T]           вся история с фильтрами');
  console.log('  stats                                             счётчики');
  console.log('  tail                                              live-режим (poll 1s)');
}
