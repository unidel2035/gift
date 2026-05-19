#!/usr/bin/env node
/**
 * agrypnia-tick.mjs — призыв к бдению.
 *
 * Запускается извне (системный cron каждую минуту, или вручную).
 * Читает due jobs, исполняет payload через `claude --print`
 * (или payload.command через bash). [SILENT]-префикс в ответе модели —
 * молчаливое исполнение, не печатается.
 *
 * Не блокирует: длинные задачи запускаются асинхронно в фоне.
 *
 * Использование:
 *   node utils/agrypnia-tick.mjs            ← один tick
 *   node utils/agrypnia-tick.mjs list       ← показать все jobs
 *   node utils/agrypnia-tick.mjs cancel <id>
 *   node utils/agrypnia-tick.mjs once "<ISO>" "<prompt>" [owner]
 *   node utils/agrypnia-tick.mjs daily "HH:MM" "<prompt>" [owner]
 *   node utils/agrypnia-tick.mjs interval <seconds> "<prompt>" [owner]
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { AgrypniaScheduler, defaultCronPath } from '../src/scheduling/AgrypniaScheduler.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sched = new AgrypniaScheduler(defaultCronPath(ROOT));

const cmd  = process.argv[2] || 'tick';
const arg1 = process.argv[3];
const arg2 = process.argv[4];
const arg3 = process.argv[5];

if (cmd === 'tick') {
  const fired = sched.tick();
  if (!fired.length) { console.log('[agrypnia] no due jobs'); process.exit(0); }
  for (const { job } of fired) {
    console.log(`[agrypnia] fire ${job.id} (${job.type}, owner=${job.owner})`);
    if (job.payload.command) {
      runDetached('bash', ['-lc', job.payload.command], job);
    } else {
      runDetached('claude', ['--print', job.payload.prompt], job);
    }
  }
}

else if (cmd === 'list') {
  const jobs = sched.list();
  if (!jobs.length) { console.log('[агрюпния пуста]'); process.exit(0); }
  for (const j of jobs) {
    const fired = j.lastFiredAt ? ` last=${j.lastFiredAt}` : '';
    console.log(`  ${j.id} [${j.type}:${j.schedule}] owner=${j.owner} fires=${j.fireCount}${fired}`);
    console.log(`    payload: ${JSON.stringify(j.payload).slice(0, 100)}`);
  }
}

else if (cmd === 'cancel') {
  if (!arg1) { console.error('usage: cancel <id>'); process.exit(1); }
  const ok = sched.cancel(arg1);
  console.log(ok ? `✓ cancelled ${arg1}` : `[не найдено] ${arg1}`);
}

else if (cmd === 'once' || cmd === 'daily' || cmd === 'interval') {
  if (!arg1 || !arg2) { console.error(`usage: ${cmd} <schedule> "<prompt>" [owner]`); process.exit(1); }
  const job = sched.schedule({
    type: cmd,
    schedule: cmd === 'interval' ? Number(arg1) : arg1,
    payload: { prompt: arg2 },
    owner: arg3 || '_claude',
  });
  console.log(`✓ scheduled ${job.id} (${job.type}, owner=${job.owner})`);
}

else {
  console.log('agrypnia-tick.mjs — ἀγρυπνία (бдение по своему καιρός)\n');
  console.log('  tick                                одна итерация');
  console.log('  list                                все jobs');
  console.log('  cancel <id>                         снять job');
  console.log('  once "<ISO>" "<prompt>" [owner]     одноразовое');
  console.log('  daily "HH:MM" "<prompt>" [owner]    каждый день UTC');
  console.log('  interval <seconds> "<prompt>" [owner]');
}

function runDetached(cmd, args, job) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', () => {});
  child.on('close', () => {
    const text = out.trim();
    if (job.silent || text.startsWith('[SILENT]')) return;
    if (text) console.log(`[agrypnia/${job.id}] ${text.slice(0, 500)}`);
  });
  child.unref();
}
