/**
 * repl.js — интерактивный REPL gift CLI поверх @anthropic-ai/claude-agent-sdk.
 *
 * Multi-turn conversation: пользователь печатает строку → SDK делает
 * tool-use loop с MCP-tools → ответ → следующая строка. Persistent
 * session: каждое сообщение пишется в data/chat-sessions/repl-<id>.json,
 * можно вернуться через --resume <id>.
 *
 * Slash-команды (обрабатываются локально, не уходят в модель):
 *   /help          — список slash-команд
 *   /clear         — очистить историю текущей сессии
 *   /save          — явный save (auto-save и так каждое сообщение)
 *   /sessions      — список последних сессий
 *   /resume <id>   — перейти к сессии (сначала /save)
 *   /tools         — список доступных tools
 *   /status        — gift status inline
 *   /recall <q>    — прямой mcp__gift__recall_treasure
 *   /unfold <id>   — прямой mcp__gift__unfold_treasure
 *   /matrix        — снимок W (mcp__gift__matrix_query)
 *   /pustynya      — пустыни матрицы
 *   /cost          — суммарная стоимость текущей сессии
 *   /quit | /exit  — выход (Ctrl+D тоже)
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { buildGiftMcpServer, GIFT_TOOL_NAMES } from './gift-tools.js';
import { GIFT_SYSTEM_PROMPT } from './system-prompt.js';
import { GIFT_HOOKS } from './hooks.js';
import { LcmStore, defaultDbPath } from '../lcm/store.js';
import { TermUI } from './term-ui.js';

const ROOT = '/home/unidel/gift';
const SESS_DIR = resolve(ROOT, 'data/chat-sessions');

const C = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m',
  red:     '\x1b[31m',
  gold:    '\x1b[33m',
};
const c = (col, s) => `${C[col]}${s}${C.reset}`;

// ── session storage ─────────────────────────────────────────────────────
function newSessionId() {
  const ts = Date.now().toString(36);
  const r  = Math.random().toString(36).slice(2, 6);
  return `repl-${ts}-${r}`;
}

function sessionPath(id) {
  return resolve(SESS_DIR, `${id}.json`);
}

function loadSession(id) {
  const path = sessionPath(id);
  if (!existsSync(path)) throw new Error(`сессия не найдена: ${id}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveSession(session) {
  if (!existsSync(SESS_DIR)) mkdirSync(SESS_DIR, { recursive: true });
  session.updatedAt = new Date().toISOString();
  writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2));
}

function listSessions(limit = 20) {
  if (!existsSync(SESS_DIR)) return [];
  const files = readdirSync(SESS_DIR)
    .filter(f => f.startsWith('repl-') && f.endsWith('.json'))
    .map(f => ({
      id:   f.replace(/\.json$/, ''),
      path: resolve(SESS_DIR, f),
      mtime: statSync(resolve(SESS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return files.map(f => {
    try {
      const data = JSON.parse(readFileSync(f.path, 'utf8'));
      return {
        id:    data.id,
        title: data.title || '',
        turns: (data.messages ?? []).length,
        updatedAt: data.updatedAt || new Date(f.mtime).toISOString(),
      };
    } catch { return { id: f.id, title: '?', turns: 0, updatedAt: '' }; }
  });
}

function lastSessionId() {
  const ls = listSessions(1);
  return ls.length ? ls[0].id : null;
}

// ── runtime state holder ────────────────────────────────────────────────
class ReplState {
  constructor(session) {
    this.session = session;
    this.totalCost = 0;
    this.totalUsage = { input_tokens: 0, output_tokens: 0 };
    this.turnInProgress = false;
    this.plainMode = !!session.plainMode;
  }
  appendUser(text) {
    this.session.messages.push({
      role: 'user', content: text, ts: new Date().toISOString(),
    });
    saveSession(this.session);
  }
  appendAssistant(text) {
    if (!text) return;
    this.session.messages.push({
      role: 'assistant', content: text, ts: new Date().toISOString(),
    });
    saveSession(this.session);
  }
}

// ── runtime ──────────────────────────────────────────────────────────────
function findClaudeBin() {
  if (process.env.GIFT_CLAUDE_BIN && existsSync(process.env.GIFT_CLAUDE_BIN)) {
    return process.env.GIFT_CLAUDE_BIN;
  }
  try {
    const path = execSync('which claude', { encoding: 'utf8' }).trim();
    if (path && existsSync(path)) return path;
  } catch {}
  return null;
}

function buildResumePrompt(session, limit = 20) {
  const tail = (session.messages ?? []).slice(-limit);
  if (!tail.length) return null;
  const lines = tail.map(m => {
    const role = m.role === 'user' ? 'ты' : 'я';
    const text = (m.content || '').toString().replace(/\n+/g, ' ').slice(0, 240);
    return `  ${role}: ${text}`;
  }).join('\n');
  return `[Резюме сессии ${session.id} (последние ${tail.length} сообщений):]\n${lines}\n\n[Продолжаем:]`;
}

/**
 * Анамнетический snapshot: топ-нити W + краткая статистика сокровищницы и бдений.
 * Пишется в systemPromptExtra при старте chat'а — даёт модели контекст
 * того, что есть на момент начала разговора.
 */
function buildAnamnesisSnapshot() {
  const lines = ['[Анамнезис на момент начала диалога]'];
  // W-матрица
  try {
    const snapPath = resolve(ROOT, 'data/sacred-history-W.json');
    if (existsSync(snapPath)) {
      const W = JSON.parse(readFileSync(snapPath, 'utf8'));
      const persons = W.persons || [];
      const acts = W.acts ?? W.actsCount ?? '?';
      lines.push(`  Матрица: ${persons.length} лиц, ${acts} актов`);
    }
  } catch {}
  // Сокровищница
  try {
    const lcmPath = resolve(ROOT, 'data/lcm.db');
    if (existsSync(lcmPath)) {
      const store = new LcmStore(lcmPath);
      const s = store.stats();
      lines.push(`  Сокровищница: ${s.total} документов`);
      store.close();
    }
  } catch {}
  // Бдения
  try {
    const cronPath = resolve(ROOT, 'data/dynamic-cron.json');
    if (existsSync(cronPath)) {
      const j = JSON.parse(readFileSync(cronPath, 'utf8'));
      const jobs = (j.jobs || []).length;
      if (jobs) lines.push(`  Бдений активно: ${jobs}`);
    }
  } catch {}
  // Pending proposals
  try {
    const propPath = resolve(ROOT, 'data/proposals.json');
    if (existsSync(propPath)) {
      const p = JSON.parse(readFileSync(propPath, 'utf8'));
      const pending = p.filter(x => x.status === 'pending').length;
      if (pending) lines.push(`  Pending proposals: ${pending}`);
    }
  } catch {}
  return lines.length > 1 ? lines.join('\n') : null;
}

