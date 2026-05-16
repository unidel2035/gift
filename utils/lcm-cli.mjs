#!/usr/bin/env node
/**
 * lcm-cli.mjs — θησαυρός: терминальный доступ к полнотекстовому корпусу.
 *
 * Команды:
 *   ingest                    ← загрузить chat-sessions + insights + acts
 *   recall "<query>" [N]      ← полнотекстовый поиск, top-N (default 10)
 *   unfold <source_id> [N]    ← развернуть документ/сессию по source_id
 *   stats                     ← статистика по источникам
 *
 * Имена `recall_treasure` / `unfold_treasure` идут от θησαυρός
 * (Мф 13:52): хозяин выносит из сокровищницы новое и старое.
 * Это не «архив» — это живой запас.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LcmStore, defaultDbPath } from '../src/lcm/store.js';
import { ingestChatSessions, ingestInsights, ingestActs } from '../src/lcm/ingest.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cmd  = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

const store = new LcmStore(defaultDbPath(ROOT));

if (cmd === 'ingest') {
  const cs = ingestChatSessions(store, ROOT);
  const ix = ingestInsights(store, ROOT);
  const ax = ingestActs(store, ROOT);
  console.log('chat-sessions:', cs);
  console.log('insights:    ', ix);
  console.log('acts:        ', ax);
  console.log('stats:       ', store.stats());
}

else if (cmd === 'recall') {
  if (!arg1) { console.error('usage: lcm-cli.mjs recall "<query>" [N]'); process.exit(1); }
  const limit = Number(arg2 || 10);
  const rows = store.grep(arg1, { limit });
  if (!rows.length) { console.log('[пусто]'); process.exit(0); }
  for (const r of rows) {
    console.log(`\n#${r.id} [${r.source}/${r.source_id}] ${r.role || '-'} ${r.ts}`);
    console.log(`  rank: ${r.rank.toFixed(3)}`);
    console.log(`  ${r.snippet}`);
  }
  console.log(`\n— найдено: ${rows.length}`);
}

else if (cmd === 'unfold') {
  if (!arg1) { console.error('usage: lcm-cli.mjs unfold <source_id> [N]'); process.exit(1); }
  const limit = Number(arg2 || 200);
  const rows = store.expand(arg1, { limit });
  if (!rows.length) { console.log('[не найдено]'); process.exit(0); }
  for (const r of rows) {
    console.log(`\n[${r.source}] ${r.role || '-'} @ ${r.ts}`);
    console.log(r.content);
  }
  console.log(`\n— документов: ${rows.length}`);
}

else if (cmd === 'stats') {
  console.log(JSON.stringify(store.stats(), null, 2));
}

else {
  console.log('lcm-cli.mjs — θησαυρός (полнотекстовая память)\n');
  console.log('Команды:');
  console.log('  ingest                       загрузить корпус');
  console.log('  recall "<query>" [N]         полнотекстовый поиск');
  console.log('  unfold <source_id> [N]       развернуть документ/сессию');
  console.log('  stats                        статистика');
}

store.close();
