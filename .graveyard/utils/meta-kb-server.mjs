#!/usr/bin/env node
/**
 * meta-kb-server.mjs — Сервер прототипа Мета КБ для НТИ (20 июня)
 *
 * Статический HTML + REST API на живых данных REG/Zulip/Shard.
 * Загружает демо-данные при старте.
 *
 * Порт: 8090
 */

import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRONEDOC = resolve(ROOT, '..', 'dronedoc2026');
const PORT = process.env.META_KB_PORT || 8090;

// ── Загрузка данных ─────────────────────────────────────────────────────────

let reg = null;
let zulip = null;

async function loadData() {
  // REG
  const { DecisionGraph } = await import(resolve(ROOT, 'src/reg/DecisionGraph.js'));
  reg = new DecisionGraph();
  // Load demo if empty
  if (reg.decisions.length === 0) {
    // Auto-populate with demo data
    const d1 = reg.recordDecision({ project:'БПЛА-5кг', domain:'aerodynamics', title:'Профиль крыла CLARK-Y', description:'Выбран для подъёмной силы 5 кг на скорости 15 м/с. Расчётный Су = 0.45.', madeBy:'Петров', team:['Петров','Иванов'], verdict:'decided', weight:4 });
    const d2 = reg.recordDecision({ project:'БПЛА-5кг', domain:'aerodynamics', title:'Профиль NACA 2412 (отклонено)', description:'Слишком большое лобовое сопротивление на целевой скорости.', madeBy:'Иванов', team:['Петров','Иванов'], verdict:'rejected', weight:2 });
    const d3 = reg.recordDecision({ project:'БПЛА-5кг', domain:'materials', title:'Углепластик 3K для крыла', description:'Вес 340г, прочность 450 МПа. Проблема: расслоение на 4-м часу вибрации (120 Hz).', madeBy:'Сидоров', team:['Сидоров','Петров'], verdict:'decided', weight:3 });
    const d4 = reg.recordDecision({ project:'БПЛА-5кг', domain:'materials', title:'Стеклопластик (отклонено)', description:'Вес 520г — превышает бюджет массы на крыло.', madeBy:'Сидоров', team:['Сидоров'], verdict:'rejected', weight:1 });
    const d5 = reg.recordDecision({ project:'БПЛА-5кг', domain:'propulsion', title:'Двигатель X450 900KV', description:'Выбран для взлётной массы 5кг. Проблема: резонанс с углепластиковым крылом на 3000 RPM.', madeBy:'Козлов', team:['Козлов','Петров'], verdict:'decided', weight:3 });
    const d6 = reg.recordDecision({ project:'БПЛА-5кг', domain:'propulsion', title:'Винт 12x6 (отклонено)', description:'Слишком большой крутящий момент для X450. Перегрев.', madeBy:'Козлов', team:['Козлов'], verdict:'rejected', weight:1 });
    const d7 = reg.recordDecision({ project:'БПЛА-5кг', domain:'avionics', title:'Полетный контроллер Cube Orange+', description:'Стандарт НТИ. ArduPilot 4.5. Вес 73г.', madeBy:'Петров', team:['Петров','Козлов'], verdict:'decided', weight:5 });
    reg.linkDecisions(d1.id, d2.id, 'supersedes');
    reg.linkDecisions(d3.id, d4.id, 'supersedes');
    reg.linkDecisions(d5.id, d6.id, 'supersedes');
    reg.linkDecisions(d1.id, d3.id, 'depends_on');
    reg.linkDecisions(d3.id, d5.id, 'conflicts_with');
    reg.linkDecisions(d1.id, d5.id, 'compatible_with');
  }

  // Zulip
  const zmod = await import(resolve(ROOT, 'utils/gift-zulip.mjs'));
  zulip = zmod;
  if (zmod.listStreams().length === 0) {
    zmod.createStream('aerodynamics', 'Аэродинамика и профили');
    zmod.createStream('materials', 'Материалы и композиты');
    zmod.createStream('propulsion', 'Силовые установки');
    zmod.createStream('avionics', 'Авионика и управление');
    zmod.createTopic('aerodynamics', 'CLARK-Y-profile', 'Петров');
    zmod.createTopic('aerodynamics', 'NACA-rejection', 'Иванов');
    zmod.createTopic('materials', 'carbon-3k-tests', 'Сидоров');
    zmod.createTopic('materials', 'delamination-problem', 'Петров');
    zmod.createTopic('propulsion', 'X450-resonance', 'Козлов');
    zmod.createTopic('avionics', 'Cube-Orange-setup', 'Петров');
    zmod.postMessage('aerodynamics', 'CLARK-Y-profile', 'Расчёт показывает Су=0.45 на скорости 15 м/с. Подходит для 5кг.', 'Петров');
    zmod.postMessage('aerodynamics', 'CLARK-Y-profile', 'Проверил CFD — ламинарный обрыв на 40% хорды. Нужна турбулизация.', 'Иванов');
    zmod.postMessage('aerodynamics', 'NACA-rejection', 'NACA 2412 даёт Сх на 15% выше чем CLARK-Y. Отклоняем.', 'Иванов');
    zmod.postMessage('materials', 'carbon-3k-tests', 'Углепластик 3K: прочность 450 МПа, вес 340г/м². Проходит.', 'Сидоров');
    zmod.postMessage('materials', 'carbon-3k-tests', 'Ориентация волокон ±45° — максимальная жёсткость на кручение.', 'Сидоров');
    zmod.postMessage('materials', 'delamination-problem', 'На 4-м часу виброиспытаний — расслоение у корня. Частота 120 Hz.', 'Петров');
    zmod.postMessage('materials', 'delamination-problem', 'Усилить корневую зону дополнительным слоем 0/90.', 'Сидоров');
    zmod.postMessage('propulsion', 'X450-resonance', 'Двигатель X450 на 3000 RPM — резонанс с углепластиком. Амплитуда 2.3мм.', 'Козлов');
    zmod.postMessage('propulsion', 'X450-resonance', 'Варианты: (1) демпфер, (2) другой материал, (3) ограничение RPM до 2500.', 'Козлов');
    zmod.postMessage('avionics', 'Cube-Orange-setup', 'Cube Orange+ прошит ArduPilot 4.5. Вес 73г. Совместим с X450 по ШИМ.', 'Петров');
  }

  console.log(\`  REG: ${reg.decisions.length} решений, ${reg.links.length} связей\`);
  console.log(\`  Zulip: ${zmod.listStreams().length} стримов, ${zmod.search('').length} сообщений\`);
}

// ── API ──────────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function serveFile(res, path, contentType) {
  if (existsSync(path)) {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(readFileSync(path, 'utf8'));
  } else {
    res.writeHead(404); res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, \`http://localhost:${PORT}\`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' });
    res.end(); return;
  }

  try {

  // ── Статические файлы ──────────────────────────────────────────────────
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const preso = resolve(DRONEDOC, 'public/meta-kb/index.html');
    if (existsSync(preso)) { serveFile(res, preso, 'text/html; charset=utf-8'); }
    else { res.writeHead(404); res.end('Presentation not found'); }
    return;
  }

  if (url.pathname === '/proto') {
    const proto = resolve(DRONEDOC, 'public/meta-kb/proto.html');
    if (existsSync(proto)) { serveFile(res, proto, 'text/html; charset=utf-8'); }
    else {
      // Inline prototype HTML
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PROTO_HTML);
    }
    return;
  }

  // ── REG API ────────────────────────────────────────────────────────────
  if (url.pathname === '/api/reg/anamnesis') {
    const q = url.searchParams.get('query') || '';
    const dom = url.searchParams.get('domain') || null;
    const proj = url.searchParams.get('project') || null;
    const result = reg.anamnesis(q, { domain: dom, project: proj });
    json(res, result);
    return;
  }
  if (url.pathname === '/api/reg/stats') { json(res, reg.stats()); return; }
  if (url.pathname === '/api/reg/decisions') {
    const dom = url.searchParams.get('domain');
    const all = dom ? reg.decisions.filter(d => d.domain === dom) : reg.decisions;
    json(res, all.slice(-50));
    return;
  }

  // ── Zulip API ──────────────────────────────────────────────────────────
  if (url.pathname === '/api/zulip/search') {
    const q = url.searchParams.get('query') || '';
    json(res, zulip.search(q));
    return;
  }
  if (url.pathname === '/api/zulip/streams') { json(res, zulip.listStreams()); return; }
  if (url.pathname === '/api/zulip/stats') { json(res, zulip.stats()); return; }

  if (url.pathname === '/api/zulip/read') {
    const stream = url.searchParams.get('stream') || 'general';
    const topic = url.searchParams.get('topic') || '';
    json(res, zulip.readTopic(stream, topic));
    return;
  }

  // ── Shard API ──────────────────────────────────────────────────────────
  if (url.pathname === '/api/shard/analyze') {
    const q = url.searchParams.get('query') || '';
    const parts = parseInt(url.searchParams.get('parts') || '3');
    const shardM = await import(resolve(ROOT, 'utils/gift-shard.mjs'));
    const result = shardM.shardQuery(q, parts);
    const risk = shardM.assessLeakRisk(result);
    json(res, { ...result, risk });
    return;
  }

  // ── Full meta-search ───────────────────────────────────────────────────
  if (url.pathname === '/api/meta/search') {
    const q = url.searchParams.get('query') || '';
    const regResult = reg.anamnesis(q);
    const zulipResult = zulip.search(q);
    json(res, {
      query: q,
      timestamp: new Date().toISOString(),
      reg: {
        previousWork: regResult.previousWork.slice(0, 5),
        failures: regResult.failures,
        compatibility: regResult.compatibility,
      },
      zulip: zulipResult.slice(0, 5).map(m => ({
        stream: m.stream, topic: m.topic, author: m.author,
        content: m.content?.slice(0, 200), ts: m.ts,
      })),
      recommendation: regResult.failures.length > 0
        ? \`Внимание: найдено ${regResult.failures.length} отклонённых подходов. Изучите перед началом работы.\`
        : 'Предыдущих решений не найдено. Вы — первый.',
    });
    return;
  }

  } catch(e) { json(res, { error: e.message, stack: e.stack }, 500); return; }

  res.writeHead(404); res.end('Not found');
});

// ── Start ────────────────────────────────────────────────────────────────────

await loadData();
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  МЕТА КБ — ПРОТОТИП для НТИ (20 июня)     ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(\`  Презентация:  http://localhost:${PORT}/\`);
  console.log(\`  Прототип:     http://localhost:${PORT}/proto\`);
  console.log('');
  console.log(\`  API:\`);
  console.log(\`    REG anamnesis: /api/reg/anamnesis?query=крыло\`);
  console.log(\`    Zulip search:  /api/zulip/search?query=резонанс\`);
  console.log(\`    Meta search:   /api/meta/search?query=крыло\`);
  console.log(\`    Shard analyze: /api/shard/analyze?query=...&parts=3\`);
  console.log('');
});

}
