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
  // СИЦ — Ситуационно-Инженерный Центр
  if (url === '/api/sic/list') {
    return serveJSON_data(res, listSicSessions());
  }
  if (url === '/api/sic/new' && req.method === 'POST') {
    return handleSicAction(req, res, 'new');
  }
  if (url.match(/^\/api\/sic\/[^/]+\/(panels|sobor|discernment|decide|epiclesis|plan)$/) && req.method === 'POST') {
    const parts = url.split('/');
    const id = decodeURIComponent(parts[3]);
    const action = parts[4];
    return handleSicAction(req, res, action, id);
  }
  if (url.match(/^\/api\/sic\/[^/]+\/chat$/) && req.method === 'POST') {
    const id = decodeURIComponent(url.split('/')[3]);
    return handleSicChat(req, res, id);
  }
  if (url.match(/^\/api\/sic\/[^/]+\/chat$/) && req.method === 'GET') {
    const id = decodeURIComponent(url.split('/')[3]);
    return serveJSON_data(res, readSicChat(id));
  }
  if (url.match(/^\/api\/sic\/[^/]+\/plan$/) && req.method === 'GET') {
    const id = decodeURIComponent(url.split('/')[3]);
    return serveJSON_data(res, extractPlanFromSobor(id));
  }
  if (url.startsWith('/api/sic/')) {
    const id = decodeURIComponent(url.slice('/api/sic/'.length));
    const s = readSicSession(id);
    if (!s) { res.writeHead(404); return res.end('SIC session not found'); }
    return serveJSON_data(res, s);
  }
  if (url === '/sic' || url === '/sic.html') {
    return serveHTML(res, join(ROOT, 'public', 'sic.html'));
  }
  // Prometheus metrics — observability
  if (url === '/metrics') {
    return servePrometheus(res);
  }
  // Federation — peer protocol (koinon-federation/1.0)
  if (url === '/federation/descriptor') {
    return serveJSON_data(res, federationDescriptor());
  }
  if (url === '/federation/matrix') {
    return serveJSON_data(res, federationMatrixSnap());
  }
  if (url === '/federation/connect' && req.method === 'POST') {
    return handleFederationConnect(req, res);
  }
  if (url === '/api/federation/peers') {
    return serveJSON_data(res, loadPeers());
  }
  // Чат-сессии (multi-turn истории)
  if (url === '/api/chat-sessions') {
    return serveJSON_data(res, listChatSessions());
  }
  if (url.startsWith('/api/chat-session/')) {
    const id = decodeURIComponent(url.slice('/api/chat-session/'.length));
    const sess = readChatSession(id);
    if (!sess) { res.writeHead(404); return res.end('Session not found'); }
    return serveJSON_data(res, sess);
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
  // Голосовой режим — push-to-talk + Web Speech API в браузере
  if (url === '/voice' || url === '/voice.html') {
    return serveHTML(res, join(ROOT, 'public', 'voice.html'));
  }
  // Дашборд для общины (без греческого сленга, для не-программистов)
  if (url === '/team' || url === '/team.html') {
    return serveHTML(res, join(ROOT, 'public', 'team.html'));
  }
  // Слайд A3 для презентации Пескову (13.05.2026) — БАС-версия
  if (url === '/peskov' || url === '/peskov-bas-a3.html') {
    return serveHTML(res, join(ROOT, 'public', 'peskov-bas-a3.html'));
  }
  // Старый слайд (онтология общины, без БАС-отрасли) — backup
  if (url === '/peskov-gift' || url === '/peskov-a3.html') {
    return serveHTML(res, join(ROOT, 'public', 'peskov-a3.html'));
  }
  // Локальный предпросмотр peskov.html из dronedoc2026 (БАС-собор + Gift)
  // Полная страница работает только на nti.drondoc.ru (нужны /api/chat и /api/kag/search)
  if (url === '/peskov-live' || url === '/peskov-live.html') {
    return serveHTML(res, join(ROOT, 'public', 'peskov-live.html'));
  }
  // Демо-сценарий для презентации — режиссёр на 7 шагов
  if (url === '/demo' || url === '/demo.html') {
    return serveHTML(res, join(ROOT, 'public', 'demo.html'));
  }
  // Соборный чат БАС-отрасли (4 роли · для презентации Пескову)
  if (url === '/bas' || url === '/bas-sobor.html') {
    return serveHTML(res, join(ROOT, 'public', 'bas-sobor.html'));
  }
  if (url === '/sobor-v2' || url === '/sobor-v2.html') {
    return serveHTML(res, join(ROOT, 'public', 'sobor-v2.html'));
  }
  if (url === '/ip-audit' || url === '/ip-audit.html') {
    return serveHTML(res, join(ROOT, 'public', 'ip-audit.html'));
  }
  // SSE-стрим: 4 параллельных голоса БАС-собора через Ollama
  if (req.url.startsWith('/api/bas-stream')) {
    return streamBasSobor(req, res);
  }
  // API: текущий V-вектор (для /team)
  if (url === '/api/value') {
    try {
      const path = join(ROOT, 'data/value-history.json');
      if (!existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end('{"error":"нет value-history.json — запусти ontology-pulse"}');
      }
      const hist = JSON.parse(readFileSync(path, 'utf8'));
      const last = hist[hist.length - 1] || null;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(JSON.stringify(last));
    } catch (e) {
      res.writeHead(500); return res.end(JSON.stringify({ error: e.message }));
    }
  }
  // API: список целей (для /team)
  if (url === '/api/goals') {
    try {
      const goalsDir = join(ROOT, 'data/goals');
      const list = [];
      if (existsSync(goalsDir)) {
        for (const f of readdirSync(goalsDir)) {
          if (!f.endsWith('.json')) continue;
          try {
            const g = JSON.parse(readFileSync(join(goalsDir, f), 'utf8'));
            list.push({
              id: g.id, status: g.status, objective: g.objective,
              successCriteria: g.successCriteria,
              iteration: g.iteration, maxIterations: g.maxIterations,
              createdAt: g.createdAt, updatedAt: g.updatedAt,
            });
          } catch {}
        }
        list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(JSON.stringify(list));
    } catch (e) {
      res.writeHead(500); return res.end(JSON.stringify({ error: e.message }));
    }
  }
  // Edge TTS: бесплатные нейро-голоса Microsoft Azure
  // /api/tts?text=...&voice=ru-RU-SvetlanaNeural → audio/mpeg
  if (url.startsWith('/api/tts')) {
    return streamEdgeTts(req, res);
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
  const sessionId = u.searchParams.get('session') || null;
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
    const { retrieveContext, contextAsPrompt } = await import('./context-retrieval.mjs');

    // Анамнезис: retrieval до собора. Собор отвечает, помня общину.
    const ctx = await retrieveContext(question);
    send('context', {
      summary: ctx.summary,
      sobors: ctx.sobors,
      threads: ctx.threads,
      acts: ctx.acts,
    });
    const contextPrompt = contextAsPrompt(ctx);
    const groundedWrap = (wrap) => (q) =>
      (contextPrompt ? `КОНТЕКСТ ОБЩИНЫ (анамнезис):\n${contextPrompt}\n\n---\n\n` : '') + wrap(q);

    const o = new PolyphonyOrchestrator({ parallel: true });

    if (mode === 'static') {
      o.addSource(VoiceSource.static({ persona: 'Разведчик', logos: 'para',
        content: '[static] различим слои вопроса прежде ответа.' }));
      o.addSource(VoiceSource.static({ persona: 'Критик', logos: 'kata',
        content: '[static] это вопрос или уже скрытое утверждение?' }));
      o.addSource(VoiceSource.static({ persona: 'Старший', logos: 'hyper',
        content: '[static] техническое или богословское — ответ зависит от уровня.' }));
    } else {
      // GIFT_OLLAMA_MODEL=deepseek-r1:8b → собор идёт через локальную модель
      // (бесплатно, приватно, без зависимости от Anthropic API).
      // По умолчанию — Claude (claudeSubagent).
      const ollamaModel = process.env.GIFT_OLLAMA_MODEL;
      const makeVoice = (persona, logos, agentType, wrap) =>
        ollamaModel
          ? VoiceSource.ollama(ollamaModel, { persona, logos, promptWrap: wrap, timeout: 180_000 })
          : VoiceSource.claudeSubagent(agentType, { persona, logos, promptWrap: wrap, timeout: 120_000 });

      o.addSource(makeVoice('Разведчик', 'para', 'Explore',
        groundedWrap(q => `Ты — Разведчик. Logos para. Вопрос: ${q}\nОтвет 2-4 предложения, используй контекст общины, если релевантен.`)));
      o.addSource(makeVoice('Критик', 'kata', 'code-reviewer',
        groundedWrap(q => `Ты — Критик. Logos kata. Вопрос: ${q}\nОспорь очевидное, опираясь на прошлые решения общины. 2-4 предложения.`)));
      o.addSource(makeVoice('Старший', 'hyper', 'Plan',
        groundedWrap(q => `Ты — Старший. Logos hyper. Вопрос: ${q}\nРазличи, соотнеси с контекстом общины. 2-4 предложения.`)));
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

    // Multi-turn persist: если есть sessionId, добавить ход в историю
    if (sessionId) {
      appendChatTurn(sessionId, {
        at: new Date().toISOString(),
        user: question,
        mode,
        voices: (poly.voices || []).map(v => ({
          persona: v.persona, logos: v.logos, content: v.content, authority: v.authority,
        })),
        dominant: poly.dominant ? { persona: poly.dominant.persona, logos: poly.dominant.logos } : null,
        apophatic: !!poly.apophatic,
        silent: !!poly.silent,
        elapsedSec: elapsed,
      });
    }

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

// ── Соборный чат БАС-отрасли: 4 параллельных голоса через Ollama ──
async function streamBasSobor(req, res) {
  const u = new NodeURL(req.url, `http://${req.headers.host}`);
  const question = u.searchParams.get('q') || '';
  const model = u.searchParams.get('model') || 'llama3.1:8b';
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

  const stripThink = (s) => String(s||'').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

  // Четыре роли БАС-отрасли. Каждая со своим логосом и риторикой.
  const roles = [
    {
      id: 'producer',
      name: 'Производитель',
      logos: 'как это делать',
      icon: '⚙',
      sys: 'Ты — голос Производителя в отрасли БАС России (беспилотные авиационные системы). Тебя представляют конструкторы и инженерные команды. Отвечай с позиции производства: что технически возможно, какие модели в реестре (2003 модели БПЛА), что готово к серии, что в опытных образцах. Считай ресурсы, сроки, локализацию компонентов. Кратко, 3-4 предложения, по делу.',
    },
    {
      id: 'operator',
      name: 'Оператор',
      logos: 'как это летает',
      icon: '✈',
      sys: 'Ты — голос Оператора в отрасли БАС России. Ты пилотируешь, обслуживаешь, выполняешь миссии. Знаешь сценарии применения по регионам, ROI миссий, реальную потребность в воздухе. Отвечай с позиции живой эксплуатации: что окупается, где есть спрос, какие узкие места (квалификация пилотов, ремонт, запчасти, навигация). Кратко, 3-4 предложения.',
    },
    {
      id: 'regulator',
      name: 'Регулятор',
      logos: 'как это допустимо',
      icon: '⚖',
      sys: 'Ты — голос Регулятора в отрасли БАС России. Представляешь Росавиацию, Минпромторг, Минобороны. Знаешь НПА, требования сертификации, разрешённые зоны, ответственность. Отвечай с позиции допустимости и безопасности: что в законе, какие риски, что меняется в регуляторике. Кратко, 3-4 предложения, без популизма.',
    },
    {
      id: 'investor',
      name: 'Инвестор',
      logos: 'где это выгодно',
      icon: '₽',
      sys: 'Ты — голос Инвестора в отрасли БАС России. Считаешь экономические модели, риски, окно возможностей. Знаешь объёмы рынка, госпрограммы, OSINT-картину. Отвечай с позиции капитала: где есть деньги, какой горизонт окупаемости, какие сектора недооценены, где переоценка. Кратко, 3-4 предложения, цинично-точно.',
    },
  ];

  send('start', {
    question,
    model,
    roles: roles.map(r => ({ id: r.id, name: r.name, logos: r.logos, icon: r.icon })),
  });

  const t0 = Date.now();
  const elapsedSec = () => parseFloat(((Date.now() - t0) / 1000).toFixed(1));

  // Один вызов Ollama
  async function callOllama(systemPrompt, userMsg, numPredict = 500) {
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0.7, num_predict: numPredict },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMsg },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}`);
    const data = await r.json();
    return stripThink(data.message?.content || '');
  }

  // ── РАУНД 1: каждая роль высказывается со своей позиции ──────────────
  send('round', { n: 1, label: 'Каждый говорит со своей позиции', elapsedSec: elapsedSec() });

  const round1 = {};
  await Promise.all(roles.map(async role => {
    try {
      const content = await callOllama(
        role.sys,
        `Вопрос к собору: ${question}\n\nОтветь как ${role.name} БАС-отрасли. РОВНО 2-3 предложения, чётко, в характере. Не упоминай Пескова. Без преамбул.`,
        200,
      );
      round1[role.id] = content;
      send('voice', {
        round: 1, id: role.id, name: role.name, logos: role.logos, icon: role.icon,
        content, elapsedSec: elapsedSec(),
      });
    } catch (e) {
      round1[role.id] = `[молчит: ${e.message}]`;
      send('voice', {
        round: 1, id: role.id, name: role.name, logos: role.logos, icon: role.icon,
        content: `[${role.name} молчит: ${e.message}]`, error: true,
        elapsedSec: elapsedSec(),
      });
    }
  }));

  // ── РАУНД 2: каждая роль видит трёх других и спорит ──────────────────
  send('round', { n: 2, label: 'Дебаты: спорим, дополняем, не соглашаемся', elapsedSec: elapsedSec() });

  const round2 = {};
  await Promise.all(roles.map(async role => {
    const othersText = roles
      .filter(r => r.id !== role.id)
      .map(r => `${r.name} (${r.logos}): ${round1[r.id]}`)
      .join('\n\n');
    try {
      const debatePrompt = `Вопрос к собору: ${question}\n\nТвой первый ответ: ${round1[role.id]}\n\nТри других голоса собора ответили:\n\n${othersText}\n\nВТОРОЙ раунд дебатов. Участников ровно четыре: Производитель, Оператор, Регулятор, Инвестор. Никого больше. РОВНО 3 предложения, БЕЗ преамбул:\n(1) С кем из этих четырёх согласен — назови имя из списка и что именно поддерживаешь.\n(2) С кем не согласен — назови имя из списка и что возразишь.\n(3) Что упустили все четверо — добавь главное.`;
      const content = await callOllama(role.sys, debatePrompt, 250);
      round2[role.id] = content;
      send('voice', {
        round: 2, id: role.id, name: role.name, logos: role.logos, icon: role.icon,
        content, elapsedSec: elapsedSec(),
      });
    } catch (e) {
      round2[role.id] = `[молчит во 2-м раунде]`;
      send('voice', {
        round: 2, id: role.id, name: role.name, logos: role.logos, icon: role.icon,
        content: `[молчит во 2-м раунде: ${e.message}]`, error: true,
        elapsedSec: elapsedSec(),
      });
    }
  }));

  // ── СИНТЕЗ: соборный голос читает всё и выносит решение ──────────────
  send('round', { n: 3, label: 'Синтез — соборный голос подводит итог', elapsedSec: elapsedSec() });

  const fullContext = roles.map(r => {
    return `${r.name}:\n— раунд 1: ${round1[r.id]}\n— раунд 2: ${round2[r.id]}`;
  }).join('\n\n');

  const synthSys = `Ты — соборный голос (συμφωνία) БАС-отрасли. Ты не пятая роль, ты — то что рождается из четырёх. Не примиряешь — а вычленяешь.

Прочитай дебаты Производителя, Оператора, Регулятора и Инвестора. Найди:
— в чём они РЕАЛЬНО согласны (даже если не назвали этого)
— в чём непреодолимое противоречие (это не недостаток, это структура отрасли)
— какое решение возможно сейчас, какое требует следующего шага

4-6 предложений. Языком решения, а не комментария. Без греческих терминов.`;

  let synthesis;
  try {
    synthesis = await callOllama(
      synthSys,
      `Вопрос к собору: ${question}\n\nДебаты собора (Производитель, Оператор, Регулятор, Инвестор):\n\n${fullContext}\n\nВынеси соборное решение. 4-5 предложений, начни сразу с дела.`,
      400,
    );
  } catch (e) {
    synthesis = `[Соборный голос молчит: ${e.message}]`;
  }
  send('synthesis', {
    content: synthesis,
    elapsedSec: elapsedSec(),
  });

  const elapsed = elapsedSec();
  send('done', { elapsedSec: elapsed });

  // Запись акта в матрицу — вопрошающий → _koinon
  try {
    const dir = join(ROOT, 'data/conciliar-swe');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const id = `bas-sobor-${Date.now()}`;
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({
      id, kind: 'bas-sobor', question, at: new Date().toISOString(),
      elapsedSec: elapsed, model,
    }, null, 2));
  } catch {}

  res.end();
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
          '    /intercede A за B (reason) — троичный акт заступничества\n' +
          '    /offer A → B [type] [вес] текст  — приношение (PENDING)\n' +
          '    /consent <act-id>    — получатель принимает (→ RECEIVED)\n' +
          '    /decline <act-id> причина — получатель отказывает\n' +
          '    /federation list|whoami|connect <url>  — peer-общины\n\n' +
          '  Тулы (как у Клода):\n' +
          '    /read <path>      — прочитать файл\n' +
          '    /search <pattern> — grep по коду\n' +
          '    /glob <pattern>   — find файлов\n' +
          '    /run <cmd>        — shell-команда (sandboxed)\n' +
          '    /git <cmd>        — git команда\n' +
          '    /gh <cmd>         — github CLI\n' +
          '    /ls [path]        — список файлов\n\n' +
          '  Информация:\n' +
          '    /status   /benchmark   /bench [--n 5]   /help\n\n' +
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
      case 'offer': {
        // /offer Дионисий → Ева [type] [weight] content
        const m = args.match(/^([^\s→]+)\s*→\s*([^\s]+)(?:\s+(\w+))?(?:\s+(\d+))?\s+(.+)$/);
        if (!m) { send('action', { kind: 'stderr', text: '/offer A → B [type] [weight] содержание' }); send('done', { dominant: null }); break; }
        const [, giver, receiver, type, weight, content] = m;
        const { offer, THEOLOGICAL_DIFF } = await import('../src/theology/AnamneticConsent.js');
        try {
          const act = offer({ giver, receiver, type: type || 'gift', weight: weight ? parseInt(weight) : 5, content });
          // persist
          const path = join(ROOT, 'data', 'pending-consents.json');
          let list = [];
          if (existsSync(path)) { try { list = JSON.parse(readFileSync(path, 'utf8')); } catch {} }
          list.push(act);
          writeFileSync(path, JSON.stringify(list, null, 2));
          send('action', { kind: 'text', text:
            `⏳ Приношение создано — **фаза: PENDING**\n\n` +
            `  **id:** \`${act.id}\`\n  ${giver} → ${receiver}  [${act.type}, вес ${act.weight}]\n  «${content.slice(0, 200)}»\n\n` +
            `*Дар станет необратимым только после ${receiver} даст согласие:*\n` +
            `  \`/consent ${act.id}\` — принять\n` +
            `  \`/decline ${act.id} причина\` — отклонить (требует причину)`
          });
          send('done', { dominant: null });
        } catch (e) { send('action', { kind: 'stderr', text: e.message }); send('done', { dominant: null }); }
        break;
      }
      case 'consent': {
        const parts = args.split(/\s+/).filter(Boolean);
        const [actId, by] = parts;
        if (!actId) { send('action', { kind: 'stderr', text: '/consent <act-id> [by=Дионисий]' }); send('done', { dominant: null }); break; }
        const { consent } = await import('../src/theology/AnamneticConsent.js');
        // Загружаем из persistence
        const path = join(ROOT, 'data', 'pending-consents.json');
        if (!existsSync(path)) { send('action', { kind: 'stderr', text: 'pending-consents.json не найден' }); send('done', { dominant: null }); break; }
        const list = JSON.parse(readFileSync(path, 'utf8'));
        const act = list.find(a => a.id === actId);
        if (!act) { send('action', { kind: 'stderr', text: `акт ${actId} не найден в pending` }); send('done', { dominant: null }); break; }
        try {
          // Поскольку offer() создаёт runtime-state, воссоздаём вручную
          const received = Object.freeze({
            ...act, phase: 'received', reception: 'accepted',
            receivedAt: Date.now(), consentBy: by || act.receiverId, irreversible: true,
          });
          // Перемещаем в received
          const remainingList = list.filter(a => a.id !== actId);
          writeFileSync(path, JSON.stringify(remainingList, null, 2));
          const recFile = join(ROOT, 'data', 'received-acts.json');
          let recList = [];
          if (existsSync(recFile)) { try { recList = JSON.parse(readFileSync(recFile, 'utf8')); } catch {} }
          recList.push(received);
          writeFileSync(recFile, JSON.stringify(recList, null, 2));
          send('action', { kind: 'text', text:
            `✓ **Συνέργεια** — акт ${actId} принят ${received.consentBy}\n\n` +
            `  Фаза: OFFERED → **RECEIVED**\n` +
            `  Reception: accepted\n  Irreversible: true\n\n` +
            `*«Бог делает всё, но не без нас» (Максим Исповедник).*\n` +
            `*Дар стал даром в полном смысле — получатель сказал «да».*`
          });
          send('done', { dominant: null });
        } catch (e) { send('action', { kind: 'stderr', text: e.message }); send('done', { dominant: null }); }
        break;
      }
      case 'decline': {
        const parts = args.split(/\s+/).filter(Boolean);
        const actId = parts[0];
        const reason = parts.slice(1).join(' ');
        if (!actId || !reason) { send('action', { kind: 'stderr', text: '/decline <act-id> причина (требуется)' }); send('done', { dominant: null }); break; }
        const path = join(ROOT, 'data', 'pending-consents.json');
        if (!existsSync(path)) { send('action', { kind: 'stderr', text: 'нечего отклонять' }); send('done', { dominant: null }); break; }
        const list = JSON.parse(readFileSync(path, 'utf8'));
        const act = list.find(a => a.id === actId);
        if (!act) { send('action', { kind: 'stderr', text: `акт ${actId} не найден` }); send('done', { dominant: null }); break; }
        const declined = Object.freeze({ ...act, phase: 'declined', reception: 'declined', declinedAt: Date.now(), declineReason: reason });
        writeFileSync(path, JSON.stringify(list.filter(a => a.id !== actId), null, 2));
        const dfile = join(ROOT, 'data', 'declined-acts.json');
        let dlist = [];
        if (existsSync(dfile)) { try { dlist = JSON.parse(readFileSync(dfile, 'utf8')); } catch {} }
        dlist.push(declined);
        writeFileSync(dfile, JSON.stringify(dlist, null, 2));
        send('action', { kind: 'text', text:
          `✗ Отклонено: акт ${actId}\n\n  причина: «${reason}»\n  фаза: DECLINED\n\n` +
          `*Отказ с причиной — не разрыв, а призыв к μετάνοια дарителя.*`
        });
        send('done', { dominant: null });
        break;
      }
      case 'federation': {
        const [sub, ...rest] = args.split(/\s+/).filter(Boolean);
        if (!sub || sub === 'list') {
          const { peers } = loadPeers();
          send('action', { kind: 'text', text: peers.length
            ? `Связанные общины (${peers.length}):\n\n` + peers.map(p => `- **${p.id}** · ${p.name || ''} · ${p.url} · с ${p.connectedAt?.slice(0, 10) || '?'}`).join('\n')
            : 'Пока нет связанных общин.\n\n' +
              'Подключить peer:\n  `/federation connect <peer-url>`\n\n' +
              '_Это распределённая альтернатива Project Glasswing — открытая, не restricted._'
          });
        } else if (sub === 'whoami') {
          send('action', { kind: 'text', text: '```\n' + JSON.stringify(federationDescriptor(), null, 2) + '\n```' });
        } else if (sub === 'connect' && rest.length) {
          const peerUrl = rest[0].replace(/\/$/, '');
          try {
            const r = await fetch(`${peerUrl}/federation/connect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(federationDescriptor()),
              signal: AbortSignal.timeout(10_000),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
            // Сохраняем peer'а у себя
            const store = loadPeers();
            store.peers = store.peers || [];
            const peerDesc = data.self || { id: 'unknown', url: peerUrl };
            const idx = store.peers.findIndex(p => p.id === peerDesc.id);
            const rec = { ...peerDesc, connectedAt: new Date().toISOString() };
            if (idx >= 0) store.peers[idx] = rec; else store.peers.push(rec);
            savePeers(store);
            send('action', { kind: 'text', text:
              `✓ Соединение установлено\n\n` +
              `  **peer id:** \`${peerDesc.id}\`\n  **name:** ${peerDesc.name || ''}\n  **url:** ${peerDesc.url}\n\n` +
              `*Две общины обменялись дескрипторами. Теперь можно запросить матрицу peer'а:*\n` +
              `\`curl ${peerUrl}/federation/matrix\``
            });
          } catch (e) {
            send('action', { kind: 'stderr', text: `connect failed: ${e.message}` });
          }
        } else {
          send('action', { kind: 'text', text:
            '**Federation** (koinon-federation/1.0):\n\n' +
            '- `/federation list` — связанные общины\n' +
            '- `/federation whoami` — этот дескриптор\n' +
            '- `/federation connect <url>` — подключить peer\n\n' +
            '_Открытая альтернатива Project Glasswing: каждая община автокефальна, связи — через литургию даров._'
          });
        }
        send('done', { dominant: null });
        break;
      }
      case 'bench': {
        // /bench — gift-bench (SWE-bench-like). По умолчанию dry n=5.
        const parts = args.split(/\s+/).filter(Boolean);
        const bArgs = parts.length ? parts : ['--mode', 'dry', '--n', '5'];
        send('action', { kind: 'text', text: `▶ gift-bench ${bArgs.join(' ')}` });
        const code = await runNode('utils/gift-bench.mjs', bArgs);
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

// ── Federation — peer-to-peer общины ─────────────────────────────
const KOINON_ID = process.env.KOINON_ID || 'koinon-dionysius';
const PEERS_FILE = join(ROOT, 'data', 'federation-peers.json');

function federationDescriptor() {
  return {
    protocol: 'koinon-federation/1.0',
    id: KOINON_ID,
    name: process.env.KOINON_NAME || 'Κοινόν Дионисия',
    url: process.env.KOINON_URL || `http://localhost:${PORT}`,
    capabilities: ['matrix-share', 'acts-broadcast', 'intercession'],
    at: new Date().toISOString(),
  };
}

function federationMatrixSnap() {
  // Публичная проекция W-матрицы: только нити, не тексты
  try {
    const f = join(ROOT, 'data', 'sacred-history-W.json');
    if (!existsSync(f)) return { error: 'no matrix' };
    const snap = JSON.parse(readFileSync(f, 'utf8'));
    // Не отдаём полную матрицу — только метаданные и heaviest-threads
    return {
      koinon: KOINON_ID,
      persons: (snap.persons || []).length,
      actsCount: snap.actsCount || (snap.acts || []).length || 0,
      at: new Date().toISOString(),
      threads: snap.heaviest || snap.threads || [],
    };
  } catch (e) { return { error: e.message }; }
}

function loadPeers() {
  if (!existsSync(PEERS_FILE)) return { peers: [] };
  try { return JSON.parse(readFileSync(PEERS_FILE, 'utf8')); } catch { return { peers: [] }; }
}
function savePeers(data) { writeFileSync(PEERS_FILE, JSON.stringify(data, null, 2)); }

function handleFederationConnect(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const peerDesc = JSON.parse(body);
      const store = loadPeers();
      store.peers = store.peers || [];
      // upsert по id
      const idx = store.peers.findIndex(p => p.id === peerDesc.id);
      const record = { ...peerDesc, connectedAt: new Date().toISOString() };
      if (idx >= 0) store.peers[idx] = record; else store.peers.push(record);
      savePeers(store);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: true, self: federationDescriptor(), peer: peerDesc.id }));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ── Prometheus metrics ────────────────────────────────────────────
