import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOllamaAgent, OLLAMA_GIFT_TOOLS } from '../src/agent-cli/ollama-runner.js';

function mockFetch(responses) {
  let i = 0;
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const r = responses[i++] ?? responses[responses.length - 1];
    return {
      ok: true,
      status: 200,
      json: async () => r,
      text: async () => JSON.stringify(r),
    };
  };
  fn.calls = calls;
  return fn;
}

test('ollama-runner — tools schema', async (t) => {
  await t.test('содержит все 8 инструментов онтологии', () => {
    const names = OLLAMA_GIFT_TOOLS.map(t => t.function.name);
    assert.ok(names.includes('matrix_query'));
    assert.ok(names.includes('pustynya_list'));
    assert.ok(names.includes('decoupage_cut'));
    assert.ok(names.includes('vintage_assess'));
    assert.ok(names.includes('score_profile'));
    assert.ok(names.includes('liturgical_today'));
    assert.ok(names.includes('epiclesis_ask'));
    assert.ok(names.includes('gift_receive'));
  });

  await t.test('каждый инструмент имеет правильный формат для Ollama', () => {
    for (const t of OLLAMA_GIFT_TOOLS) {
      assert.equal(t.type, 'function');
      assert.ok(t.function.name);
      assert.ok(t.function.description);
      assert.ok(t.function.parameters);
      assert.equal(t.function.parameters.type, 'object');
    }
  });
});

test('ollama-runner — agent loop', async (t) => {
  await t.test('требует prompt', async () => {
    await assert.rejects(() => runOllamaAgent({}), /prompt обязателен/);
  });

  await t.test('одношаговый ответ без tools (модель сразу даёт content)', async () => {
    const fetch = mockFetch([
      { message: { role: 'assistant', content: 'Привет, я gift-агент' } },
    ]);
    const r = await runOllamaAgent({
      prompt: 'привет', model: 'llama3.1:8b', fetchImpl: fetch,
    });
    assert.equal(r.success, true);
    assert.equal(r.turns, 1);
    assert.match(r.result, /gift-агент/);
  });

  await t.test('tool call → result → final answer', async () => {
    const fetch = mockFetch([
      // Turn 1: model запрашивает tool
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'liturgical_today', arguments: {} } }],
        },
      },
      // Turn 2: model отвечает с учётом tool result
      {
        message: { role: 'assistant', content: 'Сегодня обычный день — ферментация в бочке.' },
      },
    ]);
    const r = await runOllamaAgent({
      prompt: 'какой сегодня литургический день?',
      model: 'llama3.1:8b', fetchImpl: fetch,
    });
    assert.equal(r.success, true);
    assert.equal(r.turns, 2);
    assert.match(r.result, /день|ферментация|обычный/);
    // Проверяем что в messages было: system, user, assistant(tool_call), tool, assistant
    assert.equal(fetch.calls.length, 2);
    const secondCallMessages = fetch.calls[1].body.messages;
    assert.ok(secondCallMessages.find(m => m.role === 'tool'));
  });

  await t.test('передаёт tools параметр в Ollama API', async () => {
    const fetch = mockFetch([{ message: { role: 'assistant', content: 'ok' } }]);
    await runOllamaAgent({ prompt: 'x', fetchImpl: fetch });
    assert.ok(Array.isArray(fetch.calls[0].body.tools));
    assert.ok(fetch.calls[0].body.tools.length >= 8);
  });

  await t.test('передаёт system prompt', async () => {
    const fetch = mockFetch([{ message: { role: 'assistant', content: 'ok' } }]);
    await runOllamaAgent({ prompt: 'x', fetchImpl: fetch });
    const messages = fetch.calls[0].body.messages;
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /συνλειτουργός/);
    assert.match(messages[0].content, /κένωσις/);
  });

  await t.test('лимит итераций', async () => {
    // Все ответы — tool calls без финального content
    const fetch = mockFetch([
      {
        message: {
          role: 'assistant', content: '',
          tool_calls: [{ function: { name: 'liturgical_today', arguments: {} } }],
        },
      },
    ]);
    const r = await runOllamaAgent({
      prompt: 'x', maxTurns: 2, fetchImpl: fetch,
    });
    assert.equal(r.success, false);
    assert.match(r.error, /лимит итераций/);
  });

  await t.test('HTTP error → возврат с ошибкой', async () => {
    const fetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
    const r = await runOllamaAgent({ prompt: 'x', fetchImpl: fetch });
    assert.equal(r.success, false);
    assert.match(r.error, /500/);
  });
});
