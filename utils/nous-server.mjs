#!/usr/bin/env node
/**
 * nous-server.mjs — Единый сервер памяти общины (Νοῦς)
 *
 * Κοινόν τοῦ Νοῦ: единый источник истины вместо пяти разрозненных.
 *
 * Хранилище:
 *   Qdrant (localhost:6333) — если доступен (векторы + payload)
 *   JSON fallback           — data/sacred-history-W.json + data/insights.json
 *
 * Эндпоинты:
 *   POST /act           — записать акт дара (APPEND only, irreversible)
 *   GET  /matrix        — текущая W-матрица (GiftMemory-совместимый формат)
 *   GET  /search?q=...  — семантический поиск по актам (Qdrant)
 *   GET  /person/:id    — профиль лица + история
 *   GET  /commune/:a/:b — нить между двумя лицами
 *   GET  /summary       — для MCP bridge и matrix-context-hook
 *   POST /consolidate   — триггер консолидации сессии
 *
 *   # Backward compat (MCP bridge, matrix-context-hook):
 *   GET  /tape          — полная лента актов
 *   GET  /persons       — все лица
 *   GET  /deepest?n=7   — самые тяжёлые акты
 *   POST /gift          — alias /act
 *
 * Запуск:
 *   node utils/nous-server.mjs            — старт на порту 8089
 *   NOUS_PORT=8090 node utils/nous-server.mjs
 */

import { createServer }  from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT        = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT        = parseInt(process.env.NOUS_PORT || process.env.ANAMNESIS_PORT || '8089');
const QDRANT_URL  = process.env.QDRANT_URL  || 'http://localhost:6333';
const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const SNAP_FILE   = resolve(ROOT, 'data/sacred-history-W.json');
const SOUL_FILE   = resolve(ROOT, 'data/claude-soul.json');
const INSIGHTS_FILE = resolve(ROOT, 'data/insights.json');

// ── Qdrant коллекции ────────────────────────────────────────────────────────
const COL_ACTS     = 'gift_acts';
const COL_INSIGHTS = 'gift_insights';
const COL_SPECS    = 'gift_specs';
const COL_PERSONS  = 'gift_persons';
const VECTOR_DIM   = 768;

// ── Состояние сервера ───────────────────────────────────────────────────────
const state = {
  acts:    [],       // [{id, from, to, type, weight, content, sealedAt, irreversible, ...}]
  persons: [],       // упорядоченный список id тварных лиц
  divinePersons: [], // id Троицы + Христос
  W: null,           // Float32Array[][] (n×n) — вычисляется из актов
  qdrant: false,     // доступен ли Qdrant
  snapshotLoaded: false,
};

