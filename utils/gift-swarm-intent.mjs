#!/usr/bin/env node
/**
 * gift-swarm-intent.mjs — Pre-write intention broadcast
 *
 * "Я собираюсь трогать X и Y" — перед тем как писать код.
 * Остальные агенты видят намерения и могут обойти.
 *
 * Паттерны из исследования:
 *   - Waggle dance (пчёлы): broadcast quality + location, others decide
 *   - Drone deconfliction: объявить траекторию, слушать конфликты
 *   - Tuple space (Linda): pattern-matched coordination board
 *
 * Использование:
 *   node utils/gift-swarm-intent.mjs declare --files "src/auth.ts,src/types.ts"
 *   node utils/gift-swarm-intent.mjs check --file src/auth.ts
 *   node utils/gift-swarm-intent.mjs board
 *   node utils/gift-swarm-intent.mjs clear
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTENT_DIR = resolve(ROOT, 'data', '.swarm', 'intentions');
const INTENT_TTL_MS = 10 * 60 * 1000; // 10 минут

function ensureDir() {
  if (!existsSync(INTENT_DIR)) mkdirSync(INTENT_DIR, { recursive: true });
}

function agentId() {
  return process.env.GIFT_AGENT_ID || '_claude';
}

function intentFile(agent) {
  return resolve(INTENT_DIR, `${agent}.json`);
}

// ── Declare intention ────────────────────────────────────────────────────────

export function declareIntent(files, metadata = {}) {
  ensureDir();
  const agent = agentId();
  const intent = {
    agent,
    files: files.map(f => relative(ROOT, f)),
    declared: Date.now(),
    expires: Date.now() + INTENT_TTL_MS,
    metadata,
  };
  writeFileSync(intentFile(agent), JSON.stringify(intent, null, 2));
  return intent;
}

export function clearIntent(agentName) {
  const agent = agentName || agentId();
  const f = intentFile(agent);
  if (existsSync(f)) { unlinkSync(f); return true; }
  return false;
}

export function myIntent() {
  const f = intentFile(agentId());
  if (!existsSync(f)) return null;
  try {
    const intent = JSON.parse(readFileSync(f, 'utf8'));
    if (Date.now() > intent.expires) { clearIntent(); return null; }
    return intent;
  } catch { return null; }
}

export function allIntentions() {
  ensureDir();
  const now = Date.now();
  const intentions = [];
  try {
    const files = readdirSync(INTENT_DIR);
    for (const fn of files) {
      if (!fn.endsWith('.json')) continue;
      try {
        const intent = JSON.parse(readFileSync(resolve(INTENT_DIR, fn), 'utf8'));
        if (now > intent.expires) {
          unlinkSync(resolve(INTENT_DIR, fn));
          continue;
        }
        intentions.push(intent);
      } catch {}
    }
  } catch {}
  return intentions;
}

export function checkIntent(filePath) {
  const norm = relative(ROOT, filePath);
  const intentions = allIntentions();
  const me = agentId();
  const conflicts = [];

  for (const intent of intentions) {
    if (intent.agent === me) continue;
    for (const f of intent.files) {
      if (f === norm || norm.startsWith(f) || f.startsWith(norm)) {
        conflicts.push({
          agent: intent.agent,
          file: f,
          declared: intent.declared,
          expires: intent.expires,
          note: `${intent.agent} собирается трогать ${f} (до ${new Date(intent.expires).toISOString().slice(11,19)})`,
        });
      }
    }
  }
  return conflicts;
}

// ── Context for agent prompts ─────────────────────────────────────────────────

export function intentContext() {
  const intentions = allIntentions();
  const me = agentId();
  const others = intentions.filter(i => i.agent !== me);

  if (others.length === 0) return '';

  const lines = ['[Намерения других агентов:]'];
  for (const i of others) {
    const timeLeft = Math.max(0, Math.round((i.expires - Date.now()) / 1000));
    const files = i.files.join(', ');
    lines.push(`  • ${i.agent}: ${files} (ещё ~${timeLeft}с)`);
  }
  lines.push('  → Избегай этих файлов или согласуй изменение');
  return lines.join('\n');
}

// ── Sweep expired ────────────────────────────────────────────────────────────

export function sweepIntentions() {
  ensureDir();
  let count = 0;
  const now = Date.now();
  try {
    const files = readdirSync(INTENT_DIR);
    for (const fn of files) {
      if (!fn.endsWith('.json')) continue;
      try {
        const intent = JSON.parse(readFileSync(resolve(INTENT_DIR, fn), 'utf8'));
        if (now > intent.expires) {
          unlinkSync(resolve(INTENT_DIR, fn));
          count++;
        }
      } catch { unlinkSync(resolve(INTENT_DIR, fn)); count++; }
    }
  } catch {}
  return count;
}

// Only run CLI when this file is the main entry point
const isMain = process.argv[1] && resolve(process.argv[1]).includes('gift-swarm-intent');
if (isMain) {
const CMD = process.argv[2];

if (CMD === 'declare') {
  const filesArg = process.argv.find((_, i) => process.argv[i-1] === '--files');
  const files = filesArg ? filesArg.split(',').map(s => s.trim()) : [];
  if (files.length === 0) {
    console.error('declare --files "src/a.ts,src/b.ts"');
    process.exit(1);
  }
  const intent = declareIntent(files);
  console.log(JSON.stringify(intent, null, 2));
  console.log(`  📢 ${intent.agent} объявил намерение: ${intent.files.join(', ')}`);
} else if (CMD === 'check') {
  const file = process.argv.find((_, i) => process.argv[i-1] === '--file');
  if (!file) {
    console.error('check --file <path>');
    process.exit(1);
  }
  const conflicts = checkIntent(file);
  console.log(JSON.stringify(conflicts, null, 2));
} else if (CMD === 'board') {
  const intentions = allIntentions();
  if (intentions.length === 0) {
    console.log('  (доска намерений пуста)');
  } else {
    for (const i of intentions) {
      const left = Math.max(0, Math.round((i.expires - Date.now()) / 1000));
      console.log(`  📢 ${i.agent}: ${i.files.join(', ')} (${left}с)`);
    }
  }
} else if (CMD === 'clear') {
  clearIntent();
  console.log(`  ✓ намерение очищено`);
} else if (CMD === 'sweep') {
  const n = sweepIntentions();
  console.log(`  ✓ очищено просроченных: ${n}`);
} else if (CMD === 'context') {
  const ctx = intentContext();
  if (ctx) console.log(ctx);
} else {
  console.error('gift-swarm-intent: declare | check | board | clear | sweep | context');
  process.exit(1);
}
} // end CLI block
