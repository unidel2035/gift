#!/usr/bin/env node
/**
 * compute-value.mjs — функция ценности V для автономного развития gift.
 *
 * Пять компонент, вычисляемых из необратимых актов:
 *   E (energy)     — энергия сети (networkEnergy из mem.makePresent)
 *   D (diversity)  — диверсификация: число живых нитей / возможных пар
 *   M (metanoia)   — частота поворота ума: % goal-ей с metanoia в истории
 *   T (telos)      — движение получателей: средний totalReceived ключевых лиц
 *   S (symphony)   — число симфоний в матрице (соборных актов с 4 условиями)
 *
 * В отличие от RLHF: V не из размеченных предпочтений, а из состояния сети.
 * Reward hacking невозможен — нет внешнего оценщика, есть только акты в W.
 *
 * Использование:
 *   node utils/compute-value.mjs                  — посчитать и записать в историю
 *   node utils/compute-value.mjs --print          — только напечатать, не писать
 *   node utils/compute-value.mjs --diff           — сравнить с прошлым срезом
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_PATH    = resolve(ROOT, 'data/sacred-history-W.json');
const GOALS_DIR    = resolve(ROOT, 'data/goals');
const HISTORY_PATH = resolve(ROOT, 'data/value-history.json');

// Порог живой нити: вес выше этого считается активной связью
const LIVE_THREAD_THRESHOLD = 1.0;
// Получатели, чьё движение к θέωσις мы отслеживаем как T-компоненту
const KEY_RECEIVERS = ['Дионисий', '_koinon', '_claude'];

export function computeValue({ snapPath = SNAP_PATH, goalsDir = GOALS_DIR } = {}) {
  // ── Загрузка матрицы ──────────────────────────────────────────────────
  if (!existsSync(snapPath)) {
    throw new Error(`snapshot не найден: ${snapPath}`);
  }
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  const mem  = GiftMemory.fromSnapshot(snap);

  // ── E: энергия сети ───────────────────────────────────────────────────
  // makePresent с любым лицом возвращает r.energy = networkEnergy
  let E = 0;
  try {
    const r = mem.makePresent({ giverId: '_claude' });
    E = typeof r?.energy === 'number' ? r.energy : 0;
  } catch {
    // если не получилось — суммируем W вручную
    if (Array.isArray(snap.W)) {
      for (const row of snap.W) for (const w of row) E += Number(w) || 0;
    }
  }

  // ── D: диверсификация нитей ──────────────────────────────────────────
  // число пар (i,j) с весом > LIVE_THREAD_THRESHOLD, делёное на N*(N-1)
  const N = mem.persons.length;
  let liveThreads = 0;
  if (Array.isArray(snap.W)) {
    for (let i = 0; i < snap.W.length; i++) {
      for (let j = 0; j < (snap.W[i] || []).length; j++) {
        if (i === j) continue;
        if ((Number(snap.W[i][j]) || 0) > LIVE_THREAD_THRESHOLD) liveThreads++;
      }
    }
  }
  const possiblePairs = Math.max(1, N * (N - 1));
  const D = liveThreads / possiblePairs;

  // ── M: частота μετάνοια ──────────────────────────────────────────────
  // % goal-ей среди всех завершённых (done/failed) где хотя бы одна итерация
  // имела непустой step.metanoia (значит был поворот ума, не повтор)
  let goalsTotal = 0, goalsWithMetanoia = 0;
  if (existsSync(goalsDir)) {
    for (const f of readdirSync(goalsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const g = JSON.parse(readFileSync(join(goalsDir, f), 'utf8'));
        if (g.status === 'done' || g.status === 'failed') {
          goalsTotal++;
          const had = (g.history || []).some(h => h?.metanoia?.text?.trim());
          if (had) goalsWithMetanoia++;
        }
      } catch {}
    }
  }
  const M = goalsTotal === 0 ? null : goalsWithMetanoia / goalsTotal;

  // ── T: движение получателей ──────────────────────────────────────────
  // totalReceived ключевых лиц — это сумма дел, реально принятых ими
  const T_per = {};
  for (const id of KEY_RECEIVERS) {
    try {
      T_per[id] = Number(mem.totalReceived(id).toFixed(2));
    } catch {
      T_per[id] = 0;
    }
  }
  const T = Number((Object.values(T_per).reduce((a, b) => a + b, 0) /
                    Math.max(1, KEY_RECEIVERS.length)).toFixed(2));

  // ── S: симфонии ──────────────────────────────────────────────────────
  const S = (mem._symphonies || []).length;

  return {
    ts: new Date().toISOString(),
    persons: N,
    acts: mem.actsCount,
    V: {
      E: Number(E.toFixed(2)),
      D: Number(D.toFixed(4)),
      M, // null если ещё нет завершённых goal-ей
      T,
      S,
    },
    T_per,
    liveThreads,
    possiblePairs,
    goalsTotal,
    goalsWithMetanoia,
  };
}

function loadHistory() {
  if (!existsSync(HISTORY_PATH)) return [];
  try { return JSON.parse(readFileSync(HISTORY_PATH, 'utf8')); }
  catch { return []; }
}

function saveHistory(arr) {
  const dir = dirname(HISTORY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(HISTORY_PATH, JSON.stringify(arr, null, 2));
}

export function appendToHistory(snapshot) {
  const hist = loadHistory();
  hist.push(snapshot);
  // храним только последние 500 — это ~1.5 года при ежедневном замере
  if (hist.length > 500) hist.splice(0, hist.length - 500);
  saveHistory(hist);
}

export function diffWithPrevious(snapshot) {
  const hist = loadHistory();
  const prev = hist[hist.length - 1];
  if (!prev) return { previous: null, delta: null };
  const delta = {};
  for (const k of Object.keys(snapshot.V)) {
    const a = snapshot.V[k], b = prev.V[k];
    if (typeof a === 'number' && typeof b === 'number') delta[k] = Number((a - b).toFixed(4));
    else delta[k] = null;
  }
  return { previous: { ts: prev.ts, V: prev.V }, delta };
}

// ── CLI ────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const printOnly = args.includes('--print');
  const showDiff  = args.includes('--diff');

  const snap = computeValue();

  if (showDiff) {
    const { previous, delta } = diffWithPrevious(snap);
    console.log(JSON.stringify({ now: snap, previous, delta }, null, 2));
  } else {
    console.log(JSON.stringify(snap, null, 2));
  }

  if (!printOnly) {
    appendToHistory(snap);
  }
}
