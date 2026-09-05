#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ink-cli.mjs — современный TUI для gift-агента на Ink (React в терминале).
// Та же технология, что у Claude Code / Gemini CLI. Логика (модель, tools,
// федерация, КИС, матрица) переиспользуется из gift-agent.js.
//
//   • рамка ввода на всю ширину (как у Claude Code), курсор, история ↑↓
//   • /-меню команд с фильтрацией и выбором стрелками
//   • стриминг ответа, авто-выполнение tools (без запросов)
//   • статус-бар: backend · модель · стоимость · матрица
//   • КИС сканирует ответы; сессии сохраняются
// ══════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import htm from 'htm';
import fs from 'fs';
import {
  apiCallStream, executeTool, TOOLS, buildSystemPrompt, renderMarkdown,
  loadMatrix, matrixSummary, newSessionId, saveSession, loadSession, listSessions,
  estimateTokens, compactMessages,
} from './gift-agent.js';
import CognitiveImmuneSystem from '../proxy/CognitiveImmuneSystem.js';
import { connectMcp } from './mcp-client.mjs';

const html = htm.bind(React.createElement);
const PROXY = process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:3200';
const ROOT = new URL('../..', import.meta.url).pathname;

// Resume: GIFT_RESUME=<id> или --resume <id>
const RESUME_ID = process.env.GIFT_RESUME
  || (process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume') + 1] : null);
let activeSessionId = null;   // для подсказки при выходе

// КИС: один экземпляр на сессию, сканирует каждый ответ агента.
let _immune;
function immune() {
  if (!_immune) { try { _immune = new CognitiveImmuneSystem({ acts: [] }); _immune.activatePublicRepertoire(); } catch { _immune = null; } }
  return _immune;
}
function scanText(text) {
  const im = immune();
  if (!im || !text || text.length < 20) return null;
  try { return im.fullDiagnostics(text, 'agent'); } catch { return null; }
}

const SLASH = [
  { cmd: '/help', desc: 'справка' },
  { cmd: '/switch', desc: 'бэкенд (ds|ra|fed|anthropic)', arg: true },
  { cmd: '/mcp', desc: 'MCP: список / on / off (off — легче payload)', arg: true },
  { cmd: '/tools', desc: 'доступные инструменты агента' },
  { cmd: '/immune', desc: 'иммунная система (КИС) — состояние' },
  { cmd: '/theme', desc: 'тема: gift|matrix|ocean|mono', arg: true },
  { cmd: '/sessions', desc: 'сессии (можно фильтр: /sessions слово)', arg: true },
  { cmd: '/matrix', desc: 'снимок W-матрицы' },
  { cmd: '/plan', desc: 'режим планирования (только чтение, как Shift+Tab)' },
  { cmd: '/clear', desc: 'очистить диалог' },
  { cmd: '/exit', desc: 'выход' },
];

async function fetchJSON(url, opts = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(opts.timeout || 3000), ...opts });
    return await r.json();
  } catch { return null; }
}

// ── один агентский ход: стрим + авто-tools, поддерживает историю ──
async function runTurn(messages, system, cb, opts = {}) {
  const tools = opts.tools || TOOLS;
  const exec = opts.exec || executeTool;
  let turns = 0;
  while (turns++ < 30) {
    // Защита от распухания контекста (агент начитал много файлов) → зависание модели.
    try {
      if (estimateTokens(messages) > 50000) {
        cb.onText && cb.onText('\n[сжимаю контекст…]\n');
        const compacted = await compactMessages(messages, system);
        messages.length = 0; messages.push(...compacted);
      }
    } catch { /* компакт не вышел — продолжаем как есть */ }
    const resp = await apiCallStream(messages, system, tools, {
      onText: (chunk) => cb.onText(chunk),
      onToolUse: () => {},
    });
    const content = resp.content || [];
    messages.push({ role: 'assistant', content });
    const text = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (text) cb.onAssistant(text, resp.usage);
    const toolUses = content.filter(b => b.type === 'tool_use');
    if (!toolUses.length) break;
    const results = [];
    for (const tu of toolUses) {
      cb.onTool(tu.name, tu.input);
      let out;
      try { out = await exec(tu.name, tu.input); }
      catch (e) { out = 'ERROR: ' + (e?.message || e); }
      const rt = typeof out === 'string' ? out : JSON.stringify(out);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: rt.slice(0, 12000) });
      cb.onToolResult(tu.name, rt);
    }
    messages.push({ role: 'user', content: results });
  }
}

