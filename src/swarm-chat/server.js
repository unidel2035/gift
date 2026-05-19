#!/usr/bin/env node
/**
 * SwarmChat Server — WebSocket сервер для голосового чата-завода
 *
 * Запуск: node src/swarm-chat/server.js
 * WebSocket: ws://localhost:3040
 * HTTP: http://localhost:3040/status
 */

import { createServer } from 'http';
import { SwarmChatEngine, MSG_TYPE } from './SwarmChat.js';

const PORT = 3040;
const engine = new SwarmChatEngine();

// ── HTTP сервер ──────────────────────────────────────────────────

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/status') {
    res.end(JSON.stringify(engine.getStats()));
  } else if (req.url === '/activity') {
    res.end(JSON.stringify(engine.getRecentActivity()));
  } else if (req.method === 'POST' && req.url === '/message') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { playerId, text, context } = JSON.parse(body);
        const responses = await engine.handleHumanMessage(playerId, text, context || {});
        res.end(JSON.stringify({ ok: true, responses }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/sensor') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sensorId, data } = JSON.parse(body);
        const result = engine.handleSensorGift(sensorId, data);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else {
    res.end(JSON.stringify({ service: 'SwarmChat', port: PORT, endpoints: ['/status', '/activity', '/message', '/sensor'] }));
  }
});

// ── WebSocket (через базовый ws, не socket.io для простоты) ──────

let wsClients = new Set();

try {
  const { WebSocketServer } = await import('ws');

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log(`🔗 Client connected (${wsClients.size} total)`);

    ws.send(JSON.stringify({
      type: 'welcome',
      stats: engine.getStats(),
      recent: engine.getRecentActivity(5),
    }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === 'human_message') {
          const responses = await engine.handleHumanMessage(
            msg.playerId || 'anonymous',
            msg.text || '',
            msg.context || {}
          );
          // Broadcast responses to all clients
          const payload = JSON.stringify({ type: 'chat_response', playerId: msg.playerId, responses });
          for (const client of wsClients) {
            if (client.readyState === 1) client.send(payload);
          }
        }

        if (msg.type === 'sensor_gift') {
          engine.handleSensorGift(msg.sensorId, msg.data);
          // Notify all clients
          const payload = JSON.stringify({ type: 'sensor_received', sensorId: msg.sensorId });
          for (const client of wsClients) {
            if (client.readyState === 1) client.send(payload);
          }
        }

      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: e.message }));
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`🔌 Client disconnected (${wsClients.size} left)`);
    });
  });

  console.log(`\n🐝 SwarmChat Server`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   HTTP:      http://localhost:${PORT}/status\n`);

} catch {
  console.log('⚠ ws package not installed. HTTP-only mode.');
  console.log('  npm install ws');
}

server.listen(PORT);
