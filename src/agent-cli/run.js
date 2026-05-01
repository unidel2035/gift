/**
 * run.js — основной runner для агентного режима gift CLI.
 *
 * Использует @anthropic-ai/claude-agent-sdk: query() с MCP-сервером gift-tools,
 * системным промптом онтологии, hooks lifecycle, streaming output.
 *
 * Вход — prompt (string) и опции. Выход — стриминг сообщений в stdout +
 * финальный ResultMessage.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { buildGiftMcpServer, GIFT_TOOL_NAMES } from './gift-tools.js';
import { GIFT_SYSTEM_PROMPT } from './system-prompt.js';
import { GIFT_HOOKS } from './hooks.js';

/**
 * Найти исполняемый claude. SDK по умолчанию ищет bundled binary в своих
 * node_modules, но он бывает не установлен (musl-arch на WSL и т.п.).
 * Auto-detect: переменная env GIFT_CLAUDE_BIN → which claude → null.
 */
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

const C = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m',
  red:     '\x1b[31m',
};

/**
 * Запустить gift-агента.
 *
 * @param {object} opts
 * @param {string} opts.prompt — что агент должен сделать
 * @param {'plan'|'default'|'acceptEdits'|'bypassPermissions'|'dontAsk'|'auto'} [opts.permissionMode]
 * @param {number} [opts.maxTurns]
 * @param {string[]} [opts.allowedTools] — дополнительные allowed tools
 * @param {boolean}  [opts.includeBuiltins=true] — включить Read/Write/Edit/Bash/Grep/Glob
 * @param {string}   [opts.cwd]
 * @param {boolean}  [opts.verbose=false]
 * @param {object}   [opts.systemPromptExtra] — добавить к системному промпту
 * @returns {Promise<{ success:boolean, result?:string, cost_usd?:number, error?:string }>}
 */
export async function runGiftAgent(opts = {}) {
  const {
    prompt,
    permissionMode = 'default',
    maxTurns = 30,
    allowedTools: extraTools = [],
    includeBuiltins = true,
    cwd = '/home/unidel/gift',
    verbose = false,
    systemPromptExtra = '',
  } = opts;

  if (!prompt) throw new Error('runGiftAgent: prompt обязателен');

  const builtins = includeBuiltins
    ? ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch']
    : [];
  const allowedTools = [...new Set([
    ...builtins,
    ...GIFT_TOOL_NAMES,
    ...extraTools,
  ])];

  const systemPrompt = systemPromptExtra
    ? `${GIFT_SYSTEM_PROMPT}\n\n--- ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ---\n\n${systemPromptExtra}`
    : GIFT_SYSTEM_PROMPT;

  const giftServer = buildGiftMcpServer();
  const claudeBin = findClaudeBin();

  let lastResult = null;
  let stoppedByError = null;

  const queryOptions = {
    systemPrompt,
    mcpServers: { gift: giftServer },
    allowedTools,
    permissionMode,
    maxTurns,
    cwd,
    hooks: GIFT_HOOKS,
  };
  if (claudeBin) {
    queryOptions.pathToClaudeCodeExecutable = claudeBin;
    if (verbose) console.error(`${C.dim}[gift-agent] using claude bin: ${claudeBin}${C.reset}`);
  }

  const generator = query({
    prompt,
    options: queryOptions,
  });

  try {
    for await (const message of generator) {
      switch (message.type) {
        case 'system':
          if (verbose && message.subtype === 'init') {
            console.error(`${C.dim}[system:init] mcp_servers: ${JSON.stringify(message.mcp_servers ?? [])}${C.reset}`);
          }
          break;

        case 'assistant': {
          const content = message.message?.content ?? [];
          for (const block of content) {
            if (block.type === 'text') {
              process.stdout.write(block.text);
            } else if (block.type === 'tool_use') {
              const name = block.name.startsWith('mcp__gift__')
                ? `${C.magenta}⚡ ${block.name.replace('mcp__gift__', 'gift::')}${C.reset}`
                : `${C.cyan}🔧 ${block.name}${C.reset}`;
              process.stderr.write(`\n${name}${C.dim} ${JSON.stringify(block.input).slice(0, 100)}${C.reset}\n`);
            } else if (block.type === 'thinking' && verbose) {
              process.stderr.write(`${C.dim}[thinking] ${block.thinking?.slice(0, 200) ?? ''}${C.reset}\n`);
            }
          }
          break;
        }

        case 'user': {
          // Result от tool — показываем кратко
          const content = message.message?.content ?? [];
          for (const block of content) {
            if (block.type === 'tool_result' && verbose) {
              const text = typeof block.content === 'string'
                ? block.content
                : (block.content?.[0]?.text ?? '');
              process.stderr.write(`${C.green}↪ tool_result${C.reset}${C.dim} ${text.slice(0, 150)}${C.reset}\n`);
            }
          }
          break;
        }

        case 'result':
          lastResult = message;
          process.stdout.write('\n');
          if (verbose) {
            console.error(`${C.dim}── result ──${C.reset}`);
            console.error(`${C.dim}subtype: ${message.subtype}${C.reset}`);
            console.error(`${C.dim}cost:    $${message.total_cost_usd?.toFixed(4) ?? '?'}${C.reset}`);
            console.error(`${C.dim}usage:   ${JSON.stringify(message.usage ?? {})}${C.reset}`);
          }
          break;

        default:
          if (verbose) console.error(`${C.dim}[${message.type}]${C.reset}`);
      }
    }
  } catch (e) {
    stoppedByError = e;
    // Anti-recursion детектор
    const msg = e?.message ?? String(e);
    if (/Claude Code native binary not found/i.test(msg)) {
      console.error(`\n${C.red}✗ native binary не найден.${C.reset}`);
      console.error(`${C.dim}  SDK не нашёл claude в node_modules. Установи системный claude (npm i -g @anthropic-ai/claude-code)${C.reset}`);
      console.error(`${C.dim}  или укажи путь через GIFT_CLAUDE_BIN env var.${C.reset}`);
      return { success: false, error: 'claude_not_found' };
    }
    if (/Request not allowed|403|Failed to authenticate/i.test(msg)) {
      console.error(`\n${C.red}✗ claude --print заблокирован.${C.reset}`);
      console.error(`${C.dim}  Anthropic anti-recursion: пока активна Claude Code session где-то в системе,${C.reset}`);
      console.error(`${C.dim}  любой claude --print отказывает с 403. Запусти gift в обычном bash terminal,${C.reset}`);
      console.error(`${C.dim}  не из Claude Code сессии.${C.reset}`);
      return { success: false, error: 'recursion_blocked' };
    }
    return { success: false, error: msg };
  }

  if (!lastResult) {
    return { success: false, error: 'агент завершился без result-сообщения' };
  }
  return {
    success: lastResult.subtype === 'success',
    result: lastResult.result,
    cost_usd: lastResult.total_cost_usd,
    subtype: lastResult.subtype,
    usage: lastResult.usage,
  };
}
