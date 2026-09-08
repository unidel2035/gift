// Перихоресис в sobor_ask — proposal #88.
// Голоса собора звучат последовательно: каждый следующий слышит сказанное прежде.
// Stub-сервер (Anthropic-формат) фиксирует порядок запросов и содержимое каждого.
// PROXY_URL в gift-agent.js читается при импорте модуля — env ставим ДО dynamic import.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const requests = []; // { persona, userContent, seq }

test('sobor_ask — голоса последовательны, каждый слышит предыдущих', async (t) => {
  // 1. Stub-сервер: идентифицирует персону по system-промпту, отвечает уникальным маркером
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const system = parsed.system || '';
      const userContent = parsed.messages?.[0]?.content || '';
      let persona = 'unknown';
      if (system.includes('Orthodox theologian')) persona = 'theologian';
      else if (system.includes('pragmatic engineer')) persona = 'engineer';
      else if (system.includes('strategic advisor')) persona = 'strategist';
      const seq = requests.length;
      requests.push({ persona, userContent, seq });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `msg_${seq}`, type: 'message', role: 'assistant', model: 'stub',
        content: [{ type: 'text', text: `[voice-${persona}-${seq}] слово ${persona}` }],
        stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((r) => server.close(r)));

  // 2. Импорт ПОСЛЕ установки env — PROXY_URL это const на верхнем уровне модуля
  const { executeTool } = await import('../src/agent-cli/gift-agent.js');

  const result = await executeTool('sobor_ask', { question: 'Что есть дар?' });

  await t.test('ровно 3 запроса, порядок = порядку personaList', () => {
    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map((r) => r.persona), ['theologian', 'engineer', 'strategist']);
  });

  await t.test('первый голос спрашивает в одиночестве — никого ещё не слышит', () => {
    assert.ok(requests[0].userContent.includes('Что есть дар?'));
    assert.ok(!requests[0].userContent.includes('voice-'), 'первый голос не должен слышать чужих ответов');
  });

  await t.test('второй голос (engineer) слышит ответ первого (theologian)', () => {
    assert.ok(requests[1].userContent.includes('[voice-theologian-0]'),
      'user-сообщение engineer должно содержать ответ theologian');
    assert.ok(requests[1].userContent.includes('Что есть дар?'));
  });

  await t.test('третий голос (strategist) слышит ответы обоих', () => {
    assert.ok(requests[2].userContent.includes('[voice-theologian-0]'),
      'strategist должен содержать ответ theologian');
    assert.ok(requests[2].userContent.includes('[voice-engineer-1]'),
      'strategist должен содержать ответ engineer');
  });

  await t.test('итоговый вывод — все три голоса в порядке собора', () => {
    assert.equal(typeof result, 'string', `ожидали строку, получили: ${JSON.stringify(result).slice(0, 200)}`);
    assert.ok(result.includes('[voice-theologian-0]'));
    assert.ok(result.includes('[voice-engineer-1]'));
    assert.ok(result.includes('[voice-strategist-2]'));
    assert.ok(result.indexOf('[voice-theologian-0]') < result.indexOf('[voice-engineer-1]'));
    assert.ok(result.indexOf('[voice-engineer-1]') < result.indexOf('[voice-strategist-2]'));
  });
});
