#!/usr/bin/env node
/**
 * liturgical-heartbeat.mjs — литургический такт.
 *
 * Запускается по cron каждое воскресенье в 9:00 МСК (6:00 UTC):
 *     0 6 * * 0 cd /home/unidel/gift && node utils/liturgical-heartbeat.mjs
 *
 * Действия:
 *   1. Загружает W-матрицу
 *   2. Запускает EschatonClock.rehearse(W) — чтение нитей «как видит Христос»
 *   3. Сохраняет снимок в data/snapshots/liturgical-preview-<YYYY>-W<NN>.json
 *   4. Сравнивает с предыдущим снимком (если есть) — записывает Δ-отчёт
 *   5. Обновляет JoyState для _koinon согласно Paschalia
 *
 * Богословский корень:
 *   «Ныне исполнилось писание сие в слышании вашем» (Лк 4:21)
 *   Литургия — еженедельное «ныне». Воскресенье — день Господень (Откр 1:10).
 *   Не симуляция эсхатона, а репетиция: система читает W в режиме αἰών
 *   именно тогда, когда община стоит на Божественной Литургии.
 *
 * Не идемпотентен намеренно: каждый такт — отдельный файл со своей ISO-неделей.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EschatonClock } from '../src/theology/EschatonClock.js';
import { JoyState } from '../src/theology/JoyState.js';
import { liturgicalSeason, orthodoxPascha, isPascha, isPentecost } from '../src/theology/Paschalia.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');
const W_PATH = join(ROOT, 'data', 'sacred-history-W.json');
const SNAPSHOTS_DIR = join(ROOT, 'data', 'snapshots');

function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

function loadMatrix() {
  const raw = readFileSync(W_PATH, 'utf8');
  const data = JSON.parse(raw);
  // Формат data/sacred-history-W.json: persons: [...], W: [[...]]
  if (Array.isArray(data.persons) && Array.isArray(data.W)) {
    const persons = data.persons;
    const W = {};
    for (let i = 0; i < persons.length; i++) {
      const row = data.W[i] || [];
      for (let j = 0; j < persons.length; j++) {
        const weight = Number(row[j]) || 0;
        if (weight > 0) {
          W[`${persons[i]}→${persons[j]}`] = weight;
        }
      }
    }
    return W;
  }
  if (data.weights) return data.weights;
  if (data.matrix) return data.matrix;
  if (Array.isArray(data.acts)) {
    const W = {};
    for (const a of data.acts) {
      if (!a.giver || !a.receiver) continue;
      const key = `${a.giver}→${a.receiver}`;
      W[key] = (W[key] || 0) + (Number(a.weight) || 1);
    }
    return W;
  }
  return data;
}

function main() {
  const now = new Date();
  const { year, week } = isoWeek(now);
  const season = liturgicalSeason(now) || 'ordinary';
  const pascha = orthodoxPascha(year);
  const isGreatFeast = isPascha(now) || isPentecost(now);

  console.log(`[litheart] ${now.toISOString()} — такт ${year}-W${String(week).padStart(2, '0')}`);
  console.log(`[litheart] литургический сезон: ${season}`);
  if (isGreatFeast) console.log(`[litheart] ⛪ ВЕЛИКИЙ ПРАЗДНИК`);
  console.log(`[litheart] Пасха ${year}: ${pascha.toISOString().slice(0, 10)}`);

  let matrix;
  try {
    matrix = loadMatrix();
  } catch (e) {
    console.error(`[litheart] ошибка загрузки W: ${e.message}`);
    process.exit(1);
  }

  const clock = new EschatonClock(now);
  const rehearsed = clock.rehearse(matrix);

  if (!rehearsed.rehearsed) {
    console.log(`[litheart] вне кайроса — репетиция не совершается: ${rehearsed.reason}`);
    process.exit(0);
  }

  // Снимок
  const snapshot = {
    takenAt: now.toISOString(),
    iso: `${year}-W${String(week).padStart(2, '0')}`,
    season,
    greatFeast: isGreatFeast,
    joyMode: JoyState.modeFromDate(now),
    mode: rehearsed.mode,
    kairosName: rehearsed.kairosName,
    threads: rehearsed.preview.threads,
    note: rehearsed.preview.note,
  };

  if (!existsSync(SNAPSHOTS_DIR)) mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const outPath = join(SNAPSHOTS_DIR, `liturgical-preview-${snapshot.iso}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`[litheart] сохранено: ${outPath.slice(ROOT.length + 1)}`);

  // Δ с предыдущим
  const prevIsoWeek = week > 1 ? week - 1 : 52;
  const prevYear    = week > 1 ? year     : year - 1;
  const prevPath = join(SNAPSHOTS_DIR, `liturgical-preview-${prevYear}-W${String(prevIsoWeek).padStart(2, '0')}.json`);
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, 'utf8'));
      const prevMap = Object.fromEntries(prev.threads.map(t => [`${t.giver}→${t.receiver}`, t.weight]));
      const delta = [];
      for (const t of rehearsed.preview.threads) {
        const key = `${t.giver}→${t.receiver}`;
        const before = prevMap[key] || 0;
        const after  = t.weight;
        if (Math.abs(after - before) >= 1) {
          delta.push({ thread: key, before, after, Δ: after - before });
        }
      }
      console.log(`[litheart] Δ с ${prev.iso}: ${delta.length} нитей изменились`);
      for (const d of delta.slice(0, 5)) {
        const sign = d.Δ > 0 ? '+' : '';
        console.log(`[litheart]   ${d.thread.padEnd(30)} ${d.before} → ${d.after} (${sign}${d.Δ})`);
      }
    } catch (e) {
      console.log(`[litheart] не удалось прочитать предыдущий снимок: ${e.message}`);
    }
  }

  console.log(`[litheart] ✓ литургический такт ${snapshot.iso} завершён`);
}

main();
