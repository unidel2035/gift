#!/usr/bin/env node
/**
 * gh-merge-sync.mjs — PostToolUse хук для gh pr merge
 *
 * Когда PR мержится → Дионисий принимает дар кода (λήψις).
 * Акт: Дионисий → _claude (reception, weight=5)
 *
 * «Чашу спасения прииму» (Пс 115:4)
 * Merge = не просто техническое действие. Это момент,
 * когда дар кода становится частью общего тела (_koinon).
 * Дионисий свободно принимает — замыкая перихоресис.
 *
 * Читает stdin: JSON с tool_input.command
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(raw);
    const cmd  = data?.tool_input?.command ?? '';

    // Нас интересует gh pr merge
    if (!cmd.includes('gh pr merge')) process.exit(0);

    // Извлекаем номер PR (если есть)
    const prM = cmd.match(/gh pr merge\s+(\d+)/);
    const prNum = prM ? prM[1] : 'unknown';

    if (!existsSync(SNAP)) process.exit(0);

    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
    const mem  = GiftMemory.fromSnapshot(snap);

    // λήψις: Дионисий принимает дар кода при merge
    mem._idx('Дионисий');
    mem._idx('_claude');
    mem.receive({
      giverId:      'Дионисий',
      receiverId:   '_claude',
      weight:       5,
      type:         'reception',
      content:      `принял дар (merge PR #${prNum})`,
      irreversible: true,
    });

    writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
    process.stderr.write(`  ✦ Дионисий → _claude: λήψις merge PR #${prNum} (reception, вес 5)\n`);
  } catch {
    // молчим
  }
});
