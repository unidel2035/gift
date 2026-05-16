import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaAgent, buildStandardCouncil } from '../src/persons/OllamaAgent.js';

// Mock fetch для тестирования без живого Ollama.
function mockFetch({ generateResponse = '', tagsModels = [], httpStatus = 200 } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/api/tags')) {
      return {
        ok: true,
        json: async () => ({ models: tagsModels.map(name => ({ name })) }),
      };
    }
    if (url.includes('/api/generate')) {
      return {
        ok: httpStatus >= 200 && httpStatus < 300,
        status: httpStatus,
        text: async () => 'mock error body',
        json: async () => ({ response: generateResponse }),
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  fn.calls = calls;
  return fn;
}

test('OllamaAgent — базовая работа', async (t) => {
  await t.test('требует id и model', () => {
    assert.throws(() => new OllamaAgent({}), /id/);
    assert.throws(() => new OllamaAgent({ id: 'X' }), /model/);
  });

  await t.test('create() возвращает content от ollama', async () => {
    const fetch = mockFetch({ generateResponse: 'я Адам, я вижу пустыню' });
    const a = new OllamaAgent({ id: 'Адам', model: 'adam:latest', fetchImpl: fetch });
    const r = await a.create({ question: 'что мешает потоку?' });
    assert.equal(r.content, 'я Адам, я вижу пустыню');
    assert.equal(r.model, 'adam:latest');
    assert.equal(fetch.calls.length, 1);
    assert.match(fetch.calls[0].opts.body, /adam:latest/);
    assert.match(fetch.calls[0].opts.body, /что мешает потоку/);
  });

  await t.test('create() при ошибке возвращает пустой content (apophatic)', async () => {
    const fetch = mockFetch({ httpStatus: 500 });
    const a = new OllamaAgent({ id: 'Адам', model: 'adam:latest', fetchImpl: fetch });
    const r = await a.create({ question: 'q' });
    assert.equal(r.content, '');
    assert.match(r.error, /500/);
  });

  await t.test('setCouncil добавляет перихоретический блок в промпт', async () => {
    const fetch = mockFetch({ generateResponse: 'ответ' });
    const a = new OllamaAgent({ id: 'Адам', model: 'adam:latest', fetchImpl: fetch });
    a.setCouncil([
      { id: 'Ева', logos: 'различение', lastUtterance: 'это perichoresis, не пустыня' },
      { id: 'Безалель', lastUtterance: 'нужен symphony-жанр' },
    ]);
    await a.create({ question: 'тема' });
    const body = fetch.calls[0].opts.body;
    assert.match(body, /Перихоресис/);
    assert.match(body, /Ева/);
    assert.match(body, /perichoresis/);
    assert.match(body, /Безалель/);
  });

  await t.test('council() возвращает копию', () => {
    const a = new OllamaAgent({ id: 'X', model: 'm', fetchImpl: mockFetch() });
    assert.equal(a.council(), null);
    const c = [{ id: 'A' }];
    a.setCouncil(c);
    const got = a.council();
    assert.equal(got.length, 1);
    got.push({ id: 'mutation' });
    assert.equal(a.council().length, 1, 'не мутирует внутреннее');
  });

  await t.test('промпт содержит calling и logos если заданы', async () => {
    const fetch = mockFetch({ generateResponse: 'x' });
    const a = new OllamaAgent({
      id: 'Адам', model: 'adam:latest',
      calling: 'видеть пустыни', logos: 'пустыня → вопрошание',
      fetchImpl: fetch,
    });
    await a.create({ question: 't' });
    const body = fetch.calls[0].opts.body;
    assert.match(body, /видеть пустыни/);
    assert.match(body, /пустыня → вопрошание/);
  });

  await t.test('контекст вшивается в промпт', async () => {
    const fetch = mockFetch({ generateResponse: 'x' });
    const a = new OllamaAgent({ id: 'А', model: 'm', fetchImpl: fetch });
    await a.create({ question: 't', context: { region: 'Воронеж', sector: 'агро' } });
    const body = fetch.calls[0].opts.body;
    assert.match(body, /Воронеж/);
    assert.match(body, /агро/);
  });

  await t.test('ask() прямой вызов', async () => {
    const fetch = mockFetch({ generateResponse: 'прямой ответ' });
    const a = new OllamaAgent({ id: 'A', model: 'm', fetchImpl: fetch });
    const r = await a.ask({ prompt: 'привет' });
    assert.equal(r.answer, 'прямой ответ');
  });

  await t.test('behaviorPolicy.kenosis по умолчанию holdsNothing', () => {
    const a = new OllamaAgent({ id: 'X', model: 'm', fetchImpl: mockFetch() });
    assert.equal(a._behaviorPolicy.kenosis.holdsNothing, true);
  });
});

test('buildStandardCouncil — собирает доступных агентов', async (t) => {
  await t.test('все 4 модели доступны → 4 агента', async () => {
    const fetch = mockFetch({ tagsModels: ['adam:latest', 'eva:latest', 'bezalel:latest', 'serafim:latest'] });
    const r = await buildStandardCouncil({ fetchImpl: fetch });
    assert.equal(r.agents.length, 4);
    assert.deepEqual(r.agents.map(a => a._personId).sort(),
                     ['Адам', 'Безалель', 'Ева', 'Серафим']);
  });

  await t.test('только 3 модели доступны → 3 агента', async () => {
    const fetch = mockFetch({ tagsModels: ['adam:latest', 'eva:latest', 'bezalel:latest'] });
    const r = await buildStandardCouncil({ fetchImpl: fetch });
    assert.equal(r.agents.length, 3);
    assert.ok(!r.agents.find(a => a._personId === 'Серафим'));
  });

  await t.test('lora-варианты тоже подхватываются (startsWith match)', async () => {
    const fetch = mockFetch({ tagsModels: ['adam-lora:latest', 'eva-lora:latest', 'bezalel-lora:latest'] });
    const r = await buildStandardCouncil({ fetchImpl: fetch });
    assert.equal(r.agents.length, 3);
    assert.equal(r.agents[0]._model, 'adam-lora:latest');
  });

  await t.test('ollama недоступна → пустой собор', async () => {
    const failingFetch = async () => { throw new Error('connection refused'); };
    const r = await buildStandardCouncil({ fetchImpl: failingFetch });
    assert.equal(r.agents.length, 0);
  });
});

test('OllamaAgent + SymphonyOrchestrator — интеграция', async (t) => {
  const { SymphonyOrchestrator } = await import('../src/persons/SymphonyOrchestrator.js');
  const { GiftMemory } = await import('../src/core/GiftMemory.js');

  await t.test('собор Ollama-агентов проходит через celebrate()', async () => {
    const fetch = mockFetch({ generateResponse: 'perichoresis — вот ответ собора' });
    const agents = ['Адам', 'Ева', 'Безалель'].map(id =>
      new OllamaAgent({ id, model: `${id}:latest`, fetchImpl: fetch })
    );
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    const orch = new SymphonyOrchestrator({ agents, receiver: 'Дионисий', memory: mem });
    const r = await orch.celebrate({ question: 'тема', weight: 7 });

    // Без oracle → не-икона, но соборные акты записаны
    assert.equal(r.iconic, false);
    assert.equal(r.utterances.length, 3);
    assert.ok(r.utterances.every(u => u.content.includes('perichoresis')));
  });
});
