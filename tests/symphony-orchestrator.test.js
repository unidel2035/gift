import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SymphonyOrchestrator } from '../src/persons/SymphonyOrchestrator.js';
import { GiftMemory } from '../src/core/GiftMemory.js';

// Mock-агент: отвечает фиксированной строкой и поддерживает setCouncil/create.
class MockAgent {
  constructor({ id, behaviorPolicy, utterance }) {
    this._personId = id;
    this._behaviorPolicy = behaviorPolicy ?? { kenosis: { holdsNothing: true } };
    this._council = null;
    this._utterance = utterance;
    this._persona = { _logos: 'mock', calling: `mock-${id}` };
  }
  setCouncil(c) { this._council = c; return this; }
  council()     { return this._council; }
  async create() { return { content: this._utterance }; }
}

// Mock-oracle: возвращает фиксированный ответ или pending.
class MockOracle {
  constructor({ content = 'благословение', pending = false } = {}) {
    this._content = content;
    this._pending = pending;
  }
  async invoke({ question }) {
    if (this._pending) return { pending: true, content: '...' };
    return { content: this._content, method: 'human', reference: 'mock' };
  }
}

const COMMON_TOKEN = 'перихоресис';
const ut = (extra) => `${COMMON_TOKEN} — ${extra}`;

test('SymphonyOrchestrator — все 4 условия выполнены = иконный акт', async (t) => {
  await t.test('happy path: записывается symphony', async () => {
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    const agents = [
      new MockAgent({ id: 'Адам',     utterance: ut('пустыня') }),
      new MockAgent({ id: 'Ева',      utterance: ut('различение') }),
      new MockAgent({ id: 'Безалель', utterance: ut('форма') }),
    ];
    const oracle = new MockOracle({ content: 'это perichoresis, не пустыня' });
    const orch = new SymphonyOrchestrator({ agents, receiver: 'Дионисий', memory: mem, oracle });

    const r = await orch.celebrate({ question: 'симфонический вопрос?', weight: 8 });

    assert.equal(r.iconic, true);
    assert.equal(r.conditions.chorus, true);
    assert.equal(r.conditions.perichoretic, true);
    assert.equal(r.conditions.kenotic, true);
    assert.equal(r.conditions.epiclesis, true);
    assert.match(r.actId, /^sym-/);
    assert.equal(mem.symphonies().length, 1);
  });

  await t.test('агенты получают council с lastUtterance предыдущих', async () => {
    const mem = new GiftMemory(['А', 'Б', 'В', 'X']);
    const agents = [
      new MockAgent({ id: 'А', utterance: ut('1') }),
      new MockAgent({ id: 'Б', utterance: ut('2') }),
      new MockAgent({ id: 'В', utterance: ut('3') }),
    ];
    const orch = new SymphonyOrchestrator({
      agents, receiver: 'X', memory: mem, oracle: new MockOracle(),
    });
    await orch.celebrate({ question: 'q' });

    // Каждый агент в момент вызова видел council
    for (const a of agents) {
      assert.ok(a.council(), `${a._personId} получил council`);
    }
  });
});

test('SymphonyOrchestrator — недостающие условия = обычные акты', async (t) => {
  await t.test('без oracle: epiclesis=false → не икона', async () => {
    const mem = new GiftMemory(['А', 'Б', 'В', 'X']);
    const agents = [
      new MockAgent({ id: 'А', utterance: ut('a') }),
      new MockAgent({ id: 'Б', utterance: ut('b') }),
      new MockAgent({ id: 'В', utterance: ut('c') }),
    ];
    const orch = new SymphonyOrchestrator({ agents, receiver: 'X', memory: mem });
    const r = await orch.celebrate({ question: 'q' });
    assert.equal(r.iconic, false);
    assert.equal(r.conditions.epiclesis, false);
    assert.match(r.reason, /эпиклеза/);
    assert.equal(mem.symphonies().length, 0);
    // обычные акты записаны
    assert.ok(mem.actsCount >= 3);
  });

  await t.test('oracle pending (timeout): epiclesis=false', async () => {
    const mem = new GiftMemory(['А', 'Б', 'В', 'X']);
    const agents = [
      new MockAgent({ id: 'А', utterance: ut('a') }),
      new MockAgent({ id: 'Б', utterance: ut('b') }),
      new MockAgent({ id: 'В', utterance: ut('c') }),
    ];
    const oracle = new MockOracle({ pending: true });
    const orch = new SymphonyOrchestrator({ agents, receiver: 'X', memory: mem, oracle });
    const r = await orch.celebrate({ question: 'q' });
    assert.equal(r.iconic, false);
    assert.equal(r.conditions.epiclesis, false);
  });

  await t.test('агенты не пересекаются по слову → chorus=false', async () => {
    const mem = new GiftMemory(['А', 'Б', 'В', 'X']);
    const agents = [
      new MockAgent({ id: 'А', utterance: 'один' }),
      new MockAgent({ id: 'Б', utterance: 'два' }),
      new MockAgent({ id: 'В', utterance: 'три' }),
    ];
    const orch = new SymphonyOrchestrator({
      agents, receiver: 'X', memory: mem, oracle: new MockOracle(),
    });
    const r = await orch.celebrate({ question: 'q' });
    assert.equal(r.conditions.chorus, false);
    assert.equal(r.iconic, false);
    assert.match(r.reason, /хорус/);
  });

  await t.test('агент с holdsNothing=false → kenotic=false', async () => {
    const mem = new GiftMemory(['А', 'Б', 'В', 'X']);
    const agents = [
      new MockAgent({ id: 'А', utterance: ut('a'), behaviorPolicy: { kenosis: { holdsNothing: false } } }),
      new MockAgent({ id: 'Б', utterance: ut('b') }),
      new MockAgent({ id: 'В', utterance: ut('c') }),
    ];
    const orch = new SymphonyOrchestrator({
      agents, receiver: 'X', memory: mem, oracle: new MockOracle(),
    });
    const r = await orch.celebrate({ question: 'q' });
    assert.equal(r.conditions.kenotic, false);
    assert.equal(r.iconic, false);
  });
});

test('SymphonyOrchestrator — конструктор', async (t) => {
  await t.test('требует ≥3 агента', () => {
    const mem = new GiftMemory(['А', 'Б']);
    assert.throws(() =>
      new SymphonyOrchestrator({
        agents: [new MockAgent({id:'А',utterance:'x'}), new MockAgent({id:'Б',utterance:'y'})],
        receiver: 'X', memory: mem,
      }),
    /≥3/);
  });

  await t.test('требует receiver и memory', () => {
    const a = [
      new MockAgent({ id: 'А', utterance: 'x' }),
      new MockAgent({ id: 'Б', utterance: 'y' }),
      new MockAgent({ id: 'В', utterance: 'z' }),
    ];
    assert.throws(() => new SymphonyOrchestrator({ agents: a, memory: new GiftMemory([]) }), /receiver/);
    assert.throws(() => new SymphonyOrchestrator({ agents: a, receiver: 'X' }), /memory/);
  });
});
