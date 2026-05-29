// mcp-client.mjs — подключение к MCP-серверам из .mcp.json и проброс их
// инструментов в агентский цикл gift. Имена tool'ов: mcp__<server>__<tool>
// (как в Claude Code). Серверы запускаются по stdio (JSON-RPC).
import fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${label}`)), ms)),
]);

// Подключиться ко всем серверам из mcpPath. onLog(msg) — прогресс.
// Возвращает { tools, call, close, ready } — tools в Anthropic-формате.
export async function connectMcp(mcpPath, { onLog = () => {}, connectTimeout = 45000 } = {}) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf8')); }
  catch { return { tools: [], call: async () => 'нет .mcp.json', close: async () => {}, ready: [] }; }

  const servers = Object.entries(cfg.mcpServers || {});
  const clients = {};
  const route = {};     // mcp__srv__tool -> { client, orig }
  const tools = [];
  const ready = [];

  await Promise.all(servers.map(async ([name, s]) => {
    try {
      const transport = new StdioClientTransport({
        command: s.command,
        args: s.args || [],
        env: { ...process.env, ...(s.env || {}) },
        stderr: 'ignore',
      });
      const client = new Client({ name: 'gift-agent', version: '0.1.0' }, { capabilities: {} });
      await withTimeout(client.connect(transport), connectTimeout, name + ' connect');
      const list = await withTimeout(client.listTools(), 15000, name + ' listTools');
      clients[name] = client;
      for (const t of (list.tools || [])) {
        const full = `mcp__${name}__${t.name}`;
        tools.push({
          name: full,
          description: (t.description || t.name).slice(0, 500),
          input_schema: t.inputSchema || { type: 'object', properties: {} },
        });
        route[full] = { client, orig: t.name };
      }
      ready.push({ name, tools: (list.tools || []).length });
      onLog(`mcp ${name}: ${(list.tools || []).length} tools`);
    } catch (e) {
      onLog(`mcp ${name}: ${String(e.message || e).slice(0, 80)}`);
    }
  }));

  async function call(name, input) {
    const r = route[name];
    if (!r) return `неизвестный MCP-tool: ${name}`;
    try {
      const res = await withTimeout(r.client.callTool({ name: r.orig, arguments: input || {} }), 120000, name);
      const text = (res.content || []).map(b => (b.type === 'text' ? b.text : JSON.stringify(b))).join('\n');
      return text || JSON.stringify(res).slice(0, 4000);
    } catch (e) { return `MCP error (${name}): ${e.message}`; }
  }
  async function close() { for (const c of Object.values(clients)) { try { await c.close(); } catch { /* */ } } }

  return { tools, call, close, ready, route };
}
