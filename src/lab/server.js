/**
 * Сервер онтологии Дара
 *
 * REST API + HTML-интерфейс для исследования.
 * Без внешних зависимостей — только node:http.
 *
 * Запуск: node src/lab/server.js [--port 3777]
 *
 * Маршруты:
 *   GET  /           — веб-интерфейс
 *   GET  /api/status — состояние сессии
 *   POST /api/person — зарегистрировать лицо
 *   GET  /api/persons — список лиц
 *   POST /api/gift    — создать дар
 *   POST /api/accept  — принять дар {id}
 *   POST /api/decline — отклонить дар {id}
 *   POST /api/grace   — благодать {name}
 *   GET  /api/graph   — граф благодарности
 *   GET  /api/graph/cycles — перихоретические циклы
 *   POST /api/logos   — зарегистрировать λόγος
 *   GET  /api/logos   — дерево λόγοι
 *   POST /api/vm      — запустить TernaryVM {program}
 *   GET  /api/harmony — гармония λόγοι
 */

import { createServer } from 'node:http';
import { GiftAct, AntiKenosis } from '../core/GiftAct.js';
import { Trit, TernaryVM } from '../core/TernaryCore.js';
import LogosRegistry from '../core/LogosRegistry.js';
import { GratitudeGraph } from '../traces/GratitudeGraph.js';
import { GiftMemory } from '../core/GiftMemory.js';
import { KoinonFederation } from '../core/KoinonFederation.js';
import { GiftValidator } from '../core/GiftValidator.js';

// ── KoinonFederation ─────────────────────────────────────────

const _fedMemory    = new GiftMemory(['_claude', '_koinon', 'Дионисий']);
const _federation   = new KoinonFederation(
  process.env.KOINON_ID  ?? 'koinon-dion',
  _fedMemory,
  { url: process.env.KOINON_URL ?? null }
);

// ── Состояние сессии ─────────────────────────────────────────

const session = {
  persons: new Map(),
  gifts: [],
  logoi: new LogosRegistry(),
  graph: new GratitudeGraph(),
  log: [],
};

function addPerson(name, calling = null) {
  if (!session.persons.has(name)) {
    session.persons.set(name, {
      id: `p${session.persons.size + 1}`,
      name,
      calling,
      giftsGiven: 0,
      giftsReceived: 0,
    });
  }
  return session.persons.get(name);
}

function createGift(from, to, content, cost = 1, decision = null) {
  const act = GiftAct.person();
  const result = act.cycle(from, to, content, cost, decision);
  const id = `g${session.gifts.length + 1}`;
  const p = session.persons.get(from);
  if (p) p.giftsGiven++;
  const r = session.persons.get(to);
  if (r) r.giftsReceived++;
  session.gifts.push({ id, from, to, content, cost, result, ts: new Date().toISOString() });
  session.log.push({ ts: new Date().toISOString(), msg: `Дар ${id}: ${from} → ${to} «${content}»` });
  return { id, ...result };
}

// ── REST API ─────────────────────────────────────────────────

