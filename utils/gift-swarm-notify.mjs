#!/usr/bin/env node
/**
 * gift-swarm-notify.mjs — Уведомления о конфликтах между агентами
 *
 * Когда два агента пересекаются в одном файле в пределах окна:
 *   1. Записывает инцидент в conflict journal
 *   2. Отправляет сигнал в W-матрицу (акт предупреждения)
 *   3. (планируется) Уведомление через Telegram / Integram
 *
 * Запуск:
 *   node utils/gift-swarm-notify.mjs check      — проверить и уведомить
 *   node utils/gift-swarm-notify.mjs watch      — watch-режим (poll каждые N сек)
 *   node utils/gift-swarm-notify.mjs journal    — показать журнал конфликтов
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JOURNAL = resolve(ROOT, 'data/.swarm/conflict-journal.jsonl');
const NOTIFIED = resolve(ROOT, 'data/.swarm/notified.json');

function ensureJournal() {
  const dir = resolve(ROOT, 'data/.swarm');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Состояние уведомлений (чтобы не спамить) ──────────────────────────────

function notifiedState() {
  try {
    if (existsSync(NOTIFIED)) return JSON.parse(readFileSync(NOTIFIED, 'utf8'));
  } catch {}
  return {};
}

function markNotified(conflictKey) {
  const state = notifiedState();
  state[conflictKey] = Date.now();
  writeFileSync(NOTIFIED, JSON.stringify(state, null, 2));
}

function wasNotifiedRecently(conflictKey, throttleMs = 300_000) {
  const state = notifiedState();
  const last = state[conflictKey] || 0;
  return Date.now() - last < throttleMs;
}

// ── Ядро ───────────────────────────────────────────────────────────────────

async function checkAndNotify() {
  ensureJournal();

  const { detectConflicts, listActiveSessions } =
    await import(resolve(ROOT, 'utils/gift-swarm.mjs'));

  const conflicts = detectConflicts();
  if (conflicts.length === 0) return { notified: 0 };

  const notified = [];
  for (const c of conflicts) {
    const key = `${c.file}:${c.agents.sort().join('+')}`;

    // Throttle: не уведомлять чаще раза в 5 минут
    if (wasNotifiedRecently(key)) continue;

    // ── Запись в журнал ────────────────────────────────────────────────
    const entry = {
      ts: new Date().toISOString(),
      type: c.type,
      file: c.file,
      agents: c.agents,
      windowMs: c.windowMs,
      note: c.note || '',
      touches: c.touches || [],
    };
    writeFileSync(JOURNAL, JSON.stringify(entry) + '\n', { flag: 'a' });

    // ── Сигнал в W-матрицу ─────────────────────────────────────────────
    try {
      const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
      const SNAP = resolve(ROOT, 'data/sacred-history-W.json');
      if (existsSync(SNAP)) {
        const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
        const mem = GiftMemory.fromSnapshot(snap);

        // Между конфликтующими агентами — акт конфликта
        // Это не негатив: конфликт = приглашение к собору
        const [a1, a2] = c.agents;
        mem._idx(a1);
        mem._idx(a2);
        mem.receive({
          giverId: a1,
          receiverId: a2,
          weight: 0.5,
          type: 'conflict',
          content: `пересечение в ${c.file} (${c.type})`,
          irreversible: true,
        });

        writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
      }
    } catch {
      // W-матрица недоступна — продолжаем
    }

    // ── Уведомление в лог ───────────────────────────────────────────
    const icon = c.type === 'lock' ? '🔒' : '⚡';
    const times = c.touches
      ? c.touches.map(t => `${t.agent}@${new Date(t.lastTouch).toISOString().slice(11, 19)}`).join(', ')
      : '';
    console.log(`  ${icon} [swarm-notify] ${c.agents.join(' ↔ ')} → ${c.file} (${times})`);

    markNotified(key);
    notified.push(entry);
  }

  // ── Sweep старых уведомлений ─────────────────────────────────────────
  const state = notifiedState();
  const cutoff = Date.now() - 3600_000; // чистим уведомления старше часа
  let swept = 0;
  for (const k of Object.keys(state)) {
    if (state[k] < cutoff) { delete state[k]; swept++; }
  }
  if (swept > 0) writeFileSync(NOTIFIED, JSON.stringify(state, null, 2));

  return { notified: notified.length, entries: notified };
}

// ── Журнал ─────────────────────────────────────────────────────────────────

function readJournal(limit = 20) {
  const entries = [];
  try {
    if (!existsSync(JOURNAL)) return entries;
    const lines = readFileSync(JOURNAL, 'utf8').split('\n');
    for (const line of lines.reverse()) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch {}
      if (entries.length >= limit) break;
    }
  } catch {}
  return entries;
}

// Only run CLI when this file is the main entry point
const isMain = process.argv[1] && resolve(process.argv[1]).includes('gift-swarm-notify');
if (isMain) {
const CMD = process.argv[2];

if (CMD === 'check') {
  const result = await checkAndNotify();
  if (result.notified === 0) {
    console.log('  ✓ конфликтов нет');
  } else {
    console.log(`  ⚡ уведомлений: ${result.notified}`);
  }
  process.exit(0);
} else if (CMD === 'watch') {
  const interval = parseInt(process.argv[3]) || 30;
  console.log(`  👁 swarm-notify watch: каждые ${interval}с`);
  console.log(`  Ctrl+C для выхода`);
  const tick = async () => {
    await checkAndNotify();
    setTimeout(tick, interval * 1000);
  };
  tick();
} else if (CMD === 'journal') {
  const limit = parseInt(process.argv[3]) || 20;
  const entries = readJournal(limit);
  console.log(JSON.stringify(entries, null, 2));
} else {
  console.error('gift-swarm-notify: check | watch [interval] | journal [limit]');
  process.exit(1);
}
} // end CLI block
