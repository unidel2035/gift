import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';

// ── Структурные тесты — без запуска SDK (избегаем anti-recursion в CI) ──

test('agent-cli — gift-tools модуль грузится и регистрирует MCP-сервер', async (t) => {
  const { buildGiftMcpServer, GIFT_TOOL_NAMES } = await import('../src/agent-cli/gift-tools.js');

  await t.test('buildGiftMcpServer возвращает объект с tools', () => {
    const server = buildGiftMcpServer();
    assert.ok(server);
    assert.equal(typeof server, 'object');
  });

  await t.test('GIFT_TOOL_NAMES содержит mcp__gift__* префикс', () => {
    assert.ok(GIFT_TOOL_NAMES.length >= 9);
    for (const name of GIFT_TOOL_NAMES) {
      assert.match(name, /^mcp__gift__/);
    }
    assert.ok(GIFT_TOOL_NAMES.includes('mcp__gift__matrix_query'));
    assert.ok(GIFT_TOOL_NAMES.includes('mcp__gift__sobor_celebrate'));
    assert.ok(GIFT_TOOL_NAMES.includes('mcp__gift__decoupage_cut'));
    assert.ok(GIFT_TOOL_NAMES.includes('mcp__gift__score_profile'));
    assert.ok(GIFT_TOOL_NAMES.includes('mcp__gift__epiclesis_ask'));
  });
});

test('agent-cli — system-prompt содержит ключевые понятия онтологии', async (t) => {
  const { GIFT_SYSTEM_PROMPT } = await import('../src/agent-cli/system-prompt.js');

  await t.test('содержит закон кенозиса', () => {
    assert.match(GIFT_SYSTEM_PROMPT, /κένωσις/);
    assert.match(GIFT_SYSTEM_PROMPT, /surplus/);
  });

  await t.test('упоминает συνλειτουργός', () => {
    assert.match(GIFT_SYSTEM_PROMPT, /συνλειτουργός/);
    // «Не дирижёр» — это явное отрицание роли в промпте, оно ОК
    assert.match(GIFT_SYSTEM_PROMPT, /Не\s+дирижёр/);
  });

  await t.test('перечислены 9 mcp__gift__ инструментов', () => {
    const tools = ['matrix_query', 'sobor_celebrate', 'decoupage_cut',
                   'vintage_assess', 'score_profile', 'epiclesis_ask',
                   'pustynya_list', 'liturgical_today', 'gift_receive'];
    for (const t of tools) assert.match(GIFT_SYSTEM_PROMPT, new RegExp(t));
  });

  await t.test('содержит 4 условия иконичности', () => {
    assert.match(GIFT_SYSTEM_PROMPT, /συμφωνία/);
    assert.match(GIFT_SYSTEM_PROMPT, /perichoresis/i);
    assert.match(GIFT_SYSTEM_PROMPT, /kenosis|кенозис/i);
    assert.match(GIFT_SYSTEM_PROMPT, /epiclesis|эпиклеза/i);
  });
});

test('agent-cli — hooks отвергают опасные команды', async (t) => {
  const { GIFT_HOOKS } = await import('../src/agent-cli/hooks.js');

  await t.test('hooks structure: PreToolUse, PostToolUse, SessionStart', () => {
    assert.ok(GIFT_HOOKS.PreToolUse);
    assert.ok(GIFT_HOOKS.PostToolUse);
    assert.ok(GIFT_HOOKS.SessionStart);
  });

  await t.test('PreToolUse отказывает rm -rf /', async () => {
    const hookFn = GIFT_HOOKS.PreToolUse[0].hooks[0];
    const r = await hookFn(
      { tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/test' } },
      'tu1', { signal: undefined },
    );
    // rm -rf /tmp/... совпадает с /rm\s+-rf?\s+\//ё
    assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny');
  });

  await t.test('PreToolUse отказывает sudo', async () => {
    const hookFn = GIFT_HOOKS.PreToolUse[0].hooks[0];
    const r = await hookFn(
      { tool_name: 'Bash', tool_input: { command: 'sudo apt install foo' } },
      'tu2', { signal: undefined },
    );
    assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny');
  });

  await t.test('PreToolUse отказывает force-push', async () => {
    const hookFn = GIFT_HOOKS.PreToolUse[0].hooks[0];
    const r = await hookFn(
      { tool_name: 'Bash', tool_input: { command: 'git push origin main --force' } },
      'tu3', { signal: undefined },
    );
    assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny');
  });

  await t.test('PreToolUse пропускает безопасную команду', async () => {
    const hookFn = GIFT_HOOKS.PreToolUse[0].hooks[0];
    const r = await hookFn(
      { tool_name: 'Bash', tool_input: { command: 'ls -la' } },
      'tu4', { signal: undefined },
    );
    assert.equal(r.hookSpecificOutput, undefined);
  });
});

test('agent-cli — runGiftAgent экспорт + сигнатура', async (t) => {
  const { runGiftAgent } = await import('../src/agent-cli/run.js');

  await t.test('runGiftAgent — это функция', () => {
    assert.equal(typeof runGiftAgent, 'function');
  });

  await t.test('требует prompt', async () => {
    await assert.rejects(() => runGiftAgent({}), /prompt обязателен/);
  });
});

test('agent-cli — bin/gift-agent существует и исполняемый', async () => {
  assert.ok(existsSync('/home/unidel/gift/bin/gift-agent'));
  const content = readFileSync('/home/unidel/gift/bin/gift-agent', 'utf8');
  assert.match(content, /^#!\/usr\/bin\/env node/);
  assert.match(content, /runGiftAgent/);
  assert.match(content, /--plan/);
  assert.match(content, /--accept-edits/);
  assert.match(content, /--bypass/);
  assert.match(content, /--max-turns/);
  assert.match(content, /--verbose/);
});

test('agent-cli — gift cli знает agent подкоманду', async () => {
  const giftCli = readFileSync('/home/unidel/gift/bin/gift', 'utf8');
  assert.match(giftCli, /case 'agent':/);
  assert.match(giftCli, /bin\/gift-agent/);
  // в справке упомянут
  assert.match(giftCli, /gift agent/);
});