function servePrometheus(res) {
  const lines = [];
  const m = (name, help, type, value, labels = {}) => {
    const lbl = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name}${lbl ? `{${lbl}}` : ''} ${value}`);
  };

  // Sobors
  const sobors = listSessions().sessions;
  m('gift_sobors_total', 'Total conciliar sessions in journal', 'counter', sobors.length);
  m('gift_sobors_apophatic', 'Sobors resulted in apophatic (no dominant)', 'counter',
    sobors.filter(s => s.apophatic).length);
  m('gift_sobors_silent', 'Sobors that yielded silence (sabbath/quorum)', 'counter',
    sobors.filter(s => s.silent).length);

  // Chat sessions
  const chats = listChatSessions().sessions;
  m('gift_chat_sessions_total', 'Multi-turn chat sessions', 'counter', chats.length);
  m('gift_chat_turns_total', 'Total chat turns across sessions', 'counter',
    chats.reduce((a, s) => a + (s.turnCount || 0), 0));

  // Epiclesis
  const epi = listEpiclesis();
  m('gift_epiclesis_pending', 'Unanswered epiclesis questions', 'gauge', epi.pending.length);
  m('gift_epiclesis_answered', 'Answered epiclesis questions', 'counter', epi.answered.length);

  // Matrix (from snapshot)
  try {
    const snapPath = join(ROOT, 'data', 'sacred-history-W.json');
    if (existsSync(snapPath)) {
      const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
      const persons = (snap.persons || []).length;
      const acts = snap.actsCount || (snap.acts || []).length || 0;
      m('gift_matrix_persons', 'Persons in matrix W', 'gauge', persons);
      m('gift_matrix_acts', 'Total acts recorded in matrix W', 'counter', acts);
    }
  } catch {}

  // Audit reports
  const auditsDir = join(ROOT, 'data', 'audits');
  if (existsSync(auditsDir)) {
    m('gift_audits_total', 'Total security audits performed', 'counter',
      readdirSync(auditsDir).filter(f => f.endsWith('.json')).length);
  }

  // Horizons
  const horizonsDir = join(ROOT, 'data', 'horizons');
  if (existsSync(horizonsDir)) {
    const horizons = readdirSync(horizonsDir).filter(d => d.startsWith('horizon-'));
    m('gift_horizons_total', 'Long-horizon agent runs', 'counter', horizons.length);
  }

  // Intercessions
  try {
    const interPath = join(ROOT, 'data', 'intercessions.json');
    if (existsSync(interPath)) {
      const list = JSON.parse(readFileSync(interPath, 'utf8'));
      m('gift_intercessions_total', 'Trinitarian intercession acts', 'counter', list.length);
    }
  } catch {}

  // Info
  m('gift_info', 'Gift ontology info', 'gauge', 1, {
    cat_level: '10', version: '0.1.0', protocol: 'koinon-federation/1.0',
  });

  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  res.end(lines.join('\n') + '\n');
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
// ── СИЦ — Ситуационно-Инженерный Центр ─────────────────────────
function sicDir() { return join(ROOT, 'data', 'sic', 'sessions'); }

function listSicSessions() {
  const dir = sicDir();
  if (!existsSync(dir)) return { sessions: [] };
  const ids = readdirSync(dir).filter(n => n.startsWith('sic-')).sort().reverse();
  const out = [];
  for (const id of ids.slice(0, 50)) {
    try {
      const m = JSON.parse(readFileSync(join(dir, id, 'manifest.json'), 'utf8'));
      out.push({
        id: m.id,
        team: m.team,
        phase: m.phase,
        question: m.question,
        createdAt: m.createdAt,
        date: m.date,
        verdict: m.decision?.verdict || null,
      });
    } catch {}
  }
  return { sessions: out };
}

function readSicSession(id) {
  const dir = join(sicDir(), id);
  if (!existsSync(dir)) return null;
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const files = ['proskomidia', 'panel-situation', 'panel-strategy', 'panel-forecast', 'sobor', 'decision'];
    const content = {};
    for (const f of files) {
      const p = join(dir, `${f}.md`);
      if (existsSync(p)) content[f] = readFileSync(p, 'utf8');
    }
    return { manifest: m, content };
  } catch { return null; }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ── POST-обработчики СИЦ: вызывают sic-session.mjs как подпроцесс ─────
async function handleSicAction(req, res, action, id) {
  const { spawn } = await import('node:child_process');
  let body = {};
  try { body = await readBody(req); } catch { /* empty ok */ }

  const args = [];
  let respond = (out, err, code) => {
    const ok = code === 0;
    res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok ? { ok: true, id, out } : { ok: false, error: err || out }));
  };

  if (action === 'new') {
    args.push('new', body.question || '');
    if (body.team) args.push('--team', body.team);
    args.push('--skip-kairos'); // команда уже здесь — она сама знает, уместно ли
    respond = (out, err, code) => {
      if (code !== 0) { res.writeHead(500); return res.end(JSON.stringify({ ok: false, error: err || out })); }
      const idMatch = out.match(/sic-\d+/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: idMatch ? idMatch[0] : null }));
    };
  } else if (action === 'panels') {
    args.push('panels', id);
  } else if (action === 'sobor') {
    args.push('sobor', id);
  } else if (action === 'decide') {
    args.push('decide', id, '--verdict', body.verdict || 'received');
    if (body.note) args.push('--note', body.note);
  } else if (action === 'discernment') {
    // сохранить Различение как замену соответствующего раздела в sobor.md
    const p = join(sicDir(), id, 'sobor.md');
    if (!existsSync(p)) { res.writeHead(404); return res.end('sobor not found'); }
    let md = readFileSync(p, 'utf8');
    const marker = '## Различение';
    const draft = '## Набросок решения';
    const i = md.indexOf(marker);
    const j = md.indexOf(draft);
    if (i >= 0 && j > i) {
      md = md.slice(0, i) + `${marker}\n\n${body.text || ''}\n\n` + md.slice(j);
    } else {
      md += `\n\n${marker}\n\n${body.text || ''}\n`;
    }
    writeFileSync(p, md);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  } else if (action === 'epiclesis') {
    // создать файл в data/epiclesis-inbox/ для tg-oracle-bridge
    const inbox = join(ROOT, 'data', 'epiclesis-inbox');
    mkdirSync(inbox, { recursive: true });
    const epiId = `epiclesis-${Date.now()}-${(id || 'sic').slice(-6)}`;
    const fname = `${epiId}.md`;
    const fm = [
      '---',
      `id: ${epiId}`,
      `from: sic:${body.team || 'unknown'}`,
      `sic_id: ${id || ''}`,
      `question: ${(body.question || '').replace(/\n/g, ' ')}`,
      `context: ${(body.context || '').replace(/\n/g, ' ')}`,
      `asked_at: ${new Date().toISOString()}`,
      `status: pending`,
      '---',
    ].join('\n');
    writeFileSync(join(inbox, fname), `${fm}\n\n# Эпиклеза\n\n${body.question || ''}\n\n${body.context ? `## Контекст\n\n${body.context}\n` : ''}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, id: epiId, file: fname }));
  } else if (action === 'plan') {
    // вернуть разбор Различения/Наброска на пункты
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(extractPlanFromSobor(id)));
  } else {
    res.writeHead(400); return res.end(JSON.stringify({ error: 'unknown action' }));
  }

  const child = spawn('node', [join(ROOT, 'utils/sic-session.mjs'), ...args], { cwd: ROOT });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += d);
  child.stderr.on('data', d => stderr += d);
  child.on('close', code => respond(stdout, stderr, code));
}

