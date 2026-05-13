#!/usr/bin/env node
/**
 * autonomy-daemon.mjs — фоновый процесс, который каждую минуту дёргает
 * `agrypnia tick`. Это и есть привод автономии: pulse, dev-loop и любые
 * другие бдения, запланированные через `gift agrypnia interval`,
 * выполняются сами.
 *
 * Запуск через `gift autonomy start` (pid в data/.autonomy.pid).
 * Лог в data/autonomy.log.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TICK_INTERVAL_MS = 60_000;  // одна минута — стандарт для cron-уровня

function tick() {
  const stamp = new Date().toISOString();
  const r = spawnSync('node', [resolve(ROOT, 'utils/agrypnia-tick.mjs')], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 50_000,
  });
  const out = (r.stdout || '').trim();
  if (out) console.log(`[${stamp}] ${out}`);
  if (r.stderr) {
    const err = r.stderr.trim();
    if (err) console.error(`[${stamp}] stderr: ${err.slice(0, 500)}`);
  }
}

console.log(`[autonomy] daemon стартовал, tick раз в ${TICK_INTERVAL_MS / 1000}с`);
tick();  // первый сразу
setInterval(tick, TICK_INTERVAL_MS);

// чтобы pm2/systemd могли корректно остановить
process.on('SIGTERM', () => { console.log('[autonomy] SIGTERM — выхожу'); process.exit(0); });
process.on('SIGINT',  () => { console.log('[autonomy] SIGINT — выхожу');  process.exit(0); });