// ── автопредложение продолжить недавнюю сессию ──────────────────────────
// Если пользователь не указал --resume явно, но есть свежая (≤6 часов)
// сессия с непустой историей — спрашиваем хочет ли продолжить.
async function maybeAutoResume(opts) {
  if (opts.resumeId) return null;          // явный --resume уже выбран
  if (opts.noAutoResume) return null;
  if (!process.stdin.isTTY) return null;   // в пайпе/скрипте не спрашиваем
  const recent = listSessions(1);
  if (!recent.length) return null;
  const last = recent[0];
  if (!last.turns || last.turns === 0) return null;
  const ageMs = Date.now() - new Date(last.updatedAt).getTime();
  if (ageMs > 6 * 60 * 60 * 1000) return null;   // старше 6 часов — не предлагаем
  const ageMin = Math.round(ageMs / 60000);
  const ageStr = ageMin < 60 ? `${ageMin} мин назад` : `${Math.round(ageMin/60)} ч назад`;
  const title = last.title ? ` — «${last.title}»` : '';
  process.stdout.write('\n');
  process.stdout.write(`  ${c('gold', '⤺')}  прошлая сессия${title} (${last.turns} сообщ., ${ageStr})\n`);
  process.stdout.write(`  ${c('dim', 'продолжить? [Y/n] ')}`);
  const answer = await new Promise(res => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', d => res(String(d).trim().toLowerCase()));
  });
  if (answer === '' || answer === 'y' || answer === 'д' || answer === 'да') return last.id;
  return null;
}

