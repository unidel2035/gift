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

import readline from 'node:readline';
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

// ── main ────────────────────────────────────────────────────────────────
export async function runGiftRepl(opts = {}) {
  const session = opts.resumeId
    ? loadSession(opts.resumeId === 'last' ? (lastSessionId() ?? throwIf('нет сессий')) : opts.resumeId)
    : { id: newSessionId(), title: '', startedAt: new Date().toISOString(), messages: [] };
  if (!opts.resumeId) saveSession(session);

  const state = new ReplState(session);

  // ── banner ────────────────────────────────────────────────────────
  // Иконка собора: четыре луча — четыре сферы (земля/вода/огонь/воздух),
  // в центре ✦ — лицо в κοινωνία (общении). Минималистично, как
  // ✻ у Claude Code.
  printBanner(session, opts);
  console.log();

  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: true,
    historySize: 200,
    prompt: c('cyan', 'gift') + c('dim', '> '),
  });

  // inbox of user messages waiting to be sent to SDK
  const inbox = [];
  let inboxResolve = null;
  let done = false;

  function pushToInbox(text) {
    inbox.push(text);
    if (inboxResolve) { const r = inboxResolve; inboxResolve = null; r(); }
  }

  rl.on('line', async line => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }
    if (trimmed.startsWith('/')) {
      // slash-команды — обрабатываем локально, не уходят в модель
      try {
        const r = await handleSlash(trimmed, state, rl, () => { done = true; rl.close(); }, pushToInbox);
        // Некоторые команды (например /refresh) пушат сообщение в SDK через pushToInbox
        // и НЕ должны печатать prompt сразу — он напечатается после ответа SDK.
        if (r?.expectsResponse) return;
      } catch (e) {
        console.error(c('red', `error: ${e.message}`));
      }
      if (!done) rl.prompt();
      return;
    }
    // обычный turn — паузим prompt, пушим в inbox
    state.appendUser(trimmed);
    pushToInbox(trimmed);
  });

  rl.on('close', () => { done = true; if (inboxResolve) inboxResolve(); });

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
  const builtins   = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];
  const allowedTools = [...new Set([...builtins, ...GIFT_TOOL_NAMES])];

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
    permissionMode: 'bypassPermissions',
    maxTurns:       999,
    cwd:            ROOT,
    hooks:          GIFT_HOOKS,
  };
  if (claudeBin) queryOptions.pathToClaudeCodeExecutable = claudeBin;

  rl.prompt();

  let pendingAssistantText = '';

  try {
    const gen = query({ prompt: userMessageStream(), options: queryOptions });
    for await (const message of gen) {
      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            const mcps = (message.mcp_servers ?? []).map(s => `${s.name}=${s.status}`).join(', ');
            console.error(c('dim', `[init] mcp: ${mcps || '(none)'} | tools: ${(message.tools ?? []).length}`));
          }
          break;

        case 'assistant': {
          const blocks = message.message?.content ?? [];
          for (const b of blocks) {
            if (b.type === 'text') {
              process.stdout.write(b.text);
              pendingAssistantText += b.text;
            } else if (b.type === 'tool_use') {
              const name = b.name.startsWith('mcp__gift__')
                ? c('magenta', `⚡ ${b.name.replace('mcp__gift__', 'gift::')}`)
                : c('cyan',    `🔧 ${b.name}`);
              process.stderr.write(`\n${name} ${c('dim', JSON.stringify(b.input).slice(0, 100))}\n`);
            }
          }
          break;
        }

        case 'user': {
          const blocks = message.message?.content ?? [];
          for (const b of blocks) {
            if (b.type === 'tool_result') {
              const text = typeof b.content === 'string'
                ? b.content
                : (b.content?.[0]?.text ?? '');
              process.stderr.write(c('green', '↪ ') + c('dim', text.slice(0, 120)) + '\n');
            }
          }
          break;
        }

        case 'result':
          if (pendingAssistantText.trim()) state.appendAssistant(pendingAssistantText);
          pendingAssistantText = '';
          if (typeof message.total_cost_usd === 'number') {
            state.totalCost += message.total_cost_usd;
          }
          if (message.usage) {
            state.totalUsage.input_tokens  += message.usage.input_tokens  || 0;
            state.totalUsage.output_tokens += message.usage.output_tokens || 0;
          }
          process.stdout.write('\n');
          rl.prompt();
          break;

        default:
          break;
      }
    }
  } catch (e) {
    console.error(c('red', `\n✗ SDK error: ${e?.message || e}`));
  } finally {
    rl.close();
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

// ── Banner (иконка стартового экрана) ────────────────────────────────────
function printBanner(session, opts) {
  // Читаем версию из package.json для подписи
  let version = '';
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    version = `v${pkg.version || '0'}`;
  } catch {}

  // Snapshot для подзаголовка
  let metric = '';
  try {
    const snapPath = resolve(ROOT, 'data/sacred-history-W.json');
    if (existsSync(snapPath)) {
      const W = JSON.parse(readFileSync(snapPath, 'utf8'));
      const persons = (W.persons || []).length;
      const acts    = W.acts ?? W.actsCount ?? '?';
      metric = `${persons} лиц · ${acts} актов`;
    }
  } catch {}
  let treasureN = '';
  try {
    const lcmPath = resolve(ROOT, 'data/lcm.db');
    if (existsSync(lcmPath)) {
      const store = new LcmStore(lcmPath);
      treasureN = ` · ${store.stats().total} в сокровищнице`;
      store.close();
    }
  } catch {}

  console.log();
  console.log('  ' + c('gold', '✦') + '  ' + c('bold', c('gold', 'gift')) + '  ' + c('dim', version) + '  ' + c('dim', '— онтология дара'));
  console.log('     ' + c('dim', 'Κοινόν τοῦ Νοῦ ') + c('dim', '(общее ума) — собор лиц в матрице W'));
  console.log();
  console.log('  ' + c('cyan', '─'.repeat(60)));
  if (metric || treasureN) {
    console.log('  ' + c('dim', metric + treasureN));
  }
  console.log('  ' + c('dim', `сессия: ${session.id}`));
  if (session.title) console.log('  ' + c('dim', `title:  `) + c('bold', session.title));
  if (opts.resumeId)  console.log('  ' + c('dim', `resumed: ${session.messages.length} сообщений в истории`));
  console.log('  ' + c('dim', '/help — slash-команды  ·  Ctrl+D — выход'));
  console.log('  ' + c('cyan', '─'.repeat(60)));
}