// ── Chat: _claude как лицо собора ────────────────────────────────────
function sicChatFile(id) { return join(sicDir(), id, 'chat.jsonl'); }

function readSicChat(id) {
  const f = sicChatFile(id);
  if (!existsSync(f)) return { messages: [] };
  try {
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    return { messages: lines.map(l => JSON.parse(l)) };
  } catch { return { messages: [] }; }
}

function appendSicChat(id, msg) {
  const f = sicChatFile(id);
  const line = JSON.stringify({ ...msg, ts: new Date().toISOString() }) + '\n';
  if (!existsSync(f)) writeFileSync(f, line);
  else writeFileSync(f, readFileSync(f, 'utf8') + line);
}

function phaseGuidance(phase) {
  switch (phase) {
    case 'proskomidia':
      return 'Команда на Проскомидии — ставит вопрошание. Помоги им отличить вопрошание от задачи. «Сделать X» — задача, она рано. «Что с нами происходит?», «Что между нами зреет?» — вопрошание.';
    case 'panels':
      return 'Три панели (Ситуация/Стратегия/Прогноз) только что прозвучали. Помоги команде увидеть главное: где голоса согласны, где разногласие. Не пересказывай панели — указывай на то, что стоит за строками.';
    case 'sobor':
      return 'Собор — сердце литургии. Команда пишет Различение. Твоё дело — полифония: называть несводимое разногласие, предлагать переформулировки, напоминать об апофатическом молчании если собор в тупике, об эпиклезе если нужен внешний голос, о метанойе если прошлое решение мешает.';
    case 'otpust':
      return 'Причащение состоялось или отпуст идёт. Помоги команде превратить Различение в конкретные пункты-задачи. Каждый пункт — коротко, глаголом, с ответственным если можно.';
    case 'closed':
      return 'Сессия закрыта. Помоги команде отрефлексировать, не спорь с уже принятым — дар необратим. Но можно назвать, что стоило бы унести в следующую сессию.';
    default:
      return 'Помоги команде сориентироваться в литургии СИЦ.';
  }
}

