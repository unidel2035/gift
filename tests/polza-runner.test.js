import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPolzaAgent, POLZA_GIFT_TOOLS } from '../src/agent-cli/polza-runner.js';

function mockClient(responses) {
  let i = 0;
  const calls = [];
  return {
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          const r = responses[i++] ?? responses[responses.length - 1];
          if (r.throw) throw r.throw;
          return r;
        },
      },
    },
    _calls: () => calls,
  };
}

test('polza-runner — tools schema', async (t) => {
  await t.test('содержит 8 OpenAI-format инструментов', () => {
    assert.ok(POLZA_GIFT_TOOLS.length >= 8);
    for (const t of POLZA_GIFT_TOOLS) {
      assert.equal(t.type, 'function');
      assert.ok(t.function.name);
      assert.ok(t.function.description);
      assert.ok(t.function.parameters);
    }
  });
});

test('polza-runner — agent loop', async (t) => {
  await t.test('требует prompt', async () => {
    await assert.rejects(() => runPolzaAgent({ clientImpl: mockClient([]) }), /prompt обязателен/);
  });

  await t.test('без ключа возвращает no_api_key', async () => {
    const oldP = process.env.POLZA_API_KEY;
    const oldO = process.env.OPENAI_API_KEY;
    delete process.env.POLZA_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const r = await runPolzaAgent({ prompt: 'x' });
      assert.equal(r.success, false);
      assert.equal(r.error, 'no_api_key');
    } finally {
      if (oldP) process.env.POLZA_API_KEY = oldP;
      if (oldO) process.env.OPENAI_API_KEY = oldO;
    }
  });

  await t.test('одношаговый ответ', async () => {
    const client = mockClient([
      {
        choices: [{ message: { role: 'assistant', content: 'Привет.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    ]);
    const r = await runPolzaAgent({ prompt: 'привет', apiKey: 'test', clientImpl: client });
    assert.equal(r.success, true);
    assert.equal(r.turns, 1);
    assert.match(r.result, /Привет/);
  });

  await t.test('tool_call → result → final', async () => {
    const client = mockClient([
      {
        choices: [{
          message: {
            role: 'assistant', content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'liturgical_today', arguments: '{}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      },
      {
        choices: [{ message: { role: 'assistant', content: 'Сегодня обычный день.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 5 },
      },
    ]);
    const r = await runPolzaAgent({ prompt: 'день?', apiKey: 'test', clientImpl: client });
    assert.equal(r.success, true);
    assert.equal(r.turns, 2);
    assert.equal(r.usage.prompt_tokens, 50);
  });

  await t.test('передаёт tools и system', async () => {
    const client = mockClient([{
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }]);
    await runPolzaAgent({ prompt: 'x', apiKey: 'test', clientImpl: client });
    const params = client._calls()[0];
    assert.ok(Array.isArray(params.tools));
    assert.ok(params.tools.length >= 8);
    const sysMsg = params.messages.find(m => m.role === 'system');
    assert.match(sysMsg.content, /συνλειτουργός/);
  });

  await t.test('default model = claude-opus-4-7', async () => {
    const client = mockClient([{ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }]);
    await runPolzaAgent({ prompt: 'x', apiKey: 'test', clientImpl: client });
    assert.equal(client._calls()[0].model, 'claude-opus-4-7');
  });

  await t.test('401 → invalid_api_key', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    const client = mockClient([{ throw: err }]);
    const r = await runPolzaAgent({ prompt: 'x', apiKey: 'bad', clientImpl: client });
    assert.equal(r.success, false);
    assert.equal(r.error, 'invalid_api_key');
  });
});