// ── main ────────────────────────────────────────────────────────────────
export async function runGiftRepl(opts = {}) {
  // авто-resume срабатывает только без явного --resume
  const autoResumeId = await maybeAutoResume(opts);
  if (autoResumeId && !opts.resumeId) opts = { ...opts, resumeId: autoResumeId };

  const session = opts.resumeId
    ? loadSession(opts.resumeId === 'last' ? (lastSessionId() ?? throwIf('нет сессий')) : opts.resumeId)
    : { id: newSessionId(), title: '', startedAt: new Date().toISOString(), messages: [] };
  if (!opts.resumeId) saveSession(session);

  const state = new ReplState(session);

  // ── banner ────────────────────────────────────────────────────────
  // Иконка собора: четыре луча — четыре сферы (земля/вода/огонь/воздух),
  // в центре ✦ — лицо в κοινωνία (общении). Минималистично, как
  // ✻ у Claude Code.
  await printBanner(session, opts);
  console.log();

  // inbox of user messages waiting to be sent to SDK
  const inbox = [];
  let inboxResolve = null;
  let done = false;

  function pushToInbox(text) {
    inbox.push(text);
    if (inboxResolve) { const r = inboxResolve; inboxResolve = null; r(); }
  }

  // Динамический prompt: показывает PLAN mode и накопленную стоимость
  const buildPrompt = () => {
    const planTag = opts.planMode ? c('yellow', 'plan ') : '';
    const cost = state.totalCost > 0 ? c('dim', ` $${state.totalCost.toFixed(3)}`) : '';
    return planTag + c('cyan', 'gift') + cost + c('dim', '> ');
  };

  const ui = new TermUI({
    prompt: buildPrompt(),
    slashCommands: SLASH_COMMANDS,
    getPrompt: buildPrompt,  // вызывается при ui.resume() — обновлённый cost
    onLine: async line => {
      const trimmed = line.trim();
      if (!trimmed) { return; }
      if (trimmed.startsWith('/')) {
        try {
          const r = await handleSlash(trimmed, state, ui, () => {
            done = true; ui.stop();
            if (inboxResolve) inboxResolve();
          }, pushToInbox);
          // /refresh пушит обновлённый контекст в SDK — не показываем prompt сразу
          if (!r?.expectsResponse && !done) {
            // вернёмся в обычный режим ввода (prompt уже стёрт onLine'ом, рисуем)
            ui._renderPrompt();
          }
        } catch (e) {
          process.stdout.write(c('red', `error: ${e.message}`) + '\n');
          ui._renderPrompt();
        }
        return;
      }
      // @file mentions: scan @path в строке, prepend содержимое
      const expanded = expandFileMentions(trimmed);
      state.appendUser(expanded);
      ui.release();
      pushToInbox(expanded);
    },
    onClose: () => {
      done = true;
      if (inboxResolve) { const r = inboxResolve; inboxResolve = null; r(); }
      ui.stop();
    },
  });
  ui.start();

  // generator подаёт user messages в SDK по мере готовности
  async function* userMessageStream() {
    // первое сообщение — резюме при resume (если есть история)
    if (opts.resumeId) {
      const seed = buildResumePrompt(session);
      if (seed) {
        yield { type: 'user', message: { role: 'user', content: seed }, parent_tool_use_id: null, session_id: session.id };
      }
    }
    while (!done) {
      if (!inbox.length) {
        await new Promise(r => { inboxResolve = r; });
        if (done) return;
      }
      while (inbox.length) {
        const text = inbox.shift();
        yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: session.id };
      }
    }
  }

  const giftServer = buildGiftMcpServer();
  const claudeBin  = findClaudeBin();
  // Полный набор инструментов как у Claude Code:
  //   - builtins: файлы, shell, web
  //   - gift MCP: матрица, собор, сокровищница, бдение, ...
  //   - чужие MCP-сервера через wildcards: они подцепляются SDK из
  //     ~/.claude/settings.json или конфига claude --print автоматически
  //     (playwright, integram, telegram, anamnesis, и пр.)
  const builtins = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch',
                    'NotebookEdit', 'TodoWrite', 'Task', 'BashOutput', 'KillShell'];
  const mcpWildcards = [
    'mcp__playwright__*', 'mcp__integram__*', 'mcp__telegram__*',
    'mcp__anamnesis__*',  'mcp__claude_ai_Google_Drive__*',
    // wildcard для любых будущих MCP-серверов:
    'mcp__*__*',
  ];
  const allowedTools = [...new Set([...builtins, ...GIFT_TOOL_NAMES, ...mcpWildcards])];

  const anamnesis = buildAnamnesisSnapshot();
  const LANGUAGE_RULE = state.plainMode
    ? `\n\n--- РЕЖИМ /plain ---\nОтвечай простым русским. Греческие/латинские термины используй ТОЛЬКО если без них совсем нельзя — и обязательно с русским объяснением в скобках при первом употреблении в сообщении. Не используй термины как украшение.`
    : `\n\n--- ЯЗЫК ---\nКогда используешь греческий/латинский термин (κένωσις, ἀνάμνησις и т.п.) — обязательно дай русский эквивалент в скобках при первом употреблении в данном сообщении. Это не «упрощение», это уважение к собеседнику. Дионисий — автор онтологии, но не классицист. Лучше одно ясное русское слово, чем три греческих без перевода.`;
  const systemPrompt = anamnesis
    ? `${GIFT_SYSTEM_PROMPT}\n\n--- АНАМНЕЗИС ---\n\n${anamnesis}${LANGUAGE_RULE}`
    : `${GIFT_SYSTEM_PROMPT}${LANGUAGE_RULE}`;

  const queryOptions = {
    systemPrompt,
    mcpServers:   { gift: giftServer },
    allowedTools,
    permissionMode: opts.planMode ? 'plan' : 'bypassPermissions',
    maxTurns:       999,
    cwd:            ROOT,
    hooks:          GIFT_HOOKS,
    includePartialMessages: true,  // streaming token-by-token через stream_event
  };
  if (claudeBin) queryOptions.pathToClaudeCodeExecutable = claudeBin;

  let pendingAssistantText = '';
  let initShown = false;
  let streamingActive = false; // получаем ли token-deltas — тогда не дублируем text из 'assistant'

  try {
    const gen = query({ prompt: userMessageStream(), options: queryOptions });
    for await (const message of gen) {
      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            // Показываем [init] только в первый раз; SDK иногда реинициализирует
            // MCP-сервера между turn'ами и засоряет вывод.
            if (!initShown) {
              const mcps = (message.mcp_servers ?? []).map(s => `${s.name}=${s.status}`).join(', ');
              process.stderr.write(c('dim', `[init] mcp: ${mcps || '(none)'} | tools: ${(message.tools ?? []).length}`) + '\n');
              initShown = true;
            }
          }
          break;

        case 'stream_event': {
          // Partial token streaming. Печатаем text-дельты по мере прихода.
          // Tool_use deltas пропускаем — они приходят целым блоком в 'assistant'.
          const ev = message.event;
          if (ev?.type === 'content_block_delta' && ev?.delta?.type === 'text_delta') {
            streamingActive = true;
            const delta = ev.delta.text || '';
            streamMarkdown(delta);
            pendingAssistantText += delta;
          }
          break;
        }

        case 'assistant': {
          const blocks = message.message?.content ?? [];
          for (const b of blocks) {
            if (b.type === 'text') {
              // Если уже получили текст через stream_event — не дублируем
              if (!streamingActive) {
                streamMarkdown(b.text);
                pendingAssistantText += b.text;
              }
            } else if (b.type === 'thinking') {
              // Размышление модели — приглушённо, ниже spotlight
              const txt = (b.thinking || '').slice(0, 400).trim();
              if (txt) {
                process.stderr.write('\n' + c('dim', '┌─ мысль ') + c('dim', '─'.repeat(50)) + '\n');
                for (const line of txt.split('\n').slice(0, 8)) {
                  process.stderr.write(c('dim', '│ ' + line) + '\n');
                }
                process.stderr.write(c('dim', '└') + c('dim', '─'.repeat(58)) + '\n');
              }
            } else if (b.type === 'tool_use') {
              printToolUse(b);
            }
          }
          break;
        }

        case 'user': {
          const blocks = message.message?.content ?? [];
          for (const b of blocks) {
            if (b.type === 'tool_result') {
              printToolResult(b);
            }
          }
          break;
        }

        case 'result':
          flushMarkdown();
          if (pendingAssistantText.trim()) state.appendAssistant(pendingAssistantText);
          pendingAssistantText = '';
          streamingActive = false;
          if (typeof message.total_cost_usd === 'number') {
            state.totalCost += message.total_cost_usd;
          }
          if (message.usage) {
            state.totalUsage.input_tokens  += message.usage.input_tokens  || 0;
            state.totalUsage.output_tokens += message.usage.output_tokens || 0;
          }
          // turn окончен — возвращаем prompt
          if (!done) ui.resume();
          break;

        default:
          break;
      }
    }
  } catch (e) {
    process.stderr.write(c('red', `\n✗ SDK error: ${e?.message || e}`) + '\n');
  } finally {
    ui.stop();
    saveSession(state.session);
    console.log();
    console.log(c('dim', `сессия сохранена: ${session.id}`));
    console.log(c('dim', `путь: data/chat-sessions/${session.id}.json`));
    if (state.totalCost) {
      console.log(c('dim', `стоимость: $${state.totalCost.toFixed(4)}`));
    }
    console.log(c('dim', `вернуться: gift chat --resume ${session.id}`));
    console.log();
  }
}

function throwIf(msg) { throw new Error(msg); }