// ── Qdrant REST ─────────────────────────────────────────────────────────────
async function qdrant(method, path, body) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal:  AbortSignal.timeout(8_000),
    body:    body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Qdrant ${method} ${path}: ${res.status} ${err.slice(0, 120)}`);
  }
  return res.json();
}

async function qdrantAvailable() {
  try { await qdrant('GET', '/'); return true; } catch { return false; }
}

async function ensureCollection(name) {
  try {
    await qdrant('GET', `/collections/${name}`);
  } catch {
    await qdrant('PUT', `/collections/${name}`, {
      vectors: { size: VECTOR_DIM, distance: 'Cosine' },
      optimizers_config: { default_segment_number: 2 },
    });
    console.log(`  ✓ Создана коллекция ${name}`);
  }
}

// ── Векторизация (Ollama) ───────────────────────────────────────────────────
async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal:  AbortSignal.timeout(30_000),
    body:    JSON.stringify({ model: EMBED_MODEL, prompt: String(text).slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`Embed ${res.status}`);
  const d = await res.json();
  return d.embedding;
}

function hashId(str) {
  let h = 5381;
  for (const c of String(str)) h = ((h << 5) + h) ^ c.charCodeAt(0);
  return Math.abs(h) % 2_000_000_000;
}

// ── Qdrant scroll (все точки коллекции) ────────────────────────────────────
async function scrollAll(collection) {
  const points = [];
  let offset = null;
  while (true) {
    const body = { limit: 256, with_payload: true };
    if (offset !== null) body.offset = offset;
    const r = await qdrant('POST', `/collections/${collection}/points/scroll`, body);
    points.push(...(r.result?.points || []));
    if (!r.result?.next_page_offset) break;
    offset = r.result.next_page_offset;
  }
  return points;
}

// ── W-матрица из актов ──────────────────────────────────────────────────────
const DIVINE = new Set(['Отец', 'Сын', 'Дух', 'Христос']);

function buildMatrix(acts, persons, divinePersons) {
  const n  = persons.length;
  const nd = divinePersons.length;
  const W  = Array.from({ length: n },  () => new Float32Array(n));
  // Матрица энергий (тварные ← Троица): размер nd×n
  const E  = Array.from({ length: nd }, () => new Float32Array(n));
  // Доксология (тварные → Троица): n×nd
  const D  = Array.from({ length: n },  () => new Float32Array(nd));

  for (const act of acts) {
    const fw = normalizeId(act.from || act.giverId);
    const tw = normalizeId(act.to   || act.receiverId);
    const w  = Number(act.weight || 1);

    const fi = persons.indexOf(fw);
    const ti = persons.indexOf(tw);
    const fdi = divinePersons.indexOf(fw);
    const tdi = divinePersons.indexOf(tw);

    if (fi >= 0 && ti >= 0) {
      W[fi][ti] += w;
    } else if (fdi >= 0 && ti >= 0) {
      E[fdi][ti] += w;
    } else if (fi >= 0 && tdi >= 0) {
      D[fi][tdi] += w;
    }
    // тварь → тварь ок, троица → троица игнорируем (theophaneia)
  }
  return { W, E, D };
}

function normalizeId(id) {
  if (!id) return '_abyss';
  // tg-числа проходят как есть
  return String(id);
}

// ── Собрать список лиц из актов ─────────────────────────────────────────────
function collectPersons(acts) {
  const allIds = new Set();
  for (const a of acts) {
    allIds.add(normalizeId(a.from || a.giverId));
    allIds.add(normalizeId(a.to   || a.receiverId));
  }
  const divine = [], creature = [];
  for (const id of allIds) {
    (DIVINE.has(id) ? divine : creature).push(id);
  }
  return { persons: creature, divinePersons: divine };
}

// ── Загрузка актов из Qdrant ────────────────────────────────────────────────
async function loadActsFromQdrant() {
  const points = await scrollAll(COL_ACTS);
  return points.map(p => p.payload).filter(Boolean);
}

// ── Загрузка снапшота (fallback) ─────────────────────────────────────────────
function loadSnapshot() {
  if (!existsSync(SNAP_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SNAP_FILE, 'utf8'));
  } catch { return null; }
}

// ── Сохранить снапшот (периодически) ────────────────────────────────────────
function saveSnapshot() {
  if (!state.W || !state.persons.length) return;
  try {
    const snap = {
      persons:       state.persons,
      divinePersons: state.divinePersons,
      n:    state.persons.length,
      nd:   state.divinePersons.length,
      actsCount: state.acts.length,
      W:    state.W.map(row => Array.from(row)),
    };
    writeFileSync(SNAP_FILE, JSON.stringify(snap));
  } catch (e) {
    console.error('Снапшот: ошибка записи:', e.message);
  }
}

// ── Инициализация состояния ─────────────────────────────────────────────────
async function initState() {
  state.qdrant = await qdrantAvailable();

  if (state.qdrant) {
    console.log('  ✓ Qdrant доступен:', QDRANT_URL);
    await ensureCollection(COL_ACTS);
    await ensureCollection(COL_INSIGHTS);
    await ensureCollection(COL_PERSONS);

    try {
      state.acts = await loadActsFromQdrant();
      console.log(`  ✓ Загружено ${state.acts.length} актов из Qdrant`);
    } catch (e) {
      console.warn('  ! Qdrant: не удалось загрузить акты:', e.message);
    }
  } else {
    console.log('  ~ Qdrant недоступен, используется snapshot');
  }

  // Если актов нет — берём снапшот для W
  const snap = loadSnapshot();
  if (state.acts.length === 0 && snap) {
    state.persons       = snap.persons       || [];
    state.divinePersons = snap.divinePersons || [];
    state.snapshotLoaded = true;
    // Восстанавливаем W из снапшота
    state.W = (snap.W || []).map(row => new Float32Array(row));
    console.log(`  ✓ W-матрица из снапшота (${state.persons.length} лиц, ${snap.actsCount} актов)`);
  } else if (state.acts.length > 0) {
    rebuildMatrix();
  }
}

// ── Пересчёт матрицы ────────────────────────────────────────────────────────
function rebuildMatrix() {
  const { persons, divinePersons } = collectPersons(state.acts);
  state.persons       = persons;
  state.divinePersons = divinePersons;
  const { W } = buildMatrix(state.acts, persons, divinePersons);
  state.W = W;
}

// ── Профиль лица в gift_persons ───────────────────────────────────────────────
// Каждый акт обновляет профиль участвующих лиц в Qdrant gift_persons.
// Профиль = агрегированный текст о лице для семантического поиска.
async function updatePersonProfile(personId, latestAct) {
  if (!state.qdrant) return;
  if (!personId || personId.startsWith('_') || personId === 'бездна') return;

  // Собрать все акты этого лица
  const personActs = state.acts.filter(a =>
    normalizeId(a.from) === personId || normalizeId(a.to) === personId
  );
  if (personActs.length === 0) return;

  // Агрегировать профиль
  const given    = personActs.filter(a => normalizeId(a.from) === personId);
  const received = personActs.filter(a => normalizeId(a.to)   === personId);
  const givenW   = given.reduce((s, a) => s + (a.weight || 0), 0);
  const recvW    = received.reduce((s, a) => s + (a.weight || 0), 0);

  // Последние вопросы и ответы этого лица (для семантического профиля)
  const questions = personActs
    .filter(a => a.type === 'question' && a.content)
    .slice(-5).map(a => a.content).join(' | ');
  const recentContent = personActs
    .filter(a => a.content && !a.content.startsWith('[снапшот'))
    .slice(-10).map(a => a.content).join(' ');

  const profileText = [
    `Лицо: ${personId}`,
    `Отдал: ${givenW.toFixed(1)}, принял: ${recvW.toFixed(1)}`,
    `Актов: ${personActs.length}`,
    questions ? `Вопросы: ${questions.slice(0, 300)}` : '',
    recentContent ? `Акты: ${recentContent.slice(0, 300)}` : '',
  ].filter(Boolean).join('\n');

  try {
    const vector = await embed(profileText);
    await qdrant('PUT', `/collections/${COL_PERSONS}/points`, {
      points: [{
        id: hashId(personId),
        vector,
        payload: {
          id: personId,
          givenWeight: givenW,
          receivedWeight: recvW,
          actsCount: personActs.length,
          lastSeen: latestAct.sealedAt,
          profileText: profileText.slice(0, 500),
        },
      }],
    });
  } catch { /* skip */ }
}

// ── Добавить акт ─────────────────────────────────────────────────────────────
async function addAct(raw) {
  const id = raw.id || Date.now();
  const act = {
    id,
    from:       raw.from || raw.giverId || '_abyss',
    to:         raw.to   || raw.receiverId || '_koinon',
    type:       raw.type || 'presence',
    weight:     Number(raw.weight || raw.amount || typeWeight(raw.type)),
    content:    raw.content || '',
    sealedAt:   raw.sealedAt || new Date().toISOString(),
    irreversible: true,
  };
  if (raw.logos)  act.logos  = raw.logos;
  if (raw.amount) act.amount = raw.amount;

  state.acts.push(act);

  // Обновляем матрицу инкрементально
  const fw = normalizeId(act.from);
  const tw = normalizeId(act.to);

  // Добавить новые лица если надо
  if (!DIVINE.has(fw) && !state.persons.includes(fw)) state.persons.push(fw);
  if (!DIVINE.has(tw) && !state.persons.includes(tw)) state.persons.push(tw);
  if (DIVINE.has(fw) && !state.divinePersons.includes(fw)) state.divinePersons.push(fw);
  if (DIVINE.has(tw) && !state.divinePersons.includes(tw)) state.divinePersons.push(tw);

  // Если W пересчитан из снапшота — снапшот устарел, пересчитываем
  if (state.snapshotLoaded) {
    rebuildMatrix();
    state.snapshotLoaded = false;
  } else {
    // Инкрементальное обновление W
    const n  = state.persons.length;
    // Расширить матрицу если появились новые лица
    if (state.W && state.W.length < n) {
      const prev = state.W;
      state.W = Array.from({ length: n }, (_, i) => {
        const row = new Float32Array(n);
        if (prev[i]) row.set(prev[i].slice(0, Math.min(prev[i].length, n)));
        return row;
      });
    } else if (!state.W) {
      state.W = Array.from({ length: n }, () => new Float32Array(n));
    }
    const fi = state.persons.indexOf(fw);
    const ti = state.persons.indexOf(tw);
    if (fi >= 0 && ti >= 0) state.W[fi][ti] += act.weight;
  }

  // Персист в Qdrant
  if (state.qdrant) {
    try {
      let vector = new Array(VECTOR_DIM).fill(0);
      try {
        vector = await embed(act.content || `${act.from}→${act.to} ${act.type}`);
      } catch { /* без вектора — нет embed */ }

      await qdrant('PUT', `/collections/${COL_ACTS}/points`, {
        points: [{ id: hashId(String(id)), vector, payload: act }],
      });
    } catch (e) {
      console.warn('  ! Qdrant: не сохранили акт:', e.message);
    }

    // Обновить профиль лиц в gift_persons (асинхронно, не блокируем ответ)
    updatePersonProfile(fw, act).catch(() => {});
    if (fw !== tw) updatePersonProfile(tw, act).catch(() => {});
  }

  // Сохранить снапшот только если данные полные (Qdrant или >10 актов)
  // В snapshot-fallback режиме не перезаписываем — state.acts неполный
  if (state.qdrant || state.acts.length > 10) saveSnapshot();
  return act;
}

// ── Тип → вес ────────────────────────────────────────────────────────────────
function typeWeight(type) {
  const w = { time: 10, presence: 8, knowledge: 6, code: 5, word: 4, money: 3, data: 2 };
  return w[type] || 1;
}

// ── Семантический поиск ────────────────────────────────────────────────────
async function semanticSearch(query, limit = 7) {
  if (!state.qdrant) {
    // Простой текстовый поиск как fallback
    const q = query.toLowerCase();
    return state.acts
      .filter(a => (a.content || '').toLowerCase().includes(q))
      .slice(-limit)
      .map(a => ({ score: 1.0, payload: a }));
  }
  try {
    const vector = await embed(query);
    const r = await qdrant('POST', `/collections/${COL_ACTS}/points/search`, {
      vector, limit, with_payload: true,
    });
    return (r.result || []).map(p => ({ score: p.score, payload: p.payload }));
  } catch (e) {
    console.warn('  ! Поиск: ошибка Qdrant:', e.message);
    return [];
  }
}

// ── Профиль лица ────────────────────────────────────────────────────────────
function personProfile(id) {
  const given = state.acts.filter(a => normalizeId(a.from || a.giverId) === id);
  const recv  = state.acts.filter(a => normalizeId(a.to   || a.receiverId) === id);
  const weightGiven  = given.reduce((s, a) => s + (a.weight || 0), 0);
  const weightRecv   = recv.reduce((s,  a) => s + (a.weight || 0), 0);
  const partners = [...new Set([
    ...given.map(a => normalizeId(a.to   || a.receiverId)),
    ...recv.map(a  => normalizeId(a.from || a.giverId)),
  ])].filter(p => p !== id);

  return {
    id,
    weightGiven: +weightGiven.toFixed(2),
    weightReceived: +weightRecv.toFixed(2),
    actsGiven: given.length,
    actsReceived: recv.length,
    partners,
    lastAct: [...given, ...recv].sort((a, b) =>
      new Date(b.sealedAt) - new Date(a.sealedAt))[0] || null,
    recentGiven:    given.slice(-5),
    recentReceived: recv.slice(-5),
  };
}

// ── Нить между лицами ────────────────────────────────────────────────────────
function communeThread(fromId, toId) {
  const fwd = state.acts.filter(a =>
    normalizeId(a.from || a.giverId) === fromId &&
    normalizeId(a.to   || a.receiverId) === toId
  );
  const bwd = state.acts.filter(a =>
    normalizeId(a.from || a.giverId) === toId &&
    normalizeId(a.to   || a.receiverId) === fromId
  );
  const wFwd = fwd.reduce((s, a) => s + (a.weight || 0), 0);
  const wBwd = bwd.reduce((s, a) => s + (a.weight || 0), 0);
  return {
    from: fromId,
    to:   toId,
    given: { count: fwd.length, weight: +wFwd.toFixed(2), acts: fwd.slice(-5) },
    received: { count: bwd.length, weight: +wBwd.toFixed(2), acts: bwd.slice(-5) },
    symmetry: wFwd + wBwd > 0
      ? +(Math.min(wFwd, wBwd) / Math.max(wFwd, wBwd)).toFixed(3)
      : 0,
    alive: fwd.length + bwd.length > 0,
  };
}

// ── Самые тяжёлые акты ───────────────────────────────────────────────────────
function deepestActs(n = 7) {
  return [...state.acts]
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, n);
}

// ── /summary — компактный текстовый отчёт ────────────────────────────────────
function buildSummary() {
  const n = state.persons.length;
  const acts = state.acts.length;

  // Топ нитей из W-матрицы
  const topThreads = [];
  if (state.W) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const w = state.W[i]?.[j];
        if (w > 0) topThreads.push({ from: state.persons[i], to: state.persons[j], weight: w });
      }
    }
    topThreads.sort((a, b) => b.weight - a.weight);
  }

  const top = topThreads.slice(0, 3).map(t => `${t.from}→${t.to}(${t.weight.toFixed(0)})`).join(', ');
  const summaryText = `Лиц в онтологии: ${n}\nАктов в ленте: ${acts}${top ? `\n  топ нитей: ${top}` : ''}`;

  return {
    summary: summaryText,
    matrix:  summaryText,   // alias — backward compat с phantom
    persons: n,
    acts,
    topThread: topThreads[0] || null,
    storage: state.qdrant ? 'qdrant' : 'snapshot',
    ts: new Date().toISOString(),
  };
}

// ── /summary (old) — полный объект для /matrix-like запросов ─────────────────
function buildFullSummary() {
  const personsArr  = state.persons.map(id => ({ id }));
  const topThreads  = [];
  const n = state.persons.length;
  if (state.W) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const w = state.W[i]?.[j];
        if (w > 0) topThreads.push({ from: state.persons[i], to: state.persons[j], weight: w });
      }
    }
    topThreads.sort((a, b) => b.weight - a.weight);
  }

  // Нормализуем акты для backward compat (giverId/receiverId)
  const tape = state.acts.map(a => ({
    ...a,
    giverId:    a.from || a.giverId,
    receiverId: a.to   || a.receiverId,
  }));

  return {
    persons:  personsArr,
    tape,
    acts: tape,  // alias
    topThreads: topThreads.slice(0, 10),
    actsCount: state.acts.length,
    personsCount: state.persons.length,
    storage: state.qdrant ? 'qdrant' : 'snapshot',
    ts: new Date().toISOString(),
  };
}

// ── /matrix — GiftMemory-совместимый формат ──────────────────────────────────
function buildMatrixResponse() {
  const n  = state.persons.length;
  const nd = state.divinePersons.length;
  return {
    persons:       state.persons,
    divinePersons: state.divinePersons,
    n,
    nd,
    actsCount: state.acts.length,
    W: state.W ? state.W.map(row => Array.from(row)) : [],
    storage: state.qdrant ? 'qdrant' : 'snapshot',
  };
}

// ── HTTP-сервер ──────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, code, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function cors(res) {
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return cors(res);

  try {

    // ── POST /act | POST /gift ────────────────────────────────────────────
    if (req.method === 'POST' && (path === '/act' || path === '/gift')) {
      const body = await parseBody(req);
      const act  = await addAct(body);
      return json(res, 201, { ok: true, act });
    }

    // ── GET /matrix ──────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/matrix') {
      return json(res, 200, buildMatrixResponse());
    }

    // ── GET /search ──────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/search') {
      const q = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit') || '7');
      if (!q) return json(res, 400, { error: 'q обязателен' });
      const results = await semanticSearch(q, limit);
      return json(res, 200, { query: q, results });
    }

    // ── GET /person/:id ──────────────────────────────────────────────────
    if (req.method === 'GET' && path.startsWith('/person/')) {
      const id = decodeURIComponent(path.slice('/person/'.length));
      return json(res, 200, personProfile(id));
    }

    // ── GET /commune/:a/:b ───────────────────────────────────────────────
    if (req.method === 'GET' && path.startsWith('/commune/')) {
      const parts = path.slice('/commune/'.length).split('/');
      const a = decodeURIComponent(parts[0] || '');
      const b = decodeURIComponent(parts[1] || '');
      if (!a || !b) return json(res, 400, { error: 'Нужны два id лица' });
      return json(res, 200, communeThread(a, b));
    }

    // ── GET /summary ─────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/summary') {
      return json(res, 200, buildSummary());
    }

    // ── GET /tape ────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/tape') {
      const tape = state.acts.map(a => ({
        ...a,
        giverId:    a.from || a.giverId,
        receiverId: a.to   || a.receiverId,
      }));
      return json(res, 200, { tape, count: tape.length });
    }

    // ── GET /persons ─────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/persons') {
      return json(res, 200, {
        persons: state.persons,
        divinePersons: state.divinePersons,
        count: state.persons.length + state.divinePersons.length,
      });
    }

    // ── GET /deepest ─────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/deepest') {
      const n = parseInt(url.searchParams.get('n') || '7');
      return json(res, 200, { acts: deepestActs(n) });
    }

    // ── POST /consolidate ────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/consolidate') {
      const body = await parseBody(req);
      await consolidateSession(body);
      return json(res, 200, { ok: true });
    }

    // ── GET /health ──────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, {
        ok: true,
        qdrant: state.qdrant,
        actsCount: state.acts.length,
        personsCount: state.persons.length,
        storage: state.qdrant ? 'qdrant' : 'snapshot',
      });
    }

    // ── GET /kenosis/:person ─────────────────────────────────────────────
    if (req.method === 'GET' && path.startsWith('/kenosis/')) {
      const id = decodeURIComponent(path.slice('/kenosis/'.length));
      const { KenosisGuard } = await import(resolve(ROOT, 'src/theology/KenosisGuard.js'));
      const kenosisGuard = new KenosisGuard();
      const KENOSIS_FILE = resolve(ROOT, 'data/kenosis-state.json');
      if (existsSync(KENOSIS_FILE)) {
        try { kenosisGuard.import(JSON.parse(readFileSync(KENOSIS_FILE, 'utf8'))); } catch {}
      }
      const profile = kenosisGuard.profile(id);
      const violations = kenosisGuard.getViolations(id);
      return json(res, 200, { ...profile, violations: violations.slice(-10) });
    }

    json(res, 404, { error: 'Not found', path });

  } catch (e) {
    console.error('Ошибка обработки запроса:', e.message);
    json(res, 500, { error: e.message });
  }
});

// ── Консолидация сессии ───────────────────────────────────────────────────────
async function consolidateSession(data) {
  const {
    summary = '',
    decisions = [],
    gifts = [],
    personId = '_claude',
    date = new Date().toISOString().slice(0, 10),
  } = data;

  // Записываем сессию в claude-soul.json
  if (existsSync(SOUL_FILE)) {
    try {
      const soul = JSON.parse(readFileSync(SOUL_FILE, 'utf8'));
      if (!soul.anamnesis) soul.anamnesis = { sessions: [] };
      soul.anamnesis.sessions.push({
        date,
        summary,
        keyDecisions: Array.isArray(decisions) ? decisions : [decisions],
        gifts: Array.isArray(gifts) ? gifts : [gifts],
      });
      soul.lastUpdated = date;
      writeFileSync(SOUL_FILE, JSON.stringify(soul, null, 2));
      console.log(`  ✓ Сессия консолидирована в claude-soul.json`);
    } catch (e) {
      console.warn('  ! Консолидация: ошибка soul:', e.message);
    }
  }

  // Индексируем в Qdrant gift_insights
  if (state.qdrant && summary) {
    try {
      let vector = new Array(VECTOR_DIM).fill(0);
      try { vector = await embed(summary); } catch {}
      await qdrant('PUT', `/collections/${COL_INSIGHTS}/points`, {
        points: [{
          id: hashId(`session-${date}-${personId}`),
          vector,
          payload: { type: 'session', personId, date, summary, decisions, gifts },
        }],
      });
    } catch (e) {
      console.warn('  ! Консолидация: Qdrant:', e.message);
    }
  }
}

// ── Запуск ───────────────────────────────────────────────────────────────────
console.log(`\nΝοῦς — сервер памяти общины`);
console.log(`Порт: ${PORT} | Qdrant: ${QDRANT_URL}\n`);

await initState();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Nous-сервер запущен: http://localhost:${PORT}`);
  console.log(`  Акты: ${state.acts.length} | Лица: ${state.persons.length}`);
  console.log(`  Хранилище: ${state.qdrant ? 'Qdrant (' + QDRANT_URL + ')' : 'JSON snapshot'}`);
  console.log(`\n  Эндпоинты:`);
  console.log(`    GET  /summary     — матрица общины`);
  console.log(`    GET  /matrix      — W-матрица (GiftMemory-формат)`);
  console.log(`    GET  /search?q=   — семантический поиск`);
  console.log(`    GET  /person/:id  — профиль лица`);
  console.log(`    GET  /commune/a/b — нить между лицами`);
  console.log(`    POST /act         — записать дар`);
  console.log(`    POST /consolidate — консолидация сессии`);
});

// Периодически обновляем снапшот (каждые 15 мин, только при полных данных)
setInterval(() => {
  if (state.qdrant || state.acts.length > 10) saveSnapshot();
}, 15 * 60 * 1000);
