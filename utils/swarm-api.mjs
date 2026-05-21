#!/usr/bin/env node
/**
 * swarm-api.mjs — HTTP API для Swarm Dashboard
 *
 * Endpoints:
 *   GET /api/swarm/status  — полный статус (сессии, конфликты, касания, W, суверенитет)
 *   GET /api/swarm/sessions
 *   GET /api/swarm/conflicts
 *   GET /api/swarm/intentions
 *   GET /api/swarm/touches
 *   GET /api/swarm/sovereignty
 *
 * Порт: 8093 (SWARM_API_PORT)
 */

import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.SWARM_API_PORT || 8093;

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function getSwarmStatus() {
  const status = { ts: Date.now() };

  try {
    // Sessions
    const { listActiveSessions } = await import(resolve(ROOT, 'utils/gift-swarm.mjs'));
    status.sessions = listActiveSessions();

    // Conflicts
    const { detectConflicts } = await import(resolve(ROOT, 'utils/gift-swarm.mjs'));
    status.conflicts = detectConflicts();

    // Recent touches
    const { readTouches } = await import(resolve(ROOT, 'utils/gift-swarm.mjs'));
    const touches = readTouches(60000);
    status.recentTouches = touches.slice(-20);
    status.touchRate = touches.length; // touches per minute

    // Intentions
    if (existsSync(resolve(ROOT, 'utils/gift-swarm-intent.mjs'))) {
      try {
        const { allIntentions } = await import(resolve(ROOT, 'utils/gift-swarm-intent.mjs'));
        status.intentions = allIntentions();
      } catch {}
    }

    // W-matrix top threads
    try {
      const SNAP = resolve(ROOT, 'data/sacred-history-W.json');
      if (existsSync(SNAP)) {
        const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
        const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
        const mem = GiftMemory.fromSnapshot(snap);
        status.topThreads = mem.heaviest(6).filter(e => e.weight >= 1);
        status.wEnergy = mem.totalGiven('_claude').toFixed(1);
      }
    } catch {}

    // Sovereignty
    if (existsSync(resolve(ROOT, 'utils/gift-sovereignty.mjs'))) {
      try {
        const { computeSovereignty } = await import(resolve(ROOT, 'utils/gift-sovereignty.mjs'));
        status.sovereignty = computeSovereignty();
      } catch {}
    }
  } catch {}

  return status;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
    res.end();
    return;
  }

  if (url.pathname === '/api/swarm/status') {
    const status = await getSwarmStatus();
    json(res, status);
    return;
  }

  if (url.pathname === '/api/swarm/sessions') {
    const { listActiveSessions } = await import(resolve(ROOT, 'utils/gift-swarm.mjs'));
    json(res, listActiveSessions());
    return;
  }

  if (url.pathname === '/api/swarm/conflicts') {
    const { detectConflicts } = await import(resolve(ROOT, 'utils/gift-swarm.mjs'));
    json(res, detectConflicts());
    return;
  }

  if (url.pathname === '/api/swarm/intentions') {
    const { allIntentions } = await import(resolve(ROOT, 'utils/gift-swarm-intent.mjs'));
    json(res, allIntentions());
    return;
  }

  if (url.pathname === '/api/swarm/touches') {
    const { readTouches } = await import(resolve(ROOT, 'utils/gift-swarm.mjs'));
    json(res, readTouches(120000));
    return;
  }

  if (url.pathname === '/api/swarm/sovereignty') {
    const { computeSovereignty } = await import(resolve(ROOT, 'utils/gift-sovereignty.mjs'));
    json(res, computeSovereignty());
    return;
  }

  if (url.pathname === '/' || url.pathname === '/dashboard') {
    const html = readFileSync(resolve(ROOT, 'public/swarm-dashboard.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`  ⛬ Swarm API: http://localhost:${PORT}`);
  console.log(`    Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`    Status:    http://localhost:${PORT}/api/swarm/status`);
});