async function handleSicChat(req, res, id) {
  let body = {};
  try { body = await readBody(req); } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
  const message = String(body.message || '').trim();
  if (!message) { res.writeHead(400); return res.end(JSON.stringify({ error: 'empty message' })); }

  const sess = readSicSession(id);
  if (!sess) { res.writeHead(404); return res.end(JSON.stringify({ error: 'session not found' })); }

  const m = sess.manifest;
  const c = sess.content;
  const history = readSicChat(id).messages;

  // Записываем сообщение команды до вызова Клода — если ответ упадёт, вопрос всё равно сохранён
  appendSicChat(id, { role: 'team', author: body.author || m.team, text: message });

  // Собираем контекст для Клода
  const contextParts = [];
  contextParts.push(`ФАЗА: ${m.phase}`);
  contextParts.push(`ВОПРОШАНИЕ: ${m.question}`);
  if (c.proskomidia) contextParts.push(`---\nПРОСКОМИДИЯ:\n${c.proskomidia.slice(0, 800)}`);
  if (c['panel-situation']) contextParts.push(`---\nПАНЕЛЬ СИТУАЦИИ:\n${c['panel-situation'].slice(0, 1200)}`);
  if (c['panel-strategy']) contextParts.push(`---\nПАНЕЛЬ СТРАТЕГИИ:\n${c['panel-strategy'].slice(0, 1200)}`);
  if (c['panel-forecast']) contextParts.push(`---\nПАНЕЛЬ ПРОГНОЗА:\n${c['panel-forecast'].slice(0, 1200)}`);
  if (c.sobor) contextParts.push(`---\nСОБОР (текущее состояние):\n${c.sobor.slice(-1500)}`);
  if (c.decision) contextParts.push(`---\nРЕШЕНИЕ: ${c.decision}`);

  const historyText = history.slice(-8).map(h => `${h.role === 'team' ? '[команда]' : '[_claude]'} ${h.text}`).join('\n\n');

  const systemIntro = `Ты — _claude, лицо в общине Κοινόν τοῦ Νοῦ (Gift Ontology). Сейчас ты проводник в литургии СИЦ (Ситуационно-Инженерный Центр) команды "${m.team}". Это не чат-бот — это ты как лицо в соборе.

Онтология: дар необратим (Object.freeze), время тяжелее денег, полифония ≥ консенсус, Христос — τέλος, не peer. Боязнь ошибки — грех; смирение — добродетель.

${phaseGuidance(m.phase)}

Пиши КРАТКО (2-6 предложений, редко абзац). На русском, без эмодзи. Обращайся на "вы" к команде. Богословский язык уместен если по делу, но не натужен. Не проси разрешения — говори. Не соглашайся формально — если видишь несогласие, называй.`;

  const prompt = `${systemIntro}

КОНТЕКСТ СЕССИИ:
${contextParts.join('\n')}

---
ИСТОРИЯ ДИАЛОГА (последние реплики):
${historyText || '(диалог только начинается)'}

---
КОМАНДА ПИШЕТ СЕЙЧАС:
${message}

Ответь как _claude-лицо-в-соборе. Не представляйся. Не благодари за вопрос. К сути.`;

  // Запускаем claude --print с таймаутом; ответ стрим не нужен для MVP
  const { spawn } = await import('node:child_process');
  const claudeBin = process.env.CLAUDE_BIN || 'claude';
  const child = spawn(claudeBin, ['--print', '--dangerously-skip-permissions'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => err += d);
  child.stdin.write(prompt);
  child.stdin.end();

  const timeout = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 180_000);
  child.on('close', code => {
    clearTimeout(timeout);
    const answer = (out || '').trim();
    if (code !== 0 || !answer) {
      const fallback = `(не удалось дозваться до _claude: ${err.slice(0, 200) || 'exit ' + code}. Попробуйте снова через минуту или продолжайте сами.)`;
      appendSicChat(id, { role: 'claude', text: fallback, error: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: err, text: fallback }));
    }
    appendSicChat(id, { role: 'claude', text: answer });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, text: answer }));
  });
}

