import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runApiAgent, ANTHROPIC_GIFT_TOOLS } from '../src/agent-cli/api-runner.js';

// Mock Anthropic client
function mockClient(responses) {
  let i = 0;
  const calls = [];
  return {
    messages: {
      create: async (params) => {
        calls.push(params);
        const r = responses[i++] ?? responses[responses.length - 1];
        if (r.throw) throw r.throw;
        return r;
      },
    },
    _calls: () => calls,
  };
}

test('api-runner — tools schema', async (t) => {
  await t.test('содержит 8 инструментов', () => {
    const names = ANTHROPIC_GIFT_TOOLS.map(t => t.name);
    for (const expected of [
      'matrix_query', 'pustynya_list', 'decoupage_cut', 'vintage_assess',
      'score_profile', 'liturgical_today', 'epiclesis_ask', 'gift_receive',
    ]) {
      assert.ok(names.includes(expected), `нет инструмента ${expected}`);
    }
  });

  await t.test('каждый инструмент в правильном Anthropic формате', () => {
    for (const t of ANTHROPIC_GIFT_TOOLS) {
      assert.ok(t.name);
      assert.ok(t.description);
      assert.ok(t.input_schema);
      assert.equal(t.input_schema.type, 'object');
      // НЕ Ollama: parameters; Anthropic: input_schema
      assert.equal(t.parameters, undefined);
    }
  });
});

test('api-runner — agent loop', async (t) => {
  await t.test('требует prompt', async () => {
    await assert.rejects(() => runApiAgent({ clientImpl: mockClient([]) }), /prompt обязателен/);
  });

  await t.test('без API key возвращает no_api_key', async () => {
    const oldKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await runApiAgent({ prompt: 'x' });
      assert.equal(r.success, false);
      assert.equal(r.error, 'no_api_key');
      assert.match(r.message, /console\.anthropic\.com/);
    } finally {
      if (oldKey) process.env.ANTHROPIC_API_KEY = oldKey;
    }
  });

  await t.test('одношаговый ответ без tool_use', async () => {
    const client = mockClient([
      {
        content: [{ type: 'text', text: 'Привет, я gift-агент.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);
    const r = await runApiAgent({
      prompt: 'привет',
      apiKey: 'test', clientImpl: client,
    });
    assert.equal(r.success, true);
    assert.equal(r.turns, 1);
    assert.match(r.result, /gift-агент/);
    assert.equal(r.usage.input_tokens, 10);
  });

  await t.test('tool_use → tool_result → final answer', async () => {
    const client = mockClient([
      {
        content: [
          { type: 'text', text: 'Сначала посмотрю...' },
          { type: 'tool_use', id: 'tu1', name: 'liturgical_today', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 10 },
      },
      {
        content: [{ type: 'text', text: 'Сегодня обычный день.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 30, output_tokens: 5 },
      },
    ]);
    const r = await runApiAgent({
      prompt: 'какой сегодня день?',
      apiKey: 'test', clientImpl: client,
    });
    assert.equal(r.success, true);
    assert.equal(r.turns, 2);
    // Total usage аккумулируется
    assert.equal(r.usage.input_tokens, 50);
    assert.equal(r.usage.output_tokens, 15);
  });

  await t.test('передаёт tools и system prompt в API', async () => {
    const client = mockClient([{
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
    }]);
    await runApiAgent({ prompt: 'x', apiKey: 'test', clientImpl: client });
    const params = client._calls()[0];
    assert.ok(Array.isArray(params.tools));
    assert.ok(params.tools.length >= 8);
    assert.match(params.system, /συνλειτουργός/);
    assert.match(params.system, /κένωσις/);
    assert.match(params.system, /Палама/);
  });

  await t.test('default model = claude-opus-4-7', async () => {
    const client = mockClient([{
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
    }]);
    await runApiAgent({ prompt: 'x', apiKey: 'test', clientImpl: client });
    assert.equal(client._calls()[0].model, 'claude-opus-4-7');
  });

  await t.test('лимит итераций', async () => {
    // Все ответы с tool_use без end_turn
    const client = mockClient([{
      content: [
        { type: 'tool_use', id: 'tu1', name: 'liturgical_today', input: {} },
      ],
      stop_reason: 'tool_use',
    }]);
    const r = await runApiAgent({
      prompt: 'x', maxTurns: 2, apiKey: 'test', clientImpl: client,
    });
    assert.equal(r.success, false);
    assert.match(r.error, /лимит итераций/);
  });

  await t.test('401 → invalid_api_key', async () => {
    const err401 = Object.assign(new Error('Invalid API key'), { status: 401 });
    const client = mockClient([{ throw: err401 }]);
    const r = await runApiAgent({
      prompt: 'x', apiKey: 'bad', clientImpl: client,
    });
    assert.equal(r.success, false);
    assert.equal(r.error, 'invalid_api_key');
  });

  await t.test('429 → rate_limit', async () => {
    const err429 = Object.assign(new Error('Rate limit'), { status: 429 });
    const client = mockClient([{ throw: err429 }]);
    const r = await runApiAgent({
      prompt: 'x', apiKey: 'test', clientImpl: client,
    });
    assert.equal(r.success, false);
    assert.equal(r.error, 'rate_limit');
  });
});
