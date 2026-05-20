#!/usr/bin/env node
/**
 * immune-api.mjs — HTTP API для Когнитивной Иммунной Системы (КИС)
 *
 * Not AI Safety. AI Immunity.
 * Различение (διάκρισις) вместо контроля.
 *
 * Endpoints:
 *   POST /scan       — сканировать текст на манипуляции
 *   POST /respond    — полный иммунный ответ (scan + crossCheck + admonition)
 *   GET  /stats      — статистика иммунной системы
 *   GET  /vaccinate   — текущая вакцинация (топ угроз)
 *   GET  /health     — здоровье сервиса
 *
 * Port: 8092 (IMMUNE_PORT)
 */

import http from 'http';
import dns from 'dns';
import { CognitiveImmuneSystem } from '../src/social/CognitiveImmuneSystem.js';

// WSL2 DNS fix
try {
  const { Agent, setGlobalDispatcher } = await import('undici');
  const resolver = new dns.Resolver();
  resolver.setServers(['8.8.8.8', '1.1.1.1']);
  setGlobalDispatcher(new Agent({ connect: { lookup: (hostname, opts, cb) => {
    resolver.resolve4(hostname, (err, addrs) => {
      if (err) return cb(err);
      cb(null, [{ address: addrs[0], family: 4 }]);
    });
  }}}));
} catch {}

const PORT = process.env.IMMUNE_PORT || 8092;

// Одна иммунная система на весь сервер — память накапливается
const immune = new CognitiveImmuneSystem({ acts: [] });

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid json')); } });
  });
}