// ── slash-команды ───────────────────────────────────────────────────────
async function handleSlash(line, state, rl, quit, pushToInbox) {
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd) {
    case '/help':
      console.log();
      console.log(c('bold', 'Slash-команды:'));
      console.log('  /help                       список slash-команд');
      console.log('  /clear                      очистить историю');
      console.log('  /save                       явный save (auto-save и так каждое сообщение)');
      console.log('  /title <text>               задать/переименовать заголовок сессии');
      console.log('  /branch [new-id]            форк: скопировать сессию и продолжить в копии');
      console.log('  /refresh                    обновить анамнезис матрицы для модели');
      console.log('  /plain [on|off]             режим без греческих терминов (нужен restart)');
      console.log('  /glossary [<слово>]         показать словарь терминов (греч. → рус.)');
      console.log('  /sessions                   последние сессии');
      console.log('  /resume <id|last>           перейти к сессии (нужен restart)');
      console.log('  /tools                      список доступных tools');
      console.log('  /status                     gift status inline');
      console.log('  /recall <query>             полнотекстовый поиск (treasure)');
      console.log('  /unfold <source_id>         развернуть документ/сессию');
      console.log('  /matrix                     топ-нити W');
      console.log('  /pustynya                   богословские пустыни');
      console.log('  /cost                       стоимость текущей сессии');
      console.log('  /quit | /exit               выход (Ctrl+D)');
      console.log();
      break;

    case '/clear':
      state.session.messages = [];
      saveSession(state.session);
      console.log(c('dim', '✓ история очищена'));
      break;

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

    case '/tools':
      console.log();
      console.log(c('bold', 'Builtins:'));
      console.log('  Read Write Edit Bash Grep Glob WebFetch WebSearch');
      console.log(c('bold', 'Gift MCP-tools:'));
      for (const t of GIFT_TOOL_NAMES) console.log('  ' + t);
      console.log();
      break;

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
