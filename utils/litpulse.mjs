#!/usr/bin/env node
/**
 * litpulse.mjs — литургический пульс по LiturgicalCalendar.
 *
 * Запускается ежедневно (cron) и читает кайрос дня:
 *   σύναξις   (понедельник)     → запустить ontology-pulse (сбор пустынь)
 *   δοκιμασία (четверг)         → запустить дегустацию через SymphonyOrchestrator
 *   vintage   (последний день)  → запустить Vintage.assess() и записать отчёт
 *   ordinary                    → ничего (бочка ферментирует молча)
 *
 * Принципиально: пульс не «гонит» — он соблюдает кайрос. Если день не
 * литургический, ничего не происходит. Если уже сегодня запускался —
 * не дублирует.
 *
 * cron-предложение (на сервере или локально):
 *   0 4 * * *  cd /home/unidel/gift && node utils/litpulse.mjs >> data/litpulse.log 2>&1
 *
 * Запуск вручную:
 *   node utils/litpulse.mjs            # сегодняшний кайрос
 *   node utils/litpulse.mjs --dry      # только показать что было бы
 *   node utils/litpulse.mjs --force vintage  # принудительно (для отладки)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { LiturgicalCalendar, KAIROS } from '../src/scheduling/LiturgicalCalendar.js';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { Vintage } from '../src/persons/Vintage.js';

const ROOT      = '/home/unidel/gift';
const STATE     = `${ROOT}/data/.litpulse-state.json`;
const SNAP      = `${ROOT}/data/sacred-history-W.json`;
const ACTS_IDX  = `${ROOT}/data/act-index.json`;
const VINT_DIR  = `${ROOT}/data/vintages`;

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const forceIdx = args.indexOf('--force');
const forceKairos = forceIdx >= 0 ? args[forceIdx + 1] : null;

function loadState() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
}
function saveState(s) {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

const cal = new LiturgicalCalendar();
const today = forceKairos
  ? { kairos: forceKairos, day: '?', date: new Date().toISOString().slice(0, 10), why: '[force]' }
  : cal.today();
const state = loadState();

console.log(`[litpulse] ${today.date} ${today.day}: ${today.kairos} — ${today.why}`);

if (today.kairos === KAIROS.ORDINARY) {
  console.log('[litpulse] обычный день — бочка ферментирует молча. Ничего не запускаю.');
  process.exit(0);
}

// ── Σύναξις ────────────────────────────────────────────────────────────
if (today.kairos === KAIROS.SYNAXIS) {
  if (state.lastSynaxis === today.date) {
    console.log('[litpulse] σύναξις уже запускался сегодня — пропускаю');
    process.exit(0);
  }
  console.log('[litpulse] σύναξις: запускаю ontology-pulse (Адам сканирует пустыни)');
  if (!dry) {
    try {
      execSync('node utils/ontology-pulse.mjs', { cwd: ROOT, stdio: 'inherit', timeout: 5 * 60 * 1000 });
      state.lastSynaxis = today.date;
      saveState(state);
    } catch (e) {
      console.error(`[litpulse] σύναξις упал: ${e.message}`);
      process.exit(1);
    }
  }
  process.exit(0);
}

// ── Δοκιμασία ──────────────────────────────────────────────────────────
if (today.kairos === KAIROS.DOKIMASIA) {
  if (state.lastDokimasia === today.date) {
    console.log('[litpulse] δοκιμασία уже была сегодня — пропускаю');
    process.exit(0);
  }
  console.log('[litpulse] δοκιμασία: дегустация (рекомендуемая ручная фаза)');
  console.log('[litpulse]   Подготовь идею для собора и запусти:');
  console.log('[litpulse]   node utils/myslebrodilnya-istok-demo.mjs');
  console.log('[litpulse]   или используй SymphonyOrchestrator с реальной идеей.');
  console.log('[litpulse] Этот шаг требует эпиклезы (человек или Telegram-мост) — не автомат.');
  if (!dry) {
    state.lastDokimasia = today.date;
    state.dokimasiaPrompted = (state.dokimasiaPrompted ?? 0) + 1;
    saveState(state);
  }
  process.exit(0);
}

// ── Vintage ────────────────────────────────────────────────────────────
if (today.kairos === KAIROS.VINTAGE) {
  if (state.lastVintage === today.date) {
    console.log('[litpulse] vintage уже сделан сегодня — пропускаю');
    process.exit(0);
  }
  console.log('[litpulse] vintage: διάκρισις по плодам');

  if (!existsSync(SNAP)) {
    console.log('[litpulse] нет snapshot, пропускаю');
    process.exit(0);
  }

  const mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
  const acts = existsSync(ACTS_IDX) ? JSON.parse(readFileSync(ACTS_IDX, 'utf8')) : [];

  const v = new Vintage(mem, { actsIndex: acts });
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();  // последний месяц
  const report = v.assess({ since, cycles: 1 });

  console.log(`  tasted=${report.tasted.length} fruited=${report.fruited.length} sleeping=${report.sleeping.length} deferred=${report.deferred.length}`);
  console.log(`  tone: ${report.vintage.tone ?? report.vintage}`);

  if (!dry) {
    if (!existsSync(VINT_DIR)) {
      execSync(`mkdir -p ${VINT_DIR}`);
    }
    const file = `${VINT_DIR}/vintage-${today.date}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`[litpulse] записан: ${file}`);
    state.lastVintage = today.date;
    saveState(state);
  }
  process.exit(0);
}

console.error(`[litpulse] неизвестный кайрос: ${today.kairos}`);
process.exit(2);
