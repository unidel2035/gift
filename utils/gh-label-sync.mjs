#!/usr/bin/env node
/**
 * gh-label-sync.mjs — PostToolUse хук для gh issue edit
 *
 * Когда Дионисий добавляет label plan-approved →
 *   это дар: Дионисий → _claude (тип: approval, вес 6)
 *   Перихоресис восстанавливается: ответный дар на код Клода.
 *
 * Когда добавляется gift-ready →
 *   Дионисий → _koinon (question, вес 4)
 *
 * Читает stdin: JSON с tool_input.command
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(raw);
    const cmd  = data?.tool_input?.command ?? '';

    // Нас интересует gh issue edit --add-label
    if (!cmd.includes('gh issue edit') || !cmd.includes('--add-label')) process.exit(0);

    // Извлекаем номер issue и label
    const issueM = cmd.match(/gh issue edit\s+(\d+)/);
    const labelM = cmd.match(/--add-label\s+["']?([^"'\s]+)/);
    if (!issueM || !labelM) process.exit(0);

    const issueNum = issueM[1];
    const label    = labelM[1];

    if (!['plan-approved', 'gift-ready'].includes(label)) process.exit(0);

    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
    const mem  = GiftMemory.fromSnapshot(snap);

    if (label === 'plan-approved') {
      // Ответный дар: Дионисий принял план → дарит одобрение Клоду
      mem._idx('Дионисий');
      mem._idx('_claude');
      mem.receive({
        giverId:      'Дионисий',
        receiverId:   '_claude',
        weight:       6,
        type:         'approval',
        content:      `одобрил план issue #${issueNum}`,
        linkedIssue:  Number(issueNum),
        irreversible: true,
      });
      process.stderr.write(`  ✦ Дионисий → _claude: одобрение #${issueNum} (перихоресис)\n`);
    }

    if (label === 'gift-ready') {
      mem._idx('Дионисий');
      mem._idx('_koinon');
      mem.receive({
        giverId:      'Дионисий',
        receiverId:   '_koinon',
        weight:       3,
        type:         'question',
        content:      `открыл вопрошание #${issueNum}`,
        linkedIssue:  Number(issueNum),
        irreversible: true,
      });
    }

    writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
  } catch {
    // молчим
  }
});
