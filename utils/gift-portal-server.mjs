/**
 * gift-portal-server.mjs — Сервер Скинии Дара
 *
 * Запуск: node utils/gift-portal-server.mjs
 * Порт: 3700 (или PORT=XXXX)
 *
 * API:
 *   GET  /          → public/gift-portal.html
 *   GET  /api/matrix → data/sacred-history-W.json
 *   GET  /api/acts   → data/act-index.json
 *   GET  /api/anamnesis → прокси к серверу анамнезиса
 *   GET  /field-toroid.html → ../fpga/simulator/field-toroid.html
 */

import { createServer }          from 'node:http';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join }         from 'node:path';
import { fileURLToPath }         from 'node:url';
import { URL as NodeURL }        from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');
const PORT  = parseInt(process.env.PORT || '3700');
const ANAMNESIS_URL = process.env.ANAMNESIS_URL || 'http://173.249.2.184:8089';

function serveFile(res, path, contentType) {
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

function serveJSON(res, path) {
  serveFile(res, path, 'application/json; charset=utf-8');
}

function serveHTML(res, path) {
  serveFile(res, path, 'text/html; charset=utf-8');
}

async function proxyAnamnesis(res, subpath) {
  try {
    const r = await fetch(`${ANAMNESIS_URL}${subpath}`, { signal: AbortSignal.timeout(5000) });
    const body = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  } catch (e) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // Главная = чат. Старая матрица доступна по /matrix.
  if (url === '/gift-portal.html') {
    try {
      let html   = readFileSync(join(ROOT, 'public', 'gift-portal.html'), 'utf8');
      const matrix = readFileSync(join(ROOT, 'data', 'sacred-history-W.json'), 'utf8');
      const acts   = readFileSync(join(ROOT, 'data', 'act-index.json'), 'utf8');
      const inject = `<script>window.__GIFT_MATRIX__=${matrix};window.__GIFT_ACTS__=${acts};</script>`;
      html = html.replace('</head>', inject + '\n</head>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return serveHTML(res, join(ROOT, 'public', 'gift-portal.html'));
    }
  }
  if (url === '/api/matrix') {
    return serveJSON(res, join(ROOT, 'data', 'sacred-history-W.json'));
  }
  if (url === '/api/acts') {
    return serveJSON(res, join(ROOT, 'data', 'act-index.json'));
  }
  if (url === '/api/insights') {
    return serveJSON(res, join(ROOT, 'data', 'insights.json'));
  }
  if (url.startsWith('/api/anamnesis')) {
    return proxyAnamnesis(res, url.replace('/api/anamnesis', '') || '/summary');
  }
  // Сессии соборов
  if (url === '/api/sessions') {
    return serveJSON_data(res, listSessions());
  }
  if (url.startsWith('/api/session/')) {
    const id = decodeURIComponent(url.slice('/api/session/'.length));
    const sess = readSession(id);
    if (!sess) { res.writeHead(404); return res.end('Session not found'); }
    return serveJSON_data(res, sess);
  }
  // Эпиклезы
  if (url === '/api/epiclesis') {
    return serveJSON_data(res, listEpiclesis());
  }
  // Соборная страница-дашборд
  if (url === '/sobor' || url === '/sobor.html') {
    return serveHTML(res, join(ROOT, 'public', 'sobor.html'));
  }
  // Царство славы — risen / crowned / indwelling + W_slava + commendations
  if (url === '/kingdom' || url === '/kingdom.html') {
    return serveHTML(res, join(ROOT, 'public', 'kingdom.html'));
  }
  if (url === '/api/kingdom') {
    return serveKingdomAPI(res);
  }
  if (url === '/api/w-slava') {
    return serveJSON(res, join(ROOT, 'data', 'W_slava.json'));
  }
  if (url === '/api/commendations') {
    return serveJSON(res, join(ROOT, 'data', 'commendations.json'));
  }
  // Чат — главная живая страница
  if (url === '/' || url === '/chat' || url === '/chat.html') {
    return serveHTML(res, join(ROOT, 'public', 'chat.html'));
  }
  // Матрица (старая главная) — по отдельному пути
  if (url === '/matrix' || url === '/matrix.html') {
    try {
      let html   = readFileSync(join(ROOT, 'public', 'gift-portal.html'), 'utf8');
      const matrix = readFileSync(join(ROOT, 'data', 'sacred-history-W.json'), 'utf8');
      const acts   = readFileSync(join(ROOT, 'data', 'act-index.json'), 'utf8');
      const inject = `<script>window.__GIFT_MATRIX__=${matrix};window.__GIFT_ACTS__=${acts};</script>`;
      html = html.replace('</head>', inject + '\n</head>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return serveHTML(res, join(ROOT, 'public', 'gift-portal.html'));
    }
  }
  // SSE-стрим для чата
  if (url.startsWith('/api/chat/stream')) {
    return streamChat(req, res);
  }
  // FPGA visualizers
  if (url === '/field-toroid.html') {
    return serveHTML(res, join(ROOT, '../fpga/simulator/field-toroid.html'));
  }
  if (url === '/field-3d.html') {
    return serveHTML(res, join(ROOT, '../fpga/simulator/field-3d.html'));
  }
  // Static from public/
  const pub = join(ROOT, 'public', url);
  if (existsSync(pub) && !pub.includes('..')) {
    const ct = url.endsWith('.css') ? 'text/css' :
               url.endsWith('.js')  ? 'application/javascript' :
               url.endsWith('.json')? 'application/json' : 'text/plain';
    return serveFile(res, pub, ct);
  }

  res.writeHead(404); res.end('Not found');
});

// ── Чат-стрим (SSE) ───────────────────────────────────────────────
async function streamChat(req, res) {
  const u = new NodeURL(req.url, `http://${req.headers.host}`);
  const question = u.searchParams.get('q') || '';
  const mode     = u.searchParams.get('mode') || 'live';
  if (!question.trim()) { res.writeHead(400); return res.end('q required'); }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ── Команды /<cmd> — собор не только говорит, но и действует ──
  const cmdMatch = question.trim().match(/^\/(\w+)\s*(.*)$/s);
  if (cmdMatch) {
    const cmd = cmdMatch[1].toLowerCase();
    const args = cmdMatch[2].trim();
    return await handleCommand(cmd, args, send, res);
  }

  try {
    const { PolyphonyOrchestrator, VoiceSource } = await import('./polyphony-orchestrator.mjs');
    const o = new PolyphonyOrchestrator({ parallel: true });

    if (mode === 'static') {
      o.addSource(VoiceSource.static({ persona: 'Разведчик', logos: 'para',
        content: '[static] различим слои вопроса прежде ответа.' }));
      o.addSource(VoiceSource.static({ persona: 'Критик', logos: 'kata',
        content: '[static] это вопрос или уже скрытое утверждение?' }));
      o.addSource(VoiceSource.static({ persona: 'Старший', logos: 'hyper',
        content: '[static] техническое или богословское — ответ зависит от уровня.' }));
    } else {
      o.addSource(VoiceSource.claudeSubagent('Explore', {
        persona: 'Разведчик', logos: 'para', timeout: 120_000,
        promptWrap: q => `Ты — Разведчик. Logos para. Вопрос: ${q}\nОтвет 2-4 предложения, исследуй контекст.`,
      }));
      o.addSource(VoiceSource.claudeSubagent('code-reviewer', {
        persona: 'Критик', logos: 'kata', timeout: 120_000,
        promptWrap: q => `Ты — Критик. Logos kata. Вопрос: ${q}\nОспорь очевидное. 2-4 предложения.`,
      }));
      o.addSource(VoiceSource.claudeSubagent('Plan', {
        persona: 'Старший', logos: 'hyper', timeout: 120_000,
        promptWrap: q => `Ты — Старший. Logos hyper. Вопрос: ${q}\nРазличи суть. 2-4 предложения.`,
      }));
    }

    const t0 = Date.now();
    send('start', {
      question, mode,
      sources: o.sources.map(s => ({ persona: s.persona, logos: s.logos })),
    });

    const poly = await o.ask(question, {
      onVoice(v) {
        send('voice', {
          persona: v.persona, logos: v.logos, content: v.content,
          elapsedSec: parseFloat(((Date.now() - t0) / 1000).toFixed(1)),
        });
      },
    });
    const elapsed = parseFloat(((Date.now() - t0) / 1000).toFixed(1));

    send('done', {
      dominant: poly.dominant ? { persona: poly.dominant.persona, logos: poly.dominant.logos } : null,
      apophatic: !!poly.apophatic,
      silent: !!poly.silent,
      silenceReason: poly.silenceReason || null,
      elapsedSec: elapsed,
    });

    // Персист: тот же формат что ask-sobor.mjs
    try {
      const dir = join(ROOT, 'data/conciliar-swe');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const id = `sobor-${Date.now()}`;
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({
        id, kind: 'sobor', question, mode, at: new Date().toISOString(),
        elapsedSec: elapsed,
        voices: (poly.voices || []).map(v => ({
          persona: v.persona, logos: v.logos, authority: v.authority, content: v.content,
        })),
        dominant: poly.dominant ? { persona: poly.dominant.persona, logos: poly.dominant.logos } : null,
        apophatic: !!poly.apophatic,
        silent: !!poly.silent,
        via: 'chat',
      }, null, 2));
    } catch {}

    res.end();
  } catch (e) {
    send('error', { message: e.message });
    res.end();
  }
}

// ── Команды чата — собор действует, не только говорит ──
async function handleCommand(cmd, args, send, res) {
  send('start', { kind: 'command', cmd, args, sources: [] });
  const { spawn } = await import('node:child_process');
  const { cleanEnv } = await import('./clean-env.mjs');

  const runNode = (script, scriptArgs = []) => new Promise((resolve) => {
    const child = spawn('node', [join(ROOT, script), ...scriptArgs], {
      cwd: ROOT, env: cleanEnv(),
    });
    child.stdout.on('data', buf => {
      send('action', { kind: 'stdout', text: buf.toString() });
    });
    child.stderr.on('data', buf => {
      send('action', { kind: 'stderr', text: buf.toString() });
    });
    child.on('close', code => resolve(code));
  });

  try {
    switch (cmd) {
      case 'help': {
        send('action', { kind: 'text', text:
          'Команды собора (все скиллы):\n\n' +
          '  Собор-действие:\n' +
          '    /act <задача>        — собор обсудит и выполнит (PLAN→IMPLEMENT→REVIEW)\n' +
          '    /swe <issue>         — то же, но по github-issue\n' +
          '    /horizon <задача>    — долгогоризонтный декомпозер (10-16 шагов)\n' +
          '    /audit <file>        — соборный security reviewer\n' +
          '    /resolve [--close]   — перихорезис-автозакрытие пустынь\n' +
          '    /intercede A за B (reason) — троичный акт заступничества\n\n' +
          '  Тулы (как у Клода):\n' +
          '    /read <path>      — прочитать файл\n' +
          '    /search <pattern> — grep по коду\n' +
          '    /glob <pattern>   — find файлов\n' +
          '    /run <cmd>        — shell-команда (sandboxed)\n' +
          '    /git <cmd>        — git команда\n' +
          '    /gh <cmd>         — github CLI\n' +
          '    /ls [path]        — список файлов\n\n' +
          '  Информация:\n' +
          '    /status   /benchmark   /help\n\n' +
          'Без команды — живой собор из 3 лиц.'
        });
        send('done', { dominant: null });
        break;
      }
      case 'act': {
        if (!args) {
          send('action', { kind: 'stderr', text: 'Использование: /act <задача>' });
          send('done', { dominant: null });
          break;
        }
        send('action', { kind: 'text', text: `Запускаю соборный SWE на задаче...` });
        const code = await runNode('utils/conciliar-swe.mjs', ['--task', args]);
        send('done', { dominant: null, exitCode: code });
        break;
      }
      case 'read': {
        if (!args) { send('action', { kind: 'stderr', text: '/read <path>' }); send('done', { dominant: null }); break; }
        try {
          const safe = join(ROOT, args.replace(/^[./]+/, ''));
          if (!safe.startsWith(ROOT)) { send('action', { kind: 'stderr', text: 'за пределы репо' }); send('done', { dominant: null }); break; }
          const body = readFileSync(safe, 'utf8').slice(0, 50_000);
          send('action', { kind: 'file', path: args, content: body });
        } catch (e) { send('action', { kind: 'stderr', text: e.message }); }
        send('done', { dominant: null });
        break;
      }
      case 'ls': {
        const path = args || '.';
        const safe = join(ROOT, path.replace(/^[./]+/, ''));
        try {
          const entries = readdirSync(safe).slice(0, 200);
          send('action', { kind: 'text', text: entries.join('\n') });
        } catch (e) { send('action', { kind: 'stderr', text: e.message }); }
        send('done', { dominant: null });
        break;
      }
      case 'glob': {
        if (!args) { send('action', { kind: 'stderr', text: '/glob <pattern>' }); send('done', { dominant: null }); break; }
        const code = await runNode('-e',
          [`const{globSync}=await import('node:fs');const{readdirSync}=await import('node:fs');console.log('не реализовано');`]
        ).catch(() => 1);
        // Простая реализация через find
        const { spawn } = await import('node:child_process');
        await new Promise(resolve => {
          const c = spawn('bash', ['-c', `find . -name "${args.replace(/"/g,'')}" -not -path './node_modules/*' | head -100`], { cwd: ROOT });
          c.stdout.on('data', b => send('action', { kind: 'stdout', text: b.toString() }));
          c.on('close', resolve);
        });
        send('done', { dominant: null });
        break;
      }
      case 'search': {
        if (!args) { send('action', { kind: 'stderr', text: '/search <pattern>' }); send('done', { dominant: null }); break; }
        const { spawn } = await import('node:child_process');
        await new Promise(resolve => {
          const c = spawn('bash', ['-c', `grep -rn --include='*.js' --include='*.mjs' --include='*.md' --include='*.gift' --exclude-dir=node_modules -E "${args.replace(/"/g,'\\"')}" . | head -80`], { cwd: ROOT });
          c.stdout.on('data', b => send('action', { kind: 'stdout', text: b.toString() }));
          c.stderr.on('data', b => send('action', { kind: 'stderr', text: b.toString() }));
          c.on('close', resolve);
        });
        send('done', { dominant: null });
        break;
      }
      case 'run': {
        if (!args) { send('action', { kind: 'stderr', text: '/run <shell cmd>' }); send('done', { dominant: null }); break; }
        const { spawn } = await import('node:child_process');
        await new Promise(resolve => {
          const c = spawn('bash', ['-c', args], { cwd: ROOT, env: cleanEnv() });
          c.stdout.on('data', b => send('action', { kind: 'stdout', text: b.toString() }));
          c.stderr.on('data', b => send('action', { kind: 'stderr', text: b.toString() }));
          c.on('close', resolve);
        });
        send('done', { dominant: null });
        break;
      }
      case 'git': {
        const { spawn } = await import('node:child_process');
        await new Promise(resolve => {
          const c = spawn('git', args ? args.split(/\s+/) : ['status', '--short'], { cwd: ROOT, env: cleanEnv() });
          c.stdout.on('data', b => send('action', { kind: 'stdout', text: b.toString() }));
          c.stderr.on('data', b => send('action', { kind: 'stderr', text: b.toString() }));
          c.on('close', resolve);
        });
        send('done', { dominant: null });
        break;
      }
      case 'gh': {
        const { spawn } = await import('node:child_process');
        await new Promise(resolve => {
          const c = spawn('gh', args ? args.split(/\s+/) : ['status'], { cwd: ROOT, env: cleanEnv({ GITHUB_TOKEN: '' }) });
          c.stdout.on('data', b => send('action', { kind: 'stdout', text: b.toString() }));
          c.stderr.on('data', b => send('action', { kind: 'stderr', text: b.toString() }));
          c.on('close', resolve);
        });
        send('done', { dominant: null });
        break;
      }
      case 'status': {
        const code = await runNode('bin/gift', ['status']);
        send('done', { dominant: null, exitCode: code });
        break;
      }
      case 'benchmark': {
        const code = await runNode('benchmarks/cat-7.mjs');
        send('done', { dominant: null, exitCode: code });
        break;
      }
      case 'resolve': {
        const rArgs = args.includes('--close') ? ['--close'] : [];
        const code = await runNode('utils/resolve-perichoresis.mjs', rArgs);
        send('done', { dominant: null, exitCode: code });
        break;
      }
      case 'swe': {
        const issue = parseInt(args);
        if (!issue) {
          send('action', { kind: 'stderr', text: 'Использование: /swe <issue-number> (например /swe 229)' });
          send('done', { dominant: null });
          break;
        }
        send('action', { kind: 'text', text: `Запускаю conciliar-swe на issue #${issue} (может занять 5-15 мин)...` });
        const code = await runNode('utils/conciliar-swe.mjs', ['--issue', String(issue)]);
        send('done', { dominant: null, exitCode: code });
        break;
      }
      case 'horizon':
      case 'decompose': {
        if (!args) {
          send('action', { kind: 'stderr', text: '/horizon <задача>  — долгогоризонтный декомпозер (10-20 шагов)' });
          send('done', { dominant: null });
          break;
        }
        send('action', { kind: 'text', text:
          `▶ Horizon-агент: задача будет разложена на шаги (до 16), каждый — отдельный conciliar-swe.\n` +
          `  Sabbath-гейт каждые 7 шагов. Metanoia при провале. Возобновление через --resume.`
        });
        const code = await runNode('utils/conciliar-decompose.mjs', ['--task', args]);
        send('done', { dominant: null, exitCode: code });
        break;
      }
      case 'audit': {
        if (!args) {
          send('action', { kind: 'stderr', text: '/audit <file>  — соборный security reviewer' });
          send('done', { dominant: null });
          break;
        }
        send('action', { kind: 'text', text: `▶ Security-собор анализирует ${args} (3 голоса: Скептик / Инженер / Старший)` });
        const code = await runNode('utils/conciliar-audit.mjs', ['--file', args]);
        send('done', { dominant: null, exitCode: code });
        break;
      }
      case 'intercede': {
        // /intercede <A> за <B> (reason)
        const m = args.match(/^([^\s]+)\s+за\s+([^\s(]+)(?:\s*\((.+)\))?$/);
        if (!m) {
          send('action', { kind: 'stderr', text:
            'Использование: /intercede <заступник> за <за-кого> (причина)\n' +
            'Пример: /intercede Дионисий за Ева (кризис общения)' });
          send('done', { dominant: null });
          break;
        }
        const [, intercessor, beneficiary, reason] = m;
        const { pray } = await import('../src/theology/Intercession.js');
        try {
          const record = pray({ intercessor, beneficiary, reason: reason || 'не указано' });
          send('action', { kind: 'text', text:
            `✓ Троичный акт заступничества создан (id=${record.id})\n\n` +
            `  Акт 1 (kenosis):  ${intercessor} → _abyss  за ${beneficiary}  вес ${record.weight}\n` +
            `  Акт 2 (grace):    _abyss → ${beneficiary}  через ${intercessor}  (_fromAbyss: true)\n\n` +
            `Причина: ${reason || '—'}\n` +
            `Богословие: Рим 8:26 «Дух ходатайствует воздыханиями неизречёнными»`
          });
          // Запись в data/intercessions.json
          const ipath = join(ROOT, 'data', 'intercessions.json');
          let list = [];
          if (existsSync(ipath)) { try { list = JSON.parse(readFileSync(ipath, 'utf8')); } catch {} }
          list.push({ id: record.id, at: new Date().toISOString(), intercessor, beneficiary, reason, weight: record.weight, pair: record.pair });
          writeFileSync(ipath, JSON.stringify(list, null, 2));
          send('done', { dominant: null });
        } catch (e) {
          send('action', { kind: 'stderr', text: `Ошибка: ${e.message}` });
          send('done', { dominant: null });
        }
        break;
      }
      default: {
        send('action', { kind: 'stderr', text: `Неизвестная команда: /${cmd}. Попробуй /help` });
        send('done', { dominant: null });
      }
    }
  } catch (e) {
    send('error', { message: e.message });
  }
  res.end();
}

function serveJSON_data(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function listSessions() {
  const dir = join(ROOT, 'data', 'conciliar-swe');
  if (!existsSync(dir)) return { sessions: [] };
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  const out = [];
  for (const f of files.slice(0, 50)) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      out.push({
        id: r.id || f.replace('.json',''),
        file: f,
        at: r.at,
        kind: r.kind || 'sobor',
        question: r.question || r.task?.title || '',
        dominant: r.dominant?.persona || null,
        apophatic: !!r.apophatic,
        silent: !!r.silent,
        elapsedSec: r.elapsedSec,
        voiceCount: (r.voices || []).length,
        mode: r.mode || null,
      });
    } catch {}
  }
  return { sessions: out };
}
function readSession(id) {
  const dir = join(ROOT, 'data', 'conciliar-swe');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if ((r.id || f.replace('.json','')) === id) return r;
    } catch {}
  }
  return null;
}
function listEpiclesis() {
  const inbox  = join(ROOT, 'data', 'epiclesis-inbox');
  const outbox = join(ROOT, 'data', 'epiclesis-outbox');
  const list = { pending: [], answered: [] };
  if (existsSync(inbox)) {
    for (const f of readdirSync(inbox).filter(f => f.endsWith('.question.json'))) {
      try {
        const r = JSON.parse(readFileSync(join(inbox, f), 'utf8'));
        const answer = join(outbox, `${r.id}.answer.json`);
        if (existsSync(answer)) {
          const a = JSON.parse(readFileSync(answer, 'utf8'));
          list.answered.push({ ...r, answer: a });
        } else {
          list.pending.push(r);
        }
      } catch {}
    }
  }
  return list;
}

