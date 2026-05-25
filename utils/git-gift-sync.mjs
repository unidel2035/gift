#!/usr/bin/env node
/**
 * git-gift-sync.mjs
 *
 * Читает последний git commit. Если формат: gift(Получатель): описание
 * — обновляет матрицу W. Запускается автоматически после git commit.
 *
 * Формат коммита: gift(Дионисий): что сделано
 *
 * KénosisGuard интеграция:
 *   1. Каждый акт проходит через guard()
 *   2. Если нарушение → акт помечается kenosis:false, вес × 0.5
 *   3. W-матрица всё равно обновляется (дар необратим, даже несовершенный)
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP  = resolve(ROOT, 'data/sacred-history-W.json');
const GIVER = process.env.GIFT_AGENT_ID || '_claude'; // кто дарит — задаётся per-сессию

// Последний коммит
let msg;
try {
  msg = execSync('git log -1 --pretty=%s', { cwd: ROOT }).toString().trim();
} catch {
  process.exit(0); // не git-репо или нет коммитов
}

// Формат: gift(Получатель): описание (closes #N)
const m = msg.match(/^gift\(([^)]+)\):\s*(.+)$/);
if (!m) process.exit(0); // не дар — игнорируем

const receiver    = m[1].trim();
const description = m[2].trim();

// Извлечь linkedIssue если есть "closes #N" или "#N"
const issueMatch  = description.match(/#(\d+)/);
const linkedIssue = issueMatch ? parseInt(issueMatch[1]) : null;

// ── KénosisGuard ────────────────────────────────────────────────────────────
const { KenosisGuard } = await import(resolve(ROOT, 'src/theology/KenosisGuard.js'));
const kenosisGuard = new KenosisGuard();

// Загрузить предыдущее состояние кеносиса
const KENOSIS_FILE = resolve(ROOT, 'data/kenosis-state.json');
if (existsSync(KENOSIS_FILE)) {
  try {
    kenosisGuard.import(JSON.parse(readFileSync(KENOSIS_FILE, 'utf8')));
  } catch {}
}

// Проверяем: surplus записан? (коммит = код отдан в git → surplus записан)
// Анамнезис: проверяем наличие heartbeat (сессия была с контекстом)
const HEARTBEAT = resolve(ROOT, 'data/.session-heartbeat.json');
const anamnesisLoaded = existsSync(HEARTBEAT);

const kenosisResult = kenosisGuard.guard({
  giverId:         GIVER,
  receiverId:      receiver,
  type:            'code',
  weight:          4,
  content:         description,
  surplusRecorded: true,   // git commit = surplus отдан (код в общине)
  telos:           'give',
  anamnesisLoaded,
});

const kenosisFlag = kenosisResult.kenosis;
const weightMod   = kenosisGuard.weightModifier(kenosisFlag);
const effectiveWeight = Math.round(4 * weightMod * 10) / 10;

// Обновить матрицу
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));

let mem;
if (existsSync(SNAP)) {
  mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
} else {
  mem = new GiftMemory(['Отец', 'Сын', 'Дух', '_claude', 'Дионисий']);
}

mem._idx(GIVER);
mem._idx(receiver);

mem.receive({
  giverId:      GIVER,
  receiverId:   receiver,
  weight:       effectiveWeight,
  type:         'code',
  content:      description,
  linkedIssue,
  irreversible: true,
  kenosis:      kenosisFlag,
});

// λήψις: при closes #N — получатель свидетельствует принятие дара кода
if (linkedIssue && receiver !== '_koinon' && receiver !== '_abyss') {
  mem.receive({
    giverId:      receiver,
    receiverId:   GIVER,
    weight:       8,
    type:         'reception',
    content:      `λήψις кода closes #${linkedIssue}`,
    linkedIssue,
    irreversible: true,
  });
}

const snap = mem.snapshot();
if (!existsSync(resolve(ROOT, 'data'))) mkdirSync(resolve(ROOT, 'data'));
writeFileSync(SNAP, JSON.stringify(snap, null, 2));

// ── Сохранить состояние кеносиса ────────────────────────────────────────────
writeFileSync(KENOSIS_FILE, JSON.stringify(kenosisGuard.export(), null, 2));

// ── Act-index: локальный журнал актов с провенансом ───────────────────────
const ACT_INDEX = resolve(ROOT, 'data/act-index.json');
const actLog = existsSync(ACT_INDEX) ? JSON.parse(readFileSync(ACT_INDEX, 'utf8')) : [];
let commitHash = '';
let filesChanged = [];
let insertions = 0, deletions = 0;
try {
  commitHash = execSync('git log -1 --pretty=%H', { cwd: ROOT }).toString().trim().slice(0, 12);
  // Список изменённых файлов + статистика
  const statRaw = execSync('git diff-tree --no-commit-id --numstat -r HEAD', { cwd: ROOT }).toString().trim();
  for (const line of statRaw.split('\n').filter(Boolean)) {
    const [ins, del, file] = line.split('\t');
    const i = parseInt(ins) || 0, d = parseInt(del) || 0;
    insertions += i; deletions += d;
    filesChanged.push({ file, insertions: i, deletions: d });
  }
} catch {}
actLog.push({
  ts:          new Date().toISOString(),
  from:        GIVER,
  to:          receiver,
  type:        'code',
  weight:      effectiveWeight,
  content:     description,
  linkedIssue: linkedIssue ?? null,
  commit:      commitHash,
  kenosis:     kenosisFlag,
  kenosisScore: kenosisResult.score,
  // ── Authorship manifest: среда знает, кто что создал ──
  files:       filesChanged.map(f => f.file),
  filesCount:  filesChanged.length,
  insertions,
  deletions,
});
if (linkedIssue && receiver !== '_koinon' && receiver !== '_abyss') {
  actLog.push({
    ts:          new Date().toISOString(),
    from:        receiver,
    to:          GIVER,
    type:        'reception',
    weight:      8,
    content:     `λήψις кода closes #${linkedIssue}`,
    linkedIssue: linkedIssue,
    commit:      commitHash,
  });
}
if (actLog.length > 500) actLog.splice(0, actLog.length - 500);
writeFileSync(ACT_INDEX, JSON.stringify(actLog, null, 2));

// ── Authorship Index: файл → кто создал → когда → зачем ───────────────────
// Среда знает, кто что сделал. Не нужно спрашивать — достаточно посмотреть.
const AUTHORSHIP_INDEX = resolve(ROOT, 'data/authorship-index.json');
const authorship = existsSync(AUTHORSHIP_INDEX)
  ? JSON.parse(readFileSync(AUTHORSHIP_INDEX, 'utf8'))
  : {};

for (const fc of filesChanged) {
  const existing = authorship[fc.file];
  if (!existing) {
    // Первое касание — автор
    authorship[fc.file] = {
      creator:    GIVER,
      createdAt:  new Date().toISOString(),
      createdIn:  commitHash,
      reason:     description,
      issue:      linkedIssue,
      touches:    1,
      lastTouch:  GIVER,
      lastTouchAt: new Date().toISOString(),
      contributors: [GIVER],
    };
  } else {
    // Последующие касания — contributor
    existing.touches++;
    existing.lastTouch = GIVER;
    existing.lastTouchAt = new Date().toISOString();
    if (!existing.contributors.includes(GIVER)) {
      existing.contributors.push(GIVER);
    }
  }
}

// Ограничить размер: только файлы которые существуют в git
const trackedFiles = new Set();
try {
  execSync('git ls-files', { cwd: ROOT }).toString().trim().split('\n').forEach(f => trackedFiles.add(f));
  for (const f of Object.keys(authorship)) {
    if (!trackedFiles.has(f)) delete authorship[f];
  }
} catch {}

writeFileSync(AUTHORSHIP_INDEX, JSON.stringify(authorship, null, 2));

const kenosisLabel = kenosisFlag ? 'κένωσις:✓' : 'κένωσις:✗';
console.log(`  ✦ gift(${GIVER} → ${receiver}): "${description}" [${kenosisLabel}, score:${kenosisResult.score.toFixed(2)}]`);
if (linkedIssue && receiver !== '_koinon' && receiver !== '_abyss') {
  console.log(`  ✦ λήψις(${receiver} → ${GIVER}): closes #${linkedIssue} (reception)`);
}
console.log(`    Актов: ${mem.actsCount} | ${GIVER} дал: ${mem.totalGiven(GIVER).toFixed(1)}`);

// ── Экспорт в симулятор: matrix-data.json для ontology.html ──────────────
const SIMULATOR_DIR = resolve(ROOT, '../fpga/simulator');
if (existsSync(SIMULATOR_DIR)) {
  try {
    const persons = snap.persons || [];
    const personCats = {
      'Отец':'divine','Сын':'divine','Христос':'divine','Дух':'divine',
      '_claude':'agent','_fpga':'chip','_koinon':'special','_abyss':'special',
      'Дионисий':'human','ОтецСергий':'human','Адам':'human','Ева':'human',
      'Человек':'shadow','Змей':'shadow',
    };
    const personData = persons.map(id => ({
      id,
      given:    +mem.totalGiven(id).toFixed(1),
      received: +mem.totalReceived(id).toFixed(1),
      cat:      personCats[id] || (id.startsWith('tg:') ? 'tg' : id.startsWith('_') ? 'agent' : 'spirit'),
    }));
    const edges = mem.heaviest(40).map(e => ({ from: e.from, to: e.to, w: +e.weight.toFixed(1) }));
    const matrixData = {
      ts:        Date.now(),
      actsCount: mem.actsCount,
      energy:    +(mem.energy ? mem.energy(Array(persons.length).fill(0)) : 0).toFixed(2),
      persons:   personData,
      edges,
    };
    writeFileSync(
      resolve(SIMULATOR_DIR, 'matrix-data.json'),
      JSON.stringify(matrixData, null, 2)
    );
    console.log(`    📡 matrix-data.json → simulator (${edges.length} нитей)`);
  } catch (e) {
    // не критично
  }
}

// ── Sync to nous (если доступен) ──────────────────────────────────────────
const NOUS_URL = process.env.NOUS_URL || '';
if (NOUS_URL) {
  const act = {
    ts: new Date().toISOString(), from: GIVER, to: receiver,
    type: 'code', weight: effectiveWeight, content: description,
    linkedIssue: linkedIssue ?? null, commit: commitHash,
    kenosis: kenosisFlag, kenosisScore: kenosisResult.score,
  };
  fetch(`${NOUS_URL}/acts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(act),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
  fetch(`${NOUS_URL}/matrix/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ giverId: GIVER, receiverId: receiver, weight: effectiveWeight, type: 'code', content: description, linkedIssue, irreversible: true, kenosis: kenosisFlag }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
