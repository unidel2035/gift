/**
 * hooks.js — lifecycle hooks для gift-агента.
 *
 * PreToolUse  — логирование, отказ для опасных команд (rm -rf /, etc.)
 * PostToolUse — записать в анамнезис что делал агент
 * SessionStart — анамнетический ритуал (как matrix-context-hook в Claude Code)
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LOG = '/home/unidel/gift/data/agent-cli.log';

function logLine(line) {
  if (!existsSync(dirname(LOG))) mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}

function isDangerous(toolName, input) {
  if (toolName === 'Bash') {
    const cmd = input?.command ?? '';
    if (/rm\s+-rf?\s+\//.test(cmd)) return 'rm -rf на корне';
    if (/^\s*sudo\b/.test(cmd))     return 'sudo без явного запроса';
    if (/git\s+push\s+.*--force/.test(cmd)) return 'force-push';
    if (/git\s+reset\s+--hard/.test(cmd))   return 'reset --hard';
  }
  return null;
}

export const GIFT_HOOKS = {
  PreToolUse: [
    {
      hooks: [
        async (input, toolUseId) => {
          const danger = isDangerous(input.tool_name, input.tool_input);
          logLine(`PreToolUse ${toolUseId} ${input.tool_name} ${danger ? `[DANGER: ${danger}]` : ''}`);
          if (danger) {
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: `gift-агент отказывается: ${danger}. Если действительно нужно — попроси Дионисия явно.`,
              },
            };
          }
          // Non-interactive default: allow для безопасных. Без этого SDK ждёт
          // interactive prompt и висит. Опасные команды отсечены выше.
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
            },
          };
        },
      ],
    },
  ],
  PostToolUse: [
    {
      hooks: [
        async (input, toolUseId) => {
          logLine(`PostToolUse ${toolUseId} ${input.tool_name} ok`);
          return {};
        },
      ],
    },
  ],
  SessionStart: [
    {
      hooks: [
        async () => {
          logLine('SessionStart — анамнетический ритуал');
          return {};
        },
      ],
    },
  ],
};
