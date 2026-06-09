#!/usr/bin/env node
/**
 * claude-openai-shim — OpenAI-совместимый endpoint поверх подписки Claude.
 *
 * integram (и любой OpenAI-клиент) шлёт POST /v1/chat/completions,
 * шим транслирует в `claude --print` (подписка Claude Max на этой машине)
 * и возвращает ответ в формате OpenAI. Без внешних ключей и без IP-ограничений.
 *
 * Запуск:  node src/proxy/claude-openai-shim.mjs   (порт 8087)
 * integram .env:
 *   LLM_PROVIDER_CLAUDE_URL=http://localhost:8087/v1
 *   LLM_PROVIDER_CLAUDE_KEY=local
 *   LLM_ALIAS_SMART=claude/sonnet
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = process.env.SHIM_PORT || 8087;
const CLAUDE_BIN = [process.env.CLAUDE_BIN, '/home/unidel/.local/bin/claude', '/home/new/.local/bin/claude', 'claude']
  .find(p => p && (p === 'claude' || existsSync(p))) || 'claude';

function stripThink(s) { return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

// messages[] (OpenAI) → { system, prompt } для claude --print
function toPrompt(messages = []) {
  const sys = messages.filter(m => m.role === 'system').map(m => content(m)).join('\n\n');
  const convo = messages.filter(m => m.role !== 'system');
  // последний user — собственно запрос; предыдущие — транскрипт в промпт
  const lines = [];
  for (const m of convo) {
    const role = m.role === 'assistant' ? 'Assistant' : 'User';
    lines.push(`${role}: ${content(m)}`);
  }
  return { system: sys, prompt: lines.join('\n\n') || 'Привет' };
}
function content(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map(p => p.text || p.content || '').join(' ');
  return String(m.content ?? '');
}

function callClaude(system, prompt, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const args = ['--print'];
    if (system) args.push('--append-system-prompt', system);
    let out = '', done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const p = spawn(CLAUDE_BIN, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    p.on('error', () => fin(null));
    p.stdout.on('data', d => out += d);
    p.on('close', () => fin(stripThink(out) || null));
    const t = setTimeout(() => { try { p.kill(); } catch {} fin(null); }, timeoutMs);
    p.on('close', () => clearTimeout(t));
    try { p.stdin.write(prompt); p.stdin.end(); } catch { fin(null); }
  });
}

const now = () => Math.floor(Date.now() / 1000);
const id = () => 'chatcmpl-' + Math.random().toString(36).slice(2);

function openaiBody(text, model) {
  return {
    id: id(), object: 'chat.completion', created: now(), model: model || 'claude',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

const server = createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && u.pathname.endsWith('/models')) {
    return json(res, 200, { object: 'list', data: ['sonnet', 'opus', 'haiku', 'smart', 'fast'].map(m => ({ id: m, object: 'model' })) });
  }
  if (req.method === 'POST' && u.pathname.endsWith('/chat/completions')) {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 4e6) req.destroy(); });
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(b); } catch {}
      const { system, prompt } = toPrompt(body.messages);
      const text = await callClaude(system, prompt) || '(пустой ответ от Claude)';
      if (body.stream) return sse(res, text, body.model);
      json(res, 200, openaiBody(text, body.model));
    });
    return;
  }
  json(res, 404, { error: 'not found' });
});

function json(res, code, obj) {
  const d = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(d) });
  res.end(d);
}
// поток одним чанком + [DONE] — валидный SSE без инкрементальности
function sse(res, text, model) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const base = { id: id(), object: 'chat.completion.chunk', created: now(), model: model || 'claude' };
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

server.listen(PORT, '127.0.0.1', () => console.log(`claude-openai-shim · http://127.0.0.1:${PORT}/v1 · bin=${CLAUDE_BIN}`));
