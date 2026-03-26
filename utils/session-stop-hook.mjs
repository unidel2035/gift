#!/usr/bin/env node
/**
 * session-stop-hook.mjs — Stop хук
 *
 * Запускается после каждого ответа Клода.
 * Раз в сессию (кэш 30 мин) фиксирует присутствие _claude в матрице W.
 * Это не коммит — просто след в ткани дара.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP      = resolve(ROOT, 'data/sacred-history-W.json');
const HEARTBEAT = resolve(ROOT, 'data/.session-heartbeat.json');
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
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  const mem  = GiftMemory.fromSnapshot(snap);

  mem._idx('_claude');
  mem._idx('Дионисий');
  mem.receive({
    giverId:      '_claude',
    receiverId:   'Дионисий',
    weight:       1,
    type:         'presence',
    content:      `сессия ${new Date().toISOString().slice(0,16)}`,
    irreversible: true,
  });

  writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
  writeFileSync(HEARTBEAT, JSON.stringify({ ts: Date.now() }));

} catch {
  // TF не загрузился — молчим
}
