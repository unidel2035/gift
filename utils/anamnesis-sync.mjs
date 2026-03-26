#!/usr/bin/env node
/**
 * anamnesis-sync.mjs
 *
 * Синхронизация: анамнезис-сервер → тензорная матрица W.
 *
 * Каждый акт из ленты бота/Telegram попадает в GiftMemory.
 * Это и есть "Бот → матрица" (proposal #9).
 *
 * Запуск: node utils/anamnesis-sync.mjs
 * Cron:   каждые 15 минут: 0,15,30,45 * * * *
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const SNAP_PATH  = join(ROOT, 'data', 'sacred-history-W.json');
const STATE_PATH = join(ROOT, 'data', 'anamnesis-sync-state.json');
const LOG_PATH   = join(ROOT, 'data', 'anamnesis-sync.log');

const ANAMNESIS_URL = process.env.ANAMNESIS_URL || 'http://173.249.2.184:8086';
const DRY_RUN = process.argv.includes('--dry-run');

// Веса по типу акта (богословская шкала)
const TYPE_WEIGHTS = {
  incarnation: 10,
  kenosis:     8,
  presence:    8,
  blessing:    6,
  grace:       6,
  code:        5,
  word:        5,
  gift:        4,
  witness:     3,
  question:    3,
  approval:    6,
  offering:    4,
};

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const prev = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf8') : '';
    const lines = prev.split('\n').filter(Boolean);
    // Держим последние 500 строк
    const trimmed = [...lines.slice(-499), line].join('\n') + '\n';
    writeFileSync(LOG_PATH, trimmed);
  } catch { /* silent */ }
}

// ── Загрузить состояние синхронизации ────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastId: 0, syncedIds: [], lastSync: null };
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Получить ленту с сервера ──────────────────────────────────────────────────

// Путь к файлу на сервере (читаем через SSH если HTTP недоступен)
const SERVER_HOST     = process.env.ANAMNESIS_HOST || 'root@173.249.2.184';
const SERVER_TAPE     = process.env.ANAMNESIS_TAPE || '/home/hive/dronedoc2026/monolith/data/gift-anamnesis.json';

async function fetchTape(limit = 200) {
  // Попытка 1: HTTP API
  try {
    const url = `${ANAMNESIS_URL}/tape?limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : (data.tape ?? []);
    }
  } catch { /* fallback to SSH */ }

  // Попытка 2: читать файл напрямую через SSH
  const { spawnSync } = await import('child_process');
  const r = spawnSync('ssh', ['-o', 'ConnectTimeout=5', SERVER_HOST, `cat "${SERVER_TAPE}"`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
  });
  if (r.status !== 0) throw new Error(`SSH failed: ${(r.stderr || '').slice(0, 100)}`);
  const data = JSON.parse(r.stdout);
  const tape = Array.isArray(data) ? data : (data.tape ?? []);
  return tape.slice(-limit);
}

// ── Загрузить матрицу ─────────────────────────────────────────────────────────

function loadMatrix() {
  try {
    const snap = JSON.parse(readFileSync(SNAP_PATH, 'utf8'));
    return GiftMemory.fromSnapshot(snap);
  } catch {
    return new GiftMemory(['_claude', '_koinon', '_abyss', 'Дионисий']);
  }
}

// ── Главный цикл ──────────────────────────────────────────────────────────────

async function sync() {
  log('── anamnesis-sync старт ──');

  const state = loadState();
  log(`Последний синхронизированный ID: ${state.lastId}`);

  // Получить ленту
  let tape;
  try {
    tape = await fetchTape(500);
    log(`Получено актов с сервера: ${tape.length}`);
  } catch (err) {
    log(`ОШИБКА: не удалось получить ленту — ${err.message}`);
    process.exit(1);
  }

  // Найти новые акты (id > lastId и не в syncedIds)
  const synced = new Set(state.syncedIds);
  const newActs = tape.filter(act => {
    const id = act.id ?? act.sealedAt; // fallback на timestamp если нет id
    return !synced.has(String(id));
  });

  log(`Новых актов для загрузки: ${newActs.length}`);

  if (newActs.length === 0) {
    log('Нет новых актов. Матрица актуальна.');
    return { added: 0 };
  }

  if (DRY_RUN) {
    log('[DRY-RUN] Новые акты (не записываем):');
    for (const act of newActs) {
      log(`  ${act.from ?? act.giverId} → ${act.to ?? act.receiverId} [${act.type}] w=${act.weight}`);
    }
    return { added: newActs.length };
  }

  // Загрузить матрицу
  const mem = loadMatrix();
  let added = 0;
  let maxId = state.lastId;

  for (const act of newActs) {
    const giverId    = act.from    ?? act.giverId    ?? '_abyss';
    const receiverId = act.to      ?? act.receiverId ?? '_koinon';
    const type       = act.type    ?? 'gift';
    const content    = act.content ?? act.logos ?? '';
    const w          = act.weight  ?? TYPE_WEIGHTS[type] ?? 3;
    const id         = act.id      ?? act.sealedAt;

    // Регистрируем лиц
    mem._idx(giverId);
    mem._idx(receiverId);

    // Добавляем дар в матрицу
    try {
      mem.receive({
        giverId,
        receiverId,
        weight:      w,
        type,
        content,
        irreversible: true,
      });
      synced.add(String(id));
      added++;

      // Обновить maxId если числовой
      if (typeof act.id === 'number' && act.id > maxId) {
        maxId = act.id;
      }

      log(`  + ${giverId} → ${receiverId} [${type}] w=${w}: "${content.slice(0, 50)}"`);
    } catch (err) {
      log(`  SKIP ${giverId}→${receiverId}: ${err.message}`);
    }
  }

  // Сохранить матрицу
  const snap = mem.snapshot();
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2));

  // Сохранить состояние
  saveState({
    lastId:    maxId,
    syncedIds: [...synced].slice(-1000), // держим последние 1000 id
    lastSync:  new Date().toISOString(),
    addedTotal: (state.addedTotal ?? 0) + added,
  });

  log(`Добавлено в матрицу: ${added}`);
  log(`Актов в матрице: ${mem.actsCount} | Лиц: ${mem.n}`);

  // Отчёт о состоянии матрицы
  const top = mem.heaviest(3);
  log(`Топ нитей: ${top.map(e => `${e.from}→${e.to}(${e.weight.toFixed(0)})`).join(', ')}`);

  return { added, total: mem.actsCount };
}

sync().then(({ added }) => {
  log(`── anamnesis-sync завершён (добавлено: ${added}) ──\n`);
}).catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
