import { createServer } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { Transform } from 'stream';
import fs from 'fs';
import dns from 'dns';
import { CognitiveImmuneSystem } from './CognitiveImmuneSystem.js';

// WSL2 DNS fix: pre-resolve hostnames using Google DNS, then use IP directly
const _dnsResolver = new dns.Resolver();
_dnsResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
const _dnsCache = {};
async function resolveHost(hostname) {
  if (_dnsCache[hostname]) return _dnsCache[hostname];
  return new Promise((resolve, reject) => {
    _dnsResolver.resolve4(hostname, (err, addrs) => {
      if (err) return reject(err);
      _dnsCache[hostname] = addrs[0];
      console.log(`[DNS] ${hostname} → ${addrs[0]}`);
      resolve(addrs[0]);
    });
  });
}
// Pre-resolve known hosts
resolveHost('api.deepseek.com').catch(() => {});
resolveHost('api.anthropic.com').catch(() => {});
resolveHost('openrouter.ai').catch(() => {});
resolveHost('routerai.ru').catch(() => {});

const ANTHROPIC_FALLBACK = 'https://api.anthropic.com';
const MODEL_PATHS = ['/v1/messages'];
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per request

// ═══ КИС: Когнитивная Иммунная Система для DeepClaude ═══
const immuneSystem = new CognitiveImmuneSystem({ acts: [] });
immuneSystem.activatePublicRepertoire();
const IMMUNE_LOG = './immune-deepclaude.log';

function immuneScan(text, source = 'deepseek') {
  if (!text || text.length < 30) return null;
  const diag = immuneSystem.fullDiagnostics(text, source);
  if (!diag.clean || diag.silence || diag.health?.label === 'мёртвый') {
    const entry = `[${new Date().toISOString()}] ${source} | verdict:${diag.verdict} threats:${diag.threats.length} danger:${diag.dangerLevel} health:${diag.health?.label}\n`;
    try { fs.appendFileSync(IMMUNE_LOG, entry); } catch {}
    return diag;
  }
  return null;
}

const MODEL_REMAP = {
    deepseek: {
        'claude-opus-4-6':    'deepseek-v4-pro',
        'claude-opus-4-7':    'deepseek-v4-pro',
        'claude-sonnet-4-6':  'deepseek-v4-flash',
        'claude-sonnet-4-5-20250929': 'deepseek-v4-flash',
        'claude-haiku-4-5-20251001':  'deepseek-v4-flash',
    },
    openrouter: {
        'claude-opus-4-6':    'deepseek/deepseek-v4-pro',
        'claude-opus-4-7':    'deepseek/deepseek-v4-pro',
        'claude-sonnet-4-6':  'deepseek/deepseek-v4-flash',
        'claude-sonnet-4-5-20250929': 'deepseek/deepseek-v4-flash',
        'claude-haiku-4-5-20251001':  'deepseek/deepseek-v4-flash',
    },
    routerai: {
        'claude-opus-4-6':    'deepseek/deepseek-v4-pro',
        'claude-opus-4-7':    'deepseek/deepseek-v4-pro',
        'claude-sonnet-4-6':  'deepseek/deepseek-v4-pro',
        'claude-sonnet-4-5-20250929': 'deepseek/deepseek-v4-flash',
        'claude-haiku-4-5-20251001':  'qwen/qwen3-coder-30b-a3b-instruct',
    },
};

const PRICING_PER_M = {
    deepseek:   { input: 0.44,  output: 0.87 },
    openrouter: { input: 0.44,  output: 0.87 },
    fireworks:  { input: 1.74,  output: 3.48 },
    routerai:   { input: 0.66,  output: 1.32 }, // DS V4 Pro via RouterAI (~61₽/1M)
    anthropic:  { input: 3.00,  output: 15.00 },
    _single:    { input: 0.44,  output: 0.87 },
};

/**
 * Transform stream that intercepts SSE events and injects missing `usage`
 * fields. DeepSeek/OpenRouter may omit `usage` in message_start or
 * message_delta, which crashes Claude Code ("$.input_tokens" is undefined).
 */
class UsageNormalizer extends Transform {
    constructor(onUsage) {
        super();
        this._buf = '';
        this._onUsage = onUsage;
        this._inputTokens = 0;
        this._outputTokens = 0;
        this._fullText = ''; // КИС: собираем текст для сканирования
    }

    _transform(chunk, _enc, cb) {
        this._buf += chunk.toString();
        const parts = this._buf.split('\n\n');
        this._buf = parts.pop();
        for (const part of parts) {
            this.push(this._fix(part) + '\n\n');
        }
        cb();
    }

