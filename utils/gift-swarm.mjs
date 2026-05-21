#!/usr/bin/env node
/**
 * gift-swarm.mjs — Стигмергийная координация агентов
 *
 * Без центрального оркестратора. Координация через общую файловую память:
 *   - кто активен (сессии)
 *   - кто что пишет (блокировки)
 *   - где конфликты (детектор)
 *
 * Каждый акт необратимо меняет поле для следующих агентов — как феромоны у муравьёв.
 *
 * Использование (CLI):
 *   node utils/gift-swarm.mjs register --agent Dev1
 *   node utils/gift-swarm.mjs heartbeat
 *   node utils/gift-swarm.mjs lock acquire --file src/foo.js
 *   node utils/gift-swarm.mjs lock release --file src/foo.js
 *   node utils/gift-swarm.mjs lock check --file src/foo.js
 *   node utils/gift-swarm.mjs sessions
 *   node utils/gift-swarm.mjs conflicts
 *   node utils/gift-swarm.mjs deregister
 *
 * Богословский слой:
 *   Стигмергия (στίγμα + ἔργον) — метка-дар, меняющая поле.
 *   Не «кто командует», а «чей дар изменил ландшафт».
 *   1 Кор 12: «Вы — тело Христово, а порознь — члены».
 *   Координация не через иерархию, а через взаимное признание даров.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SWARM_DIR = resolve(ROOT, 'data', '.swarm');
const SESSIONS_DIR = resolve(SWARM_DIR, 'sessions');
const LOCKS_DIR = resolve(SWARM_DIR, 'locks');
const LOG_DIR = resolve(SWARM_DIR, 'log');
const TOUCH_FILE = resolve(SWARM_DIR, 'touches.jsonl');
const CROSS_WINDOW_MS = 60_000; // окно пересечения: 60с

// ── Init ──────────────────────────────────────────────────────────────────────

function ensureDirs() {
  for (const d of [SWARM_DIR, SESSIONS_DIR, LOCKS_DIR, LOG_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function agentId() {
  return process.env.GIFT_AGENT_ID || process.env.USER || 'unknown';
}

function sessionFile(agent) {
  return resolve(SESSIONS_DIR, `${agent}.json`);
}

function lockFile(filePath) {
  const norm = relative(ROOT, filePath).replace(/\//g, '__');
  return resolve(LOCKS_DIR, `${norm}.json`);
}

// ── Session Registry ──────────────────────────────────────────────────────────

export function registerSession(agentName, metadata = {}) {
  ensureDirs();
  const agent = agentName || agentId();
  const hostPid = process.env.SWARM_HOST_PID
    ? parseInt(process.env.SWARM_HOST_PID)
    : (process.ppid || process.pid);
  const sid = `${agent}-${Date.now()}`;
  const session = {
    sessionId: sid,
    agent,
    pid: hostPid,
    started: Date.now(),
    heartbeat: Date.now(),
    files: [],
    metadata: {
      hostname: process.env.HOSTNAME || '',
      claudeSession: process.env.CLAUDE_SESSION_ID || '',
      model: process.env.CLAUDE_MODEL || '',
      ...metadata,
    },
  };
  writeFileSync(sessionFile(agent), JSON.stringify(session, null, 2));
  log(`[swarm] сессия ${agent} зарегистрирована: ${sid.slice(-8)}`);
  return session;
}

export function heartbeat(agentName) {
  const agent = agentName || agentId();
  const file = sessionFile(agent);
  if (!existsSync(file)) return null;
  try {
    const session = JSON.parse(readFileSync(file, 'utf8'));
    session.heartbeat = Date.now();
    writeFileSync(file, JSON.stringify(session, null, 2));
    return session;
  } catch { return null; }
}

export function deregisterSession(agentName) {
  const agent = agentName || agentId();
  const file = sessionFile(agent);
  if (!existsSync(file)) return false;
  try {
    // Release all locks held by this agent
    const ourLocks = getAgentLocks(agent);
    for (const lk of ourLocks) {
      try { unlinkSync(lockFile(lk.file)); } catch {}
    }
    unlinkSync(file);
    log(`[swarm] сессия ${agent} дерегистрирована`);
    return true;
  } catch { return false; }
}

export function listActiveSessions(staleMs = 120_000) {
  ensureDirs();
  const now = Date.now();
  const sessions = [];
  try {
    const files = readdirSync(SESSIONS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = JSON.parse(readFileSync(resolve(SESSIONS_DIR, f), 'utf8'));
        const age = now - s.heartbeat;
        s.stale = age > staleMs;
        s.ageMs = age;
        sessions.push(s);
      } catch {}
    }
  } catch {}
  return sessions.sort((a, b) => b.heartbeat - a.heartbeat);
}

export function activeSession(agentName) {
  const agent = agentName || agentId();
  const file = sessionFile(agent);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return null; }
}

export function activeFileEditors(filePath, excludeAgent) {
  const active = listActiveSessions();
  const norm = relative(ROOT, filePath);
  return active.filter(s =>
    s.agent !== excludeAgent &&
    s.files.some(f => f.startsWith(norm) || norm.startsWith(f))
  );
}

// ── File Locks ────────────────────────────────────────────────────────────────

export function acquireLock(filePath, agentName) {
  ensureDirs();
  const agent = agentName || agentId();
  const lf = lockFile(filePath);

  // Check if already locked
  const existing = checkLock(filePath);
  if (existing) {
    // Stale lock (pid dead) — reclaim
    if (existing.stale) {
      releaseLock(filePath, existing.agent);
      log(`[swarm] перехвачен stale lock ${relative(ROOT, filePath)} от ${existing.agent}`);
    } else {
      // Record touch even on failed acquire — shows intent/conflict
      recordTouch(filePath, agent);
      return { acquired: false, holder: existing.agent, since: existing.acquired };
    }
  }

  // PID хоста: если запущен как хук (дочерний процесс Cline), берём ppid.
  // Если CLI — process.pid. SWARM_HOST_PID можно переопределить извне.
  const hostPid = process.env.SWARM_HOST_PID
    ? parseInt(process.env.SWARM_HOST_PID)
    : (process.ppid || process.pid);

  const lock = {
    file: relative(ROOT, filePath),
    agent,
    pid: hostPid,
    ppid: process.ppid || null,
    acquired: Date.now(),
  };
  writeFileSync(lf, JSON.stringify(lock, null, 2));

  // Track in session
  const sf = sessionFile(agent);
  if (existsSync(sf)) {
    try {
      const session = JSON.parse(readFileSync(sf, 'utf8'));
      if (!session.files.includes(lock.file)) session.files.push(lock.file);
      session.heartbeat = Date.now();
      writeFileSync(sf, JSON.stringify(session, null, 2));
    } catch {}
  }

  recordTouch(filePath, agent);
  log(`[swarm] блокировка: ${agent} → ${lock.file}`);
  return { acquired: true };
}

export function releaseLock(filePath, agentName) {
  const agent = agentName || agentId();
  const lf = lockFile(filePath);
  if (!existsSync(lf)) return false;
  try {
    const lock = JSON.parse(readFileSync(lf, 'utf8'));
    unlinkSync(lf);

    // Remove from session tracking
    const sf = sessionFile(agent);
    if (existsSync(sf)) {
      try {
        const session = JSON.parse(readFileSync(sf, 'utf8'));
        const norm = relative(ROOT, filePath);
        session.files = session.files.filter(f => f !== norm);
        writeFileSync(sf, JSON.stringify(session, null, 2));
      } catch {}
    }

    log(`[swarm] освобождена: ${agent} → ${lock.file}`);
    return true;
  } catch { return false; }
}

export function checkLock(filePath) {
  const lf = lockFile(filePath);
  if (!existsSync(lf)) return null;
  try {
    const lock = JSON.parse(readFileSync(lf, 'utf8'));
    const stale = isPidDead(lock.pid);
    return { ...lock, stale };
  } catch { return null; }
}

function isPidDead(pid) {
  try {
    return process.kill(pid, 0) === false;
  } catch {
    return true; // ESRCH = no such process
  }
}

function getAgentLocks(agent) {
  const locks = [];
  try {
    const files = readdirSync(LOCKS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const l = JSON.parse(readFileSync(resolve(LOCKS_DIR, f), 'utf8'));
        if (l.agent === agent) {
          locks.push(l);
        }
      } catch {}
    }
  } catch {}
  return locks;
}

// ── Touch Log ─────────────────────────────────────────────────────────────────

function recordTouch(filePath, agentName) {
  ensureDirs();
  const agent = agentName || agentId();
  const entry = {
    ts: Date.now(),
    file: relative(ROOT, filePath),
    agent,
  };
  try {
    writeFileSync(TOUCH_FILE, JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch {}
}

function readTouches(sinceMs) {
  const cutoff = Date.now() - sinceMs;
  const touches = [];
  try {
    if (!existsSync(TOUCH_FILE)) return touches;
    const lines = readFileSync(TOUCH_FILE, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const t = JSON.parse(line);
        if (t.ts >= cutoff) touches.push(t);
      } catch {}
    }
  } catch {}
  return touches;
}

export function sweepTouches(maxAgeMs = 300_000) {
  // Keep only last 5 min of touches, compact in place
  const cutoff = Date.now() - maxAgeMs;
  try {
    if (!existsSync(TOUCH_FILE)) return 0;
    const lines = readFileSync(TOUCH_FILE, 'utf8').split('\n').filter(Boolean);
    const kept = [];
    let removed = 0;
    for (const line of lines) {
      try {
        const t = JSON.parse(line);
        if (t.ts >= cutoff) kept.push(line);
        else removed++;
      } catch { kept.push(line); }
    }
    if (removed > 0 || kept.length !== lines.length) {
      writeFileSync(TOUCH_FILE, kept.join('\n') + (kept.length ? '\n' : ''));
    }
    return removed;
  } catch { return 0; }
}

// ── Conflict Detection ────────────────────────────────────────────────────────

export function detectConflicts(windowMs = CROSS_WINDOW_MS) {
  ensureDirs();
  const conflicts = [];
  const active = listActiveSessions().filter(s => !s.stale);

  // ── Слой 1: активные блокировки (жёсткий конфликт) ──────────────────────────
  const lockConflicts = {};
  for (const s of active) {
    for (const f of s.files) {
      const lf = lockFile(resolve(ROOT, f));
      if (existsSync(lf)) {
        try {
          const l = JSON.parse(readFileSync(lf, 'utf8'));
          if (!lockConflicts[f]) lockConflicts[f] = [];
          lockConflicts[f].push(l.agent);
        } catch {}
      }
    }
  }
  for (const [file, agents] of Object.entries(lockConflicts)) {
    const unique = [...new Set(agents)];
    if (unique.length > 1) {
      conflicts.push({ file, agents: unique, type: 'lock', windowMs });
    }
  }

  // ── Слой 2: окно пересечения (мягкий конфликт) ──────────────────────────────
  const touches = readTouches(windowMs);

  // Also treat active locks as touches (Alice holds lock → she's "touching" now)
  try {
    const lockFiles = readdirSync(LOCKS_DIR).filter(f => f.endsWith('.json'));
    for (const lf of lockFiles) {
      try {
        const l = JSON.parse(readFileSync(resolve(LOCKS_DIR, lf), 'utf8'));
        // Add as touch if within window
        if (l.acquired && l.acquired >= Date.now() - windowMs) {
          touches.push({ ts: l.acquired, file: l.file, agent: l.agent, _viaLock: true });
        }
      } catch {}
    }
  } catch {}

  const fileAgents = {};
  for (const t of touches) {
    const key = t.file;
    if (!fileAgents[key]) fileAgents[key] = new Set();
    fileAgents[key].add(t.agent);
  }

  for (const [file, agentSet] of Object.entries(fileAgents)) {
    if (agentSet.size > 1) {
      const agents = [...agentSet];
      // Check if already caught by lock layer
      const alreadyListed = conflicts.find(c => c.file === file && c.type === 'lock');
      if (!alreadyListed) {
        // Get timestamps for each agent
        const agentTouches = agents.map(a => {
          const tsList = touches.filter(t => t.file === file && t.agent === a).map(t => t.ts);
          return { agent: a, lastTouch: Math.max(...tsList) };
        });
        conflicts.push({
          file,
          agents,
          type: 'overlap',
          windowMs,
          touches: agentTouches,
          note: `файл трогали ${agents.join(' и ')} в пределах ${(windowMs/1000).toFixed(0)}с`,
        });
      }
    }
  }

  return conflicts;
}

// ── Context for agent prompts ─────────────────────────────────────────────────

/**
 * Генерирует контекстную строку для вставки в system prompt агента.
 * Показывает: кто активен, какие файлы заблокированы, какие конфликты.
 */