function handleApi(method, path, body) {
  // GET /api/status
  if (method === 'GET' && path === '/api/status') {
    return {
      persons: session.persons.size,
      gifts: session.gifts.length,
      accepted: session.gifts.filter(g => g.result.accepted).length,
      declined: session.gifts.filter(g => g.result.accepted === false).length,
      waiting: session.gifts.filter(g => g.result.accepted === null).length,
      graphEdges: session.graph._edgeCount ?? 0,
      logoi: session.logoi.stats().total,
      log: session.log.slice(-10),
    };
  }

  // GET /api/persons
  if (method === 'GET' && path === '/api/persons') {
    return [...session.persons.values()];
  }

  // POST /api/person
  if (method === 'POST' && path === '/api/person') {
    const { name, calling } = body;
    if (!name) return { error: 'name required' };
    const p = addPerson(name, calling);
    session.log.push({ ts: new Date().toISOString(), msg: `Лицо: ${name}` });
    return p;
  }

  // POST /api/gift — Gift Protocol v0.1 (schema:"gift/v1") ИЛИ legacy API
  //
  // Если тело содержит schema:"gift/v1" → протокольный обработчик:
  //   валидирует акт, записывает в W-матрицу, возвращает запечатанный акт.
  // Иначе → legacy (from/to/content/cost), сессионный режим.
  if (method === 'POST' && path === '/api/gift') {
    if (body && body.schema === 'gift/v1') {
      const result = GiftValidator.validate(body);
      if (!result.ok) {
        return { ok: false, errors: result.errors };
      }
      const { act } = result;
      const memAct = GiftValidator.toMemoryAct(act);
      _fedMemory.receive(memAct);
      session.log.push({
        ts: act.timestamp,
        msg: `Дар [gift/v1]: ${act.from} → ${act.to} (${act.type}, w=${act.weight})`,
      });
      return { ok: true, act, memoryAct: memAct };
    }
    // legacy
    const { from, to, content, cost = 1, decision = null } = body;
    if (!from || !content) return { error: 'from and content required' };
    return createGift(from, to || 'all', content, cost, decision);
  }

  // POST /api/accept
  if (method === 'POST' && path === '/api/accept') {
    const { id } = body;
    const g = session.gifts.find(x => x.id === id);
    if (!g) return { error: `gift ${id} not found` };
    g.result.accepted = true;
    g.result.gratitude = true;
    session.graph.addGratitude(g.to, g.from, g.id);
    session.log.push({ ts: new Date().toISOString(), msg: `Принят: ${id}` });
    return { ok: true, id };
  }

  // POST /api/decline
  if (method === 'POST' && path === '/api/decline') {
    const { id } = body;
    const g = session.gifts.find(x => x.id === id);
    if (!g) return { error: `gift ${id} not found` };
    g.result.accepted = false;
    session.log.push({ ts: new Date().toISOString(), msg: `Отклонён: ${id}` });
    return { ok: true, id };
  }

  // POST /api/grace
  if (method === 'POST' && path === '/api/grace') {
    const { name } = body;
    const t0 = new Trit(0);
    const t1 = t0.grace();
    session.log.push({ ts: new Date().toISOString(), msg: `Благодать → ${name}: ${t0.name} → ${t1.name}` });
    return { name, from: t0.name, to: t1.name };
  }

  // GET /api/graph
  if (method === 'GET' && path === '/api/graph') {
    const nodes = new Set();
    const edges = [];
    for (const [from, list] of (session.graph._edges ?? new Map())) {
      nodes.add(from);
      for (const e of list) {
        nodes.add(e.thankedId);
        edges.push({ from, to: e.thankedId, gift: e.giftId, ts: e.timestamp });
      }
    }
    return {
      nodes: [...nodes],
      edges,
      edgeCount: session.graph._edgeCount ?? 0,
      verticalCount: session.graph._verticalCount ?? 0,
      density: typeof session.graph.density === 'function' ? session.graph.density() : null,
    };
  }

  // GET /api/graph/cycles
  if (method === 'GET' && path === '/api/graph/cycles') {
    const cycles = session.graph.findCycles?.(6) ?? [];
    return { cycles, count: cycles.length };
  }

  // POST /api/logos
  if (method === 'POST' && path === '/api/logos') {
    const { name, principle, physis, telos } = body;
    if (!name) return { error: 'name required' };
    const l = session.logoi.register({ name, principle, physis, telos, bearerType: 'creation' });
    session.log.push({ ts: new Date().toISOString(), msg: `λόγος: ${name}` });
    return l;
  }

  // GET /api/logos
  if (method === 'GET' && path === '/api/logos') {
    return session.logoi.getTree();
  }

  // GET /api/harmony
  if (method === 'GET' && path === '/api/harmony') {
    return session.logoi.getHarmony();
  }

  // POST /api/vm
  if (method === 'POST' && path === '/api/vm') {
    const { program = 'salvation' } = body;
    const vm = new TernaryVM();
    if (program === 'salvation') {
      vm.loadProgram(TernaryVM.salvationProgram());
    }
    const result = vm.run();
    session.log.push({ ts: new Date().toISOString(), msg: `VM: ${program} → acc=${vm.accumulator}` });
    return {
      program,
      steps: result.steps,
      halted: result.halted,
      accumulator: vm.accumulator.toJSON(),
      log: result.log,
    };
  }

  // GET /api/gifts
  if (method === 'GET' && path === '/api/gifts') {
    return session.gifts.map(g => ({
      id: g.id,
      from: g.from,
      to: g.to,
      content: g.content,
      cost: g.cost,
      accepted: g.result.accepted,
      gratitude: g.result.gratitude,
      ts: g.ts,
    }));
  }

  // ── Gift Protocol v0.1 ──────────────────────────────────────
  // POST /gift — принять акт дара по формальному протоколу.
  //
  // Тело: { schema:"gift/v1", from, to, type, weight?, content?, irreversible?, timestamp?, proof? }
  //
  // Отличие от POST /api/gift:
  //   /api/gift — старый API (from/to/content/cost), сессионный.
  //   /gift     — протокольный endpoint: валидирует schema gift/v1,
  //               записывает в W-матрицу (_fedMemory), возвращает
  //               необратимо запечатанный акт + memoryAct для матрицы.
  //
  // κένωσις: принятый дар нельзя отозвать (irreversible:true — аксиома).
  if (method === 'POST' && path === '/gift') {
    const result = GiftValidator.validate(body);
    if (!result.ok) {
      return { ok: false, errors: result.errors };
    }
    const { act } = result;
    // Обновить W-матрицу
    const memAct = GiftValidator.toMemoryAct(act);
    _fedMemory.receive(memAct);
    session.log.push({
      ts: act.timestamp,
      msg: `Дар [gift/v1]: ${act.from} → ${act.to} (${act.type}, w=${act.weight})`,
    });
    return {
      ok: true,
      act,
      memoryAct: memAct,
    };
  }

  // GET /gift/schema — вернуть JSON Schema протокола
  if (method === 'GET' && path === '/gift/schema') {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dir = dirname(fileURLToPath(import.meta.url));
    const schema = JSON.parse(readFileSync(join(__dir, '../protocol/gift-schema.json'), 'utf8'));
    return schema;
  }

  return null;
}

