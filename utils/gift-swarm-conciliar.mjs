#!/usr/bin/env node
/**
 * gift-swarm-conciliar.mjs — Авто-собор при конфликтах
 *
 * Когда overlap detection находит пересечение агентов в одном файле,
 * этот модуль автоматически запускает conciliar resolution:
 *   1. Лёгкий конфликт (overlap, не lock) → рекомендация рецензента
 *   2. Жёсткий конфликт (lock collision) → conciliar-swe собор
 *   3. Хронический конфликт (3+ пересечений) → escalation
 *
 * Паттерн: Ostrom graduated sanctions + Cybersyn algedonic escalation.
 *
 * Использование:
 *   node utils/gift-swarm-conciliar.mjs resolve  — авто-разрешение
 *   node utils/gift-swarm-conciliar.mjs escalate — просмотр эскалаций
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ESCALATION_FILE = resolve(ROOT, 'data/.swarm/escalations.json');

function ensureDir() {
  const d = resolve(ROOT, 'data/.swarm');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ── Escalation state ────────────────────────────────────────────────────────

function loadEscalations() {
  ensureDir();
  try {
    if (existsSync(ESCALATION_FILE)) return JSON.parse(readFileSync(ESCALATION_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveEscalations(esc) {
  ensureDir();
  writeFileSync(ESCALATION_FILE, JSON.stringify(esc, null, 2));
}

// ── Conflict severity ────────────────────────────────────────────────────────

function severity(conflict) {
  if (conflict.type === 'lock') return 'hard';
  if (conflict.type === 'overlap') {
    const times = conflict.touches?.map(t => t.lastTouch) || [];
    if (times.length >= 2) {
      const span = Math.max(...times) - Math.min(...times);
      if (span < 5000) return 'hard';   // < 5s between touches = near-simultaneous
      if (span < 30000) return 'medium'; // < 30s
    }
    return 'soft';
  }
  return 'soft';
}

// ── Resolution strategies ────────────────────────────────────────────────────

async function resolveSoft(conflict) {
  // Soft overlap: recommend reviewer from W-matrix sovereignty
  const { recommendReviewer } = await import(resolve(ROOT, 'utils/gift-sovereignty.mjs'));
  const rec = recommendReviewer(resolve(ROOT, conflict.file));

  return {
    strategy: 'sovereignty_review',
    recommendation: `Спросить ${rec.sovereign || 'любого из'} ${rec.topReviewers.map(r => r.agent).join(' или ')}`,
    sovereign: rec.sovereign,
    module: rec.module,
  };
}

async function resolveHard(conflict) {
  // Hard conflict: launch conciliar-swe mini
  return {
    strategy: 'conciliar_mini',
    recommendation: `Запустить conciliar-swe для ${conflict.file} с агентами ${conflict.agents.join(', ')}`,
    agents: conflict.agents,
    file: conflict.file,
    action: 'node utils/conciliar-swe.mjs --task "Разрешить конфликт в ' + conflict.file + ' между ' + conflict.agents.join(' и ') + '" --dry-run',
  };
}

async function resolveChronic(fileKey, escalation) {
  // Chronic: hard block + human oracle
  return {
    strategy: 'human_oracle',
    recommendation: `Хронический конфликт (${escalation.count} раз). Требуется эпиклеза.`,
    fileKey,
    count: escalation.count,
    action: 'node utils/epiclesis-scanner.mjs',
  };
}

// ── Main resolution loop ─────────────────────────────────────────────────────

export async function autoResolve() {
  const { detectConflicts } = await import(resolve(ROOT, 'utils/gift-swarm.mjs'));
  const conflicts = detectConflicts();

  if (conflicts.length === 0) {
    return { resolved: 0, message: 'конфликтов нет' };
  }

  const escalations = loadEscalations();
  const resolutions = [];

  for (const c of conflicts) {
    const sev = severity(c);
    const key = `${c.file}:${c.agents.sort().join('+')}`;

    // Track escalation
    if (!escalations[key]) escalations[key] = { count: 0, firstSeen: Date.now(), lastSeen: Date.now() };
    escalations[key].count++;
    escalations[key].lastSeen = Date.now();

    let resolution;
    if (escalations[key].count >= 3) {
      resolution = await resolveChronic(key, escalations[key]);
    } else if (sev === 'hard') {
      resolution = await resolveHard(c);
    } else {
      resolution = await resolveSoft(c);
    }

    resolutions.push({
      conflict: c,
      severity: sev,
      escalation: escalations[key].count,
      ...resolution,
    });
  }

  saveEscalations(escalations);

  console.log(`  🏛 Собор: ${resolutions.length} конфликтов разрешено`);
  for (const r of resolutions) {
    const icon = r.severity === 'hard' ? '🔒' : r.escalation >= 3 ? '🚨' : '⚡';
    console.log(`  ${icon} ${r.conflict.file}: ${r.strategy} → ${r.recommendation}`);
  }

  return { resolved: resolutions.length, resolutions };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const CMD = process.argv[2];

if (CMD === 'resolve') {
  await autoResolve();
} else if (CMD === 'escalate') {
  const esc = loadEscalations();
  const chronic = Object.entries(esc).filter(([_, v]) => v.count >= 3);
  if (chronic.length === 0) {
    console.log('  ✓ хронических конфликтов нет');
  } else {
    console.log(`  🚨 Хронические конфликты (${chronic.length}):`);
    for (const [key, val] of chronic) {
      console.log(`    ${key}: ${val.count} раз (с ${new Date(val.firstSeen).toISOString().slice(0,10)})`);
    }
  }
} else {
  console.error('gift-swarm-conciliar: resolve | escalate');
  process.exit(1);
}