const THEMES = {
  gift:   { accent: 'yellow', border: 'cyan' },
  matrix: { accent: 'green', border: 'green' },
  ocean:  { accent: 'cyan', border: 'blue' },
  mono:   { accent: 'white', border: 'gray' },
};

const LOGO = [
  '  ██████╗ ██╗███████╗████████╗',
  ' ██╔════╝ ██║██╔════╝╚══██╔══╝',
  ' ██║  ███╗██║█████╗     ██║',
  ' ██║   ██║██║██╔══╝     ██║',
  ' ╚██████╔╝██║██║        ██║',
  '  ╚═════╝ ╚═╝╚═╝        ╚═╝',
].join('\n');

let _itemId = 0;
const item = (o) => ({ id: ++_itemId, ...o });

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = (stdout && stdout.columns) || 80;

  const [items, setItems] = useState([{ id: 0, kind: 'banner' }]);  // transcript (Static), первым — логотип
  const [stream, setStream] = useState('');      // живой стрим ответа
  const [lastVerdict, setLastVerdict] = useState(null);  // последний вердикт КИС (для панели)
  const [activity, setActivity] = useState('');  // что агент делает сейчас (для спиннера)
  const [lastTool, setLastTool] = useState(null);  // последний tool+результат (для панели)
  const [theme, setTheme] = useState(THEMES.gift);
  const [themeName, setThemeName] = useState('gift');
  const [buf, setBuf] = useState('');            // строка ввода
  const [cur, setCur] = useState(0);             // позиция курсора
  const [busy, setBusy] = useState(false);
  // Plan-mode (Shift+Tab, как у Claude Code): агент думает и предлагает план,
  // но не пишет и не исполняет. Опасные tools отфильтрованы на уровне раздачи —
  // модель не может «случайно» нажать на Bash, его просто нет в списке.
  const [planMode, setPlanMode] = useState(false);
  const planModeRef = useRef(false);
  planModeRef.current = planMode;
  // Permission-диалог (как у Claude Code): опасные tools — Write/Edit/Bash —
  // спрашивают y/n/a (a = да и больше не спрашивать в сессии). Read/Grep/Glob — авто.
  const [approve, setApprove] = useState(null);   // { name, preview, resolve }
  const autoApproveRef = useRef(false);
  const approveRef = useRef(null);
  approveRef.current = approve;
  const [spin, setSpin] = useState(0);
  const [sel, setSel] = useState(0);             // выбор в /-меню
  const [status, setStatus] = useState({ label: '…', model: '', cost: 0, acts: 0 });
  const messagesRef = useRef([]);                // история для API
  const histRef = useRef([]);                    // история ввода
  const histIdxRef = useRef(-1);
  const sessionRef = useRef(null);
  if (sessionRef.current === null) {
    const s = (RESUME_ID && loadSession(RESUME_ID)) || { id: newSessionId(), messages: [] };
    sessionRef.current = s;
    messagesRef.current = Array.isArray(s.messages) ? s.messages : [];
    activeSessionId = s.id;
  }
  const mcpRef = useRef({ tools: [], call: null });
  const queuedRef = useRef(null);   // сообщение, набранное во время генерации
  const [mcp, setMcp] = useState({ ready: [], count: 0, connecting: true });

  const add = useCallback((it) => setItems(prev => [...prev, item(it)]), []);

  const refreshStatus = useCallback(async () => {
    const st = await fetchJSON(`${PROXY}/_proxy/status`);
    const cost = await fetchJSON(`${PROXY}/_proxy/cost`);
    const nousUrl = process.env.ANAMNESIS_URL || 'http://localhost:8089';
    const nous = await fetchJSON(`${nousUrl.replace(/\/$/, '')}/summary`, { timeout: 1200 });
    let acts = 0; try { acts = (loadMatrix().acts || []).length; } catch {}
    setStatus({
      label: st?.label || st?.mode || 'local',
      model: st?.model || '',
      cost: cost?.total_cost ?? 0,
      acts,
      anamnesis: !!nous,
    });
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);
  useEffect(() => { const t = setInterval(refreshStatus, 12000); return () => clearInterval(t); }, [refreshStatus]);

  // Подключение MCP-серверов в фоне (Playwright/Telegram/Integram/Context7…)
  const doConnectMcp = useCallback(async () => {
    setMcp({ ready: [], count: 0, connecting: true });
    try {
      const m = await connectMcp(ROOT + '.mcp.json', { onLog: () => {} });
      mcpRef.current = m;
      setMcp({ ready: m.ready, count: m.tools.length, connecting: false });
      if (m.ready.length) add({ kind: 'sys', text: 'MCP подключены: ' + m.ready.map(r => `${r.name}(${r.tools})`).join(', ') });
    } catch { setMcp({ ready: [], count: 0, connecting: false }); }
  }, [add]);
  useEffect(() => { doConnectMcp(); }, [doConnectMcp]);
  useEffect(() => {
    if (RESUME_ID && messagesRef.current.length) {
      add({ kind: 'sys', text: `↻ продолжена сессия ${sessionRef.current.id} (${messagesRef.current.length} сообщений в контексте)` });
    }
  }, []);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSpin(s => (s + 1) % 10), 80);
    return () => clearInterval(t);
  }, [busy]);

  const menuOpen = buf.startsWith('/') && !busy;
  const menuMatches = menuOpen ? SLASH.filter(s => s.cmd.startsWith(buf.split(' ')[0])) : [];

  async function handleSlash(line) {
    const [cmd, ...rest] = line.trim().split(' ');
    const arg = rest.join(' ');
    if (cmd === '/exit') { exit(); return; }
    if (cmd === '/plan') { setPlanMode(v => !v); add({ kind: 'sys', text: planModeRef.current ? 'режим плана снят — можно исполнять' : 'режим плана: только чтение и анализ, записи запрещены (Shift+Tab — снять)' }); return; }
    if (cmd === '/clear') { messagesRef.current = []; setItems([{ id: 0, kind: 'banner' }, item({ kind: 'sys', text: 'диалог очищен' })]); return; }
    if (cmd === '/help') {
      add({ kind: 'sys', text: SLASH.map(s => `  ${s.cmd.padEnd(12)} — ${s.desc}`).join('\n') });
      return;
    }
    if (cmd === '/switch') {
      const map = { ds: 'deepseek', ra: 'routerai', or: 'openrouter', fw: 'fireworks', fed: 'federation', an: 'anthropic' };
      const backend = map[arg] || arg || 'federation';
      const r = await fetchJSON(`${PROXY}/_proxy/mode`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://127.0.0.1' },
        body: `backend=${backend}`,
      });
      add({ kind: 'sys', text: r?.error ? `ошибка: ${r.error}` : `бэкенд → ${r?.label || backend}` });
      refreshStatus();
      return;
    }
    if (cmd === '/theme') {
      const t = THEMES[arg];
      if (t) { setTheme(t); setThemeName(arg); add({ kind: 'sys', text: `тема → ${arg}` }); }
      else add({ kind: 'sys', text: `темы: ${Object.keys(THEMES).join(', ')} (текущая: ${themeName})` });
      return;
    }
    if (cmd === '/mcp' && (arg === 'off' || arg === 'on')) {
      if (arg === 'off') {
        try { mcpRef.current.close && mcpRef.current.close(); } catch {}
        mcpRef.current = { tools: [], call: null, ready: [] };
        setMcp({ ready: [], count: 0, connecting: false });
        add({ kind: 'sys', text: 'MCP отключены — payload легче, модель быстрее. /mcp on — вернуть.' });
      } else {
        add({ kind: 'sys', text: 'MCP подключаются…' });
        doConnectMcp();
      }
      return;
    }
    if (cmd === '/mcp') {
      // 1) мгновенно — список серверов из .mcp.json (синхронно, никогда не пусто)
      let servers = [];
      let lines = [];
      const paths = [ROOT + '.mcp.json', process.cwd() + '/.mcp.json'];
      let cfgFound = false;
      for (const p of paths) {
        try { const cfg = JSON.parse(fs.readFileSync(p, 'utf8')); servers = Object.entries(cfg.mcpServers || {}); cfgFound = true; break; } catch {}
      }
      if (!cfgFound) lines = [`нет .mcp.json (искал: ${paths.join(', ')})`];
      else if (!servers.length) lines = ['(нет MCP-серверов в .mcp.json)'];
      else {
        lines = ['MCP-серверы:'];
        for (const [name, s] of servers) {
          const url = (s.args || []).join(' ').match(/https?:\/\/[^\s'"]+/)?.[0];
          lines.push(`  ${name}${url ? ' → ' + url : ' (' + (s.command || 'cmd') + ')'}`);
        }
      }
      // 2) живой статус подключения MCP-клиентом
      const ready = mcpRef.current.ready || [];
      const conn = mcp.connecting ? '  (подключаюсь…)'
        : ready.length ? '  подключено: ' + ready.map(r => `${r.name} ● ${r.tools} tools`).join(', ')
        : '  подключено: нет';
      lines.push(conn);
      add({ kind: 'sys', text: lines.join('\n') });
      return;
    }
    if (cmd === '/tools') {
      const all = [...TOOLS, ...mcpRef.current.tools];
      const txt = `Инструменты агента (${all.length}, из них MCP: ${mcpRef.current.tools.length}):\n` +
        all.map(t => `  ${t.name.padEnd(22)} ${(t.description || '').split('\n')[0].slice(0, 52)}`).join('\n');
      add({ kind: 'sys', text: txt });
      return;
    }
    if (cmd === '/immune') {
      const im = immune();
      if (!im) { add({ kind: 'sys', text: 'КИС недоступна' }); return; }
      const ab = (im.antibodies || []).length;
      const rep = (im.repertoire && (im.repertoire.length || Object.keys(im.repertoire).length)) || 0;
      const st = im.getStats ? im.getStats() : {};
      const txt = [
        'Когнитивная Иммунная Система (КИС):',
        `  репертуар: ${ab} антител${rep ? ', ' + rep + ' паттернов' : ''}`,
        `  сканов за сессию: детекций ${st.totalDetections ?? 0}, типов ${st.uniqueTypes ?? 0}, ср.опасность ${st.avgDanger ?? 0}`,
        st.topClones && st.topClones.length ? '  топ-клоны: ' + st.topClones.map(c => `${c.id}×${c.count}`).join(', ') : '',
        '  Как работает: каждый ответ агента сканируется — детектит манипуляции,',
        '  солюционизм, лесть, противоречия (с историей и W-матрицей), «мёртвый» тон.',
        '  Вердикт показывается под каждым ответом: 🛡 healthy/neutral/suspicious/attack.',
      ].filter(Boolean).join('\n');
      add({ kind: 'sys', text: txt });
      return;
    }
    if (cmd === '/sessions') {
      let ss = listSessions(50);
      if (arg) { const q = arg.toLowerCase(); ss = ss.filter(s => (s.id + ' ' + (s.preview || '')).toLowerCase().includes(q)); }
      const list = ss.slice(0, 12).map(s => `  ${s.id}  ${s.preview || ''}`.slice(0, cols - 2)).join('\n');
      add({ kind: 'sys', text: (arg ? `сессии «${arg}»:\n` : '') + (list || '(нет сессий)') });
      return;
    }
    if (cmd === '/matrix') {
      let txt = ''; try { txt = matrixSummary(loadMatrix()); } catch (e) { txt = 'матрица недоступна'; }
      add({ kind: 'sys', text: String(txt).slice(0, 2000) });
      return;
    }
    add({ kind: 'sys', text: `неизвестная команда: ${cmd}` });
  }

  async function submit(line) {
    const text = line.trim();
    if (!text) return;
    histRef.current.push(line); histIdxRef.current = -1;
    setBuf(''); setCur(0); setSel(0);
    if (text.startsWith('/')) { await handleSlash(text); return; }

    add({ kind: 'user', text });
    messagesRef.current.push({ role: 'user', content: text });
    setBusy(true); setStream(''); setActivity('');
    let streamed = '';
    try {
      const mcpHint = (mcpRef.current.ready && mcpRef.current.ready.length)
        ? `\n\nДоступны MCP-инструменты от серверов: ${mcpRef.current.ready.map(r => r.name).join(', ')} ` +
          `(имена вида mcp__<сервер>__<tool>: браузер, телеграм, документация). Вызывай когда уместно.`
        : '';
      const PLAN_PROMPT = '\n\n# РЕЖИМ ПЛАНИРОВАНИЯ (plan mode)\nСейчас действует запрет на изменения: НЕ пиши и не правь файлы, НЕ запускай команды с побочными эффектами. Только чтение и анализ. Изложи план: шаги, файлы, риски. Пользователь одобрит — режим снимется и план будет исполнен.';
      const planTools = [...TOOLS, ...mcpRef.current.tools].filter(t =>
        ['Read', 'Grep', 'Glob', 'WebFetch', 'TodoWrite', 'matrix_query', 'recall_treasure'].includes(t.name) || t.name.startsWith('mcp__'));
      await runTurn(messagesRef.current, buildSystemPrompt() + mcpHint + (planMode ? PLAN_PROMPT : ''), {
        onText: (c) => { streamed += c; setStream(streamed); setActivity(''); },
        onAssistant: (t, usage) => {
          streamed = '';
          const d = scanText(t);
          setLastVerdict(d?.verdict || null);
          add({
            kind: 'assistant', text: t,
            verdict: d?.verdict || null,
            health: d?.health?.label || null,
            threats: (d?.threats || []).length,
          });
          setStream('');
        },
        onTool: (name, input) => { setActivity(`${name}: ${previewInput(name, input).slice(0, 50)}`); add({ kind: 'tool', name, input }); },
        onToolResult: (name, result) => { setActivity(''); setLastTool({ name, result: String(result).replace(/\n/g, ' ').slice(0, 80) }); add({ kind: 'toolres', name, result: result.slice(0, 500) }); },
      }, {
        tools: planMode ? planTools : [...TOOLS, ...mcpRef.current.tools],
        exec: async (n, i) => {
          const run = () => (n.startsWith('mcp__') && mcpRef.current.call) ? mcpRef.current.call(n, i) : executeTool(n, i);
          const dangerous = ['Write', 'Edit', 'Bash'].includes(n) && !n.startsWith('mcp__');
          if (!dangerous || autoApproveRef.current || process.env.GIFT_YES) return run();
          const ok = await new Promise(resolve => {
            setApprove({ name: n, preview: previewInput(n, i), resolve });
          });
          setApprove(null);
          return ok ? run() : { error: 'пользователь отклонил действие' };
        },
      });
    } catch (e) {
      add({ kind: 'err', text: String(e?.message || e) });
    }
    setStream('');
    setBusy(false); setActivity('');
    // сессия
    try { sessionRef.current.messages = messagesRef.current; saveSession(sessionRef.current); } catch {}
    refreshStatus();
    // отложенное сообщение из очереди (набрано во время генерации)
    if (queuedRef.current) { const q = queuedRef.current; queuedRef.current = null; setTimeout(() => submit(q), 30); }
  }

  useInput((input, key) => {
    // диалог подтверждения: y/д = да · n/отк = нет · a/в = да всегда · Esc = нет
    if (approveRef.current) {
      const k = (input || '').toLowerCase();
      if (k === 'y' || k === 'д' || key.return) { approveRef.current.resolve(true); }
      else if (k === 'a' || k === 'в') { autoApproveRef.current = true; approveRef.current.resolve(true); }
      else if (k === 'n' || k === 'н' || key.escape || (key.ctrl && input === 'c')) { approveRef.current.resolve(false); }
      return;
    }
    if (key.ctrl && input === 'c') { exit(); return; }
    if (key.ctrl && input === 'd') { if (!buf && !busy) exit(); return; }

    if (key.return) {
      let line = buf;
      if (!busy && menuOpen && menuMatches.length && buf.indexOf(' ') === -1) {
        const pick = menuMatches[Math.min(sel, menuMatches.length - 1)];
        if (pick) {
          // команда требует аргумент и он ещё не введён → подставить и ждать ввода
          if (pick.arg && pick.cmd === buf.trim()) { setBuf(pick.cmd + ' '); setCur(pick.cmd.length + 1); return; }
          if (pick.arg && pick.cmd !== buf.trim()) { setBuf(pick.cmd + ' '); setCur(pick.cmd.length + 1); return; }
          line = pick.cmd;   // команда без аргумента — отправляем ВЫБРАННУЮ (не устаревший buf)
        }
      }
      // Во время генерации — ставим в очередь (отправится после текущего ответа)
      if (busy) {
        if (line.trim()) { queuedRef.current = (queuedRef.current ? queuedRef.current + '\n' : '') + line; setBuf(''); setCur(0); add({ kind: 'sys', text: '⏳ в очереди: ' + line.slice(0, 60) }); }
        return;
      }
      submit(line);
      return;
    }
    if (key.upArrow) {
      if (menuOpen) { setSel(s => Math.max(0, s - 1)); return; }
      const h = histRef.current;
      if (h.length && histIdxRef.current < h.length - 1) {
        histIdxRef.current++; const v = h[h.length - 1 - histIdxRef.current]; setBuf(v); setCur(v.length);
      }
      return;
    }
    if (key.downArrow) {
      if (menuOpen) { setSel(s => Math.min(menuMatches.length - 1, s + 1)); return; }
      if (histIdxRef.current > 0) { histIdxRef.current--; const v = histRef.current[histRef.current.length - 1 - histIdxRef.current]; setBuf(v); setCur(v.length); }
      else if (histIdxRef.current === 0) { histIdxRef.current = -1; setBuf(''); setCur(0); }
      return;
    }
    if (key.leftArrow) { setCur(c => Math.max(0, c - 1)); return; }
    if (key.rightArrow) { setCur(c => Math.min(buf.length, c + 1)); return; }
    if (key.escape) { setBuf(''); setCur(0); setSel(0); return; }
    if (key.tab && key.shift) { setPlanMode(v => !v); return; }
    if (key.tab) {
      if (menuOpen && menuMatches.length) { const p = menuMatches[Math.min(sel, menuMatches.length - 1)]; setBuf(p.cmd + (p.arg ? ' ' : '')); setCur(p.cmd.length + (p.arg ? 1 : 0)); }
      else if (buf && !busy) {
        // Комплит пути файла: последний токен строки — префикс пути.
        // Общее начало — дописываем; вилка из нескольких — не гадаем.
        try {
          const m = buf.slice(0, cur).match(/(^|\s)([^\s*?]+)$/);
          if (m) {
            const tok = m[2];
            const slash = tok.lastIndexOf('/');
            const dirPart = slash >= 0 ? tok.slice(0, slash + 1) || '/' : '';
            const filePart = slash >= 0 ? tok.slice(slash + 1) : tok;
            const dir = dirPart || '.';
            const names = fs.readdirSync(dir, { withFileTypes: true })
              .filter(e => e.name.startsWith(filePart) && !e.name.startsWith('.'));
            if (names.length === 1) {
              const full = dirPart + names[0].name + (names[0].isDirectory() ? '/' : ' ');
              const nb = buf.slice(0, cur - tok.length) + full + buf.slice(cur);
              setBuf(nb); setCur(cur - tok.length + full.length);
            } else if (names.length > 1) {
              // общий префикс — дописываем сколько можем
              let pref = names[0].name;
              for (const e of names) { while (!e.name.startsWith(pref)) pref = pref.slice(0, -1); }
              if (pref.length > filePart.length) {
                const full = dirPart + pref;
                const nb = buf.slice(0, cur - tok.length) + full + buf.slice(cur);
                setBuf(nb); setCur(cur - tok.length + full.length);
              }
            }
          }
        } catch { /* readdir не удался — тихо */ }
      }
      return;
    }
    if (key.ctrl && input === 'r') {   // обратный поиск по истории
      const q = buf.toLowerCase();
      const matches = histRef.current.filter(x => x !== buf && (!q || x.toLowerCase().includes(q)));
      if (matches.length) { const v = matches[matches.length - 1]; setBuf(v); setCur(v.length); }
      return;
    }
    if (key.backspace || key.delete) {
      if (cur > 0) { setBuf(b => b.slice(0, cur - 1) + b.slice(cur)); setCur(c => c - 1); setSel(0); }
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setBuf(b => b.slice(0, cur) + input + b.slice(cur));
      setCur(c => c + input.length);
      setSel(0);
    }
  });

  // ── render ──
  const SPN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const beforeCur = buf.slice(0, cur);
  const atCur = buf[cur] || ' ';
  const afterCur = buf.slice(cur + 1);

  return html`
    <${Box} flexDirection="column">
      <${Static} items=${items}>
        ${(it) => html`<${TItem} key=${it.id} it=${it} cols=${cols} />`}
      <//>

      ${stream ? html`<${Box} marginTop=${1}><${Text} color="white">${stream.split('\n').slice(-10).join('\n')}<//><//>` : null}

      ${busy ? html`<${Box}><${Text} color="yellow">${SPN[spin % SPN.length]} <//><${Text} color=${activity ? 'magenta' : undefined} dimColor=${!activity}>${activity || 'думаю…'}<//><//>` : null}

      <${Box} flexDirection="row" marginTop=${1}>
        <${Box} flexDirection="column" flexGrow=${1}>
          <${Box} borderStyle="round" borderColor=${busy ? 'gray' : theme.border} paddingX=${1}>
            <${Text} color=${theme.accent}>${'❯ '}<//>
            <${Text}>${beforeCur}<//>
            <${Text} inverse>${atCur}<//>
            <${Text}>${afterCur}<//>
          <//>
          ${menuOpen && menuMatches.length ? html`
            <${Box} flexDirection="column">
              ${menuMatches.map((m, i) => html`
                <${Text} key=${m.cmd} color=${i === sel ? 'yellow' : 'cyan'} bold=${i === sel}>
                  ${i === sel ? '▸ ' : '  '}${m.cmd.padEnd(12)}<${Text} dimColor> — ${m.desc}<//>
                <//>`)}
            <//>`
        : html`<${Text} dimColor>  ${planMode ? html`<${Text} color="magenta" bold>⏳ plan<//><${Text} dimColor> · Shift+Tab снять · <//>` : ''}↑↓ история · / меню · Tab дополнить · Shift+Tab план · ^C выход<//>`}
        <//>

        ${approve ? html`<${Box} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX=${1}>
          <${Text} color="yellow" bold>⚠ ${approve.name}<//>
          <${Text} dimColor>  ${String(approve.preview).slice(0, cols - 8)}<//>
          <${Text} color="green">y<//><${Text}>=да <//><${Text} color="red">n<//><${Text}>=нет <//><${Text} color="cyan">a<//><${Text}>=всегда в этой сессии<//>
        <//>` : null}
      <${Box} flexDirection="column" width=${26} borderStyle="round" borderColor=${theme.border} paddingX=${1} marginLeft=${1}>
          <${Text} bold color=${theme.accent}>⛬ gift<//>
          <${Text} dimColor>${(status.label || '').slice(0, 22)}<//>
          ${status.model ? html`<${Text} color="blue">${status.model.slice(0, 22)}<//>` : null}
          <${Text}>$ ${(status.cost || 0).toFixed(4)}<//>
          <${Text}>matrix: ${status.acts}<//>
          <${Text} color=${status.anamnesis ? 'green' : 'gray'}>anamnesis ${status.anamnesis ? '●' : '○'}<//>
          <${Text} color=${mcp.count ? 'green' : 'gray'}>mcp: ${mcp.connecting ? '…' : mcp.count + ' tools'}<//>
          <${Text} color=${lastVerdict && !['healthy', 'neutral', 'smooth'].includes(lastVerdict) ? 'yellow' : 'green'}>🛡 ${lastVerdict || '—'}<//>
          ${lastTool ? html`<${Box} marginTop=${1} flexDirection="column"><${Text} color="magenta">● ${lastTool.name}<//><${Text} dimColor>${lastTool.result.slice(0, 22)}<//><//>` : null}
          <${Box} marginTop=${1}><${Text} dimColor>тема: ${themeName}<//><//>
        <//>
      <//>
    <//>`;
}

// один элемент транскрипта
function TItem({ it, cols }) {
  if (it.kind === 'banner') return html`<${Box} flexDirection="column" marginBottom=${1}>
      <${Text} color="yellow">${LOGO}<//>
      <${Text} dimColor>  gift-agent · Ink · федерация · /help — команды · /immune — иммунка<//>
    <//>`;
  if (it.kind === 'user') return html`<${Box} marginTop=${1}><${Text} color="cyan" bold>❯ <//><${Text}>${it.text}<//><//>`;
  if (it.kind === 'assistant') {
    const sev = it.threats > 0 ? 'red' : (it.verdict === 'suspicious' || it.verdict === 'contradictory' || it.verdict === 'attack') ? 'yellow' : 'green';
    return html`<${Box} marginTop=${1} flexDirection="column">
      <${Text}>${renderMarkdown(it.text)}<//>
      ${it.verdict ? html`<${Text} color=${sev} dimColor=${sev === 'green'}>🛡 ${it.verdict}${it.threats ? ' · угроз: ' + it.threats : ''}<//>` : null}
    <//>`;
  }
  if (it.kind === 'tool') {
    // TodoWrite → чек-лист как у Claude Code: ☐ pending · ◐ in_progress · ✓ completed
    if (it.name === 'TodoWrite' && it.input && Array.isArray(it.input.todos)) {
      const mark = { pending: '☐', in_progress: '◐', completed: '✓' };
      const color = { pending: 'gray', in_progress: 'yellow', completed: 'green' };
      return html`<${Box} flexDirection="column" marginTop=${1}>
        ${it.input.todos.map((t, i) => html`<${Text} key=${i} color=${color[t.status] || 'gray'}>  ${mark[t.status] || '☐'} ${t.status === 'in_progress' ? (t.content || '') + ' ←' : (t.content || '')}<//>`)}
      <//>`;
    }
    const head = html`<${Box}><${Text} color="magenta">● ${it.name}<//><${Text} dimColor> ${previewInput(it.name, it.input).slice(0, cols - 12)}<//><//>`;
    const W = Math.max(20, cols - 6);
    // Edit → дифф (красные старые / зелёные новые строки)
    if (it.name === 'Edit' && it.input && it.input.old_string != null) {
      const oldL = String(it.input.old_string).split('\n').slice(0, 14);
      const newL = String(it.input.new_string || '').split('\n').slice(0, 14);
      return html`<${Box} flexDirection="column">
        ${head}
        <${Box} flexDirection="column" marginLeft=${2}>
          ${oldL.map((l, i) => html`<${Text} key=${'o' + i} color="red">- ${l.slice(0, W)}<//>`)}
          ${newL.map((l, i) => html`<${Text} key=${'n' + i} color="green">+ ${l.slice(0, W)}<//>`)}
        <//>
      <//>`;
    }
    // Write → содержимое нового файла (зелёным)
    if (it.name === 'Write' && it.input && it.input.content != null) {
      const lines = String(it.input.content).split('\n');
      return html`<${Box} flexDirection="column">
        ${head}
        <${Box} flexDirection="column" marginLeft=${2}>
          ${lines.slice(0, 16).map((l, i) => html`<${Text} key=${i} color="green">+ ${l.slice(0, W)}<//>`)}
          ${lines.length > 16 ? html`<${Text} dimColor>  … +${lines.length - 16} строк<//>` : null}
        <//>
      <//>`;
    }
    return head;
  }
  if (it.kind === 'toolres') return html`<${Box}><${Text} dimColor>  ⎿ ${String(it.result).replace(/\n/g, ' ').slice(0, cols - 6)}<//><//>`;
  if (it.kind === 'sys') return html`<${Box} marginTop=${1}><${Text} color="gray">${it.text}<//><//>`;
  if (it.kind === 'err') return html`<${Box} marginTop=${1}><${Text} color="red">✗ ${it.text}<//><//>`;
  return null;
}
function previewInput(name, input) {
  if (!input) return '';
  if (name === 'Bash') return input.command || '';
  if (input.file_path) return input.file_path;
  if (input.pattern) return input.pattern;
  return JSON.stringify(input);
}

const _app = render(html`<${App} />`);
_app.waitUntilExit().then(() => {
  if (activeSessionId) {
    process.stdout.write(
      `\n  Продолжить эту сессию:\n` +
      `  \x1b[36mgift --resume ${activeSessionId}\x1b[0m\n\n`,
    );
  }
  process.exit(0);   // MCP stdio-дети держат event loop — выходим явно
}).catch(() => process.exit(0));
