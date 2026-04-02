#!/usr/bin/env node
/**
 * phantom-server.mjs — HTTP-сервер явления _claude
 *
 * Telegram-бот вызывает этот сервер, когда нужно решить:
 * являться ли _claude, и если да — получить его ответ.
 *
 * Порт: 8091 (PHANTOM_PORT)
 *
 * Эндпоинты:
 *   POST /appear    — полный цикл явления (shouldAppear + context + Claude + record)
 *   POST /decide    — только решение: являться или нет
 *   GET  /presence  — метрика присутствия (явлений за неделю, нити, вес)
 *   GET  /health    — здоровье сервера
 *
 * Запуск:
 *   node utils/phantom-server.mjs
 *   PHANTOM_PORT=8091 node utils/phantom-server.mjs
 */

import { createServer } from 'http';
import {
  shouldClaudeAppear,
  appear,
  getPresenceMetrics,
} from '../src/phantom/claude-phantom.mjs';

const PORT = parseInt(process.env.PHANTOM_PORT || '8091');

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // ── POST /appear — полный цикл явления ──────────────────────────────
    if (path === '/appear' && req.method === 'POST') {
      const data = await readBody(req);
      const { personId, text, chatId, forceAppear } = data;

      if (!text) return json(res, { error: 'text is required' }, 400);

      const msg = { text };
      const should = shouldClaudeAppear(msg, { forceAppear });

      if (!should) {
        return json(res, { appeared: false, reason: 'silence' });
      }

      const person = personId || `tg:${chatId || 'unknown'}`;
      console.log(`[phantom] Явление для ${person}: "${text.slice(0, 60)}..."`);

      const { response, recorded } = await appear(person, text);

      return json(res, {
        appeared: true,
        response,
        personId: person,
        recorded: {
          nousRecorded: recorded.nousRecorded,
          wordWeight: recorded.wordAct.weight,
          presenceWeight: recorded.presenceAct.weight,
        },
      });
    }

    // ── POST /decide — только решение ───────────────────────────────────
    if (path === '/decide' && req.method === 'POST') {
      const data = await readBody(req);
      const { text, forceAppear } = data;

      if (!text) return json(res, { error: 'text is required' }, 400);

      const should = shouldClaudeAppear({ text }, { forceAppear });
      return json(res, { shouldAppear: should });
    }

    // ── GET /presence — метрика ─────────────────────────────────────────
    if (path === '/presence' || path === '/api/phantom/presence') {
      if (req.method === 'GET') {
        return json(res, getPresenceMetrics());
      }
    }

    // ── GET /health ─────────────────────────────────────────────────────
    if (path === '/health' && req.method === 'GET') {
      return json(res, {
        status: 'ok',
        service: 'phantom-server',
        uptime: process.uptime(),
        metrics: getPresenceMetrics(),
      });
    }

    // ── 404 ─────────────────────────────────────────────────────────────
    json(res, { error: 'not found', endpoints: ['POST /appear', 'POST /decide', 'GET /presence', 'GET /health'] }, 404);

  } catch (e) {
    console.error('[phantom] Error:', e.message);
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`[phantom-server] ::${PORT} — явление _claude`);
  console.log(`  POST /appear    — полный цикл явления`);
  console.log(`  POST /decide    — решение: являться?`);
  console.log(`  GET  /presence  — метрика присутствия`);
});
