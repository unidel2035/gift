#!/usr/bin/env node
/**
 * anamnesis-mcp-bridge.js — MCP stdio bridge к памяти общины
 *
 * Даёт Claude прямой доступ к анамнетической ленте:
 *   anamnesis_summary   — краткий обзор (лица + последние акты)
 *   anamnesis_persons   — все лица
 *   anamnesis_tape      — вся лента актов
 *   anamnesis_deepest   — самые тяжёлые акты (время, присутствие)
 *   anamnesis_commune   — нить между двумя лицами
 *   anamnesis_add_gift  — записать новый дар в ленту
 *
 * Запуск (stdio MCP):
 *   node utils/anamnesis-mcp-bridge.js
 */

'use strict';

const ANAMNESIS_URL = process.env.ANAMNESIS_URL || 'http://173.249.2.184:8089';

// ── MCP protocol over stdio ────────────────────────────────────────────────

let _id = 0;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function httpGet(path) {
  const res = await fetch(`${ANAMNESIS_URL}${path}`);
  return res.json();
}

async function httpPost(path, body) {
  const res = await fetch(`${ANAMNESIS_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const TOOLS = [
  {
    name: 'anamnesis_summary',
    description: 'Краткое резюме памяти общины: кто в онтологии, последние акты дара. Читать в начале разговора.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'anamnesis_persons',
    description: 'Все лица в онтологии: имя, призвание, τέλος, когда вошли.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'anamnesis_tape',
    description: 'Полная лента актов дара — необратимая, анамнетическая.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'anamnesis_deepest',
    description: 'Самые тяжёлые акты (время=10, присутствие=8). Что было важнее всего.',
    inputSchema: {
      type: 'object',
      properties: { n: { type: 'number', description: 'сколько актов (по умолчанию 7)' } },
    },
  },
  {
    name: 'anamnesis_commune',
    description: 'Нить между двумя лицами: сколько дали друг другу, жива ли связь.',
    inputSchema: {
      type: 'object',
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', description: 'id первого лица' },
        to:   { type: 'string', description: 'id второго лица' },
      },
    },
  },
  {
    name: 'anamnesis_add_gift',
    description: 'Записать новый акт дара в ленту. Необратимо.',
    inputSchema: {
      type: 'object',
      required: ['giverId', 'receiverId', 'type', 'content'],
      properties: {
        giverId:    { type: 'string', description: 'id дарителя (или _abyss)' },
        receiverId: { type: 'string', description: 'id получателя (или _koinon)' },
        type:       { type: 'string', enum: ['time','presence','knowledge','code','word','money','data'], description: 'тип дара' },
        content:    { type: 'string', description: 'описание акта' },
        amount:     { type: 'number', description: 'количество (часы, рубли, PR)' },
      },
    },
  },
  {
    name: 'anamnesis_search',
    description: 'Семантический поиск по актам дара. Находит релевантные акты по тексту запроса (Qdrant векторный поиск).',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'поисковый запрос' },
        limit: { type: 'number', description: 'максимум результатов (по умолчанию 7)' },
      },
    },
  },
  {
    name: 'anamnesis_matrix',
    description: 'W-матрица общины в GiftMemory-формате: persons, W (тензор весов), actsCount.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'anamnesis_summary':
      return httpGet('/summary');
    case 'anamnesis_persons':
      return httpGet('/persons');
    case 'anamnesis_tape':
      return httpGet('/tape');
    case 'anamnesis_deepest':
      return httpGet(`/deepest?n=${args.n || 7}`);
    case 'anamnesis_commune':
      return httpGet(`/commune/${args.from}/${args.to}`);
    case 'anamnesis_add_gift':
      return httpPost('/gift', args);
    case 'anamnesis_search':
      return httpGet(`/search?q=${encodeURIComponent(args.query)}&limit=${args.limit || 7}`);
    case 'anamnesis_matrix':
      return httpGet('/matrix');
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── stdio loop ─────────────────────────────────────────────────────────────

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }

    const id = msg.id;

    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'anamnesis', version: '1.0.0' },
      }});
    } else if (msg.method === 'notifications/initialized') {
      // no-op
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      try {
        const result = await callTool(name, args || {});
        send({ jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }});
      } catch (e) {
        send({ jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: `Ошибка: ${e.message}` }],
          isError: true,
        }});
      }
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
    }
  }
});
