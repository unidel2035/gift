#!/usr/bin/env node
/**
 * coop-sync-server — живое поле присутствия МЕЖДУ машинами (дыра №1 протокола организма).
 *
 * `.swarm` держит присутствие на одной машине. Этот relay даёт общий heartbeat всему телу:
 * каждый кентавр (своя консоль, своя машина) шлёт сюда heartbeat, и `gift space` на любой
 * машине видит, кто-где-кодит в реальном времени — не через федерацию репозиториев (архив),
 * а через живое настоящее (παρουσία). Присутствие эфемерно: TTL, не хранит историю.
 *
 * Это НЕ память (та — в W, необратима). Это нервная синапса настоящего: кто здесь сейчас.
 *
 * Эндпоинты:
 *   POST /heartbeat  {agent, organ?, machine?, intents?:[{files}]}  → {ok, present:[...]}
 *   GET  /present                                                    → {present:[...], now}
 *   POST /leave      {agent}                                         → {ok}
 *   GET  /health                                                     → {ok, count, ttlMs}
 *
 * Запуск:
 *   node utils/coop-sync-server.mjs                 # порт 8090
 *   COOP_SYNC_PORT=9000 node utils/coop-sync-server.mjs
 *
 * Клиенты указывают COOP_SYNC_URL=http://host:8090 — см. utils/coop-presence.mjs.
 * Деплой на сервер общины (рядом с ботом) — отдельный шаг (под рукой Дионисия).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.COOP_SYNC_PORT) || 8090;
const TTL_MS = Number(process.env.COOP_TTL_MS) || 120_000; // живой, если heartbeat свежее 120с

// In-memory поле присутствия. Эфемерно по замыслу: рестарт = чистое настоящее.
const field = new Map(); // agent → { agent, organ, machine, intents, heartbeat }

export function upsert(rec, now = Date.now()) {
  const agent = String(rec.agent || '').trim();
  if (!agent) return null;
  const entry = {
    agent,
    organ: rec.organ || null,
    machine: rec.machine || null,
    intents: Array.isArray(rec.intents) ? rec.intents : [],
    heartbeat: now,
  };
  field.set(agent, entry);
  return entry;
}

export function present(now = Date.now()) {
  const live = [];
  for (const [agent, e] of field) {
    if (now - e.heartbeat > TTL_MS) { field.delete(agent); continue; } // подмёл протухших
    live.push({ ...e, ageMs: now - e.heartbeat });
  }
  return live.sort((a, b) => b.heartbeat - a.heartbeat);
}

export function remove(agent) { return field.delete(agent); }
export function _reset() { field.clear(); } // для тестов

// ── HTTP ──────────────────────────────────────────────────────────────
function json(res, code, obj) {
  const d = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(d) });
  res.end(d);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export function createCoopServer() {
  return createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && u.pathname === '/health') {
        return json(res, 200, { ok: true, count: present().length, ttlMs: TTL_MS });
      }
      if (req.method === 'GET' && u.pathname === '/present') {
        return json(res, 200, { present: present(), now: Date.now() });
      }
      if (req.method === 'POST' && u.pathname === '/heartbeat') {
        const body = await readBody(req);
        const e = upsert(body);
        if (!e) return json(res, 400, { ok: false, error: 'нет agent' });
        return json(res, 200, { ok: true, present: present() });
      }
      if (req.method === 'POST' && u.pathname === '/leave') {
        const body = await readBody(req);
        remove(String(body.agent || ''));
        return json(res, 200, { ok: true });
      }
      json(res, 404, { ok: false, error: 'not found' });
    } catch (e) { json(res, 500, { ok: false, error: e.message }); }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createCoopServer();
  server.listen(PORT, () => console.log(`coop-sync · поле присутствия · http://localhost:${PORT} · TTL ${TTL_MS / 1000}с`));
}