export function swarmContext() {
  const sessions = listActiveSessions();
  const active = sessions.filter(s => !s.stale);
  const conflicts = detectConflicts();
  const agentMe = agentId();

  let lines = [];

  if (active.length <= 1) {
    lines.push('  • Других активных агентов нет');
  } else {
    const others = active.filter(s => s.agent !== agentMe);
    lines.push(`  • Активных агентов: ${others.map(s => s.agent).join(', ')}`);

    // Show what files each agent is touching
    for (const s of others) {
      if (s.files.length > 0) {
        lines.push(`    ${s.agent}: ${s.files.join(', ')}`);
      }
    }
  }

  // Show conflicts
  if (conflicts.length > 0) {
    for (const c of conflicts) {
      const icon = c.type === 'lock' ? '🔒' : '⚡';
      if (c.type === 'overlap' && c.touches) {
        const times = c.touches.map(t => `${t.agent}@${new Date(t.lastTouch).toISOString().slice(11,19)}`).join(', ');
        lines.push(`  ${icon} ПЕРЕСЕЧЕНИЕ: ${c.file} — ${c.agents.join(' и ')} (${times})`);
      } else if (c.type === 'lock') {
        const lockedBy = c.agents.length > 0 ? ` (заблокирован: ${c.agents.join(', ')})` : '';
        lines.push(`  ${icon} КОНФЛИКТ: ${c.file} — правят: ${c.agents.join(', ')}${lockedBy}`);
      }
    }
  } else {
    // Check for overlap window hints even without conflicts
    const touches = readTouches(CROSS_WINDOW_MS);
    const fileAgents = {};
    for (const t of touches) {
      if (t.agent === agentMe) continue;
      const key = t.file;
      if (!fileAgents[key]) fileAgents[key] = new Set();
      fileAgents[key].add(t.agent);
    }
    for (const [file, agentSet] of Object.entries(fileAgents)) {
      if (agentSet.size > 0) {
        lines.push(`  👁 ${file}: недавно трогал ${[...agentSet].join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

// ── Sweep stale sessions ──────────────────────────────────────────────────────

export function sweepStale(staleMs = 120_000) {
  ensureDirs();
  const sessions = listActiveSessions(staleMs);
  let cleared = 0;
  for (const s of sessions) {
    if (s.stale) {
      // Check if it's really stale (multiple checks)
      try {
        const sf = sessionFile(s.agent);
        if (!existsSync(sf)) continue;
        const current = JSON.parse(readFileSync(sf, 'utf8'));
        if (Date.now() - current.heartbeat > staleMs) {
          deregisterSession(s.agent);
          cleared++;
        }
      } catch {}
    }
  }
    if (cleared > 0) log(`[swarm] очищено stale сессий: ${cleared}`);
  const touched = sweepTouches();
  if (touched > 0) log(`[swarm] очищено touches: ${touched}`);
  return cleared;
}

// ── Log ───────────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  try {
    writeFileSync(resolve(LOG_DIR, 'swarm.log'), `[${ts}] ${msg}\n`, { flag: 'a' });
  } catch {}
  // Always log to stderr
  process.stderr.write(`  ${msg}\n`);
}

// ── CLI ────────────────────────────────────────────────────────────────────────

// Only run CLI when this file is the main entry point (not when imported)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (!isMain) {
  // Module mode: exports only, no CLI
} else {
  const CMD = process.argv[2];

if (CMD === 'register') {
  const agent = process.argv.find((_, i) => process.argv[i-1] === '--agent') || agentId();
  const session = registerSession(agent);
  console.log(JSON.stringify(session));
} else if (CMD === 'heartbeat') {
  const s = heartbeat();
  console.log(s ? JSON.stringify(s) : '{"error":"no session"}');
} else if (CMD === 'deregister') {
  const ok = deregisterSession();
  console.log(JSON.stringify({ deregistered: ok }));
} else if (CMD === 'sessions') {
  const sessions = listActiveSessions();
  console.log(JSON.stringify(sessions, null, 2));
} else if (CMD === 'conflicts') {
  const windowArg = process.argv.find((_, i) => process.argv[i-1] === '--window');
  const windowMs = windowArg ? parseInt(windowArg) * 1000 : CROSS_WINDOW_MS;
  const conflicts = detectConflicts(windowMs);
  console.log(JSON.stringify(conflicts, null, 2));
} else if (CMD === 'sweep-touches') {
  const n = sweepTouches();
  console.log(JSON.stringify({ swept: n }));
} else if (CMD === 'context') {
  console.log(swarmContext());
} else if (CMD === 'sweep') {
  const n = sweepStale();
  console.log(JSON.stringify({ swept: n }));
} else if (CMD === 'lock') {
  const action = process.argv[3];
  const file = process.argv.find((_, i) => process.argv[i-1] === '--file');
  const agent = process.argv.find((_, i) => process.argv[i-1] === '--agent') || agentId();
  if (action === 'acquire' && file) {
    const result = acquireLock(file, agent);
    console.log(JSON.stringify(result));
  } else if (action === 'release' && file) {
    const ok = releaseLock(file, agent);
    console.log(JSON.stringify({ released: ok }));
  } else if (action === 'check' && file) {
    const result = checkLock(file);
    console.log(JSON.stringify(result));
  } else {
    console.error('lock: acquire|release|check --file <path> [--agent <name>]');
    process.exit(1);
  }
} else if (CMD) {
  console.error(`Неизвестная команда: ${CMD}`);
  console.error('Доступно: register, heartbeat, deregister, sessions, conflicts, context, sweep, lock, sweep-touches');
  process.exit(1);
}
} // end CLI block
