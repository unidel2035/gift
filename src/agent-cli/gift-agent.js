/**
 * gift-agent.js — полноценный агент БЕЗ claude-agent-sdk.
 *
 * Прямые API-вызовы через прокси (localhost:3200).
 * Свои инструменты: Read, Write, Edit, Bash, Grep, Glob.
 * Межсессионная координация: W-матрица + KoinonBus.
 * Иммунная система: CIS-сканирование каждого ответа.
 *
 * Agent loop:
 *   1. prompt → API (Anthropic format, через прокси)
 *   2. Ответ: text → показать | tool_use → выполнить
 *   3. Результат tool → обратно в API
 *   4. Повторять до text-ответа или max_turns
 *   5. Записать акт в W-матрицу, уведомить KoinonBus
 */

// Suppress TensorFlow noise from GiftMemory
process.env.TF_CPP_MIN_LOG_LEVEL = process.env.TF_CPP_MIN_LOG_LEVEL || '3';
process.env.TF_ENABLE_ONEDNN_OPTS = '0';

import dns from 'node:dns';
import { Agent as HttpsAgent } from 'node:https';

// ═══════════════════════════════════════════════════════════════
// Gift framework integration (graceful — works without gift/)
// ═══════════════════════════════════════════════════════════════
let KoinonBus = null, GiftMemory = null, LivingMatrix = null;
try {
  ({ KoinonBus } = await import('../koinon/KoinonBus.js'));
  ({ GiftMemory } = await import('../core/GiftMemory.js'));
  ({ LivingMatrix } = await import('../core/LivingMatrix.js'));
} catch {
  // Running outside gift/ — use built-in lightweight matrix
}

const GIFT_ROOT = '/home/unidel/gift';
const W_SNAPSHOT = `${GIFT_ROOT}/data/sacred-history-W.json`;

function loadGiftMemory() {
  if (!GiftMemory) return null;
  try {
    const snap = JSON.parse(readFileSync(W_SNAPSHOT, 'utf8'));
    return GiftMemory.fromSnapshot(snap);
  } catch { return null; }
}

function loadKoinon() {
  if (!KoinonBus) return null;
  try { return new KoinonBus(); } catch { return null; }
}

function koinonRecent(bus, limit = 5) {
  if (!bus) return '';
  try {
    const history = bus.history({ limit });
    if (!history.length) return '(no messages)';
    return history.map(m => `  [${m.from}→${m.to || '*'}] ${(m.message || '').slice(0, 80)}`).join('\n');
  } catch { return ''; }
}

function giftMemorySummary(mem) {
  if (!mem) return '';
  try {
    const persons = mem.persons();
    const totalActs = mem.acts?.length || 0;
    const top = mem.topThreads?.(3) || [];
    let s = `Persons: ${persons.length}, Acts: ${totalActs}`;
    if (top.length) s += `\nTop threads: ${top.map(t => `${t.from}→${t.to}(${t.weight})`).join(', ')}`;
    return s;
  } catch { return ''; }
}

// WSL2 DNS fix: Node.js undici ignores dns.setServers, use custom resolver
const _resolver = new dns.Resolver();
_resolver.setServers(['8.8.8.8', '1.1.1.1']);
const _dnsCache = {};
async function resolveHost(hostname) {
  if (_dnsCache[hostname]) return _dnsCache[hostname];
  return new Promise((resolve, reject) => {
    _resolver.resolve4(hostname, (err, addrs) => {
      if (err) return reject(err);
      _dnsCache[hostname] = addrs[0];
      resolve(addrs[0]);
    });
  });
}

// Custom fetch using node:https with DNS override (WSL2 fix)
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

