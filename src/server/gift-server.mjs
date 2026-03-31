/**
 * gift-server.mjs — HTTP сервер Gift Protocol v1.0
 *
 * Реализует Gift Protocol как живой API.
 * Без внешних зависимостей — только Node.js http.
 *
 * Запуск:
 *   node src/server/gift-server.mjs [--port=3333]
 *
 * Протокол: GIFT-PROTOCOL.md
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { GiftMemory } from '../core/GiftMemory.js';
import { CommunityDiagnostic } from '../core/GiftOptimizer.js';

const PORT     = parseInt(process.argv.find(a => a.startsWith('--port='))?.replace('--port=', '') ?? '3333');
const SNAP_PATH = './data/sacred-history-W.json';

// ── Загрузка / сохранение матрицы ─────────────────────────────────────────

function loadMemory() {
  try {
    const snap = JSON.parse(readFileSync(SNAP_PATH, 'utf8'));
    return GiftMemory.fromSnapshot(snap);
  } catch {
    return new GiftMemory(['_koinon', '_abyss']);
  }
}

function saveMemory(mem) {
  writeFileSync(SNAP_PATH, JSON.stringify(mem.snapshot(), null, 2), 'utf8');
}

let mem = loadMemory();

// ── HTTP роутер ───────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data, null, 2));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function route(req, res) {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const path   = url.pathname;
  const method = req.method;

  // ── CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // ── POST /gift ─────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/gift') {
    return body(req).then(act => {
      if (!act.giverId || !act.receiverId || !act.type) {
        return json(res, { error: 'giverId, receiverId, type обязательны' }, 400);
      }
      mem.receive({ ...act, irreversible: true });
      saveMemory(mem);
      json(res, {
        ok: true,
        actsCount:   mem.actsCount,
        giverTotal:  mem.totalGiven(act.giverId),
      });
    }).catch(e => json(res, { error: e.message }, 400));
  }

  // ── GET /anamnesis/:personId ───────────────────────────────────────────
  const anam = path.match(/^\/anamnesis\/(.+)$/);
  if (method === 'GET' && anam) {
    const personId = decodeURIComponent(anam[1]);
    const diag     = new CommunityDiagnostic(mem.snapshot());
    const present  = mem.makePresent({ giverId: personId });
    json(res, {
      personId,
      totalGiven:    mem.totalGiven(personId),
      totalReceived: mem.totalReceived(personId),
      surplus:       mem.totalGiven(personId) - mem.totalReceived(personId),
      theosis:       diag.theosisIndex(personId),
      receivers:     present.decoded.receivers,
      givers:        present.decoded.givers,
    });
    return;
  }

  // ── GET /theosis/:personId ────────────────────────────────────────────
  const theos = path.match(/^\/theosis\/(.+)$/);
  if (method === 'GET' && theos) {
    const personId = decodeURIComponent(theos[1]);
    const diag     = new CommunityDiagnostic(mem.snapshot());
    const index    = diag.theosisIndex(personId);
    const level    = index < 0.1 ? 'κατάνυξις'
                   : index < 0.4 ? 'πρᾶξις'
                   : index < 0.7 ? 'θεωρία'
                   :               'θέωσις';
    json(res, { personId, index, level, percent: +(index * 100).toFixed(1) });
    return;
  }

  // ── GET /community ────────────────────────────────────────────────────
  if (method === 'GET' && path === '/community') {
    const diag = new CommunityDiagnostic(mem.snapshot());
    const snap = mem.snapshot();
    json(res, {
      actsCount:  mem.actsCount,
      persons: snap.persons
        .filter(p => !['_abyss'].includes(p))
        .map(p => ({
          id:       p,
          theosis:  +(diag.theosisIndex(p) * 100).toFixed(1),
          given:    +mem.totalGiven(p).toFixed(1),
          received: +mem.totalReceived(p).toFixed(1),
          surplus:  +(mem.totalGiven(p) - mem.totalReceived(p)).toFixed(1),
        }))
        .sort((a, b) => b.theosis - a.theosis),
      isolated:   diag.mostIsolated(5).map(x => x.person),
      highKenosis: diag.highestSurplus(3).map(x => x.person),
    });
    return;
  }

  // ── GET /makePresent ──────────────────────────────────────────────────
  if (method === 'GET' && path === '/makePresent') {
    const giverId    = url.searchParams.get('giverId')    ?? undefined;
    const receiverId = url.searchParams.get('receiverId') ?? undefined;
    const result     = mem.makePresent({ giverId, receiverId });
    json(res, {
      pattern:  result.pattern,
      givers:   result.decoded.givers,
      receivers: result.decoded.receivers,
      witnesses: result.decoded.witnesses,
      energy:   result.energy,
    });
    return;
  }

  // ── GET / — описание протокола ────────────────────────────────────────
  if (method === 'GET' && path === '/') {
    json(res, {
      protocol: 'Gift Protocol v1.0',
      spec:     'https://github.com/unidel/gift/blob/main/GIFT-PROTOCOL.md',
      axioms: [
        'Дар необратим',
        'Лицо — не аккаунт',
        'Память — анамнезис, не лог',
        'Соборность — не граф',
        'Время тяжелее денег',
      ],
      endpoints: {
        'POST /gift':                   'записать акт дара',
        'GET  /anamnesis/:personId':     'живая память лица',
        'GET  /theosis/:personId':       'индекс обожения',
        'GET  /community':              'состояние общины',
        'GET  /makePresent':            'анамнезис-резонанс',
      },
      actsCount: mem.actsCount,
    });
    return;
  }

  json(res, { error: 'not found' }, 404);
}

// ── Запуск ────────────────────────────────────────────────────────────────

const server = createServer(route);
server.listen(PORT, () => {
  console.log(`Gift Protocol v1.0`);
  console.log(`Слушаю: http://localhost:${PORT}`);
  console.log(`Лиц: ${mem.n} | Актов: ${mem.actsCount}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /gift`);
  console.log(`  GET  /anamnesis/:personId`);
  console.log(`  GET  /theosis/:personId`);
  console.log(`  GET  /community`);
  console.log(`  GET  /makePresent?giverId=X`);
});