    _fix(event) {
        const m = event.match(/^data: (.+)$/m);
        if (!m) return event;
        try {
            const d = JSON.parse(m[1]);
            let changed = false;
            // КИС: собираем текст из content_block_delta
            if (d.type === 'content_block_delta' && d.delta?.text) {
                this._fullText += d.delta.text;
            }
            if (d.type === 'message_start' && d.message) {
                if (d.message.usage) {
                    this._inputTokens = d.message.usage.input_tokens || 0;
                } else {
                    d.message.usage = { input_tokens: 0, output_tokens: 0 };
                    changed = true;
                }
            }
            if (d.type === 'message_delta') {
                if (d.usage) {
                    this._outputTokens = d.usage.output_tokens || 0;
                } else {
                    d.usage = { output_tokens: 0 };
                    changed = true;
                }
            }
            if (changed) return event.replace(m[1], () => JSON.stringify(d));
        } catch { /* not JSON, pass through */ }
        return event;
    }

    _flush(cb) {
        if (this._buf.trim()) this.push(this._fix(this._buf) + '\n\n');
        if (this._onUsage) this._onUsage(this._inputTokens, this._outputTokens);
        // КИС: сканировать полный ответ модели
        if (this._fullText.length > 30) {
            const diag = immuneScan(this._fullText, 'deepseek');
            if (diag && !diag.clean) {
                const threats = diag.threats.map(t => t.name).join(', ');
                console.log(`  🛡 КИС: ${diag.verdict} | ${diag.threats.length} threats (${threats}) | danger:${diag.dangerLevel} | health:${diag.health?.label}`);
            }
        }
        cb();
    }
}

/**
 * For non-streaming JSON responses, ensure `usage` exists.
 */
function normalizeJsonBody(buf) {
    try {
        const obj = JSON.parse(buf);
        if (obj.type === 'message' && !obj.usage) {
            obj.usage = { input_tokens: 0, output_tokens: 0 };
            return Buffer.from(JSON.stringify(obj));
        }
    } catch { /* not JSON */ }
    return buf;
}

function stripAllThinkingBlocks(body) {
    if (!body?.messages) return;
    for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        msg.content = msg.content.filter(b => b.type !== 'thinking');
    }
}

function stripUnsignedThinkingBlocks(body) {
    if (!body?.messages) return;
    for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        msg.content = msg.content.filter(
            block => block.type !== 'thinking' || block.signature
        );
    }
}

