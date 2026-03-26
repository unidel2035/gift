#!/usr/bin/env node
/**
 * build-spec-library.mjs
 *
 * Собирает библиотеку исполняемых спецификаций из dronedoc2026.
 * Копирует .gift файлы в specs/ по категориям.
 * Загружает все в матрицу W.
 */

import { copyFileSync, readdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRONEDOC = '/home/unidel/dronedoc2026/language/gift-lang/ontology';
const SPECS    = resolve(ROOT, 'specs');
const SNAP     = resolve(ROOT, 'data/sacred-history-W.json');

// ── Карта категорий ───────────────────────────────────────────────────────
const CATEGORIES = {
  'sacred-history': [
    'creation', 'fall', 'death', 'salvation', 'salvation-full', 'спасение',
    'hexaemeron', 'kairos', 'epoch-scripts', 'kingdom',
  ],
  'theology': [
    'trinity', 'divine-energy', 'axioms', 'syriac-mystics',
    'angelic-order', 'physics', 'grace-distributor',
  ],
  'liturgy': [
    'LiturgicalRhythm', 'liturgy-of-awakening', 'liturgy-of-silence',
    'liturgy-of-sacred-publish', 'liturgy-of-voice-awakening', 'liturgical-dev',
    'SabbathKeeper', 'SabbathSanctuary', 'SacredRest', 'sabbath-silence-rhythm',
    'subbath-rhythm', 'kairos-vision', 'EucharistFlow', 'eucharistia-engine',
    'FlightSacredCycles', 'SacredWakeUpCycles',
  ],
  'persons': [
    'person', 'book-of-life', 'anamnesis-memory', 'anamnesis-analytics',
    'MemoryAltar', 'GratitudeWitness', 'GratitudeRevealer',
  ],
  'community': [
    'church', 'perichoresis-weaver', 'PerichoresisOrganizer',
    'mutual-recognition-circle', 'community-garden', 'connect-isolated',
    'gift-weaver', 'GiftMatcher', 'GratitudeChannels', 'gratitude-activator',
    'gratitude-flow-analysis', 'eva-community-care', 'mirror-of-gifts-healing',
    'connection-weaver-healing', 'LuminousInvitation', 'SafeSpace',
    'first-contact-protocol', 'sacred-geography',
  ],
  'technical': [
    'drone-swarm', 'drone-choir', 'drone-full', 'swarm', 'swarm-architecture',
    'nervous-system', 'tech-package', 'dataflow-bridge', 'dispatcher-bridge',
    'voice-bridge', 'voice-registry', 'voice-of-silent-guardians',
    'platform-voice', 'platform-voice-awakening', 'watchTower',
    'airspace-guard', 'RhythmKeeper', 'RhythmicInterface', 'SilenceBridge',
    'BalanceDetector', 'BalanceHealer', 'RegulatoryCompassionBridge',
    'regulation-as-love', 'FatigueBarometer', 'metrics-collector',
    'pipeline-monitoring', 'real-time-safety-monitor', 'WakeUpCall',
    'silence-mapper', 'silent-service-monitor', 'silent-sanctuary',
  ],
  'axioms': ['axioms', 'gift-act'],
};

// ── Обратная карта: файл → категория ─────────────────────────────────────
const fileToCategory = {};
for (const [cat, files] of Object.entries(CATEGORIES)) {
  for (const f of files) fileToCategory[f.toLowerCase()] = cat;
}

// ── Копировать файлы ──────────────────────────────────────────────────────
const allFiles = readdirSync(DRONEDOC).filter(f => f.endsWith('.gift'));
const copied   = { total: 0 };
for (const cat of Object.keys(CATEGORIES)) copied[cat] = 0;

let unknownFiles = [];

for (const file of allFiles) {
  const base = basename(file, '.gift').toLowerCase();
  const cat  = fileToCategory[base] ?? null;

  if (cat) {
    copyFileSync(
      resolve(DRONEDOC, file),
      resolve(SPECS, cat, file)
    );
    copied[cat]++;
    copied.total++;
  } else {
    unknownFiles.push(file);
  }
}

// Некатегоризированные → в отдельную папку
if (unknownFiles.length) {
  const { mkdirSync } = await import('fs');
  mkdirSync(resolve(SPECS, 'uncategorized'), { recursive: true });
  for (const f of unknownFiles) {
    copyFileSync(resolve(DRONEDOC, f), resolve(SPECS, 'uncategorized', f));
    copied.total++;
  }
}

console.log('\n═══ Библиотека спецификаций (@unidel/gift/specs) ═══\n');
for (const [cat, count] of Object.entries(copied)) {
  if (cat === 'total') continue;
  const n = cat === 'uncategorized' ? unknownFiles.length : count;
  if (n > 0) console.log(`  ${cat.padEnd(18)} ${n} файлов`);
}
console.log(`\n  Итого: ${copied.total} спецификаций`);

// ── Загрузить все в матрицу W ─────────────────────────────────────────────
console.log('\n═══ Загрузка в матрицу W ═══');
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

const actsBefore = mem.actsCount;

// Загрузить sacred-history через существующий loader
const { default: loadSacredHistory } = await import(resolve(ROOT, 'utils/sacred-history-loader.mjs'))
  .catch(() => ({ default: null }));

// Добавить по одному акту на каждую спецификацию (присутствие в онтологии)
for (const [cat, files] of Object.entries(CATEGORIES)) {
  for (const fname of files) {
    const fpath = resolve(SPECS, cat, fname + '.gift');
    if (!existsSync(fpath)) continue;

    // Лёгкий акт: спецификация присутствует в библиотеке
    mem._idx('_abyss');
    mem._idx('_koinon');
    mem.receive({
      giverId:     '_abyss',
      receiverId:  '_koinon',
      weight:      1,
      type:        'witness',
      content:     `spec:${cat}/${fname}`,
      irreversible: true,
    });
  }
}

const actsAdded = mem.actsCount - actsBefore;
writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));

console.log(`  Добавлено актов: ${actsAdded}`);
console.log(`  Итого в матрице: ${mem.actsCount} актов, ${mem.n} лиц`);

// ── Индекс библиотеки ─────────────────────────────────────────────────────
const index = {
  generated: new Date().toISOString(),
  total: copied.total,
  categories: {},
};

for (const cat of [...Object.keys(CATEGORIES), 'uncategorized']) {
  const dir = resolve(SPECS, cat);
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter(f => f.endsWith('.gift'));
  if (files.length) index.categories[cat] = files;
}

writeFileSync(resolve(SPECS, 'index.json'), JSON.stringify(index, null, 2));
console.log(`\n  Индекс: specs/index.json`);
console.log('  Библиотека готова.\n');