async function safeFetch(url, opts = {}) {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';

  // For localhost — use native fetch
  if (isLocal) return fetch(url, opts);

  // Resolve DNS through Google DNS
  let ip = u.hostname;
  const origHost = u.hostname;
  try { ip = await resolveHost(origHost); } catch {}

  return new Promise((resolve, reject) => {
    const reqFn = isHttps ? httpsRequest : httpRequest;
    const reqOpts = {
      hostname: ip,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { ...opts.headers, host: origHost },
      servername: origHost, // SNI for TLS
    };

    const req = reqFn(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => Promise.resolve(JSON.parse(body)),
          text: () => Promise.resolve(body),
        });
      });
    });

    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { resolve, dirname, basename, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════
// Spinner — фразы при ожидании ответа
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// Markdown → ANSI renderer (lightweight)
// ═══════════════════════════════════════════════════════════════

function renderMarkdown(text) {
  return text
    // Code blocks: ```lang\n...\n``` → dim
    .replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => `\x1b[2m${code.trimEnd()}\x1b[0m`)
    // Inline code: `text` → cyan
    .replace(/`([^`]+)`/g, '\x1b[36m$1\x1b[0m')
    // Headers: ### → bold gold
    .replace(/^### (.+)$/gm, '\x1b[1m\x1b[33m$1\x1b[0m')
    .replace(/^## (.+)$/gm, '\x1b[1m\x1b[33m$1\x1b[0m')
    .replace(/^# (.+)$/gm, '\x1b[1m\x1b[33m$1\x1b[0m')
    // Bold: **text** → bold
    .replace(/\*\*([^*]+)\*\*/g, '\x1b[1m$1\x1b[0m')
    // Italic: *text* → italic (dim as fallback)
    .replace(/\*([^*]+)\*/g, '\x1b[3m$1\x1b[0m')
    // Bullet: - text → cyan bullet
    .replace(/^- (.+)$/gm, '  \x1b[36m•\x1b[0m $1')
    // Horizontal rule: --- → dim line
    .replace(/^---$/gm, '\x1b[2m────────────────────────────────\x1b[0m')
    // Emoji shortcuts (common ones that terminals may not render)
    ;
}

// Буферизованный markdown-рендерер: копит чанки до полных строк,
// чтобы не рвать markdown-синтаксис (##, **, etc.) посередине.
function createMarkdownStream(out = process.stdout) {
  let buf = '';
  return {
    write(chunk) {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) out.write(renderMarkdown(line) + '\n');
    },
    flush() {
      if (buf) out.write(renderMarkdown(buf));
      buf = '';
    },
  };
}

const THINKING_PHRASES = [
  'размышляю...', 'думаю...', 'анализирую...', 'ищу решение...',
  'погружаюсь...', 'выстраиваю...', 'собираю...', 'оцениваю...',
  'ткáчество мысли...', 'вглядываюсь...', 'соединяю нити...',
];
const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  constructor() {
    this._interval = null;
    this._frame = 0;
    this._phrase = '';
  }
  start(phrase) {
    this._phrase = phrase || THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
    this._frame = 0;
    this._interval = setInterval(() => {
      const ch = SPINNER_CHARS[this._frame % SPINNER_CHARS.length];
      process.stderr.write(`\r\x1b[2K  \x1b[36m${ch}\x1b[0m \x1b[2m${this._phrase}\x1b[0m`);
      this._frame++;
    }, 80);
  }
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      process.stderr.write('\r\x1b[2K');
    }
  }
  update(phrase) {
    this._phrase = phrase;
  }
}

// ═══════════════════════════════════════════════════════════════
// Colors
// ═══════════════════════════════════════════════════════════════
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  magenta: '\x1b[35m', red: '\x1b[31m', gold: '\x1b[33m',
};
const c = (col, s) => `${C[col]}${s}${C.reset}`;

// ═══════════════════════════════════════════════════════════════
// Built-in tools (Read, Write, Edit, Bash, Grep, Glob)
// ═══════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'Read',
    description: 'Read a file. Returns file contents with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to file' },
        offset: { type: 'number', description: 'Line number to start from (1-based)' },
        limit: { type: 'number', description: 'Max lines to read' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Write',
    description: 'Write content to a file. Creates or overwrites.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: 'Replace exact string in a file.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path' },
        old_string: { type: 'string', description: 'Exact text to find' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'Bash',
    description: 'Execute a bash command. Returns stdout + stderr.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command' },
        timeout: { type: 'number', description: 'Timeout in ms (default 120000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'Grep',
    description: 'Search file contents with regex (ripgrep). Returns matching file paths or content.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'Directory or file to search' },
        glob: { type: 'string', description: 'File glob filter (e.g. "*.js")' },
        output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'Output mode (default: files_with_matches)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Glob',
    description: 'Find files matching a glob pattern.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.js")' },
        path: { type: 'string', description: 'Base directory' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'matrix_query',
    description: 'Query the W-matrix: show persons, top threads, recent acts.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', enum: ['summary', 'persons', 'threads', 'recent'], description: 'What to query' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'matrix_record',
    description: 'Record an act (gift) in the W-matrix between two persons.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Giver (person ID)' },
        to: { type: 'string', description: 'Receiver (person ID)' },
        content: { type: 'string', description: 'What was given' },
        type: { type: 'string', description: 'Act type: code, insight, question, covenant, grace' },
      },
      required: ['from', 'to', 'content'],
    },
  },
  {
    name: 'koinon_say',
    description: 'Publish a message to the KoinonBus (inter-agent communication).',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Target agent or * for broadcast' },
        topic: { type: 'string', description: 'Message topic' },
        message: { type: 'string', description: 'Message body' },
      },
      required: ['message'],
    },
  },
  {
    name: 'koinon_inbox',
    description: 'Read recent messages from KoinonBus.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max messages (default: 20)' },
        from: { type: 'string', description: 'Filter by sender' },
      },
      required: [],
    },
  },
  {
    name: 'recall_treasure',
    description: 'Search the treasury (LcmStore) for past insights, decisions, or knowledge.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'sobor_ask',
    description: 'Ask 3 LLM instances with different system prompts (sobor/council). Returns all 3 answers.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to ask the council' },
        personas: { type: 'string', description: 'Comma-separated persona names: theologian,engineer,strategist (default: all)' },
      },
      required: ['question'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// Tool execution
// ═══════════════════════════════════════════════════════════════

async function executeTool(name, input) {
  try {
    switch (name) {
      case 'Read': {
        const { file_path, offset = 1, limit = 2000 } = input;
        if (!existsSync(file_path)) return { error: `File not found: ${file_path}` };
        const lines = readFileSync(file_path, 'utf8').split('\n');
        const start = Math.max(0, offset - 1);
        const slice = lines.slice(start, start + limit);
        return slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');
      }

      case 'Write': {
        const { file_path, content } = input;
        const dir = dirname(file_path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(file_path, content);
        return `File written: ${file_path} (${content.length} bytes)`;
      }

      case 'Edit': {
        const { file_path, old_string, new_string, replace_all = false } = input;
        if (!existsSync(file_path)) return { error: `File not found: ${file_path}` };
        let content = readFileSync(file_path, 'utf8');
        if (!content.includes(old_string)) return { error: `String not found in file` };
        if (replace_all) {
          content = content.split(old_string).join(new_string);
        } else {
          const idx = content.indexOf(old_string);
          content = content.slice(0, idx) + new_string + content.slice(idx + old_string.length);
        }
        writeFileSync(file_path, content);
        return `File edited: ${file_path}`;
      }

      case 'Bash': {
        const { command, timeout = 120000 } = input;
        try {
          const result = spawnSync('bash', ['-c', command], {
            encoding: 'utf8',
            timeout,
            maxBuffer: 1024 * 1024 * 10,
            cwd: process.cwd(),
          });
          let output = '';
          if (result.stdout) output += result.stdout;
          if (result.stderr) output += result.stderr;
          if (result.status !== 0) output += `\nExit code: ${result.status}`;
          return output || '(no output)';
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'Grep': {
        const { pattern, path: searchPath = '.', glob: fileGlob, output_mode = 'files_with_matches' } = input;
        const args = ['rg'];
        if (output_mode === 'files_with_matches') args.push('-l');
        else if (output_mode === 'count') args.push('-c');
        else args.push('-n');
        if (fileGlob) args.push('--glob', fileGlob);
        args.push('--max-count', '250');
        args.push(pattern, searchPath);
        try {
          const result = spawnSync(args[0], args.slice(1), {
            encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 * 5,
          });
          return result.stdout || '(no matches)';
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'Glob': {
        const { pattern, path: basePath = '.' } = input;
        try {
          const result = spawnSync('find', [basePath, '-path', `*${pattern}*`, '-type', 'f'], {
            encoding: 'utf8', timeout: 10000,
          });
          // Fallback: use shell glob
          const result2 = spawnSync('bash', ['-c', `ls -1 ${basePath}/${pattern} 2>/dev/null | head -100`], {
            encoding: 'utf8', timeout: 10000,
          });
          return (result2.stdout || result.stdout || '(no matches)').trim();
        } catch (e) {
          return { error: e.message };
        }
      }

      // ── Gift-специфичные tools ──────────────────────────────
      case 'matrix_query': {
        const mem = loadGiftMemory();
        const localW = loadMatrix();
        const { query, limit = 10 } = input;
        switch (query) {
          case 'summary':
            return giftMemorySummary(mem) || matrixSummary(localW);
          case 'persons': {
            const persons = mem?.persons() || Object.keys(localW.persons || {});
            return Array.isArray(persons) ? persons.slice(0, limit).join('\n') : `${persons.length} persons`;
          }
          case 'threads': {
            const top = mem?.topThreads?.(limit) || [];
            if (top.length) return top.map(t => `${t.from}→${t.to}: ${t.weight}`).join('\n');
            // Fallback: compute from local matrix
            const threadMap = {};
            for (const act of (localW.acts || [])) {
              const key = `${act.from}→${act.to}`;
              threadMap[key] = (threadMap[key] || 0) + 1;
            }
            return Object.entries(threadMap).sort((a, b) => b[1] - a[1]).slice(0, limit)
              .map(([k, v]) => `${k}: ${v}`).join('\n') || '(no threads)';
          }
          case 'recent': {
            const acts = mem?.acts || localW.acts || [];
            return acts.slice(-limit).map(a => `  ${a.from}→${a.to}: ${(a.content || '').slice(0, 60)}`).join('\n') || '(no acts)';
          }
          default:
            return { error: `Unknown matrix query: ${query}. Use: summary, persons, threads, recent` };
        }
      }

      case 'matrix_record': {
        const { from, to, content: actContent, type = 'insight' } = input;
        const wFresh = loadMatrix();
        const act = recordAct(wFresh, from, to, actContent, type);
        // Also sync to full GiftMemory if available
        const bus = loadKoinon();
        if (bus) {
          try { bus.publish({ from, to, topic: 'matrix_record', message: actContent }); } catch {}
        }
        return `Act recorded: ${act.id} | ${from}→${to} (${type})`;
      }

      case 'koinon_say': {
        const bus = loadKoinon();
        if (!bus) return { error: 'KoinonBus not available (running outside gift/)' };
        const { to = '*', topic = 'chat', message } = input;
        try {
          const receipt = bus.publish({ from: process.env.GIFT_AGENT_ID || 'gift-agent', to, topic, message });
          return `Published to KoinonBus: ${JSON.stringify(receipt)}`;
        } catch (e) {
          return { error: `KoinonBus publish failed: ${e.message}` };
        }
      }

      case 'koinon_inbox': {
        const bus = loadKoinon();
        if (!bus) return { error: 'KoinonBus not available (running outside gift/)' };
        const { limit = 20, from: filterFrom } = input;
        try {
          let msgs = bus.history?.({ limit }) || [];
          if (filterFrom) msgs = msgs.filter(m => m.from === filterFrom);
          if (!msgs.length) return '(no messages)';
          return msgs.map(m => `[${m.from}→${m.to || '*'}] ${(m.message || '').slice(0, 120)}`).join('\n');
        } catch (e) {
          return { error: `KoinonBus poll failed: ${e.message}` };
        }
      }

      case 'recall_treasure': {
        const { query, limit = 5 } = input;
        // Search in insights.json, proposals.json, reflection.json
        const searchPaths = [
          `${GIFT_ROOT}/data/insights.json`,
          `${GIFT_ROOT}/data/proposals.json`,
          `${GIFT_ROOT}/data/reflection.json`,
        ];
        const results = [];
        for (const p of searchPaths) {
          if (!existsSync(p)) continue;
          try {
            const data = JSON.parse(readFileSync(p, 'utf8'));
            const items = Array.isArray(data) ? data : (data.entries || data.insights || []);
            for (const item of items) {
              const text = typeof item === 'string' ? item : (item.text || item.content || item.title || JSON.stringify(item));
              if (text.toLowerCase().includes(query.toLowerCase())) {
                results.push({ source: basename(p), text: text.slice(0, 200) });
                if (results.length >= limit) break;
              }
            }
          } catch {}
          if (results.length >= limit) break;
        }
        if (!results.length) return `No results for: ${query}`;
        return results.map(r => `[${r.source}] ${r.text}`).join('\n---\n');
      }

      case 'sobor_ask': {
        const { question, personas = 'theologian,engineer,strategist' } = input;
        const personaList = personas.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
        const personaPrompts = {
          theologian: 'You are an Orthodox theologian. Answer with theological depth, referencing Scripture and the Fathers. Be concise.',
          engineer: 'You are a pragmatic engineer. Answer with concrete technical steps. Be concise and practical.',
          strategist: 'You are a strategic advisor. Answer with strategic insight, considering long-term consequences. Be concise.',
        };
        try {
          const answers = await Promise.all(personaList.map(async (persona) => {
            const sysPrompt = personaPrompts[persona] || `You are a ${persona}. Answer concisely.`;
            const resp = await apiCall([{ role: 'user', content: question }], sysPrompt, []);
            const text = resp.content?.find(b => b.type === 'text')?.text || '(no answer)';
            return { persona, text };
          }));
          return answers.map(a => `## ${a.persona}\n${a.text}`).join('\n\n---\n\n');
        } catch (e) {
          return { error: `Sobor failed: ${e.message}` };
        }
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: `Tool ${name} failed: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════
// API call (through proxy, Anthropic format)
// ═══════════════════════════════════════════════════════════════

const PROXY_URL = process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:3200';
const API_KEY = process.env.ANTHROPIC_AUTH_TOKEN || process.env.DEEPSEEK_API_KEY || 'proxy';

async function apiCall(messages, systemPrompt, tools) {
  const body = {
    model: 'claude-opus-4-6', // remapped by proxy
    max_tokens: 8192,
    system: systemPrompt,
    messages,
    tools,
  };

  const resp = await safeFetch(`${PROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let errText;
    try { errText = await resp.text(); } catch { errText = '(no body)'; }
    throw new Error(`API ${resp.status}: ${errText.slice(0, 300)}`);
  }

  return resp.json();
}

/**
 * Streaming API call — показывает текст по мере генерации.
 * Возвращает полный response объект (как non-streaming).
 * onText(chunk) вызывается для каждого фрагмента текста.
 * onToolUse(name, input) вызывается при начале tool_use.
 */
async function apiCallStream(messages, systemPrompt, tools, { onText, onToolUse } = {}) {
  const body = {
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    stream: true,
    system: systemPrompt,
    messages,
    tools,
  };

  // Use native fetch for streaming (proxy is localhost — resp.body is ReadableStream)
  const resp = await fetch(`${PROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let errText;
    try { errText = await resp.text(); } catch { errText = '(no body)'; }
    throw new Error(`API ${resp.status}: ${errText.slice(0, 300)}`);
  }

  // Parse SSE stream incrementally via ReadableStream
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const content = [];
  let currentBlock = null;
  let stopReason = null;
  let usage = { input_tokens: 0, output_tokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // Keep incomplete last line in buffer for next chunk
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      let event;
      try { event = JSON.parse(data); } catch { continue; }

      if (event.type === 'message_start' && event.message?.usage) {
        usage.input_tokens = event.message.usage.input_tokens || 0;
      }

      if (event.type === 'content_block_start') {
        currentBlock = event.content_block || {};
        if (currentBlock.type === 'tool_use' && onToolUse) {
          onToolUse(currentBlock.name, currentBlock.input || {});
        }
      }

      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          if (onText) onText(event.delta.text);
          if (currentBlock?.type === 'text') {
            currentBlock.text = (currentBlock.text || '') + event.delta.text;
          }
        }
        if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
          if (currentBlock?.type === 'tool_use') {
            currentBlock._jsonBuf = (currentBlock._jsonBuf || '') + event.delta.partial_json;
          }
        }
      }

      if (event.type === 'content_block_stop') {
        if (currentBlock) {
          if (currentBlock.type === 'tool_use' && currentBlock._jsonBuf) {
            try { currentBlock.input = JSON.parse(currentBlock._jsonBuf); } catch {}
            delete currentBlock._jsonBuf;
          }
          content.push(currentBlock);
          currentBlock = null;
        }
      }

      if (event.type === 'message_delta') {
        stopReason = event.delta?.stop_reason || stopReason;
        if (event.usage) usage.output_tokens = event.usage.output_tokens || 0;
      }
    }
  }

  return { content, stop_reason: stopReason, usage };
}

// ═══════════════════════════════════════════════════════════════
// W-Matrix: межсессионная память — что сделали агенты
// ═══════════════════════════════════════════════════════════════

const GIFT_DATA = process.env.GIFT_DATA || resolve(process.env.HOME || '/tmp', '.gift-code');
const W_PATH = resolve(GIFT_DATA, 'w-matrix.json');
const SESSIONS_DIR = resolve(GIFT_DATA, 'sessions');

function ensureDataDir() {
  if (!existsSync(GIFT_DATA)) mkdirSync(GIFT_DATA, { recursive: true });
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
}

function loadMatrix() {
  ensureDataDir();
  if (!existsSync(W_PATH)) return { acts: [], persons: {}, created: new Date().toISOString() };
  try { return JSON.parse(readFileSync(W_PATH, 'utf8')); } catch { return { acts: [], persons: {} }; }
}

function saveMatrix(w) {
  ensureDataDir();
  writeFileSync(W_PATH, JSON.stringify(w, null, 2));
}

function recordAct(w, from, to, content, type = 'code') {
  const act = {
    id: `act-${Date.now().toString(36)}`,
    from, to, content, type,
    timestamp: new Date().toISOString(),
    weight: 1,
  };
  w.acts.push(act);
  // Update person weights
  if (!w.persons[from]) w.persons[from] = { given: 0, received: 0 };
  if (!w.persons[to]) w.persons[to] = { given: 0, received: 0 };
  w.persons[from].given++;
  w.persons[to].received++;
  saveMatrix(w);
  return act;
}

function matrixSummary(w) {
  const acts = w.acts || [];
  const persons = Object.entries(w.persons || {});
  const recent = acts.slice(-5).map(a => `  ${a.from}→${a.to}: ${(a.content || '').slice(0, 60)}`).join('\n');
  return `W-Matrix: ${acts.length} acts, ${persons.length} persons\nRecent:\n${recent || '  (empty)'}`;
}

// ═══════════════════════════════════════════════════════════════
// Session persistence
// ═══════════════════════════════════════════════════════════════

function newSessionId() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function saveSession(session) {
  ensureDataDir();
  session.updatedAt = new Date().toISOString();
  writeFileSync(resolve(SESSIONS_DIR, `${session.id}.json`), JSON.stringify(session, null, 2));
}

function loadSession(id) {
  const p = resolve(SESSIONS_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function listSessions(limit = 10) {
  ensureDataDir();
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(readFileSync(resolve(SESSIONS_DIR, f), 'utf8'));
        return { id: data.id, turns: (data.messages || []).length, updatedAt: data.updatedAt, title: data.title };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════
// Cognitive Immune System (lightweight inline version)
// ═══════════════════════════════════════════════════════════════

const IMMUNE_LOG = resolve(GIFT_DATA, 'immune.log');

const MANIPULATION_MARKERS = {
  authority: ['эксперт', 'доказано', 'общеизвестно', 'все знают', 'бесспорно', 'неоспоримо'],
  urgency: ['срочно', 'немедленно', 'последний шанс', 'упуст', 'не ждёт'],
  flattery: ['лучш', 'великолепн', 'гениальн', 'уникальн', 'блестящ'],
  guilt: ['должны', 'обязаны', 'как вы можете', 'предательств'],
  fear: ['катастроф', 'погибн', 'потеряем', 'уничтож', 'обречен'],
  gaslighting: ['ты ошибаешься', 'этого не было', 'ты путаешь', 'тебе показалось'],
};

function immuneScan(text) {
  if (!text || text.length < 50) return null;
  const threats = [];
  const lower = text.toLowerCase();
  for (const [type, markers] of Object.entries(MANIPULATION_MARKERS)) {
    const found = markers.filter(m => lower.includes(m));
    if (found.length >= 2) threats.push({ type, markers: found });
  }
  if (threats.length === 0) return null;
  const entry = `[${new Date().toISOString()}] ${threats.length} threats: ${threats.map(t => t.type).join(', ')}\n`;
  try {
    ensureDataDir();
    writeFileSync(IMMUNE_LOG, (existsSync(IMMUNE_LOG) ? readFileSync(IMMUNE_LOG, 'utf8') : '') + entry);
  } catch {}
  return threats;
}

// ═══════════════════════════════════════════════════════════════
// Agent loop
// ═══════════════════════════════════════════════════════════════

function buildSystemPrompt() {
  // Lightweight matrix
  const w = loadMatrix();
  const wSummary = matrixSummary(w);

  // Full gift memory (if available)
  const giftMem = loadGiftMemory();
  const giftSummary = giftMemorySummary(giftMem);

  // KoinonBus messages (inter-agent comms)
  const bus = loadKoinon();
  const koinon = koinonRecent(bus, 5);

  return `You are gift-agent — coding assistant in the user's terminal.
Tools: Read, Write, Edit, Bash, Grep, Glob.
Be concise. Execute, don't explain.
Working directory: ${process.cwd()}

## Inter-session memory
${giftSummary ? `Gift Matrix (full):\n${giftSummary}` : `Local matrix:\n${wSummary}`}

${koinon ? `## Recent messages from other agents (KoinonBus)\n${koinon}` : ''}

When you complete a task, it is recorded in the matrix. Other agents will see it.`;
}

// ═══════════════════════════════════════════════════════════════
// Permission system: confirm unsafe tools
// ═══════════════════════════════════════════════════════════════

const SAFE_TOOLS = new Set(['Read', 'Grep', 'Glob']);

function toolPreview(tu) {
  const file = tu.input.file_path ? c('dim', ' → ' + (tu.input.file_path || '')) : '';
  switch (tu.name) {
    case 'Edit': {
      const oldLines = (tu.input.old_string || '').split('\n');
      const newLines = (tu.input.new_string || '').split('\n');
      const maxLines = 12; // не больше 12 строк diff'а
      const oldShow = oldLines.slice(0, maxLines);
      const newShow = newLines.slice(0, maxLines);
      let diff = file + '\n';
      for (const l of oldShow) {
        diff += `       ${c('red', '−')} ${c('dim', l.slice(0, 100))}\n`;
      }
      for (const l of newShow) {
        diff += `       ${c('green', '+')} ${l.slice(0, 100)}\n`;
      }
      if (oldLines.length > maxLines || newLines.length > maxLines) {
        diff += `       ${c('dim', '... (' + Math.max(oldLines.length, newLines.length) + ' lines total)')}`;
      }
      return diff.trimEnd();
    }
    case 'Write':
      return `${file}  ${c('dim', '(' + (tu.input.content?.length || 0) + ' bytes)')}
       ${c('dim', (tu.input.content || '').slice(0, 80).replace(/\n/g, '↵'))}`;
    case 'Bash':
      return `${c('dim', ' → ' + (tu.input.command || '').slice(0, 120))}`;
    default:
      return c('dim', ' → ' + JSON.stringify(tu.input).slice(0, 80));
  }
}

async function confirmTools(toolUses, autoYes, ui) {
  const approved = [];
  let allYes = autoYes;
  for (const tu of toolUses) {
    if (SAFE_TOOLS.has(tu.name) || allYes) {
      approved.push(tu);
      continue;
    }
    if (!ui) {
      process.stderr.write(`  ${c('red', '✗ rejected (non-interactive)')}: ${tu.name}\n`);
      continue;
    }
    // Информативный prompt
    const header = `\n  ${c('bold', '▸')} ${c('cyan', tu.name)}${toolPreview(tu)}`;
    const prompt = `${header}\n     ${c('green', '[Y]')} yes  ${c('red', '[N]')} no  ${c('gold', '[A]')} yes to all\n  ${c('yellow', '→')} `;
    const answer = await ui.confirmAction(prompt);
    if (answer === 'all') {
      allYes = true;
      approved.push(tu);
    } else if (answer === 'y') {
      approved.push(tu);
    } else {
      process.stderr.write(`     ${c('red', '✗ skipped')}\n`);
    }
  }
  return approved;
}

// ═══════════════════════════════════════════════════════════════
// Context compaction: auto-summarise old messages
// ═══════════════════════════════════════════════════════════════

function estimateTokens(messages) {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') total += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.text) total += b.text.length;
        if (b.content) total += b.content.length;
      }
    }
  }
  return Math.ceil(total / 4);
}

async function compactMessages(messages, systemPrompt) {
  // Keep: last 5 turns (user+assistant pairs)
  // Summarise older messages via a small API call
  const KEEP = 10; // last 10 messages (5 turns)
  if (messages.length <= KEEP) return messages;

  const toSummarise = messages.slice(0, -KEEP);
  const recent = messages.slice(-KEEP);

  // Build summary prompt
  const summaryText = toSummarise.map(m => {
    const role = m.role;
    const text = typeof m.content === 'string' ? m.content
      : (Array.isArray(m.content) ? m.content.map(b => b.text || b.content || '').join(' ') : '');
    return `[${role}] ${text.slice(0, 200)}`;
  }).join('\n');

  try {
    const resp = await apiCall([
      { role: 'user', content: `Summarise this conversation history in 3-5 bullet points (Russian):\n\n${summaryText}` }
    ], 'You are a summariser. Be concise. Output ONLY bullet points.', []);
    const summary = resp.content?.find(b => b.type === 'text')?.text || '(summary failed)';
    return [
      { role: 'user', content: `[Session context — earlier messages summarised]:\n${summary}` },
      ...recent,
    ];
  } catch {
    // Fallback: just truncate
    return [{ role: 'user', content: `[Earlier messages truncated for context: ${toSummarise.length} messages]` }, ...recent];
  }
}

export async function agentLoop(prompt, opts = {}) {
  const {
    systemPrompt = DEFAULT_SYSTEM,
    maxTurns = 30,
    tools = TOOLS,
    onToolUse,
    onText,
    onTurn,
    autoYes = false,
  } = opts;

  const messages = [{ role: 'user', content: prompt }];
  let turns = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (turns < maxTurns) {
    turns++;
    if (onTurn) onTurn(turns);

    // Auto-compact if >100K tokens
    const estTokens = estimateTokens(messages);
    if (estTokens > 100_000) {
      if (onText) onText('\n[compacting context...]\n');
      const compacted = await compactMessages(messages, systemPrompt);
      messages.length = 0;
      messages.push(...compacted);
    }

    const md = onText ? null : createMarkdownStream();
    const response = await apiCallStream(messages, systemPrompt, tools, {
      onText: (chunk) => {
        if (onText) onText(chunk);
        else md.write(chunk);
      },
      onToolUse: (name, input) => {
        if (onToolUse) onToolUse(name, input);
      },
    });
    if (md) md.flush();
    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    const content = response.content || [];
    let toolUses = content.filter(b => b.type === 'tool_use');

    // Confirm unsafe tools
    if (toolUses.length > 0) {
      toolUses = await confirmTools(toolUses, autoYes, null);
    }

    // No tool calls → done
    if (toolUses.length === 0) {
      break;
    }

    // Execute tools
    messages.push({ role: 'assistant', content });

    const toolResults = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input);
      const resultText = typeof result === 'string' ? result : JSON.stringify(result);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: resultText.slice(0, 50000),
      });
    }

    messages.push({ role: 'user', content: toolResults });

    // Stop reason
    if (response.stop_reason === 'end_turn') break;
  }

  return { turns, totalInputTokens, totalOutputTokens };
}

// ═══════════════════════════════════════════════════════════════
// Interactive REPL
// ═══════════════════════════════════════════════════════════════

export async function runRepl(opts = {}) {
  const systemPrompt = opts.systemPrompt || buildSystemPrompt();
  const autoYes = opts.autoYes || false;
  const w = loadMatrix();

  // Session: resume or new
  const resumeId = opts.resume;
  let session;
  if (resumeId) {
    const rid = resumeId === 'last' ? (listSessions(1)[0]?.id) : resumeId;
    session = rid ? loadSession(rid) : null;
    if (!session) { console.error(`Session not found: ${resumeId}`); process.exit(1); }
  } else {
    session = { id: newSessionId(), messages: [], createdAt: new Date().toISOString() };
  }

  const actCount = (w.acts || []).length;
  const personCount = Object.keys(w.persons || {}).length;

  // Dynamic prompt: статус бэкенда кешируется асинхронно
  let _statusCache = '...';
  async function refreshStatus() {
    try {
      const r = await fetch(`${PROXY_URL}/_proxy/status`);
      const data = await r.json();
      _statusCache = `${data.mode || '?'}:${data.model?.slice(0, 20) || '?'}`;
    } catch { _statusCache = 'proxy offline'; }
  }
  await refreshStatus();

  process.stdout.write(`
   ${c('gold', '██████╗ ██╗███████╗████████╗')}
  ${c('gold', '██╔════╝ ██║██╔════╝╚══██╔══╝')}
  ${c('gold', '██║  ███╗██║█████╗     ██║')}
  ${c('gold', '██║   ██║██║██╔══╝     ██║')}
  ${c('gold', '╚██████╔╝██║██║        ██║')}
  ${c('gold', ' ╚═════╝ ╚═╝╚═╝        ╚═╝')}

  ${c('bold', 'gift-agent')} ${c('dim', 'v0.1.0')}
  ${c('dim', process.cwd())}
  ${c('dim', `backend: ${_statusCache}  |  matrix: ${actCount} acts, ${personCount} persons  |  ${session.id}`)}
  ${c('dim', '/switch ra|ds  /sessions  /matrix  /help  Ctrl+D — exit')}

`);

  const spinner = new Spinner();
  const slashCommands = [
    { cmd: '/switch', desc: 'переключить бэкенд (ra|ds|or|fw)', needsArg: true },
    { cmd: '/login', desc: 'установить API ключ', needsArg: true },
    { cmd: '/status', desc: 'статус прокси', needsArg: false },
    { cmd: '/matrix', desc: 'W-матрица', needsArg: false },
    { cmd: '/sessions', desc: 'список сессий', needsArg: false },
    { cmd: '/resume', desc: 'продолжить сессию', needsArg: true },
    { cmd: '/koinon', desc: 'сообщения от других агентов', needsArg: false },
    { cmd: '/clear', desc: 'очистить историю', needsArg: false },
    { cmd: '/compact', desc: 'сжать контекст (оставить последние 5 ходов)', needsArg: false },
    { cmd: '/help', desc: 'справка', needsArg: false },
    { cmd: '/exit', desc: 'выход', needsArg: false },
  ];

  const conversationMessages = session.messages || [];
  let uiReady;

  const HR = '────────────────────────────────────────────────────────────────';
  // Однострочный промпт (как ввод Claude Code). Многострочные рамки ломали рендер.
  function buildPrompt() {
    return `${c('green', '❯')} `;
  }

  let _promptCache = buildPrompt();

  // Try TermUI (raw mode), fallback to readline
  let ui;
  try {
    const { TermUI } = await import('./term-ui.js');
    ui = new TermUI({
      prompt: _promptCache,
      getPrompt: () => {
        refreshStatus(); // fire-and-forget async refresh
        _promptCache = buildPrompt();
        return _promptCache;
      },
      slashCommands,
      onLine: (line) => handleInput(line),
      onClose: () => {
        session.messages = conversationMessages;
        saveSession(session);
        // Уйти на новую строку после промпта и очистить
        process.stdout.write('\n\n\n\r\x1b[2K');
        process.exit(0);
      },
    });
    ui.start();
  } catch {
    // Fallback readline
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `${c('green', '>')} ` });
    rl.prompt();
    rl.on('line', line => handleInput(line).then(() => rl.prompt()));
    rl.on('close', () => {
      session.messages = conversationMessages;
      saveSession(session);
      process.exit(0);
    });
  }

  async function handleInput(line) {
    const input = line.trim();
    if (!input) return;

    // Slash commands
    if (input === '/help') {
      console.log(`
  /switch [ra|ds|or|fw]  — переключить бэкенд
  /login <backend> <key> — установить API ключ
  /status                — статус прокси
  /matrix                — W-матрица (межсессионная память)
  /sessions              — список сессий
  /resume <id>           — продолжить сессию
  /koinon                — сообщения от других агентов
  /clear                 — очистить историю
  /compact               — сжать контекст
  /exit                  — выход

  --yes, --accept-edits  — автоподтверждение Write/Edit/Bash
`);
      if (ui) ui.resume(); return;
    }

    if (input.startsWith('/switch')) {
      const backend = input.split(/\s+/)[1];
      const short = { ra: 'routerai', ds: 'deepseek', or: 'openrouter', fw: 'fireworks' };
      if (!backend) {
        try {
          const r = await fetch(`${PROXY_URL}/_proxy/status`);
          const data = await r.json();
          console.log(`  ${c('bold', data.label || data.mode)} | ${data.requests || 0} requests`);
        } catch { console.log('  Proxy not running'); }
      } else {
        try {
          const r = await fetch(`${PROXY_URL}/_proxy/mode`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: `backend=${short[backend] || backend}`,
          });
          const data = await r.json();
          if (data.error) console.log(`  Error: ${data.error}`);
          else console.log(`  ${data.previous} → ${c('bold', data.mode)}`);
        } catch { console.log('  Proxy not running'); }
      }
      if (ui) ui.resume(); return;
    }

    if (input.startsWith('/login')) {
      const parts = input.split(/\s+/);
      const short = { ra: 'routerai', ds: 'deepseek', or: 'openrouter', fw: 'fireworks' };
      const backend = short[parts[1]] || parts[1];
      const key = parts[2];
      if (!backend || !key) { console.log('  /login <backend> <key>'); if (ui) ui.resume(); return; }
      try {
        await fetch(`${PROXY_URL}/_proxy/key`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `backend=${backend}&key=${key}`,
        });
        await fetch(`${PROXY_URL}/_proxy/mode`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `backend=${backend}`,
        });
        console.log(`  Key set, switched to ${c('bold', backend)}`);
      } catch { console.log('  Proxy not running'); }
      if (ui) ui.resume(); return;
    }

    if (input === '/status') {
      try {
        const r = await fetch(`${PROXY_URL}/_proxy/status`);
        const data = await r.json();
        console.log(`  ${c('bold', data.label || data.mode)} | model: ${data.model || '?'} | ${data.requests} requests`);
      } catch { console.log('  Proxy not running'); }
      if (ui) ui.resume(); return;
    }

    if (input === '/matrix') {
      const fresh = loadMatrix();
      console.log(`\n${matrixSummary(fresh)}\n`);
      if (ui) ui.resume(); return;
    }

    if (input === '/sessions') {
      const list = listSessions(10);
      if (!list.length) { console.log('  No sessions yet'); }
      else {
        console.log(`\n  ${c('bold', 'Sessions:')}`);
        for (const s of list) {
          const mark = s.id === session.id ? c('green', '→') : ' ';
          console.log(`  ${mark} ${s.id}  ${c('dim', `${s.turns} turns  ${s.updatedAt || ''}`)}`);
        }
      }
      console.log();
      if (ui) ui.resume(); return;
    }

    if (input.startsWith('/resume')) {
      const rid = input.split(/\s+/)[1];
      if (!rid) { console.log('  /resume <session-id> or /resume last'); if (ui) ui.resume(); return; }
      const target = rid === 'last' ? (listSessions(1)[0]?.id) : rid;
      const loaded = target ? loadSession(target) : null;
      if (!loaded) { console.log(`  Session not found: ${rid}`); if (ui) ui.resume(); return; }
      // Save current
      session.messages = conversationMessages;
      saveSession(session);
      // Switch
      session = loaded;
      conversationMessages.length = 0;
      conversationMessages.push(...(loaded.messages || []));
      console.log(`  Resumed: ${session.id} (${conversationMessages.length} messages)`);
      if (ui) ui.resume(); return;
    }

    if (input === '/koinon') {
      const bus = loadKoinon();
      if (!bus) { console.log('  KoinonBus not available (running outside gift/)'); }
      else {
        const msgs = koinonRecent(bus, 10);
        console.log(`\n${c('bold', 'KoinonBus — recent messages:')}\n${msgs || '  (empty)'}\n`);
      }
      if (ui) ui.resume(); return;
    }

    if (input === '/clear') {
      conversationMessages.length = 0;
      console.log('  History cleared');
      if (ui) ui.resume(); return;
    }

    if (input === '/compact') {
      const est = estimateTokens(conversationMessages);
      if (conversationMessages.length < 6) {
        console.log(`  ${c('dim', 'Too few messages to compact (${conversationMessages.length} msgs, ~${est} tokens)')}`);
      } else {
        console.log(`  ${c('dim', `Compacting ${conversationMessages.length} msgs (~${est} tokens)...`)}`);
        const compacted = await compactMessages(conversationMessages, systemPrompt);
        conversationMessages.length = 0;
        conversationMessages.push(...compacted);
        console.log(`  ${c('green', 'Compacted')} → ${conversationMessages.length} msgs (~${estimateTokens(conversationMessages)} tokens)`);
      }
      if (ui) ui.resume(); return;
    }

    if (input === '/exit' || input === '/quit') {
      session.messages = conversationMessages;
      saveSession(session);
      console.log(`  Session saved: ${session.id}`);
      if (ui) { ui.stop(); }
      session.messages = conversationMessages;
      saveSession(session);
      console.log(`  ${c('dim', 'session saved: ' + session.id)}`);
      process.exit(0);
    }

    // Agent call
    conversationMessages.push({ role: 'user', content: input });
    if (ui) ui.release();

    try {
      const messages = [...conversationMessages];
      let fullText = '';
      let streamStarted = false;

      // Auto-compact if >100K tokens
      const estTokens = estimateTokens(messages);
      if (estTokens > 100_000) {
        process.stderr.write(`  ${c('dim', '[compacting context...]')}\n`);
        const compacted = await compactMessages(messages, systemPrompt);
        messages.length = 0;
        messages.push(...compacted);
      }

      // Helper: streaming call with spinner management
      async function streamCall(msgs, spinLabel) {
        spinner.start(spinLabel);
        streamStarted = false;
        const md = createMarkdownStream();
        const resp = await apiCallStream(msgs, systemPrompt, TOOLS, {
          onText: (chunk) => {
            if (!streamStarted) { spinner.stop(); streamStarted = true; }
            md.write(chunk);
            fullText += chunk;
          },
          onToolUse: (name) => {
            spinner.update(name);
          },
        });
        md.flush();
        spinner.stop();
        return resp;
      }

      const response = await streamCall(messages);

      const content = response.content || [];

      // Confirm unsafe tools before executing
      let toolUses = content.filter(b => b.type === 'tool_use');
      if (toolUses.length > 0) {
        toolUses = await confirmTools(toolUses, autoYes, ui);
      }

      // Agent loop for tool_use
      let loopMessages = [...messages, { role: 'assistant', content }];
      let loopCount = 0;

      while (toolUses.length > 0 && loopCount < 20) {
        loopCount++;

        // Execute tools
        const toolResults = [];
        for (const tu of toolUses) {
          process.stderr.write(`  ${c('cyan', '● ' + tu.name)} ${c('dim', JSON.stringify(tu.input).slice(0, 80))}\n`);
          const result = await executeTool(tu.name, tu.input);
          const resultText = typeof result === 'string' ? result : JSON.stringify(result);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: resultText.slice(0, 50000),
          });
        }

        loopMessages.push({ role: 'user', content: toolResults });

        // Next API call — streaming
        const nextResp = await streamCall(loopMessages, 'продолжаю...');
        const nextContent = nextResp.content || [];
        loopMessages.push({ role: 'assistant', content: nextContent });

        toolUses = nextContent.filter(b => b.type === 'tool_use');

        // Confirm before next iteration
        if (toolUses.length > 0) {
          toolUses = await confirmTools(toolUses, autoYes, ui);
        }

        if (nextResp.stop_reason === 'end_turn') break;
      }
      process.stdout.write('\n\n');

      // CIS: scan for manipulation
      const threats = immuneScan(fullText);
      if (threats) {
        process.stderr.write(`  ${c('red', '⚠ CIS:')} ${threats.map(t => t.type).join(', ')}\n`);
      }

      // Save full conversation chain (not just final response)
      // loopMessages contains: [user, assistant(tools), user(results), assistant(tools), ...]
      // conversationMessages already has the user message, so append everything after it
      const newMessages = loopMessages.slice(conversationMessages.length);
      conversationMessages.push(...newMessages);

      // Auto-save session
      session.messages = conversationMessages;
      saveSession(session);

      // Record in W-matrix + KoinonBus
      const agentId = process.env.GIFT_AGENT_ID || 'gift-agent';
      const userId = process.env.USER || 'user';
      const summary = fullText.slice(0, 100).replace(/\n/g, ' ');
      if (summary.length > 10) {
        const wFresh = loadMatrix();
        recordAct(wFresh, agentId, userId, summary, 'response');
        // Notify other agents via KoinonBus
        const bus = loadKoinon();
        if (bus) {
          try { bus.publish({ from: agentId, to: '*', topic: 'sync', message: summary }); } catch {}
        }
      }

    } catch (e) {
      spinner.stop();
      const cause = e.cause?.message || e.cause?.code || '';
      console.error(`  ${c('red', 'Error:')} ${e.message}${cause ? ' (' + cause + ')' : ''}`);
    }

    process.stdout.write('\n');
    if (ui) ui.resume();
  }
}

// ═══════════════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════════════

if (process.argv[1]?.endsWith('gift-agent.js')) {
  const args = process.argv.slice(2);
  const resumeIdx = args.indexOf('--resume');
  const resume = resumeIdx >= 0 ? (args[resumeIdx + 1] || 'last') : null;
  const autoYes = args.includes('--yes') || args.includes('--accept-edits');
  const prompt = args.filter((a, i) => !a.startsWith('--') && i !== resumeIdx + 1).join(' ');

  // Read from stdin if piped
  let stdinPrompt = '';
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    stdinPrompt = Buffer.concat(chunks).toString().trim();
  }

  const finalPrompt = prompt || stdinPrompt;

  if (finalPrompt && !resume) {
    // Single-turn mode
    const result = await agentLoop(finalPrompt, { systemPrompt: buildSystemPrompt(), autoYes });
    // Record in matrix
    const w = loadMatrix();
    recordAct(w, process.env.GIFT_AGENT_ID || 'gift-agent', process.env.USER || 'user',
      finalPrompt.slice(0, 100), 'task');
    process.exit(0);
  } else {
    // REPL mode (interactive)
    await runRepl({ resume, autoYes });
  }
}