export function startModelProxy({ targetUrl, apiKey, startPort = 3200, backends, defaultMode }) {
    return new Promise((resolve, reject) => {
        const initialTarget = new URL(targetUrl);
        const initialBearer = targetUrl.includes('openrouter') || targetUrl.includes('fireworks');

        const allBackends = {};
        if (backends) {
            for (const [name, cfg] of Object.entries(backends)) {
                allBackends[name] = {
                    target: new URL(cfg.url),
                    apiKey: cfg.apiKey,
                    useBearer: cfg.url.includes('openrouter') || cfg.url.includes('fireworks') || cfg.url.includes('routerai'),
                };
            }
        }
        const initialName = defaultMode || (backends ? 'anthropic' : null);
        const startBackend = initialName && initialName !== 'anthropic' && allBackends[initialName];

        const state = {
            mode: initialName || '_single',
            target: startBackend ? startBackend.target : initialTarget,
            apiKey: startBackend ? startBackend.apiKey : apiKey,
            useBearer: startBackend ? startBackend.useBearer : initialBearer,
            hadNonAnthropicSession: !!startBackend,
        };

        let reqCount = 0;
        const t0Global = Date.now();
        const costs = {};

        function recordUsage(backend, inputTokens, outputTokens) {
            if (!costs[backend]) costs[backend] = { input: 0, output: 0, requests: 0 };
            costs[backend].input += inputTokens || 0;
            costs[backend].output += outputTokens || 0;
            costs[backend].requests++;
        }

        function getCostSummary() {
            const summary = {};
            let totalActual = 0;
            let totalAnthropic = 0;
            for (const [backend, tokens] of Object.entries(costs)) {
                const p = PRICING_PER_M[backend] || PRICING_PER_M._single;
                const ap = PRICING_PER_M.anthropic;
                const actual = (tokens.input * p.input + tokens.output * p.output) / 1_000_000;
                const anthropicEq = (tokens.input * ap.input + tokens.output * ap.output) / 1_000_000;
                totalActual += actual;
                totalAnthropic += anthropicEq;
                summary[backend] = {
                    input_tokens: tokens.input,
                    output_tokens: tokens.output,
                    requests: tokens.requests,
                    cost: +actual.toFixed(4),
                    anthropic_equivalent: +anthropicEq.toFixed(4),
                };
            }
            return {
                backends: summary,
                total_cost: +totalActual.toFixed(4),
                anthropic_equivalent: +totalAnthropic.toFixed(4),
                savings: +((totalAnthropic - totalActual).toFixed(4)),
            };
        }

        function switchMode(name) {
            if (name === 'anthropic') {
                const prev = state.mode;
                state.mode = 'anthropic';
                state.target = new URL(ANTHROPIC_FALLBACK);
                state.apiKey = null;
                state.useBearer = false;
                return { mode: 'anthropic', previous: prev };
            }
            const b = allBackends[name];
            if (!b) return { error: `Unknown backend: ${name}. Valid: anthropic, ${Object.keys(allBackends).join(', ')}` };
            if (!b.apiKey) return { error: `API key not set for ${name}` };
            const prev = state.mode;
            state.mode = name;
            state.target = b.target;
            state.apiKey = b.apiKey;
            state.useBearer = b.useBearer;
            state.hadNonAnthropicSession = true;
            return { mode: name, previous: prev };
        }

        const server = createServer((clientReq, clientRes) => {
            const urlPath = clientReq.url.split('?')[0];

            // Control endpoints — /_proxy/* (never collides with /v1/*)
            if (urlPath.startsWith('/_proxy/')) {
                if (urlPath === '/_proxy/status') {
                    const remap = MODEL_REMAP[state.mode] || {};
                    const modelNames = Object.values(remap);
                    const mainModel = modelNames[0] || 'anthropic';
                    const labels = {
                        deepseek: 'DeepSeek (api.deepseek.com)',
                        routerai: 'RouterAI (routerai.ru) — рубли',
                        openrouter: 'OpenRouter',
                        fireworks: 'Fireworks AI',
                        anthropic: 'Anthropic (оригинал)',
                    };
                    clientRes.writeHead(200, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify({
                        mode: state.mode,
                        label: labels[state.mode] || state.mode,
                        model: mainModel,
                        uptime: Math.round((Date.now() - t0Global) / 1000),
                        requests: reqCount,
                    }));
                    return;
                }
                if (urlPath === '/_proxy/cost') {
                    clientRes.writeHead(200, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify(getCostSummary()));
                    return;
                }
                if (urlPath === '/_proxy/key' && clientReq.method === 'POST') {
                    const origin = clientReq.headers['origin'] || '';
                    if (origin && !origin.startsWith('http://127.0.0.1') && !origin.startsWith('http://localhost')) {
                        clientRes.writeHead(403, { 'content-type': 'application/json' });
                        clientRes.end(JSON.stringify({ error: 'Forbidden' }));
                        return;
                    }
                    const chunks = [];
                    let bodySize = 0;
                    clientReq.on('data', c => {
                        bodySize += c.length;
                        if (bodySize > 2048) { clientReq.destroy(); return; }
                        chunks.push(c);
                    });
                    clientReq.on('end', () => {
                        const body = Buffer.concat(chunks).toString();
                        const mBackend = body.match(/backend=([a-z]+)/);
                        const mKey = body.match(/key=([^\s&]+)/);
                        if (!mBackend || !mKey) {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify({ error: 'Need backend=<name>&key=<api_key>' }));
                            return;
                        }
                        const bName = mBackend[1];
                        const bKey = mKey[1];
                        if (bName === 'anthropic') {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify({ error: 'Cannot set key for anthropic' }));
                            return;
                        }
                        if (!allBackends[bName]) {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify({ error: `Unknown backend: ${bName}. Valid: ${Object.keys(allBackends).join(', ')}` }));
                            return;
                        }
                        allBackends[bName].apiKey = bKey;
                        // If this is the active backend, update state too
                        if (state.mode === bName) {
                            state.apiKey = bKey;
                        }
                        const masked = bKey.slice(0, 6) + '****' + bKey.slice(-4);
                        console.log(`[MODEL-PROXY] Key set for ${bName}: ${masked}`);
                        clientRes.writeHead(200, { 'content-type': 'application/json' });
                        clientRes.end(JSON.stringify({ backend: bName, key: masked, active: state.mode === bName }));
                    });
                    return;
                }
                if (urlPath === '/_proxy/mode' && clientReq.method === 'POST') {
                    const origin = clientReq.headers['origin'] || '';
                    if (origin && !origin.startsWith('http://127.0.0.1') && !origin.startsWith('http://localhost')) {
                        clientRes.writeHead(403, { 'content-type': 'application/json' });
                        clientRes.end(JSON.stringify({ error: 'Forbidden' }));
                        return;
                    }
                    const chunks = [];
                    let bodySize = 0;
                    clientReq.on('data', c => {
                        bodySize += c.length;
                        if (bodySize > 1024) { clientReq.destroy(); return; }
                        chunks.push(c);
                    });
                    clientReq.on('end', () => {
                        const body = Buffer.concat(chunks).toString();
                        const m = body.match(/backend=([a-z]+)/);
                        if (!m) {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify({ error: 'Missing backend= in body' }));
                            return;
                        }
                        const result = switchMode(m[1]);
                        if (result.error) {
                            clientRes.writeHead(400, { 'content-type': 'application/json' });
                            clientRes.end(JSON.stringify(result));
                            return;
                        }
                        const remap = MODEL_REMAP[result.mode] || {};
                        const modelNames = Object.values(remap);
                        result.model = modelNames[0] || 'anthropic';
                        const labels = {
                            deepseek: 'DeepSeek', routerai: 'RouterAI (рубли)',
                            openrouter: 'OpenRouter', fireworks: 'Fireworks',
                            anthropic: 'Anthropic',
                        };
                        result.label = labels[result.mode] || result.mode;
                        console.log(`[MODEL-PROXY] Mode switched: ${result.previous} → ${result.mode} (${result.model})`);
                        clientRes.writeHead(200, { 'content-type': 'application/json' });
                        clientRes.end(JSON.stringify(result));
                    });
                    return;
                }
                if (urlPath === '/_proxy/mode' && clientReq.method !== 'POST') {
                    clientRes.writeHead(405, { 'content-type': 'application/json' });
                    clientRes.end(JSON.stringify({ error: 'Use POST' }));
                    return;
                }
                clientRes.writeHead(404, { 'content-type': 'application/json' });
                clientRes.end(JSON.stringify({ error: 'Not found' }));
                return;
            }

            // In anthropic mode, everything passes through transparently
            const isAnthropicMode = state.mode === 'anthropic';
            const isModelCall = !isAnthropicMode && MODEL_PATHS.includes(urlPath);
            const dest = isModelCall ? state.target : new URL(ANTHROPIC_FALLBACK);

            // Build upstream path. target.pathname may overlap with
            // clientReq.url (e.g. OpenRouter /api/v1 + /v1/messages).
            // Strip the shared prefix to avoid /api/v1/v1/messages.
            let fullPath;
            if (isModelCall) {
                const base = state.target.pathname.replace(/\/$/, '');
                let overlap = '';
                for (let i = 1; i <= Math.min(base.length, urlPath.length); i++) {
                    if (base.endsWith(urlPath.substring(0, i))) overlap = urlPath.substring(0, i);
                }
                fullPath = overlap ? base + urlPath.substring(overlap.length) : base + urlPath;
            } else {
                fullPath = clientReq.url;
            }

            const reqId = ++reqCount;
            const t0 = Date.now();

            if (isModelCall) {
                console.log(`[MODEL-PROXY] #${reqId} → ${dest.hostname}${fullPath}`);
            }

            const headers = { ...clientReq.headers, host: dest.host };
            delete headers['content-length'];

            if (isModelCall) {
                delete headers['authorization'];
                delete headers['x-api-key'];
                if (state.useBearer) {
                    headers['authorization'] = `Bearer ${state.apiKey}`;
                } else {
                    headers['x-api-key'] = state.apiKey;
                }
            }

            const chunks = [];
            clientReq.on('data', c => chunks.push(c));
            clientReq.on('end', () => {
                let body = Buffer.concat(chunks);

                // Remap Anthropic model names to backend-specific names
                if (isModelCall && MODEL_REMAP[state.mode]) {
                    try {
                        const parsed = JSON.parse(body);
                        const mapped = MODEL_REMAP[state.mode][parsed.model];
                        if (mapped) {
                            console.log(`[MODEL-PROXY] #${reqId} model remap: ${parsed.model} → ${mapped}`);
                            parsed.model = mapped;
                            body = Buffer.from(JSON.stringify(parsed));
                        }
                    } catch { /* not JSON or parse error, pass through */ }
                }

                // Strip thinking blocks before forwarding.
                // Non-Anthropic: strip ALL blocks — backends reject thinking blocks
                // they didn't generate, even unsigned ones.
                // Anthropic after a non-Anthropic session: also strip ALL, because
                // foreign backends generate signed-but-invalid thinking blocks that
                // stripUnsignedThinkingBlocks passes through, causing Anthropic 400s.
                if (isAnthropicMode && MODEL_PATHS.includes(urlPath)) {
                    try {
                        const parsed = JSON.parse(body);
                        if (state.hadNonAnthropicSession) {
                            stripAllThinkingBlocks(parsed);
                        } else {
                            stripUnsignedThinkingBlocks(parsed);
                        }
                        body = Buffer.from(JSON.stringify(parsed));
                    } catch { /* pass through */ }
                }
                if (isModelCall) {
                    try {
                        const parsed = JSON.parse(body);
                        // DeepSeek requires thinking blocks to be passed back
                        // Only strip for non-DeepSeek backends
                        if (state.mode !== 'deepseek') {
                            stripAllThinkingBlocks(parsed);
                        }
                        body = Buffer.from(JSON.stringify(parsed));
                    } catch { /* pass through */ }
                }

                // WSL2: use pre-resolved IP if available
                const resolvedIP = _dnsCache[dest.hostname];
                const opts = {
                    hostname: resolvedIP || dest.hostname,
                    port: dest.port || 443,
                    path: fullPath,
                    method: clientReq.method,
                    headers: { ...headers, 'content-length': body.length, ...(resolvedIP ? { host: dest.hostname } : {}) },
                    timeout: REQUEST_TIMEOUT_MS,
                    servername: dest.hostname, // SNI for TLS
                };

                const proxyReq = httpsRequest(opts, (proxyRes) => {
                    if (isModelCall) {
                        const ttfb = Date.now() - t0;
                        console.log(`[MODEL-PROXY] #${reqId} TTFB ${ttfb}ms (status ${proxyRes.statusCode})`);
                    }

                    const ct = proxyRes.headers['content-type'] || '';
                    const isSSE = ct.includes('text/event-stream');

                    if (isModelCall && isSSE) {
                        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                        const norm = new UsageNormalizer((inp, out) => recordUsage(state.mode, inp, out));
                        proxyRes.pipe(norm).pipe(clientRes);
                        proxyRes.on('end', () => {
                            console.log(`[MODEL-PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${norm._inputTokens}in/${norm._outputTokens}out)`);
                        });
                    } else if (isModelCall && ct.includes('application/json')) {
                        const respChunks = [];
                        proxyRes.on('data', c => respChunks.push(c));
                        proxyRes.on('end', () => {
                            const raw = Buffer.concat(respChunks);
                            const fixed = normalizeJsonBody(raw);
                            try {
                                const j = JSON.parse(fixed);
                                if (j.usage) recordUsage(state.mode, j.usage.input_tokens, j.usage.output_tokens);
                            } catch {}
                            const outHeaders = { ...proxyRes.headers, 'content-length': fixed.length };
                            delete outHeaders['transfer-encoding'];
                            clientRes.writeHead(proxyRes.statusCode, outHeaders);
                            clientRes.end(fixed);
                            console.log(`[MODEL-PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (json, ${fixed.length}b)`);
                        });
                    } else {
                        // Non-model or unknown content-type: pass through
                        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                        proxyRes.pipe(clientRes);
                        if (isModelCall) {
                            proxyRes.on('end', () => {
                                console.log(`[MODEL-PROXY] #${reqId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
                            });
                        }
                    }
                });

                proxyReq.on('timeout', () => {
                    console.error(`[MODEL-PROXY] #${reqId} TIMEOUT after ${REQUEST_TIMEOUT_MS / 1000}s`);
                    proxyReq.destroy(new Error('Request timeout'));
                });

                proxyReq.on('error', (err) => {
                    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
                    console.error(`[MODEL-PROXY] #${reqId} ERROR after ${elapsed}s: ${err.message}`);
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(502, { 'content-type': 'application/json' });
                    }
                    clientRes.end(JSON.stringify({ error: { message: 'Upstream connection error' } }));
                });

                proxyReq.end(body);
            });
        });

        function tryListen(port) {
            server.once('error', (err) => {
                if (err.code === 'EADDRINUSE' && port < startPort + 20) {
                    tryListen(port + 1);
                } else {
                    reject(err);
                }
            });
            server.listen(port, '127.0.0.1', () => {
                const actualPort = server.address().port;
                console.log(`[MODEL-PROXY] Listening on 127.0.0.1:${actualPort} → ${targetUrl} (mode: ${state.mode})`);
                resolve({ port: actualPort, close: () => server.close(), switchMode });
            });
        }

        tryListen(startPort);
    });
}