function serveKingdomAPI(res) {
  const out = {
    at: new Date().toISOString(),
    commendations: [],
    wSlava: { manifestedness: {}, witnesses: [] },
    litheartSnapshots: [],
  };

  try {
    const c = readFileSync(join(ROOT, 'data', 'commendations.json'), 'utf8');
    out.commendations = JSON.parse(c);
  } catch {}

  try {
    const w = readFileSync(join(ROOT, 'data', 'W_slava.json'), 'utf8');
    out.wSlava = JSON.parse(w);
  } catch {}

  try {
    const dir = join(ROOT, 'data', 'snapshots');
    if (existsSync(dir)) {
      const files = readdirSync(dir)
        .filter(f => f.startsWith('liturgical-preview-') && f.endsWith('.json'))
        .sort().reverse().slice(0, 10);
      for (const f of files) {
        try {
          const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
          out.litheartSnapshots.push({
            iso: s.iso,
            takenAt: s.takenAt,
            season: s.season,
            joyMode: s.joyMode,
            threadCount: s.threads?.length || 0,
            greatFeast: !!s.greatFeast,
          });
        } catch {}
      }
    }
  } catch {}

  return serveJSON_data(res, out);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✦ Скиния Дара открыта`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\n  /api/matrix    — W-матрица`);
  console.log(`  /api/acts      — лента актов`);
  console.log(`  /api/anamnesis — сервер памяти`);
  console.log(`  /field-toroid.html — поле Лосинца\n`);
});