// ── @file mentions ──────────────────────────────────────────────────────
// Сканирует строку на вхождения @path/to/file (где path — относительный
// от ROOT путь). Если файл существует, добавляет его содержимое к началу
// сообщения. Это убирает roundtrip 'модель → Read' для часто упоминаемых
// файлов.
const MENTION_RE = /@([\w./\-]+)/g;
function expandFileMentions(text) {
  const seen = new Set();
  const blocks = [];
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    const full = path.startsWith('/') ? path : resolve(ROOT, path);
    if (!existsSync(full)) continue;
    try {
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      if (stat.size > 100 * 1024) {
        blocks.push(`[@${path} — файл слишком большой (${Math.round(stat.size/1024)}KB), модель пусть прочитает Read'ом]`);
      } else {
        const content = readFileSync(full, 'utf8');
        blocks.push(`[@${path}]\n\`\`\`\n${content}\n\`\`\``);
      }
      seen.add(path);
    } catch {}
  }
  if (!blocks.length) return text;
  return blocks.join('\n\n') + '\n\n' + text;
}

// ── Streaming Markdown → ANSI ───────────────────────────────────────────
let mdBuffer = '';
let mdInCode = false;       // сейчас внутри ```code-block```
let mdCodeLang = '';

// Простая подсветка ключевых слов для популярных языков
const SYNTAX_KEYWORDS = {
  js: /\b(const|let|var|function|return|if|else|for|while|class|extends|import|export|from|async|await|new|throw|try|catch|finally|null|undefined|true|false|this|super)\b/g,
  ts: /\b(const|let|var|function|return|if|else|for|while|class|extends|import|export|from|async|await|new|throw|try|catch|finally|null|undefined|true|false|this|super|interface|type|enum|public|private|protected|readonly|as)\b/g,
  json: /\b(true|false|null)\b/g,
  bash: /\b(if|then|else|fi|for|do|done|while|case|esac|function|return|echo|cd|export|local|read)\b/g,
  python: /\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|None|True|False|self|lambda|yield)\b/g,
  py: /\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|None|True|False|self|lambda|yield)\b/g,
};