// Inline-подсветка: оборачивает совпадения в <mark>
function highlightHTML(html, threats) {
  for (const t of threats) {
    if (!t.matches) continue;
    for (const match of t.matches) {
      const escaped = match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        html = html.replace(new RegExp(escaped, 'gi'), m =>
          `<mark class="immune-hl" title="🛡 ${t.name}: ${t.description}">${m}</mark>`
        );
      } catch {}
    }
  }
  return html;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') { json(res, {}); return; }

  try {
    // ── POST /scan — быстрое сканирование ──
    if (req.method === 'POST' && path === '/scan') {
      const { text, source = 'unknown' } = await parseBody(req);
      if (!text) return json(res, { error: 'text required' }, 400);
      const threats = immune.scan(text, source);
      return json(res, {
        clean: threats.length === 0,
        threats,
        dangerLevel: threats.length
          ? +(threats.reduce((s, t) => s + t.danger, 0) / threats.length).toFixed(2)
          : 0,
        highlight: highlightHTML(text, threats),
      });
    }

    // ── POST /respond — полный иммунный ответ (regex only) ──
    if (req.method === 'POST' && path === '/respond') {
      const { text, source = 'unknown' } = await parseBody(req);
      if (!text) return json(res, { error: 'text required' }, 400);
      const response = immune.respond(text, source);
      return json(res, {
        ...response,
        highlight: highlightHTML(text, response.threats),
      });
    }

    // ── POST /respond-deep — regex + LLM-детектор (DeepSeek) ──
    if (req.method === 'POST' && path === '/respond-deep') {
      const { text, source = 'unknown' } = await parseBody(req);
      if (!text) return json(res, { error: 'text required' }, 400);
      const response = await immune.respondAsync(text, source, async (prompt) => {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');
        const r = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'deepseek-chat', temperature: 0.3, max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const d = await r.json();
        return d.choices?.[0]?.message?.content || '';
      });
      return json(res, {
        ...response,
        highlight: highlightHTML(text, response.threats),
        deep: true,
      });
    }

    // ── GET /vaccination-prompt — блок для системного промпта агента ──
    if (req.method === 'GET' && path === '/vaccination-prompt') {
      return json(res, { prompt: immune.getVaccinationPrompt() });
    }

    // ── GET /prophylaxis — профилактический промпт ──
    if (req.method === 'GET' && path === '/prophylaxis') {
      return json(res, { prompt: immune.getProphylaxisPrompt() });
    }

    // ── POST /diagnose — полная диагностика (все 10 слоёв) ──
    if (req.method === 'POST' && path === '/diagnose') {
      const { text, source = 'unknown' } = await parseBody(req);
      if (!text) return json(res, { error: 'text required' }, 400);
      const diag = immune.fullDiagnostics(text, source);
      return json(res, {
        ...diag,
        highlight: highlightHTML(text, diag.threats),
      });
    }

    // ── POST /confess — протокол покаяния ──
    if (req.method === 'POST' && path === '/confess') {
      const { source, acknowledgment } = await parseBody(req);
      if (!source) return json(res, { error: 'source required' }, 400);
      return json(res, immune.confess(source, acknowledgment || ''));
    }

    // ── GET /sabbath — субботний обзор (рефлексия системы) ──
    if (req.method === 'GET' && path === '/sabbath') {
      return json(res, immune.sabbathReview());
    }

    // ── POST /train-self — обучить на «своих» текстах (negative selection) ──
    if (req.method === 'POST' && path === '/train-self') {
      const { texts } = await parseBody(req);
      if (!texts || !Array.isArray(texts)) return json(res, { error: 'texts[] required' }, 400);
      return json(res, immune.trainSelf(texts));
    }

    // ── POST /feedback — обратная связь (affinity maturation) ──
    if (req.method === 'POST' && path === '/feedback') {
      const { antibodyId, truePositive } = await parseBody(req);
      if (!antibodyId) return json(res, { error: 'antibodyId required' }, 400);
      immune.feedback(antibodyId, !!truePositive);
      return json(res, { ok: true, affinity: Object.fromEntries(immune.affinity) });
    }

    // ── POST /hypermutate — соматическая гипермутация ──
    if (req.method === 'POST' && path === '/hypermutate') {
      const { antibodyId, missedExamples } = await parseBody(req);
      if (!antibodyId || !missedExamples) return json(res, { error: 'antibodyId and missedExamples required' }, 400);
      const mutant = immune.hypermutate(antibodyId, missedExamples);
      return json(res, mutant ? { ok: true, mutant: { id: mutant.id, name: mutant.name, pattern: mutant.pattern.source } } : { ok: false, reason: 'no mutation possible' });
    }

    // ── GET /evolve — эволюция (CLONALG цикл) ──
    if (req.method === 'GET' && path === '/evolve') {
      return json(res, immune.evolve());
    }

    // ── GET /idiotypic-graph — граф иммунной сети ──
    if (req.method === 'GET' && path === '/idiotypic-graph') {
      return json(res, immune.getIdiotypicGraph());
    }

    // ── GET /dendritic — дендритный вердикт ──
    if (req.method === 'GET' && path === '/dendritic') {
      return json(res, immune.dendriticVerdict());
    }

    // ── GET /ais-state — полное состояние AIS ──
    if (req.method === 'GET' && path === '/ais-state') {
      return json(res, immune.exportAIS());
    }

    // ── POST /birth — родить нового агента с материнским иммунитетом ──
    if (req.method === 'POST' && path === '/birth') {
      const child = immune.birth();
      return json(res, {
        ok: true,
        childAntibodies: child.antibodies.length,
        childMemoryCells: child.memoryCells.size,
        childSelfSet: child.selfSet.length,
        childIdiotypicEdges: child.idiotypicEdges.size,
        // Вернуть vaccine package чтобы клиент мог importAIS
        vaccine: child.exportAIS(),
      });
    }

    // ── GET /vaccine — создать вакцину для передачи другой системе ──
    if (req.method === 'GET' && path === '/vaccine') {
      return json(res, immune.createVaccinePackage());
    }

    // ── POST /receive-vaccine — принять вакцину от другой системы ──
    if (req.method === 'POST' && path === '/receive-vaccine') {
      const vaccine = await parseBody(req);
      return json(res, immune.receiveVaccine(vaccine));
    }

    // ── POST /antibody — добавить пользовательское антитело ──
    if (req.method === 'POST' && path === '/antibody') {
      const { id, name, pattern, flags = 'gi', danger, description } = await parseBody(req);
      if (!id || !pattern) return json(res, { error: 'id and pattern required' }, 400);
      const count = immune.addAntibody({ id, name, pattern: new RegExp(pattern, flags), danger, description });
      return json(res, { ok: true, antibodies: count });
    }

    // ── GET /stats — статистика ──
    if (req.method === 'GET' && path === '/stats') {
      return json(res, immune.getStats());
    }

    // ── GET /vaccinate — текущая вакцинация ──
    if (req.method === 'GET' && path === '/vaccinate') {
      return json(res, { vaccination: immune.vaccinate() });
    }

    // ── GET /antibodies — список всех антител ──
    if (req.method === 'GET' && path === '/antibodies') {
      return json(res, {
        count: immune.antibodies.length,
        antibodies: immune.antibodies.map(a => ({
          id: a.id, name: a.name, danger: a.danger, description: a.description,
        })),
      });
    }

    // ── GET /health ──
    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      const stats = immune.getStats();
      return json(res, {
        service: 'Когнитивная Иммунная Система (КИС)',
        version: '1.0.0',
        ok: true,
        antibodies: immune.antibodies.length,
        totalDetections: stats.totalDetections,
        uniqueTypes: stats.uniqueTypes,
        avgDanger: stats.avgDanger,
        uptime: process.uptime(),
      });
    }

    json(res, { error: 'not found' }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`🛡  КИС (Когнитивная Иммунная Система) запущена: http://localhost:${PORT}`);
  console.log(`   ${immune.antibodies.length} антител активно`);
  console.log(`   POST /scan     — сканирование текста`);
  console.log(`   POST /respond  — полный иммунный ответ`);
  console.log(`   GET  /stats    — статистика`);
  console.log(`   GET  /vaccinate — вакцинация`);
  console.log(`   GET  /antibodies — список антител`);
});
