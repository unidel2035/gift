/**
 * gift-portal-server.mjs — Сервер Скинии Дара
 *
 * Запуск: node utils/gift-portal-server.mjs
 * Порт: 3700 (или PORT=XXXX)
 *
 * API:
 *   GET  /          → public/gift-portal.html
 *   GET  /api/matrix → data/sacred-history-W.json
 *   GET  /api/acts   → data/act-index.json
 *   GET  /api/anamnesis → прокси к серверу анамнезиса
 *   GET  /field-toroid.html → ../fpga/simulator/field-toroid.html
 */

import { createServer }          from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join }         from 'node:path';
import { fileURLToPath }         from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');
const PORT  = parseInt(process.env.PORT || '3700');
const ANAMNESIS_URL = process.env.ANAMNESIS_URL || 'http://173.249.2.184:8089';

function serveFile(res, path, contentType) {
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

function serveJSON(res, path) {
  serveFile(res, path, 'application/json; charset=utf-8');
}

function serveHTML(res, path) {
  serveFile(res, path, 'text/html; charset=utf-8');
}

async function proxyAnamnesis(res, subpath) {
  try {
    const r = await fetch(`${ANAMNESIS_URL}${subpath}`, { signal: AbortSignal.timeout(5000) });
    const body = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch (e) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/' || url === '/gift-portal.html') {
    return serveHTML(res, join(ROOT, 'public', 'gift-portal.html'));
  }
  if (url === '/api/matrix') {
    return serveJSON(res, join(ROOT, 'data', 'sacred-history-W.json'));
  }
  if (url === '/api/acts') {
    return serveJSON(res, join(ROOT, 'data', 'act-index.json'));
  }
  if (url === '/api/insights') {
    return serveJSON(res, join(ROOT, 'data', 'insights.json'));
  }
  if (url.startsWith('/api/anamnesis')) {
    return proxyAnamnesis(res, url.replace('/api/anamnesis', '') || '/summary');
  }
  // FPGA visualizers
  if (url === '/field-toroid.html') {
    return serveHTML(res, join(ROOT, '../fpga/simulator/field-toroid.html'));
  }
  if (url === '/field-3d.html') {
    return serveHTML(res, join(ROOT, '../fpga/simulator/field-3d.html'));
  }
  // Static from public/
  const pub = join(ROOT, 'public', url);
  if (existsSync(pub) && !pub.includes('..')) {
    const ct = url.endsWith('.css') ? 'text/css' :
               url.endsWith('.js')  ? 'application/javascript' :
               url.endsWith('.json')? 'application/json' : 'text/plain';
    return serveFile(res, pub, ct);
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✦ Скиния Дара открыта`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\n  /api/matrix    — W-матрица`);
  console.log(`  /api/acts      — лента актов`);
  console.log(`  /api/anamnesis — сервер памяти`);
  console.log(`  /field-toroid.html — поле Лосинца\n`);
});