function highlightCode(line, lang) {
  const re = SYNTAX_KEYWORDS[lang];
  if (!re) return '\x1b[2m' + line + '\x1b[0m'; // dim для неизвестного языка
  return ('\x1b[2m' + line + '\x1b[0m')
    .replace(re, '\x1b[35m$&\x1b[0m\x1b[2m')   // keywords magenta
    .replace(/(["'`])(.*?)\1/g, '\x1b[32m$&\x1b[0m\x1b[2m')  // strings green
    .replace(/\/\/.*$/, '\x1b[36m$&\x1b[0m\x1b[2m')          // line comments cyan
    .replace(/\b\d+\b/g, '\x1b[33m$&\x1b[0m\x1b[2m');         // numbers yellow
}

function renderLine(line) {
  // Граница code-block
  const fenceMatch = line.match(/^```(\w*)\s*$/);
  if (fenceMatch) {
    if (mdInCode) {
      mdInCode = false; mdCodeLang = '';
      return '\x1b[2m└' + '─'.repeat(56) + '\x1b[0m';
    } else {
      mdInCode = true;
      mdCodeLang = (fenceMatch[1] || '').toLowerCase();
      return '\x1b[2m┌─ ' + (mdCodeLang || 'code') + ' ' + '─'.repeat(50 - mdCodeLang.length) + '\x1b[0m';
    }
  }
  // Внутри code-block — подсветка по языку
  if (mdInCode) {
    return '\x1b[2m│ \x1b[0m' + highlightCode(line, mdCodeLang);
  }
  // Обычный markdown
  return line
    .replace(/^#### (.+)$/, '\x1b[1m\x1b[35m$1\x1b[0m')
    .replace(/^### (.+)$/,  '\x1b[1m\x1b[36m$1\x1b[0m')
    .replace(/^## (.+)$/,   '\x1b[1m\x1b[33m$1\x1b[0m')
    .replace(/^# (.+)$/,    '\x1b[1m\x1b[35m$1\x1b[0m')
    .replace(/\*\*([^*\n]+?)\*\*/g, '\x1b[1m$1\x1b[0m')
    .replace(/__([^_\n]+?)__/g,     '\x1b[1m$1\x1b[0m')
    .replace(/`([^`\n]+?)`/g, '\x1b[36m$1\x1b[0m')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1\x1b[3m$2\x1b[0m')
    .replace(/^(\s*)[-*]\s/, '$1• ');
}

function streamMarkdown(text) {
  mdBuffer += text;
  let nl;
  while ((nl = mdBuffer.indexOf('\n')) !== -1) {
    const line = mdBuffer.slice(0, nl);
    mdBuffer = mdBuffer.slice(nl + 1);
    process.stdout.write(renderLine(line) + '\n');
  }
}

function flushMarkdown() {
  if (mdBuffer) {
    process.stdout.write(renderLine(mdBuffer));
    mdBuffer = '';
  }
}

// ── Pretty-print для tool_use / tool_result ─────────────────────────────
const ANSI = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
  red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m',
};

function printToolUse(b) {
  const isGift = b.name.startsWith('mcp__gift__');
  const isMcp  = b.name.startsWith('mcp__');
  const niceName = isGift ? b.name.replace('mcp__gift__', 'gift::') : b.name;
  const icon = isGift ? '⚡' : (isMcp ? '🜂' : '🔧');
  const colorCode = isGift ? ANSI.magenta : (isMcp ? ANSI.yellow : ANSI.cyan);

  const out = [];
  out.push('\n');
  out.push(colorCode + ANSI.bold + icon + ' ' + niceName + ANSI.reset);

  const input = b.input || {};
  switch (b.name) {
    case 'Read':
      out.push(ANSI.dim + '  ' + (input.file_path || '?') + ANSI.reset);
      if (input.offset || input.limit) out.push(ANSI.dim + ` (${input.offset||0}:+${input.limit||'all'})` + ANSI.reset);
      out.push('\n');
      break;
    case 'Write':
      out.push(ANSI.dim + '  ' + (input.file_path || '?') + ANSI.reset + '\n');
      out.push(formatNewBlock(input.content || '', 12));
      break;
    case 'Edit': {
      out.push(ANSI.dim + '  ' + (input.file_path || '?') + ANSI.reset);
      if (input.replace_all) out.push(ANSI.dim + '  (replace_all)' + ANSI.reset);
      out.push('\n');
      out.push(formatDiff(input.old_string || '', input.new_string || '', 12));
      break;
    }
    case 'Bash':
      out.push('\n');
      out.push(ANSI.dim + '  $ ' + ANSI.reset + (input.command || '').slice(0, 300));
      out.push('\n');
      break;
    case 'Grep':
      out.push(ANSI.dim
        + ` "${input.pattern || '?'}" in ${input.path || '.'}`
        + (input.glob ? ` glob=${input.glob}` : '')
        + ANSI.reset + '\n');
      break;
    case 'Glob':
      out.push(ANSI.dim + ` ${input.pattern || '?'}` + ANSI.reset + '\n');
      break;
    default: {
      // Дженерик: краткий dump input
      const dump = JSON.stringify(input);
      out.push(ANSI.dim + '  ' + dump.slice(0, 180) + (dump.length > 180 ? '…' : '') + ANSI.reset + '\n');
    }
  }
  process.stderr.write(out.join(''));
}

function formatDiff(oldStr, newStr, maxLines = 12) {
  const oldLines = (oldStr || '').split('\n');
  const newLines = (newStr || '').split('\n');
  const out = [];
  for (const l of oldLines.slice(0, maxLines)) {
    out.push(ANSI.red + '  - ' + l + ANSI.reset + '\n');
  }
  if (oldLines.length > maxLines) {
    out.push(ANSI.dim + `  … +${oldLines.length - maxLines} строк удалено` + ANSI.reset + '\n');
  }
  for (const l of newLines.slice(0, maxLines)) {
    out.push(ANSI.green + '  + ' + l + ANSI.reset + '\n');
  }
  if (newLines.length > maxLines) {
    out.push(ANSI.dim + `  … +${newLines.length - maxLines} строк добавлено` + ANSI.reset + '\n');
  }
  return out.join('');
}

function formatNewBlock(content, maxLines = 12) {
  const lines = (content || '').split('\n');
  const out = [];
  for (const l of lines.slice(0, maxLines)) {
    out.push(ANSI.green + '  + ' + l + ANSI.reset + '\n');
  }
  if (lines.length > maxLines) {
    out.push(ANSI.dim + `  … +${lines.length - maxLines} строк (всего ${lines.length})` + ANSI.reset + '\n');
  }
  return out.join('');
}

function printToolResult(b) {
  const text = typeof b.content === 'string'
    ? b.content
    : Array.isArray(b.content) ? (b.content[0]?.text ?? '') : '';
  if (!text.trim()) return;
  if (b.is_error) {
    process.stderr.write(ANSI.red + '  ✗ ошибка: ' + ANSI.reset + ANSI.dim + text.slice(0, 300) + ANSI.reset + '\n');
    return;
  }
  // короткий первый кусок результата (без перехода в полный text — он засорит экран)
  const firstLines = text.split('\n').slice(0, 3).join('\n');
  const truncated = firstLines.length < text.length ? firstLines + ANSI.dim + ' …' + ANSI.reset : firstLines;
  process.stderr.write(ANSI.green + '  ↪ ' + ANSI.reset + ANSI.dim + truncated.replace(/\n/g, '\n    ') + ANSI.reset + '\n');
}

// ── Slash-команды с русскими описаниями (для всплывающего меню) ─────────
const SLASH_COMMANDS = [
  { cmd: '/help',     desc: 'список всех команд с описанием' },
  { cmd: '/compact',  desc: 'сжать историю сессии (модель сделает summary)' },
  { cmd: '/clear',    desc: 'очистить историю текущей сессии' },
  { cmd: '/save',     desc: 'явно сохранить (auto-save и так каждое сообщение)' },
  { cmd: '/title',    desc: 'задать или переименовать заголовок сессии', needsArg: true },
  { cmd: '/branch',   desc: 'форк: скопировать сессию в новый id' },
  { cmd: '/refresh',  desc: 'обновить контекст матрицы W для модели' },
  { cmd: '/plain',    desc: 'режим без греческих терминов (нужен restart)', needsArg: true },
  { cmd: '/glossary', desc: 'словарь греческих терминов (греч. → рус.)', needsArg: true },
  { cmd: '/sessions', desc: 'последние сохранённые сессии' },
  { cmd: '/resume',   desc: 'перейти к сессии по id', needsArg: true },
  { cmd: '/tools',    desc: 'список доступных tools (builtins + gift MCP)' },
  { cmd: '/status',   desc: 'статус текущей сессии (msgs/cost/tokens)' },
  { cmd: '/recall',   desc: 'полнотекстовый поиск по сокровищнице', needsArg: true },
  { cmd: '/unfold',   desc: 'развернуть документ/сессию по source_id', needsArg: true },
  { cmd: '/matrix',   desc: 'топ-нити матрицы W (через nous)' },
  { cmd: '/pustynya', desc: 'богословские пустыни сети' },
  { cmd: '/cost',     desc: 'стоимость и использование токенов сессии' },
  { cmd: '/quit',     desc: 'выход (Ctrl+D работает так же)' },
  { cmd: '/exit',     desc: 'выход (Ctrl+D работает так же)' },
];

// ── Banner (иконка стартового экрана) ────────────────────────────────────
const GIFT_LOGO = [
  '   ██████╗ ██╗███████╗████████╗',
  '  ██╔════╝ ██║██╔════╝╚══██╔══╝',
  '  ██║  ███╗██║█████╗     ██║   ',
  '  ██║   ██║██║██╔══╝     ██║   ',
  '  ╚██████╔╝██║██║        ██║   ',
  '   ╚═════╝ ╚═╝╚═╝        ╚═╝   ',
];

async function printBanner(session, opts) {
  // Версия
  let version = '';
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    version = `v${pkg.version || '0'}`;
  } catch {}

  // Snapshot: лица, акты, главная нить, энергия сети
  let metric = '', topThread = '', energy = '';
  try {
    const snapPath = resolve(ROOT, 'data/sacred-history-W.json');
    if (existsSync(snapPath)) {
      const W = JSON.parse(readFileSync(snapPath, 'utf8'));
      const personsArr = W.persons || [];
      const acts    = W.acts ?? W.actsCount ?? '?';
      metric = `${personsArr.length} лиц · ${acts} актов`;
      // W.W — 2D массив весов, индексы соответствуют personsArr
      try {
        const matrix = W.W;
        if (Array.isArray(matrix) && Array.isArray(matrix[0])) {
          let best = null;
          let sum = 0;
          for (let i = 0; i < matrix.length; i++) {
            for (let j = 0; j < matrix[i].length; j++) {
              const w = Number(matrix[i][j]) || 0;
              sum += w;
              if (!best || w > best.w) best = { i, j, w };
            }
          }
          if (best && best.w > 1 && personsArr[best.i] && personsArr[best.j]) {
            topThread = `${personsArr[best.i]} → ${personsArr[best.j]} (вес ${best.w.toFixed(0)})`;
          }
        }
      } catch {}
      // Энергия сети — спросить у nous с коротким таймаутом; если нет — не показывать
      try {
        const NOUS = process.env.NOUS_URL || 'http://localhost:8089';
        const r = await fetch(`${NOUS}/summary`, { signal: AbortSignal.timeout(400) });
        if (r.ok) {
          const data = await r.json();
          if (typeof data.networkEnergy === 'number') {
            const sign = data.networkEnergy < 0 ? '−' : '+';
            energy = `энергия сети: ${sign}${Math.abs(data.networkEnergy).toFixed(0)}`;
          }
        }
      } catch {}
    }
  } catch {}
  let treasureN = '';
  try {
    const lcmPath = resolve(ROOT, 'data/lcm.db');
    if (existsSync(lcmPath)) {
      const store = new LcmStore(lcmPath);
      treasureN = `${store.stats().total} в сокровищнице`;
      store.close();
    }
  } catch {}

  // Шина: непрочитанные для текущей сессии
  let inboxN = '';
  try {
    const myId = process.env.GIFT_CLAUDE_ID || 'gift-claude';
    const busLog = resolve(ROOT, 'data/koinon-bus.jsonl');
    const posFile = resolve(ROOT, 'data/koinon-pos.json');
    if (existsSync(busLog) && existsSync(posFile)) {
      const positions = JSON.parse(readFileSync(posFile, 'utf8'));
      const myPos = positions[myId] ?? 0;
      const allBytes = statSync(busLog).size;
      if (allBytes > myPos) {
        // грубая оценка: сколько строк после позиции
        const tail = readFileSync(busLog, 'utf8').slice(myPos);
        const n = tail.split('\n').filter(l => l.trim()).length;
        if (n > 0) inboxN = `${n} непрочитанных в шине`;
      }
    }
  } catch {}

  // Цели в работе
  let goalsN = '';
  try {
    const goalsDir = resolve(ROOT, 'data/goals');
    if (existsSync(goalsDir)) {
      const files = readdirSync(goalsDir).filter(f => f.endsWith('.json'));
      let active = 0, done = 0;
      for (const f of files) {
        try {
          const g = JSON.parse(readFileSync(resolve(goalsDir, f), 'utf8'));
          if (g.status === 'running' || g.status === 'paused' || g.status === 'pending') active++;
          if (g.status === 'done') done++;
        } catch {}
      }
      if (active) goalsN = `${active} ${active === 1 ? 'цель' : 'целей'} в работе`;
    }
  } catch {}

  console.log();
  for (const line of GIFT_LOGO) console.log(c('gold', line));
  console.log();
  console.log('  ' + c('gold', '✦') + '  ' + c('bold', 'онтология дара') + '  ' + c('dim', version));
  console.log('     ' + c('dim', 'Κοινόν τοῦ Νοῦ ') + c('dim', '(общее ума) — собор лиц в матрице W'));
  console.log();
  console.log('  ' + c('cyan', '─'.repeat(60)));
  // Состояние общины — главное, что видит человек на входе
  if (metric) console.log('  ' + c('dim', metric));
  if (topThread) console.log('  ' + c('dim', 'главная нить: ') + c('bold', topThread));
  if (energy)    console.log('  ' + c('dim', energy));
  const extras = [treasureN, inboxN, goalsN].filter(Boolean);
  if (extras.length) console.log('  ' + c('dim', extras.join(' · ')));
  console.log();
  console.log('  ' + c('dim', `сессия: ${session.id}`));
  if (session.title) console.log('  ' + c('dim', `title:  `) + c('bold', session.title));
  if (opts.resumeId) console.log('  ' + c('dim', `продолжаем: ${session.messages.length} сообщений в истории`));
  // Подсказка для тех, кто впервые
  if (!opts.resumeId && (!session.messages || session.messages.length === 0)) {
    console.log();
    console.log('  ' + c('dim', 'просто говори со мной обычным языком — я сам зову нужные инструменты.'));
    console.log('  ' + c('dim', '«покажи матрицу», «закрой #72», «что у нас сейчас», «нужно три мнения насчёт X»'));
  }
  console.log('  ' + c('dim', 'наберите «/» — меню команд  ·  Ctrl+D — выход'));
  console.log('  ' + c('cyan', '─'.repeat(60)));
}

// ── slash-команды ───────────────────────────────────────────────────────
async function handleSlash(line, state, ui, quit, pushToInbox) {
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(' ');
  // Голый '/' (просто Enter) — fallback: показать /help
  // (меню должно всплывать в момент набора, но если пользователь дошёл до Enter)
  if (cmd === '/') {
    return handleSlash('/help', state, ui, quit, pushToInbox);
  }
  switch (cmd) {
    case '/help':
      console.log();
      console.log(c('bold', 'Slash-команды (всё на русском):'));
      const widthCmd = Math.max(...SLASH_COMMANDS.map(s => s.cmd.length)) + 2;
      for (const item of SLASH_COMMANDS) {
        console.log('  ' + c('cyan', item.cmd.padEnd(widthCmd)) + c('dim', '— ' + item.desc));
      }
      console.log();
      console.log(c('dim', '  Подсказки:'));
      console.log(c('dim', '   • меню всплывает сразу при наборе «/»'));
      console.log(c('dim', '   • TAB — дополнить, если совпадение одно'));
      console.log(c('dim', '   • Ctrl+D — выход'));
      console.log();
      break;

    case '/clear':
      state.session.messages = [];
      saveSession(state.session);
      console.log(c('dim', '✓ история очищена'));
      break;

    case '/compact': {
      // Сжать историю: попросить модель сделать summary последних N сообщений.
      // SDK будет видеть только summary как первое user-сообщение в next turn.
      // Текущий run продолжает работать; следующий /resume или новая сессия
      // получит compact-history.
      const tail = state.session.messages.slice(-40);
      if (tail.length < 8) {
        console.log(c('dim', 'история ещё короткая, сжатие не нужно'));
        break;
      }
      const dump = tail.map(m => `${m.role === 'user' ? 'пользователь' : 'я'}: ${(m.content || '').slice(0, 800)}`).join('\n\n');
      const compactRequest = `[Сжатие истории — /compact]\n\nНиже расшифровка последних ${tail.length} сообщений нашего диалога. Сделай конспект 200-400 слов: ключевые решения, изменения в коде, текущее состояние, открытые вопросы. Формат — bullet points. Это станет базой для продолжения.\n\n--- ИСТОРИЯ ---\n\n${dump}`;
      console.log(c('dim', `↳ прошу модель сжать ${tail.length} сообщений…`));
      state.appendUser(compactRequest);
      pushToInbox(compactRequest);
      // После ответа модели вручную /clear, чтобы сократить корпус
      console.log(c('dim', '   после ответа модели — /clear оставит только summary'));
      return { expectsResponse: true };
    }

    case '/save':
      saveSession(state.session);
      console.log(c('dim', `✓ saved: ${state.session.id}`));
      break;

    case '/title':
      if (!arg) { console.log(`title: "${state.session.title || '(пусто)'}"`); break; }
      state.session.title = arg;
      saveSession(state.session);
      console.log(c('dim', `✓ title: ${arg}`));
      break;

    case '/branch': {
      const newId = arg || newSessionId();
      const fork = {
        id: newId,
        title: state.session.title ? `${state.session.title} (branch)` : '',
        startedAt: new Date().toISOString(),
        branchedFrom: state.session.id,
        messages: [...state.session.messages],
      };
      saveSession(fork);
      console.log(c('dim', `✓ branched: ${newId}`));
      console.log(c('yellow', '⚠ форк сохранён, но текущий REPL продолжает в исходной сессии.'));
      console.log(c('dim',    `  Чтобы продолжить в форке: выйди и запусти gift chat --resume ${newId}`));
      break;
    }

    case '/refresh': {
      const snapshot = buildAnamnesisSnapshot();
      if (!snapshot) { console.log(c('dim', 'нечего обновлять')); break; }
      const seed = `[Обновлённый анамнезис (текущее состояние онтологии):]\n${snapshot}`;
      state.appendUser(seed);
      pushToInbox(seed);
      console.log(c('dim', '↻ анамнезис обновлён, шлю модели…'));
      return { expectsResponse: true };
    }

    case '/plain': {
      // Включить/выключить режим простого русского.
      // Меняет sessionprefs; для применения нужен перезапуск (systemPrompt
      // фиксируется при старте SDK-run).
      const want = arg === 'off' ? false : (arg === 'on' || !arg ? true : !!arg);
      state.plainMode = want;
      state.session.plainMode = want;
      saveSession(state.session);
      console.log(c('dim', `✓ /plain ${want ? 'on' : 'off'}`));
      console.log(c('yellow', '⚠ для применения нужен restart: Ctrl+D, затем gift chat --resume ' + state.session.id));
      break;
    }

    case '/glossary': {
      // Локальный показ словаря (без roundtrip к модели).
      const { spawn } = await import('node:child_process');
      const args = arg ? ['utils/gift-glossary.mjs', 'find', arg] : ['utils/gift-glossary.mjs'];
      await new Promise(r => {
        const p = spawn('node', args, { cwd: ROOT, stdio: 'inherit' });
        p.on('exit', r);
      });
      break;
    }

    case '/sessions': {
      const ls = listSessions(15);
      console.log();
      console.log(c('bold', `Последние сессии (${ls.length}):`));
      for (const s of ls) {
        const mark = s.id === state.session.id ? c('cyan', '●') : ' ';
        const title = s.title ? `  ${c('bold', s.title)}` : '';
        console.log(`  ${mark} ${s.id}  ${c('dim', `${s.turns} turns`)}  ${c('dim', s.updatedAt)}${title}`);
      }
      console.log();
      break;
    }

    case '/resume': {
      if (!arg) { console.log('usage: /resume <id|last>'); break; }
      console.log(c('yellow', '⚠ /resume в текущей сессии не переключает SDK-context.'));
      console.log(c('dim',    '  Выйди (Ctrl+D) и запусти: gift chat --resume ' + arg));
      break;
    }

    case '/tools': {
      console.log();
      console.log(c('bold', 'Builtins:'));
      const builtins = [
        ['Read',         'прочитать файл'],
        ['Write',        'создать/перезаписать файл'],
        ['Edit',         'точечная замена в файле'],
        ['Bash',         'выполнить shell-команду'],
        ['Grep',         'поиск по содержимому файлов'],
        ['Glob',         'поиск файлов по паттерну'],
        ['WebFetch',     'загрузить URL и обработать LLM'],
        ['WebSearch',    'веб-поиск'],
        ['NotebookEdit', 'правка Jupyter-ноутбука'],
        ['TodoWrite',    'трекер задач внутри сессии'],
        ['Task',         'запустить subagent'],
      ];
      for (const [n, d] of builtins) {
        console.log('  ' + c('cyan', n.padEnd(15)) + c('dim', '— ' + d));
      }

      console.log();
      console.log(c('bold', 'Gift MCP-tools (онтология дара):'));
      const giftDesc = {
        'mcp__gift__matrix_query':       'снимок матрицы W (топ-нити, пустыни, принцип)',
        'mcp__gift__sobor_celebrate':    'соборное вопрошание (4 голоса + 4 условия иконичности)',
        'mcp__gift__decoupage_cut':      'различение замысла по 4 сферам (Переслегин)',
        'mcp__gift__vintage_assess':     'различение по плодам — что родилось через время',
        'mcp__gift__score_profile':      'sommelier-карта идеи в 16 измерениях',
        'mcp__gift__epiclesis_ask':      'призывание человека-оракула (вопрос Дионисию)',
        'mcp__gift__pustynya_list':      'список пустынь сети (нитей с весом ≤ порога)',
        'mcp__gift__liturgical_today':   'литургический день: σύναξις/δοκιμασία/vintage/ordinary',
        'mcp__gift__gift_receive':       'записать акт дара в матрицу W (необратим)',
        'mcp__gift__recall_treasure':    'полнотекстовый поиск по сокровищнице (FTS5)',
        'mcp__gift__unfold_treasure':    'развернуть документ/сессию по source_id',
        'mcp__gift__agrypnia_schedule':  'запланировать бдение лица (once/interval/daily)',
        'mcp__gift__agrypnia_list':      'список запланированных бдений',
        'mcp__gift__agrypnia_cancel':    'снять запланированное бдение',
      };
      for (const t of GIFT_TOOL_NAMES) {
        const short = t.replace('mcp__gift__', 'gift::');
        const desc  = giftDesc[t] || '';
        console.log('  ' + c('cyan', short.padEnd(24)) + c('dim', '— ' + desc));
      }

      console.log();
      console.log(c('bold', 'Внешние MCP-сервера (через Claude Code):'));
      const externals = [
        ['playwright',                'браузерная автоматизация (click/fill/screenshot/...)'],
        ['integram',                  'workspace platform (таблицы, документы, отчёты)'],
        ['telegram',                  'поиск/сканирование Telegram-каналов'],
        ['anamnesis',                 'мост к серверу анамнезиса (память общины)'],
        ['claude_ai_Google_Drive',    'доступ к Google Drive (нужна аутентификация)'],
      ];
      for (const [n, d] of externals) {
        console.log('  ' + c('cyan', `mcp__${n}__*`.padEnd(28)) + c('dim', '— ' + d));
      }
      console.log();
      console.log(c('dim', 'Полный список загруженных tools — в [init]-сообщении при старте сессии.'));
      console.log();
      break;
    }

    case '/status': {
      const lcmPath = resolve(ROOT, 'data/lcm.db');
      const cronPath = resolve(ROOT, 'data/dynamic-cron.json');
      console.log();
      console.log(c('bold', `Статус сессии`) + c('dim', `  ${state.session.id}`));
      console.log(c('dim', '─'.repeat(46)));
      console.log(`  Сообщений:        ${state.session.messages.length}`);
      console.log(`  Стоимость:        $${state.totalCost.toFixed(4)}`);
      console.log(`  Tokens (in/out):  ${state.totalUsage.input_tokens} / ${state.totalUsage.output_tokens}`);
      if (existsSync(lcmPath)) {
        const store = new LcmStore(lcmPath);
        console.log(`  Сокровищница:     ${store.stats().total} документов`);
        store.close();
      }
      if (existsSync(cronPath)) {
        try {
          const j = JSON.parse(readFileSync(cronPath, 'utf8'));
          console.log(`  Бдений активно:   ${(j.jobs || []).length}`);
        } catch {}
      }
      console.log();
      break;
    }

    case '/recall': {
      if (!arg) { console.log('usage: /recall <query>'); break; }
      const lcmPath = resolve(ROOT, 'data/lcm.db');
      if (!existsSync(lcmPath)) { console.log(c('dim', 'сокровищница пуста (gift treasure ingest)')); break; }
      const store = new LcmStore(lcmPath);
      const rows = store.grep(arg, { limit: 5 });
      if (!rows.length) { console.log(c('dim', '[пусто]')); }
      else {
        for (const r of rows) {
          console.log(`\n${c('cyan', `#${r.id}`)} [${r.source}/${r.source_id}] ${r.role || '-'} ${r.ts}`);
          console.log(`  ${r.snippet}`);
        }
      }
      store.close();
      break;
    }

    case '/unfold': {
      if (!arg) { console.log('usage: /unfold <source_id>'); break; }
      const lcmPath = resolve(ROOT, 'data/lcm.db');
      if (!existsSync(lcmPath)) { console.log(c('dim', 'сокровищница пуста')); break; }
      const store = new LcmStore(lcmPath);
      const rows = store.expand(arg, { limit: 50 });
      if (!rows.length) { console.log(c('dim', '[не найдено]')); }
      else {
        for (const r of rows) {
          console.log(`\n${c('dim', `[${r.source}] ${r.role || '-'} @ ${r.ts}`)}`);
          console.log(r.content);
        }
      }
      store.close();
      break;
    }

    case '/matrix': {
      const NOUS = process.env.NOUS_URL || 'http://localhost:8089';
      try {
        const r = await fetch(`${NOUS}/matrix`, { signal: AbortSignal.timeout(2000) });
        const d = await r.json();
        const top = (d.heaviest || d.topThreads || []).slice(0, 7);
        console.log();
        for (const t of top) {
          console.log(`  ${(t.from || '?')} → ${(t.to || '?')}: ${c('gold', Number(t.weight).toFixed(1))}`);
        }
        console.log();
      } catch { console.log(c('dim', 'nous недоступен')); }
      break;
    }

    case '/pustynya': {
      const NOUS = process.env.NOUS_URL || 'http://localhost:8089';
      try {
        const r = await fetch(`${NOUS}/summary`, { signal: AbortSignal.timeout(2000) });
        const d = await r.json();
        const dx = d.theologicalDeserts || [];
        console.log();
        console.log(c('bold', `Пустыни: ${dx.length}`));
        for (const x of dx.slice(0, 8)) {
          console.log(`  ${x.from || '?'} → ${x.to || '?'} (${x.kind || '-'})`);
        }
        console.log();
      } catch { console.log(c('dim', 'nous недоступен')); }
      break;
    }

    case '/cost':
      console.log(c('dim', `cost: $${state.totalCost.toFixed(4)} | tokens in/out: ${state.totalUsage.input_tokens}/${state.totalUsage.output_tokens}`));
      break;

    case '/quit':
    case '/exit':
      quit();
      break;

    default:
      console.log(c('red', `неизвестная slash-команда: ${cmd}`));
      console.log(c('dim', '  /help — список'));
  }
}

// ── helpers для CLI bin/gift ────────────────────────────────────────────
export const giftReplApi = {
  listSessions,
  lastSessionId,
};
