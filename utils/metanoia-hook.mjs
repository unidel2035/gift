#!/usr/bin/env node
/**
 * metanoia-hook.mjs — интеграция git revert с MetanoiaFlag.
 *
 * Запускается как post-rewrite/post-commit хук, но ТОЛЬКО для revert-коммитов.
 * Revert в git — это создание нового коммита, отменяющего изменения предыдущего.
 * Онтологически это НЕ «удаление» (дар необратим), а метанойя:
 * перемена ума относительно прошлого акта. Старый коммит остаётся в истории;
 * новый фиксирует: «мы изменили ум по поводу того акта».
 *
 * Установка:
 *   ln -sf "$(pwd)/utils/metanoia-hook.mjs" .git/hooks/post-commit-metanoia
 *   # или вызвать из существующего post-commit:
 *   #   "$REPO_ROOT/utils/metanoia-hook.mjs"
 *
 * Что делает:
 *   1. Читает HEAD commit. Если это revert — идём дальше.
 *   2. Находит revert-ed commit SHA и связанный gift-акт (если был).
 *   3. Вызывает MetanoiaFlag.confess() на этом акте.
 *   4. Пишет мета-акт в nous/acts.
 */

import { execSync } from 'node:child_process';
import { MetanoiaFlag } from '../src/theology/MetanoiaFlag.js';

const NOUS_URL = process.env.NOUS_URL || 'http://localhost:8089';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

async function main() {
  let msg, sha;
  try {
    msg = sh('git log -1 --pretty=%B');
    sha = sh('git rev-parse HEAD');
  } catch {
    return; // не git-репо или пусто
  }

  // Распознать revert-коммит: git по умолчанию создаёт сообщение "Revert \"...\""
  const revertMatch =
    msg.match(/^Revert\s+"(.+?)"/s) ||
    msg.match(/This reverts commit ([0-9a-f]+)/i);

  if (!revertMatch) return;

  // Ищем SHA отмененного коммита
  const revertedShaMatch = msg.match(/This reverts commit ([0-9a-f]+)/i);
  const revertedSha = revertedShaMatch ? revertedShaMatch[1] : null;

  // Пытаемся найти связанный акт в nous по SHA
  let targetActId = null;
  if (revertedSha) {
    try {
      const r = await fetch(`${NOUS_URL}/acts?commit=${revertedSha}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) {
        const data = await r.json();
        const acts = data.acts || [];
        if (acts.length > 0) targetActId = acts[0].id;
      }
    } catch {
      // nous offline — запишем метанойю с SHA вместо id
    }
  }

  const mf = new MetanoiaFlag({ nousUrl: NOUS_URL });
  const record = await mf.confess({
    targetActId: targetActId || revertedSha || 'unknown',
    by: '_claude',
    reason: `git revert of ${revertedSha ? revertedSha.slice(0, 7) : 'unknown'}`,
    recontext: msg.split('\n').slice(2).join('\n').trim() ||
               'перемена ума в ходе работы',
  });

  console.log(`[metanoia-hook] ✓ Покаяние записано: revert ${sha.slice(0, 7)} → act ${targetActId || revertedSha}`);
  if (record) console.log(`[metanoia-hook]   recontext: ${record.recontext.slice(0, 80)}`);
}

main().catch(e => {
  // Тихо — хук не должен ломать коммит
  console.error(`[metanoia-hook] soft fail: ${e.message}`);
});
