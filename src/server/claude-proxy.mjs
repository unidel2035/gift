/**
 * claude-proxy.mjs — Claude API прокси для Gift DAO
 *
 * Общий ключ Anthropic + доступ по W-матрице.
 * Щедрые получают больше. Не богатые — дающие.
 *
 * Запуск:
 *   ANTHROPIC_API_KEY=sk-ant-... node src/server/claude-proxy.mjs
 *
 * Использование (вместо api.anthropic.com):
 *   baseURL: http://your-server:4444
 *   x-telegram-user-id: 12345678  (вместо Bearer-токена)
 */

import { createServer } from 'http';
import { GiftDAO } from '../dao/GiftDAO.js';

const PORT    = parseInt(process.env.PROXY_PORT ?? '4444');
const API_KEY = process.env.ANTHROPIC_API_KEY;
const dao     = new GiftDAO();

if (!API_KEY) { console.error('ANTHROPIC_API_KEY не задан'); process.exit(1); }

// ── Утилиты ───────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end',  () => { try { resolve(JSON.parse(d || '{}')); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

// Примерный подсчёт токенов по тексту (грубо: 1 токен ≈ 4 символа)
function estimateTokens(obj) {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

// ── Прокси ────────────────────────────────────────────────────────────────

async function proxyToAnthropic(path, reqBody, res) {
  const upstream = await fetch(`https://api.anthropic.com${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':          API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(reqBody),
  });

  res.writeHead(upstream.status, {
    'Content-Type':               'application/json',
    'Access-Control-Allow-Origin': '*',
  });

  const data = await upstream.text();
  res.end(data);
  return upstream.status;
}

// ── Роутер ────────────────────────────────────────────────────────────────

async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }

  // ── GET /dao/profile — профиль участника ──────────────────────────────
  if (req.method === 'GET' && url.pathname === '/dao/profile') {
    const userId = req.headers['x-telegram-user-id'];
    if (!userId) return json(res, { error: 'x-telegram-user-id required' }, 401);
    const profile = dao.profile(userId);
    if (!profile) return json(res, { error: 'не участник DAO. Напиши /join в @dar_gift_bot' }, 403);
    return json(res, profile);
  }

  // ── GET /dao/leaderboard ──────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/dao/leaderboard') {
    return json(res, { leaderboard: dao.leaderboard(), members: dao.memberCount });
  }

  // ── POST /v1/messages — проксируем к Claude ───────────────────────────
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const userId = req.headers['x-telegram-user-id'];
    if (!userId) return json(res, { error: 'x-telegram-user-id required' }, 401);

    const profile = dao.profile(userId);
    if (!profile) {
      return json(res, {
        error: 'доступ закрыт',
        hint:  'Вступи в Gift DAO: напиши /join в @dar_gift_bot',
      }, 403);
    }

    const { available } = dao.tokensAvailable(userId);
    if (available < 100) {
      return json(res, {
        error:    'лимит исчерпан',
        hint:     'Помоги кому-то из общины → получишь бонусные токены',
        surplus:  profile.surplus,
        available,
      }, 429);
    }

    let reqBody;
    try { reqBody = await body(req); } catch { return json(res, { error: 'invalid JSON' }, 400); }

    const estimatedCost = estimateTokens(reqBody);
    if (!dao.consumeTokens(userId, estimatedCost)) {
      return json(res, { error: 'недостаточно токенов', available }, 429);
    }

    const status = await proxyToAnthropic(url.pathname, reqBody, res);
    console.log(`[proxy] ${profile.name} → ${status} | −${estimatedCost} tokens | остаток: ${available - estimatedCost}`);
    return;
  }

  // ── GET / — статус прокси ──────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/') {
    return json(res, {
      service:  'Gift DAO Claude Proxy',
      members:  dao.memberCount,
      acts:     dao.actsCount,
      protocol: 'Доступ по щедрости, не по кошельку',
      join:     '@dar_gift_bot → /join',
    });
  }

  json(res, { error: 'not found' }, 404);
}

createServer(route).listen(PORT, () => {
  console.log(`Gift DAO Proxy запущен: http://localhost:${PORT}`);
  console.log(`Участников: ${dao.memberCount} | Актов: ${dao.actsCount}`);
  console.log(`Endpoint: POST /v1/messages (x-telegram-user-id: header)`);
});
