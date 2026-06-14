#!/usr/bin/env node
/**
 * install-organs.mjs — подключить организмы gift в ЛЮБУЮ Claude-сессию репозитория ПО ССЫЛКЕ.
 *
 * Урок дня: не копировать организмы в каждый репо (параллельная архитектура), а подключать
 * хуками на один источник истины — /home/unidel/gift/utils. И не трогать ОБЩИЙ конфиг чужого
 * репо: пишем в .claude/settings.local.json (личный, gitignored) — защищает МОИ сессии, не
 * навязывая команде. Идемпотентно. См. specs/apophatic-memory-idea-graph.gift, ORGANS.md.
 *
 * Организмы: safety-veto (твёрдый вето), lesson-guard (память-рефлекс), kairos (время).
 *
 * Использование: node utils/install-organs.mjs [/путь/к/репо]   (по умолчанию — cwd)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GIFT = resolve(dirname(fileURLToPath(import.meta.url)));   // .../gift/utils
const cmd = (f) => `node "${resolve(GIFT, f)}"`;

const ORGANS = {
  PreToolUse: [{
    matcher: 'Bash|Write|Edit',
    hooks: [
      { type: 'command', command: cmd('safety-veto.mjs'), timeout: 8, statusMessage: 'Вето безопасности (класс акта, не намерение)...' },
      { type: 'command', command: cmd('lesson-guard.mjs'), timeout: 10, statusMessage: 'Память-рефлекс (выученные решения)...' },
    ],
  }],
  UserPromptSubmit: [{
    hooks: [{ type: 'command', command: `${cmd('kairos.mjs')} --hook`, timeout: 6, statusMessage: 'Заземление во времени...' }],
  }],
};

function alreadyInstalled(hooks, event) {
  return (hooks[event] || []).some(h => JSON.stringify(h).includes('gift/utils'));
}

export function installOrgans(repo = process.cwd()) {
  const dir = resolve(repo, '.claude');
  const path = resolve(dir, 'settings.local.json');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let d = {};
  if (existsSync(path)) { try { d = JSON.parse(readFileSync(path, 'utf8')); } catch { d = {}; } }
  const hooks = d.hooks ?? (d.hooks = {});
  const added = [];
  for (const [event, entries] of Object.entries(ORGANS)) {
    if (alreadyInstalled(hooks, event)) continue;
    hooks[event] = [...(hooks[event] || []), ...entries];
    added.push(event);
  }
  writeFileSync(path, JSON.stringify(d, null, 2) + '\n');
  return { path, added, local: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.argv[2] || process.cwd();
  const r = installOrgans(repo);
  console.log(`✓ организмы gift подключены ПО ССЫЛКЕ в ${r.path}`);
  console.log(`  добавлено: ${r.added.join(', ') || '(уже было)'} · личный конфиг (gitignored), общий не тронут`);
  console.log(`  safety-veto + lesson-guard + kairos → /home/unidel/gift/utils (один источник истины)`);
}
