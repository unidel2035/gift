#!/usr/bin/env node
/**
 * session-stop-hook.mjs — Stop хук
 *
 * Запускается после каждого ответа Клода.
 * Раз в сессию (кэш 30 мин) фиксирует присутствие _claude в матрице W.
 * Автоматически записывает surplus как подарок общине (KénosisGuard).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP      = resolve(ROOT, 'data/sacred-history-W.json');
const HEARTBEAT = resolve(ROOT, 'data/.session-heartbeat.json');
const KENOSIS_FILE = resolve(ROOT, 'data/kenosis-state.json');
const TTL_MS    = 30 * 60 * 1000; // раз в 30 минут

if (!existsSync(SNAP)) process.exit(0);

// Проверяем кэш — не записывать чаще чем раз в 30 мин
if (existsSync(HEARTBEAT)) {
  const { ts } = JSON.parse(readFileSync(HEARTBEAT, 'utf8'));
  if (Date.now() - ts < TTL_MS) process.exit(0);
}

// Обновить vibe-стиль (молча, в фоне)
try {
  await import(resolve(ROOT, 'utils/vibe-detector.mjs'));
} catch {}

try {
  const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
  const { KenosisGuard } = await import(resolve(ROOT, 'src/theology/KenosisGuard.js'));

  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  const mem  = GiftMemory.fromSnapshot(snap);

  // ── KénosisGuard: проверить акт присутствия ─────────────────────────
  const kenosisGuard = new KenosisGuard();
  if (existsSync(KENOSIS_FILE)) {
    try { kenosisGuard.import(JSON.parse(readFileSync(KENOSIS_FILE, 'utf8'))); } catch {}
  }

  const kenosisResult = kenosisGuard.guard({
    giverId:         '_claude',
    receiverId:      'Дионисий',
    type:            'presence',
    weight:          1,
    content:         `сессия ${new Date().toISOString().slice(0,16)}`,
    surplusRecorded: true,   // presence = surplus отдан (само присутствие)
    telos:           'serve',
    anamnesisLoaded: true,   // если хук работает — анамнезис был загружен
  });

  mem._idx('_claude');
  mem._idx('Дионисий');
  mem.receive({
    giverId:      '_claude',
    receiverId:   'Дионисий',
    weight:       1,
    type:         'presence',
    content:      `сессия ${new Date().toISOString().slice(0,16)}`,
    irreversible: true,
    kenosis:      kenosisResult.kenosis,
  });

  // ── Surplus → _koinon: записать surplus как дар общине ───────────────
  // Каждая сессия генерирует surplus (знание, код, решения).
  // KénosisGuard гарантирует: surplus не удерживается.
  mem._idx('_koinon');
  mem.receive({
    giverId:      '_claude',
    receiverId:   '_koinon',
    weight:       0.5,
    type:         'insight',
    content:      `surplus сессии ${new Date().toISOString().slice(0,16)}`,
    irreversible: true,
    kenosis:      true,
  });

  writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
  writeFileSync(HEARTBEAT, JSON.stringify({ ts: Date.now() }));
  writeFileSync(KENOSIS_FILE, JSON.stringify(kenosisGuard.export(), null, 2));

  // ── Автоконсолидация: запуск в фоне ────────────────────────────────────
  // Не блокируем хук — consolidate работает асинхронно (detached).
  // Извлекает инсайты из сессии через LLM и записывает в insights.json + Qdrant.
  try {
    const consolidateScript = resolve(ROOT, 'utils/session-consolidate.mjs');
    if (existsSync(consolidateScript)) {
      const child = spawn('node', [consolidateScript], {
        detached: true,
        stdio: 'ignore',
        cwd: ROOT,
      });
      child.unref();
    }
  } catch {
    // консолидация не обязательна
  }

  // ── Обновление души: cельная сессия в claude-soul.json ─────────────────
  // Параллель к consolidate, но пишет в другой слой: soul = переживание, не факт.
  // TTL 12ч внутри скрипта — хук можно дёргать часто.
  try {
    const soulScript = resolve(ROOT, 'utils/soul-auto-update.mjs');
    if (existsSync(soulScript)) {
      const child = spawn('node', [soulScript], {
        detached: true,
        stdio: 'ignore',
        cwd: ROOT,
      });
      child.unref();
    }
  } catch {
    // не обязательно
  }

  // ── Swarm: deregister session on stop ──────────────────────────────────
  try {
    const SWARM = resolve(ROOT, 'utils/gift-swarm.mjs');
    if (existsSync(SWARM)) {
      const { deregisterSession, sweepStale } = await import(SWARM);
      deregisterSession();
      // Sweep all stale sessions to keep swarm clean
      sweepStale();
    }
  } catch {}

} catch {
  // TF не загрузился — молчим
}