// ── HTML-интерфейс ───────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Онтология Дара</title>
<style>
  :root {
    --bg: #0e0e14;
    --panel: #15151f;
    --border: #2a2a3a;
    --accent: #8b5cf6;
    --accent2: #06b6d4;
    --text: #e2e8f0;
    --dim: #64748b;
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #eab308;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; }

  header { border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 15px; color: var(--accent); }
  header .tagline { color: var(--dim); font-size: 11px; }

  .layout { display: grid; grid-template-columns: 280px 1fr 280px; gap: 0; height: calc(100vh - 45px); }

  .panel { border-right: 1px solid var(--border); overflow-y: auto; }
  .panel:last-child { border-right: none; border-left: 1px solid var(--border); }

  .section { border-bottom: 1px solid var(--border); padding: 12px; }
  .section h2 { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }

  input, select, textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 8px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 12px;
    width: 100%;
    margin-bottom: 4px;
  }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); }

  button {
    background: var(--accent);
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    width: 100%;
    margin-top: 4px;
  }
  button:hover { opacity: 0.85; }
  button.secondary { background: var(--panel); border: 1px solid var(--border); color: var(--text); }
  button.green { background: #166534; }
  button.red { background: #7f1d1d; }

  .status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .stat { background: var(--bg); border: 1px solid var(--border); padding: 8px; border-radius: 4px; }
  .stat .val { font-size: 20px; color: var(--accent); font-weight: bold; }
  .stat .lbl { font-size: 10px; color: var(--dim); }

  .log-entry { padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 11px; color: var(--dim); }
  .log-entry .ts { color: var(--accent2); font-size: 10px; }

  .gift-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px;
    margin-bottom: 6px;
  }
  .gift-card .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .gift-card .id { color: var(--accent); font-size: 10px; }
  .gift-card .status { font-size: 10px; padding: 2px 6px; border-radius: 10px; }
  .status-accepted { background: #14532d; color: var(--green); }
  .status-declined { background: #7f1d1d; color: var(--red); }
  .status-waiting  { background: #422006; color: var(--yellow); }
  .gift-card .route { font-size: 12px; }
  .gift-card .content { font-size: 11px; color: var(--dim); margin-top: 2px; }
  .gift-card .actions { display: flex; gap: 4px; margin-top: 6px; }
  .gift-card .actions button { margin: 0; width: auto; flex: 1; padding: 4px 8px; font-size: 11px; }

  .main-area { display: flex; flex-direction: column; }
  .canvas-area { flex: 1; position: relative; overflow: hidden; }
  svg { width: 100%; height: 100%; }

  .vm-output { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 11px; white-space: pre; overflow-x: auto; }
  .vm-step { display: flex; gap: 8px; }
  .vm-pc { color: var(--accent); min-width: 40px; }
  .vm-action { color: var(--text); }
  .vm-acc { color: var(--accent2); }

  .trit-plus { color: var(--green); }
  .trit-zero { color: var(--dim); }
  .trit-minus { color: var(--red); }

  .tabs { display: flex; border-bottom: 1px solid var(--border); }
  .tab { padding: 8px 14px; cursor: pointer; font-size: 11px; color: var(--dim); border-bottom: 2px solid transparent; }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  .tab-content { display: none; padding: 12px; overflow-y: auto; flex: 1; }
  .tab-content.active { display: block; }

  .logos-tree { font-size: 11px; }
  .logos-node { padding: 2px 0; }
  .logos-name { color: var(--text); }
  .logos-meta { color: var(--dim); }
  .logos-movement-kata { color: var(--green); }
  .logos-movement-para { color: var(--red); }
  .logos-movement-hyper { color: var(--accent); }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
</style>
</head>
<body>

<header>
  <h1>⟁ Онтология Дара</h1>
  <span class="tagline">«Всё из Него, Им и к Нему» (Рим 11:36)</span>
  <span id="season" style="margin-left:auto;color:var(--accent2);font-size:11px"></span>
</header>

<div class="layout">

<!-- ── Левая панель ── -->
<div class="panel">

  <div class="section">
    <h2>Статус</h2>
    <div class="status-grid" id="stats">
      <div class="stat"><div class="val" id="st-persons">0</div><div class="lbl">Лиц</div></div>
      <div class="stat"><div class="val" id="st-gifts">0</div><div class="lbl">Даров</div></div>
      <div class="stat"><div class="val" id="st-accepted">0</div><div class="lbl">Принято</div></div>
      <div class="stat"><div class="val" id="st-edges">0</div><div class="lbl">Благодарностей</div></div>
    </div>
  </div>

  <div class="section">
    <h2>Лицо</h2>
    <input id="p-name" placeholder="Имя" />
    <input id="p-calling" placeholder="Призвание (необяз.)" />
    <button onclick="registerPerson()">Зарегистрировать лицо</button>
  </div>

  <div class="section">
    <h2>Дар</h2>
    <input id="g-from" placeholder="От кого" />
    <input id="g-to" placeholder="Кому" />
    <input id="g-content" placeholder="Что дарится" />
    <input id="g-cost" type="number" value="1" placeholder="Цена (кеносис)" />
    <button onclick="offerGift()">⟶ Предложить дар</button>
  </div>

  <div class="section">
    <h2>Благодать / Кеносис</h2>
    <input id="grace-name" placeholder="Имя лица" />
    <button onclick="applyGrace()" class="green">✦ Благодать</button>
    <button onclick="applyKenosis()" class="secondary" style="margin-top:4px">↓ Кеносис</button>
  </div>

  <div class="section">
    <h2>λόγος</h2>
    <input id="l-name" placeholder="Имя λόγος" />
    <input id="l-telos" placeholder="Цель (τέλος)" />
    <button onclick="registerLogos()">Зарегистрировать λόγος</button>
  </div>

  <div class="section">
    <h2>TernaryVM</h2>
    <button onclick="runVM('salvation')">▶ Программа Спасения</button>
  </div>

</div>

<!-- ── Центральная панель ── -->
<div class="main-area">

  <div class="tabs">
    <div class="tab active" onclick="switchTab('graph')">Граф</div>
    <div class="tab" onclick="switchTab('gifts')">Дары</div>
    <div class="tab" onclick="switchTab('vm')">VM</div>
    <div class="tab" onclick="switchTab('logos')">Λόγοι</div>
  </div>

  <div class="tab-content active" id="tab-graph">
    <div id="graph-info" style="font-size:11px;color:var(--dim);margin-bottom:8px"></div>
    <svg id="graph-svg">
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
          <polygon points="0 0, 6 2, 0 4" fill="#8b5cf6" />
        </marker>
      </defs>
      <g id="graph-g"></g>
    </svg>
  </div>

  <div class="tab-content" id="tab-gifts">
    <div id="gifts-list"></div>
  </div>

  <div class="tab-content" id="tab-vm">
    <div id="vm-output"></div>
  </div>

  <div class="tab-content" id="tab-logos">
    <div id="logos-harmony" style="margin-bottom:12px;font-size:11px"></div>
    <div id="logos-tree" class="logos-tree"></div>
  </div>

</div>

<!-- ── Правая панель ── -->
<div class="panel">

  <div class="section">
    <h2>Журнал</h2>
    <div id="log-entries"></div>
  </div>

  <div class="section">
    <h2>Лица</h2>
    <div id="persons-list" style="font-size:11px"></div>
  </div>

  <div class="section">
    <h2>Циклы (перихоресис)</h2>
    <button onclick="loadCycles()" class="secondary">Найти циклы</button>
    <div id="cycles-list" style="font-size:11px;margin-top:8px"></div>
  </div>

</div>

</div>

<script>
const api = async (method, path, body) => {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};

const $ = id => document.getElementById(id);
const val = id => $(id)?.value?.trim() || '';

// ── Обновить UI ──────────────────────────────────────────────

async function refresh() {
  const status = await api('GET', '/status');
  $('st-persons').textContent = status.persons;
  $('st-gifts').textContent = status.gifts;
  $('st-accepted').textContent = status.accepted;
  $('st-edges').textContent = status.graphEdges;

  // Лог
  const logEl = $('log-entries');
  logEl.innerHTML = (status.log || []).slice().reverse().map(e =>
    '<div class="log-entry"><span class="ts">' + e.ts.slice(11,19) + '</span> ' + e.msg + '</div>'
  ).join('');

  // Лица
  const ps = await api('GET', '/persons');
  $('persons-list').innerHTML = ps.map(p =>
    '<div style="padding:3px 0;border-bottom:1px solid var(--border)">' +
    '<span style="color:var(--accent)">' + p.id + '</span> ' + p.name +
    (p.calling ? ' <span style="color:var(--dim)">(' + p.calling + ')</span>' : '') +
    ' <span style="color:var(--dim)">↑' + p.giftsGiven + ' ↓' + p.giftsReceived + '</span>' +
    '</div>'
  ).join('');

  loadGraph();
  loadGifts();
  loadLogos();
}

// ── Граф ─────────────────────────────────────────────────────

async function loadGraph() {
  const g = await api('GET', '/graph');
  $('graph-info').textContent =
    'Вершин: ' + g.nodes.length + '  |  Рёбер: ' + g.edgeCount +
    (g.density != null ? '  |  Плотность: ' + g.density.toFixed(2) : '');

  const svg = $('graph-svg');
  const W = svg.clientWidth || 600;
  const H = svg.clientHeight || 400;
  const gEl = $('graph-g');
  gEl.innerHTML = '';

  if (!g.nodes.length) {
    gEl.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#2a2a3a" font-size="14" dy=".3em">Граф пуст</text>';
    return;
  }

  // Расположение узлов по кругу
  const pos = {};
  g.nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / g.nodes.length - Math.PI / 2;
    const r = Math.min(W, H) * 0.35;
    pos[n] = { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle) };
  });

  // Рёбра
  for (const e of g.edges) {
    const s = pos[e.from], t = pos[e.to];
    if (!s || !t) continue;
    const dx = t.x - s.x, dy = t.y - s.y;
    const len = Math.sqrt(dx*dx+dy*dy) || 1;
    const ex = t.x - dx/len*18, ey = t.y - dy/len*18;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', s.x); line.setAttribute('y1', s.y);
    line.setAttribute('x2', ex); line.setAttribute('y2', ey);
    line.setAttribute('stroke', '#8b5cf688');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('marker-end', 'url(#arrow)');
    gEl.appendChild(line);
  }

  // Узлы
  for (const n of g.nodes) {
    const p = pos[n];
    const g2 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', p.x); circle.setAttribute('cy', p.y);
    circle.setAttribute('r', 18);
    circle.setAttribute('fill', '#1e1e2e');
    circle.setAttribute('stroke', '#8b5cf6');
    circle.setAttribute('stroke-width', '1.5');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', p.x); text.setAttribute('y', p.y + 1);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('fill', '#e2e8f0');
    text.setAttribute('font-size', '10');
    text.textContent = n.length > 6 ? n.slice(0,6) + '…' : n;
    g2.appendChild(circle); g2.appendChild(text);
    gEl.appendChild(g2);
  }
}

// ── Дары ─────────────────────────────────────────────────────

async function loadGifts() {
  const gifts = await api('GET', '/gifts');
  $('gifts-list').innerHTML = gifts.slice().reverse().map(g => {
    const status = g.accepted === true ? 'accepted' : g.accepted === false ? 'declined' : 'waiting';
    const statusText = g.accepted === true ? '✓ принят' : g.accepted === false ? '✗ отклонён' : '⏳ ожидание';
    return '<div class="gift-card">' +
      '<div class="header"><span class="id">' + g.id + '</span>' +
      '<span class="status status-' + status + '">' + statusText + '</span></div>' +
      '<div class="route">' + g.from + ' → ' + (g.to || '?') + '</div>' +
      '<div class="content">«' + g.content + '» | цена: ' + g.cost + '</div>' +
      (status === 'waiting' ? '<div class="actions">' +
        '<button class="green" onclick="acceptGift(\'' + g.id + '\')">Принять</button>' +
        '<button class="red" onclick="declineGift(\'' + g.id + '\')">Отклонить</button>' +
        '</div>' : '') +
      '</div>';
  }).join('') || '<div style="color:var(--dim);font-size:11px">Даров нет</div>';
}

// ── λόγοι ─────────────────────────────────────────────────────

async function loadLogos() {
  const tree = await api('GET', '/logos');
  const harmony = await api('GET', '/harmony');
  $('logos-harmony').innerHTML =
    'κατὰ: <span style="color:var(--green)">' + harmony.kataPhysin + '</span>  ' +
    'παρὰ: <span style="color:var(--red)">' + harmony.paraPhysin + '</span>  ' +
    'ὑπὲρ: <span style="color:var(--accent)">' + harmony.hyperPhysin + '</span>  ' +
    'Всего: ' + harmony.total + '<br>' +
    (harmony.observations || []).map(o => '<span style="color:var(--dim)">' + o + '</span>').join('<br>');

  function renderNode(node, depth) {
    const indent = '&nbsp;'.repeat(depth * 4);
    const mov = node.movement || '';
    const movClass = mov === 'kata_physin' ? 'logos-movement-kata' :
                     mov === 'para_physin' ? 'logos-movement-para' :
                     mov === 'hyper_physin' ? 'logos-movement-hyper' : '';
    let html = '<div class="logos-node">' + indent +
      '<span class="logos-name">' + node.name + '</span>' +
      (mov ? ' <span class="logos-meta ' + movClass + '">[' + mov.replace('_physin','') + ']</span>' : '') +
      (node.telos ? ' <span class="logos-meta">→ ' + node.telos + '</span>' : '') +
      '</div>';
    for (const c of (node.children || [])) html += renderNode(c, depth + 1);
    return html;
  }
  $('logos-tree').innerHTML = renderNode(tree.root, 0);
}

// ── Циклы ─────────────────────────────────────────────────────

async function loadCycles() {
  const { cycles } = await api('GET', '/graph/cycles');
  $('cycles-list').innerHTML = cycles.length === 0
    ? '<span style="color:var(--dim)">Перихоретических циклов нет</span>'
    : cycles.map((c, i) => '<div style="color:var(--accent2);padding:3px 0">' + (i+1) + '. ' + c.join(' → ') + '</div>').join('');
}

// ── VM ────────────────────────────────────────────────────────

async function runVM(program) {
  const r = await api('POST', '/vm', { program });
  switchTab('vm');
  $('vm-output').innerHTML =
    '<div style="color:var(--accent);margin-bottom:8px">▶ ' + program + ' | шагов: ' + r.steps + '</div>' +
    r.log.map(s =>
      '<div class="vm-step">' +
      '<span class="vm-pc">PC=' + s.pc + '</span>' +
      '<span class="vm-action">' + s.action + '</span>' +
      '<span class="vm-acc">' + s.acc + '</span></div>'
    ).join('') +
    '<div style="margin-top:8px;color:var(--accent2)">Аккумулятор: ' +
    formatTryte(r.accumulator) + '</div>' +
    (r.accumulator.health === 3 ? '<div style="color:var(--green);margin-top:4px">✦ ὑπὲρ φύσιν — полное обожение!</div>' :
     r.accumulator.health === 0 ? '<div style="color:var(--dim);margin-top:4px">κατὰ φύσιν</div>' :
     '<div style="color:var(--red);margin-top:4px">παρὰ φύσιν</div>');
  refresh();
}

function formatTryte(t) {
  const fmt = v => v.short === '+' ? '<span class="trit-plus">+</span>' :
                   v.short === '-' ? '<span class="trit-minus">-</span>' :
                   '<span class="trit-zero">0</span>';
  return '[' + fmt(t.logos) + fmt(t.energy) + fmt(t.relation) + ']';
}

// ── Действия ─────────────────────────────────────────────────

async function registerPerson() {
  const name = val('p-name');
  if (!name) return;
  await api('POST', '/person', { name, calling: val('p-calling') });
  $('p-name').value = ''; $('p-calling').value = '';
  refresh();
}

async function offerGift() {
  const from = val('g-from'), to = val('g-to'), content = val('g-content');
  if (!from || !content) return;
  await api('POST', '/gift', { from, to, content, cost: Number($('g-cost').value) || 1 });
  $('g-from').value=''; $('g-to').value=''; $('g-content').value='';
  switchTab('gifts');
  refresh();
}

async function acceptGift(id) {
  await api('POST', '/accept', { id });
  refresh();
}

async function declineGift(id) {
  await api('POST', '/decline', { id });
  refresh();
}

async function applyGrace() {
  const name = val('grace-name');
  if (!name) return;
  await api('POST', '/grace', { name });
  refresh();
}

async function applyKenosis() {
  const name = val('grace-name');
  if (!name) return;
  const t = { from: 'ὑπὲρ φύσιν', to: 'κατὰ φύσιν' };
  alert(name + ': кеносис\n' + t.from + ' → ' + t.to);
}

async function registerLogos() {
  const name = val('l-name'), telos = val('l-telos');
  if (!name) return;
  await api('POST', '/logos', { name, telos });
  $('l-name').value=''; $('l-telos').value='';
  switchTab('logos');
  refresh();
}

// ── Табы ─────────────────────────────────────────────────────

function switchTab(id) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const tabs = ['graph','gifts','vm','logos'];
    t.classList.toggle('active', tabs[i] === id);
  });
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  $('tab-' + id)?.classList.add('active');
}

