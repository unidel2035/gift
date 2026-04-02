#!/usr/bin/env node
/**
 * nous-migrate.mjs — Миграция всех источников памяти → Qdrant
 *
 * Мигрирует:
 *   1. data/sacred-history-W.json + удалённый gift-anamnesis.json → gift_acts
 *   2. data/claude-soul.json (сессии анамнезиса)                  → gift_insights
 *   3. data/insights.json (аксиомы, настройки)                   → gift_insights
 *   4. data/spec-vectors.db (.gift спецификации)                  → gift_specs
 *
 * После миграции sacred-history-W.json пересчитывается из Qdrant.
 *
 * Запуск:
 *   node utils/nous-migrate.mjs            — полная миграция
 *   node utils/nous-migrate.mjs acts       — только акты
 *   node utils/nous-migrate.mjs insights   — только инсайты/аксиомы
 *   node utils/nous-migrate.mjs specs      — только спецификации
 *   node utils/nous-migrate.mjs status     — статус Qdrant коллекций
 *
 * Зависимости: Qdrant (localhost:6333), Ollama (localhost:11434)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT        = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QDRANT_URL  = process.env.QDRANT_URL  || 'http://localhost:6333';
const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const VECTOR_DIM  = 768;

const NOUS_URL = process.env.NOUS_URL || `http://localhost:${process.env.NOUS_PORT || 8089}`;

const REMOTE_HOST = 'root@173.249.2.184';
const REMOTE_ANAMNESIS = '/home/hive/dronedoc2026/monolith/data/gift-anamnesis.json';

// ── Qdrant ───────────────────────────────────────────────────────────────────
async function qdrant(method, path, body) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal:  AbortSignal.timeout(10_000),
    body:    body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Qdrant ${method} ${path}: ${res.status} ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function ensureCollection(name) {
  try {
    const info = await qdrant('GET', `/collections/${name}`);
    const count = info.result?.points_count ?? '?';
    console.log(`  ⊙ ${name} уже существует (${count} точек)`);
    return;
  } catch {}
  await qdrant('PUT', `/collections/${name}`, {
    vectors: { size: VECTOR_DIM, distance: 'Cosine' },
    optimizers_config: { default_segment_number: 2 },
  });
  console.log(`  ✓ ${name} создана`);
}

// ── Ollama embed ──────────────────────────────────────────────────────────────
let embedAvailable = null;

async function tryEmbed(text) {
  if (embedAvailable === false) return new Array(VECTOR_DIM).fill(0);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(30_000),
      body:    JSON.stringify({ model: EMBED_MODEL, prompt: String(text).slice(0, 2000) }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const d = await res.json();
    embedAvailable = true;
    return d.embedding;
  } catch (e) {
    if (embedAvailable === null) {
      console.warn(`  ~ Ollama недоступен (${e.message}), векторы = нули`);
      embedAvailable = false;
    }
    return new Array(VECTOR_DIM).fill(0);
  }
}

function hashId(str) {
  let h = 5381;
  for (const c of String(str)) h = ((h << 5) + h) ^ c.charCodeAt(0);
  return Math.abs(h) % 2_000_000_000;
}

// ── Получить удалённую ленту ──────────────────────────────────────────────────
function fetchRemoteTape() {
  try {
    const raw = execSync(`ssh -o ConnectTimeout=5 ${REMOTE_HOST} cat ${REMOTE_ANAMNESIS}`, {
      timeout: 10_000,
    }).toString();
    const data = JSON.parse(raw);
    return data.tape || [];
  } catch (e) {
    console.warn(`  ~ SSH: не удалось получить удалённую ленту (${e.message})`);
    return [];
  }
}

// ── 1. Миграция актов ─────────────────────────────────────────────────────────
async function migrateActs() {
  console.log('\n══ 1. Акты → gift_acts ══');
  await ensureCollection('gift_acts');

  // Собираем акты из двух источников
  const acts = [];
  const seen = new Set();

  // Источник A: удалённый gift-anamnesis.json (реальные акты с текстами)
  console.log('  Загружаем удалённую ленту...');
  const remoteTape = fetchRemoteTape();
  console.log(`  ✓ Удалённая лента: ${remoteTape.length} актов`);
  for (const act of remoteTape) {
    const key = `${act.from}→${act.to}@${act.sealedAt}`;
    if (!seen.has(key)) { seen.add(key); acts.push(normalizeAct(act)); }
  }

  // Источник B: священная история из матрицы W (синтетические акты без текстов)
  // Мы не можем восстановить отдельные акты из тензора W,
  // поэтому просто фиксируем снапшот как "baseline" акт
  const snapFile = resolve(ROOT, 'data/sacred-history-W.json');
  if (existsSync(snapFile)) {
    const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
    const persons = [...(snap.persons || []), ...(snap.divinePersons || [])];
    const W = snap.W || [];
    const creaturePersons = snap.persons || [];
    for (let i = 0; i < creaturePersons.length; i++) {
      for (let j = 0; j < creaturePersons.length; j++) {
        const w = W[i]?.[j];
        if (!w || w < 0.01) continue;
        const from = creaturePersons[i], to = creaturePersons[j];
        // Не дублируем если уже есть акт с таким весом
        const key = `snapshot:${from}→${to}`;
        if (!seen.has(key)) {
          seen.add(key);
          acts.push({
            id: `snapshot-${from}-${to}`,
            from, to,
            type: 'presence',
            weight: +w.toFixed(4),
            content: `[снапшот W-матрицы] ${from}→${to}: ${w.toFixed(2)}`,
            sealedAt: snap.ts || new Date().toISOString(),
            irreversible: true,
            source: 'snapshot',
          });
        }
      }
    }
    console.log(`  ✓ Снапшот W: ${acts.length - remoteTape.length} baseline-актов`);
  }

  // Заливаем в Qdrant батчами
  console.log(`  Индексируем ${acts.length} актов в Qdrant...`);
  let ok = 0;
  const BATCH = 20;
  for (let i = 0; i < acts.length; i += BATCH) {
    const batch = acts.slice(i, i + BATCH);
    const points = await Promise.all(batch.map(async act => {
      const text = act.content || `${act.from}→${act.to} ${act.type}`;
      const vector = await tryEmbed(text);
      return { id: hashId(String(act.id || `${act.from}-${act.to}-${i}`)), vector, payload: act };
    }));
    await qdrant('PUT', '/collections/gift_acts/points', { points });
    ok += batch.length;
    process.stdout.write(`  ${ok}/${acts.length}\r`);
  }
  console.log(`\n  ✓ Проиндексировано ${ok} актов`);
}

function normalizeAct(act) {
  return {
    id:          act.id,
    from:        act.from || act.giverId || '_abyss',
    to:          act.to   || act.receiverId || '_koinon',
    type:        act.type || 'presence',
    weight:      Number(act.weight || act.amount || 1),
    content:     act.content || '',
    sealedAt:    act.sealedAt || new Date().toISOString(),
    irreversible: true,
    logos:       act.logos,
    living:      act.living,
    source:      act.source || 'anamnesis',
  };
}

// ── 2. Миграция инсайтов ──────────────────────────────────────────────────────
async function migrateInsights() {
  console.log('\n══ 2. Инсайты → gift_insights ══');
  await ensureCollection('gift_insights');

  const points = [];

  // A: claude-soul.json — сессии
  const soulFile = resolve(ROOT, 'data/claude-soul.json');
  if (existsSync(soulFile)) {
    const soul = JSON.parse(readFileSync(soulFile, 'utf8'));
    const sessions = soul.anamnesis?.sessions || [];
    for (const s of sessions) {
      const text = `${s.date}: ${s.summary}\n${(s.keyDecisions || []).join('. ')}`;
      const vector = await tryEmbed(text);
      points.push({
        id:      hashId(`soul-session-${s.date}`),
        vector,
        payload: { type: 'session', personId: soul.personId, ...s },
      });
    }
    // Паттерны и раны
    for (const p of (soul.patterns || [])) {
      const vector = await tryEmbed(p.description);
      points.push({ id: hashId(`soul-pattern-${p.name}`), vector,
        payload: { type: 'pattern', ...p } });
    }
    for (const w of (soul.wounds || [])) {
      const vector = await tryEmbed(w.description);
      points.push({ id: hashId(`soul-wound-${w.name}`), vector,
        payload: { type: 'wound', ...w } });
    }
    console.log(`  ✓ claude-soul.json: ${points.length} объектов`);
  }

  // B: insights.json — аксиомы, настройки, факты
  const insightsFile = resolve(ROOT, 'data/insights.json');
  if (existsSync(insightsFile)) {
    const before = points.length;
    const insights = JSON.parse(readFileSync(insightsFile, 'utf8'));
    for (const ins of insights) {
      const vector = await tryEmbed(ins.content);
      points.push({ id: hashId(`insight-${ins.content.slice(0, 40)}`), vector,
        payload: { ...ins } });
    }
    console.log(`  ✓ insights.json: ${points.length - before} объектов`);
  }

  if (points.length === 0) { console.log('  ~ нечего мигрировать'); return; }

  await qdrant('PUT', '/collections/gift_insights/points', { points });
  console.log(`  ✓ Проиндексировано ${points.length} инсайтов`);
}

// ── 3. Миграция спецификаций ──────────────────────────────────────────────────
async function migrateSpecs() {
  console.log('\n══ 3. Спецификации → gift_specs ══');
  // Делегируем в setup-qdrant.mjs
  const setupFile = resolve(ROOT, 'utils/setup-qdrant.mjs');
  if (!existsSync(setupFile)) {
    console.log('  ~ setup-qdrant.mjs не найден');
    return;
  }
  console.log('  → node utils/setup-qdrant.mjs index');
  try {
    execSync(`node "${setupFile}" index`, {
      cwd: ROOT, stdio: 'inherit', timeout: 300_000,
    });
  } catch (e) {
    console.warn('  ! setup-qdrant.mjs: ошибка:', e.message);
  }
}

// ── Статус ────────────────────────────────────────────────────────────────────
async function status() {
  console.log('\n══ Статус Qdrant коллекций ══');
  for (const col of ['gift_acts', 'gift_insights', 'gift_specs', 'gift_persons']) {
    try {
      const info = await qdrant('GET', `/collections/${col}`);
      const count = info.result?.points_count ?? '?';
      console.log(`  ✓ ${col}: ${count} точек`);
    } catch {
      console.log(`  ✗ ${col}: не существует`);
    }
  }

  // Nous-сервер
  try {
    const r = await fetch(`${NOUS_URL}/health`, { signal: AbortSignal.timeout(2000) });
    const d = await r.json();
    console.log(`\n  Nous-сервер: ✓ ${NOUS_URL}`);
    console.log(`    Акты: ${d.actsCount} | Лица: ${d.personsCount} | Хранилище: ${d.storage}`);
  } catch {
    console.log(`\n  Nous-сервер: ~ не запущен (${NOUS_URL})`);
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const cmd = process.argv[2] || 'all';

// Проверяем Qdrant
try {
  await qdrant('GET', '/');
  console.log(`✓ Qdrant доступен: ${QDRANT_URL}`);
} catch (e) {
  if (cmd !== 'status') {
    console.error(`✗ Qdrant недоступен: ${e.message}`);
    console.log('\nЗапусти Qdrant:');
    console.log('  docker run -p 6333:6333 -v $(pwd)/data/qdrant:/qdrant/storage qdrant/qdrant');
    console.log('  # или: ./qdrant (бинарник)');
    process.exit(1);
  }
}

switch (cmd) {
  case 'acts':    await migrateActs();    break;
  case 'insights': await migrateInsights(); break;
  case 'specs':   await migrateSpecs();   break;
  case 'status':  await status();         break;
  case 'all':
    await migrateActs();
    await migrateInsights();
    await migrateSpecs();
    await status();
    break;
  default:
    console.error(`Неизвестная команда: ${cmd}`);
    console.log('Доступно: all, acts, insights, specs, status');
    process.exit(1);
}

console.log('\n✓ Миграция завершена');