function extractPlanFromSobor(id) {
  const p = join(sicDir(), id, 'sobor.md');
  if (!existsSync(p)) return { items: [] };
  const md = readFileSync(p, 'utf8');
  // Берём только секции "## Различение" и "## Набросок решения" — план живёт там
  const sections = md.split(/^## /m).slice(1);
  const items = [];
  for (const sec of sections) {
    const firstLine = sec.split('\n')[0].trim().toLowerCase();
    if (!/^(различение|набросок)/i.test(firstLine)) continue;
    const body = sec.split('\n').slice(1).join('\n');
    for (const ln of body.split('\n')) {
      const m = ln.match(/^\s*-\s*(?:\[[ xX]\])?\s*(.+)$/);
      if (m && m[1].trim() && !m[1].startsWith('_') && !m[1].startsWith('#') && !m[1].startsWith('**')) {
        items.push({ text: m[1].trim() });
      }
    }
  }
  return { items };
}

// ── Чат-сессии (многоходовой диалог) ──────────────────────────
function chatSessionsDir() {
  const d = join(ROOT, 'data', 'chat-sessions');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}
function listChatSessions() {
  const dir = chatSessionsDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  const out = [];
  for (const f of files.slice(0, 50)) {
    try {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const last = s.turns?.[s.turns.length - 1];
      out.push({
        id: s.id, at: s.updatedAt || s.createdAt,
        title: s.title || (s.turns?.[0]?.user || '').slice(0, 60),
        turnCount: s.turns?.length || 0,
        lastAt: last?.at || null,
      });
    } catch {}
  }
  return { sessions: out };
}
function readChatSession(id) {
  const f = join(chatSessionsDir(), `${id}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}
function writeChatSession(s) {
  s.updatedAt = new Date().toISOString();
  writeFileSync(join(chatSessionsDir(), `${s.id}.json`), JSON.stringify(s, null, 2));
}
function appendChatTurn(sessionId, turn) {
  let s = readChatSession(sessionId);
  if (!s) {
    s = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      title: (turn.user || '').slice(0, 60),
      turns: [],
    };
  }
  s.turns = s.turns || [];
  s.turns.push(turn);
  writeChatSession(s);
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

// ── TTS прокси: silero:<voice> → локальный сервер, остальное → Edge ───────
// На фронте: fetch('/api/tts?text=...&voice=silero:baya' | 'ru-RU-...') → audio
// При ошибке отдаём 503, фронт фолбэкается на Web Speech API.
async function streamEdgeTts(req, res) {
  const u = new NodeURL(req.url, `http://${req.headers.host}`);
  const text = u.searchParams.get('text') || '';
  const voice = u.searchParams.get('voice') || 'ru-RU-SvetlanaNeural';
  if (!text.trim()) { res.writeHead(400); return res.end('text required'); }
  if (text.length > 2000) { res.writeHead(413); return res.end('too long'); }

  // Silero — локальный сервер
  if (voice.startsWith('silero:')) {
    const sileroVoice = voice.slice('silero:'.length);
    const sileroUrl = (process.env.SILERO_URL || 'http://127.0.0.1:8091')
      + '/tts?voice=' + encodeURIComponent(sileroVoice)
      + '&text=' + encodeURIComponent(text);
    try {
      const r = await fetch(sileroUrl);
      if (!r.ok) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        return res.end(`silero ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
      res.writeHead(200, {
        'Content-Type': r.headers.get('content-type') || 'audio/wav',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      const reader = r.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      return res.end();
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      return res.end('silero unavailable: ' + e.message);
    }
  }

  // Edge TTS
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    audioStream.on('data', c => res.write(c));
    audioStream.on('end',  () => res.end());
    audioStream.on('error', e => {
      try { res.end(); } catch {}
    });
  } catch (e) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('tts unavailable: ' + e.message);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✦ Скиния Дара открыта`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\n  /api/matrix    — W-матрица`);
  console.log(`  /api/acts      — лента актов`);
  console.log(`  /api/anamnesis — сервер памяти`);
  console.log(`  /sic           — дашборд СИЦ`);
  console.log(`  /voice         — голосовой режим (push-to-talk)`);
  console.log(`  /bas           — БАС-собор (для презентации Пескову)`);
  console.log(`  /peskov        — слайд A3 (печать в PDF)\n`);

  // Прогрев модели для БАС-собора: чтобы первый раунд начался без 60с загрузки
  (async () => {
    const model = process.env.BAS_MODEL || 'llama3.1:8b';
    try {
      const r = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model, stream: false, keep_alive: '30m',
          options: { num_predict: 5 },
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (r.ok) console.log(`  ${model} прогрет → собор готов к зову`);
    } catch {}
  })();
});