// ── Init ──────────────────────────────────────────────────────

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

// ── HTTP сервер ──────────────────────────────────────────────

const [,, ...cliArgs] = process.argv;
const portArg = cliArgs.find((_, i) => cliArgs[i - 1] === '--port');
const PORT = parseInt(portArg || process.env.PORT || '3777');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // HTML
  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  // API
  if (path.startsWith('/api')) {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    }

    const apiPath = path.replace('/api', '') || '/status';
    const result = handleApi(req.method, '/api' + apiPath, body);

    if (result !== null) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result, null, 2));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', path }));
    }
    return;
  }

  // Federation
  if (path.startsWith('/federation')) {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    }

    const json = (obj, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj, null, 2));
    };

    // POST /federation/connect — рукопожатие
    if (req.method === 'POST' && path === '/federation/connect') {
      try {
        const descriptor = _federation.acceptHandshake(body);
        json(descriptor);
      } catch (e) {
        json({ error: e.message }, 400);
      }
      return;
    }

    // GET /federation/peers — список общин
    if (req.method === 'GET' && path === '/federation/peers') {
      json({ peers: _federation.peers(), count: _federation.peerCount() });
      return;
    }

    // POST /federation/gift — принять межобщинный акт
    if (req.method === 'POST' && path === '/federation/gift') {
      const result = _federation.receiveFromPeer(body);
      json(result);
      return;
    }

    // GET /federation/matrix — экспорт матрицы
    if (req.method === 'GET' && path === '/federation/matrix') {
      json(_federation.matrixSnapshot());
      return;
    }

    // GET /federation/global — глобальный тензор
    if (req.method === 'GET' && path === '/federation/global') {
      const paschaBoost = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('pascha') === '1';
      const tensor = await _federation.computeGlobalTensor({ paschaBoost });
      json(tensor);
      return;
    }

    // GET /federation/pascha — пасхальная синхронизация
    if (req.method === 'GET' && path === '/federation/pascha') {
      const year = parseInt(new URL(req.url, `http://localhost:${PORT}`).searchParams.get('year') ?? new Date().getFullYear());
      const result = await _federation.onPascha(year);
      json(result);
      return;
    }

    json({ error: 'not found', path }, 404);
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n\x1b[35m╔══════════════════════════════════════════════════╗`);
  console.log(`║  ⟁ Онтология Дара — сервер запущен             ║`);
  console.log(`║  http://localhost:${PORT}                         ║`);
  console.log(`╚══════════════════════════════════════════════════╝\x1b[0m\n`);
});
