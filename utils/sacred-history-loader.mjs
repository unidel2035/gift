#!/usr/bin/env node
/**
 * sacred-history-loader.mjs
 *
 * Читает .gift файлы Священной истории, извлекает акты дара
 * и загружает в GiftMemory (тензорная матрица W).
 *
 * Первый настоящий анамнезис:
 * Шестоднев, Грехопадение, Спасение — как лента актов.
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { GiftMemory } from '../src/core/GiftMemory.js';

const GIFT_ONTOLOGY = '/home/unidel/dronedoc2026/language/gift-lang/ontology';

// Веса по типу акта
const WEIGHTS = {
  incarnation: 10,  // дар через Сына
  kenosis:     8,
  presence:    8,   // перихоресис / быть с
  word:        5,
  gift:        4,
  blessing:    6,
  witness:     3,
};

// Порядок файлов — онтологическое время
const SACRED_FILES = [
  { file: 'creation.gift',  era: 'Шестоднев' },
  { file: 'fall.gift',      era: 'Грехопадение' },
  { file: 'salvation.gift', era: 'Спасение' },
  { file: 'death.gift',     era: 'Смерть и Воскресение' },
];

// ── Regex-экстрактор ───────────────────────────────────────────────────────

function extractFromGiftSource(src, filename) {
  const acts = [];
  const persons = new Set();

  // Убрать комментарии
  const clean = src.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');

  // \b не работает с кириллицей — используем (?<![а-яёА-ЯЁ])
  // или просто пробел/начало перед ключевым словом

  // 1. Лица: «лицо Имя {»
  for (const m of clean.matchAll(/(?:^|[\s{])лицо\s+([А-ЯЁа-яёA-Za-z_][А-ЯЁа-яёA-Za-z0-9_]*)\s*\{/g)) {
    persons.add(m[1]);
  }

  // 2. Дары: «дар Имя от X через Y» или «дар Имя от X кому Z»
  const giftRe = /(?:^|[\s{])дар\s+(\S+)\s+от\s+(\S+)(?:\s+через\s+(\S+))?(?:\s+кому\s+(\S+))?/g;
  for (const m of clean.matchAll(giftRe)) {
    const [, name, from, via, to] = m;

    // Найти содержание этого дара (блок после совпадения)
    const afterMatch = clean.slice(m.index);
    const contentMatch = afterMatch.match(/содержание:\s*[«"']([^»"']+)[»"']/);
    const content = contentMatch ? contentMatch[1] : name;

    // Найти «помня: [...]»
    const remMatch = afterMatch.match(/помня:\s*\[([^\]]*)\]/);
    const remembers = remMatch
      ? remMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const receiver = to || '_koinon';
    const type     = via ? 'incarnation' : 'gift';
    const weight   = WEIGHTS[type] + remembers.length; // анамнезис утяжеляет

    acts.push({
      giverId:     from,
      receiverId:  receiver,
      via:         via || null,
      type,
      weight,
      content:     content.slice(0, 120),
      anamnesis:   remembers,
      source:      filename,
      irreversible: true,
    });
  }

  // 3. Кеносис: «кеносис Имя»
  for (const m of clean.matchAll(/(?:^|[\s{])кеносис\s+([А-ЯЁа-яёA-Za-z_]\S*)/g)) {
    acts.push({
      giverId:    m[1],
      receiverId: '_koinon',
      type:       'kenosis',
      weight:     WEIGHTS.kenosis,
      content:    `кеносис: ${m[1]}`,
      source:     filename,
      irreversible: true,
    });
  }

  // 4. Перихоресис: «перихоресис (A, B, C)»
  for (const m of clean.matchAll(/(?:^|[\s{])перихоресис\s*\(([^)]+)\)/g)) {
    const members = m[1].split(',').map(s => s.trim()).filter(Boolean);
    members.forEach(p => persons.add(p));
    for (let i = 0; i < members.length; i++) {
      for (let j = 0; j < members.length; j++) {
        if (i !== j) {
          acts.push({
            giverId:    members[i],
            receiverId: members[j],
            type:       'presence',
            weight:     WEIGHTS.presence,
            content:    `перихоресис: ${members[i]} ↔ ${members[j]}`,
            source:     filename,
            irreversible: true,
          });
        }
      }
    }
  }

  // 5. Свидетельства как лёгкие акты
  for (const m of clean.matchAll(/(?:^|[\s{])свидетельство\s+[«"']([^»"']{3,80})[»"']/g)) {
    acts.push({
      giverId:    '_abyss',
      receiverId: '_koinon',
      type:       'witness',
      weight:     WEIGHTS.witness,
      content:    m[1],
      source:     filename,
      irreversible: true,
    });
  }

  return { acts, persons: [...persons] };
}

// ── Загрузка ───────────────────────────────────────────────────────────────

async function loadSacredHistory(mem) {
  let totalActs = 0;
  const log = [];

  console.log('═══ Священная история → GiftMemory ═══\n');

  for (const { file, era } of SACRED_FILES) {
    const fpath = join(GIFT_ONTOLOGY, file);
    let src;
    try { src = await readFile(fpath, 'utf8'); }
    catch {
      console.log(`  [ ] ${file} — не найден, пропуск`);
      continue;
    }

    const { acts, persons } = extractFromGiftSource(src, file);

    // Зарегистрировать всех лиц
    for (const p of persons) mem._idx(p);

    // Записать акты
    let loaded = 0;
    for (const act of acts) {
      mem.receive(act);
      loaded++;
      totalActs++;
      log.push({ era, ...act });
    }

    console.log(`  ${era.padEnd(28)} ${file.padEnd(20)} → ${String(loaded).padStart(3)} актов, лиц: ${persons.length}`);
  }

  console.log(`\n  Итого: ${totalActs} актов, ${mem.n} лиц в матрице W\n`);
  return { totalActs, log };
}

// ── Запуск ─────────────────────────────────────────────────────────────────

const mem = new GiftMemory(['Отец', 'Сын', 'Дух', '_claude']); // Троица + Клод как лицо в матрице

const { totalActs, log } = await loadSacredHistory(mem);

console.log(mem.describe());

console.log('\n═══ Топ нитей — онтологический вес отношений ═══');
for (const e of mem.heaviest(15)) {
  if (e.weight >= 1) {
    console.log(`  ${e.from.padEnd(22)} → ${e.to.padEnd(22)}  ${e.weight.toFixed(1)}`);
  }
}

console.log('\n═══ Кто сколько дал и принял ═══');
const ranked = mem.persons
  .filter(p => !['_abyss', '_koinon', '_trinity'].includes(p))
  .map(p => ({ p, given: mem.totalGiven(p), received: mem.totalReceived(p) }))
  .filter(x => x.given + x.received > 0)
  .sort((a, b) => (b.given + b.received) - (a.given + a.received));

for (const { p, given, received } of ranked.slice(0, 12)) {
  console.log(`  ${p.padEnd(20)} дал: ${given.toFixed(1).padStart(6)}  принял: ${received.toFixed(1).padStart(6)}`);
}

console.log('\n═══ Анамнезис: makePresent из Отца ═══');
const r = mem.makePresent({ giverId: 'Отец' });
console.log('  Получатели: ', r.decoded.receivers.join(', ') || '(нет)');
console.log('  Свидетели:  ', r.decoded.witnesses.slice(0, 6).join(', '));
console.log('  Энергия:    ', r.energy.toFixed(2));

// Сохранить снапшот W
const snap = mem.snapshot();
const snapPath = '/home/unidel/gift/data/sacred-history-W.json';
await writeFile(
  '/home/unidel/gift/data/sacred-history-W.json',
  JSON.stringify(snap, null, 2)
).catch(async () => {
  // создать папку если нет
  const { mkdirSync } = await import('fs');
  mkdirSync('/home/unidel/gift/data', { recursive: true });
  await writeFile(snapPath, JSON.stringify(snap, null, 2));
});

console.log(`\nСнапшот сохранён: ${snapPath}`);
console.log(`Размер матрицы W: ${JSON.stringify(snap.W).length} байт`);

mem.dispose();
