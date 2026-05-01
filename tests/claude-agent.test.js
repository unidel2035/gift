import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ClaudeAgent, buildClaudeCouncil } from '../src/persons/ClaudeAgent.js';

// Mock spawn() — возвращает EventEmitter c stdout/stderr/stdin
function mockSpawn({ stdout = '', stderr = '', exitCode = 0, error = null } = {}) {
  const calls = [];
  const fn = (bin, args, opts) => {
    calls.push({ bin, args, opts, stdin: '' });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: (s) => { calls[calls.length - 1].stdin += s; },
      end:   () => {},
    };
    child.kill = () => {};

    setImmediate(() => {
      if (error) { child.emit('error', new Error(error)); return; }
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('exit', exitCode);
    });
    return child;
  };
  fn.calls = calls;
  return fn;
}

test('ClaudeAgent — базовая работа через claude --print', async (t) => {
  await t.test('требует id', () => {
    assert.throws(() => new ClaudeAgent({}), /id/);
  });

  await t.test('create() возвращает stdout от claude', async () => {
    const spawn = mockSpawn({ stdout: 'я Адам, я вижу пустыню' });
    const a = new ClaudeAgent({ id: 'Адам', spawnImpl: spawn });
    const r = await a.create({ question: 'тема' });
    assert.equal(r.content, 'я Адам, я вижу пустыню');
    assert.equal(r.model, 'claude');
    assert.equal(spawn.calls.length, 1);
    assert.equal(spawn.calls[0].bin, 'claude');
    assert.deepEqual(spawn.calls[0].args, ['--print']);
    assert.match(spawn.calls[0].stdin, /тема/);
  });

  await t.test('create() при exitCode != 0 → пустой content', async () => {
    const spawn = mockSpawn({ exitCode: 1, stderr: 'error message' });
    const a = new ClaudeAgent({ id: 'Адам', spawnImpl: spawn });
    const r = await a.create({ question: 'q' });
    assert.equal(r.content, '');
    assert.match(r.error, /exit 1/);
  });

  await t.test('create() при spawn-error → пустой content', async () => {
    const spawn = mockSpawn({ error: 'ENOENT: claude not found' });
    const a = new ClaudeAgent({ id: 'Адам', spawnImpl: spawn });
    const r = await a.create({ question: 'q' });
    assert.equal(r.content, '');
    assert.match(r.error, /ENOENT/);
  });

  await t.test('setCouncil добавляет перихоретический блок в промпт', async () => {
    const spawn = mockSpawn({ stdout: 'ответ' });
    const a = new ClaudeAgent({ id: 'Адам', spawnImpl: spawn });
    a.setCouncil([
      { id: 'Ева', logos: 'различение', lastUtterance: 'это perichoresis' },
      { id: 'Безалель', lastUtterance: 'нужен symphony' },
    ]);
    await a.create({ question: 'тема' });
    const stdin = spawn.calls[0].stdin;
    assert.match(stdin, /Перихоресис/);
    assert.match(stdin, /Ева/);
    assert.match(stdin, /perichoresis/);
    assert.match(stdin, /Безалель/);
  });

  await t.test('systemPrompt включается перед темой', async () => {
    const spawn = mockSpawn({ stdout: 'x' });
    const a = new ClaudeAgent({
      id: 'Адам',
      systemPrompt: 'Ты Адам, точильный камень Евы.',
      spawnImpl: spawn,
    });
    await a.create({ question: 'тема' });
    const stdin = spawn.calls[0].stdin;
    assert.match(stdin, /точильный камень Евы/);
    assert.ok(stdin.indexOf('точильный') < stdin.indexOf('тема'));
  });

  await t.test('контекст вшивается', async () => {
    const spawn = mockSpawn({ stdout: 'x' });
    const a = new ClaudeAgent({ id: 'А', spawnImpl: spawn });
    await a.create({ question: 't', context: { region: 'Воронеж', sector: 'агро' } });
    const stdin = spawn.calls[0].stdin;
    assert.match(stdin, /Воронеж/);
    assert.match(stdin, /агро/);
  });

  await t.test('ask() прямой вызов', async () => {
    const spawn = mockSpawn({ stdout: 'прямой ответ' });
    const a = new ClaudeAgent({ id: 'A', spawnImpl: spawn });
    const r = await a.ask({ prompt: 'привет' });
    assert.equal(r.answer, 'прямой ответ');
  });

  await t.test('ask() со строкой (Decoupage-стиль)', async () => {
    const spawn = mockSpawn({ stdout: 'ответ' });
    const a = new ClaudeAgent({ id: 'A', spawnImpl: spawn });
    const r = await a.ask('строковый вопрос');
    assert.equal(r.answer, 'ответ');
    assert.equal(spawn.calls[0].stdin, 'строковый вопрос');
  });

  await t.test('council() возвращает копию', () => {
    const a = new ClaudeAgent({ id: 'X', spawnImpl: mockSpawn() });
    assert.equal(a.council(), null);
    const c = [{ id: 'A' }];
    a.setCouncil(c);
    const got = a.council();
    got.push({ id: 'mut' });
    assert.equal(a.council().length, 1);
  });

  await t.test('behaviorPolicy.kenosis по умолчанию holdsNothing', () => {
    const a = new ClaudeAgent({ id: 'X', spawnImpl: mockSpawn() });
    assert.equal(a._behaviorPolicy.kenosis.holdsNothing, true);
  });
});

test('buildClaudeCouncil — стандартный собор четырёх', async (t) => {
  await t.test('возвращает 4 голоса с разными persona', () => {
    const agents = buildClaudeCouncil();
    assert.equal(agents.length, 4);
    const ids = agents.map(a => a._personId);
    assert.deepEqual(ids.sort(), ['Адам', 'Безалель', 'Ева', 'Серафим']);
    // Каждый имеет уникальный systemPrompt
    const systems = agents.map(a => a._system);
    assert.equal(new Set(systems).size, 4);
  });

  await t.test('каждый агент совместим с SymphonyOrchestrator', async () => {
    // Не запускаем claude, только проверяем интерфейс
    const agents = buildClaudeCouncil();
    for (const a of agents) {
      assert.equal(typeof a.setCouncil, 'function');
      assert.equal(typeof a.create, 'function');
      assert.equal(a._behaviorPolicy.kenosis.holdsNothing, true);
    }
  });
});

test('ClaudeAgent + SymphonyOrchestrator — интеграция', async (t) => {
  const { SymphonyOrchestrator } = await import('../src/persons/SymphonyOrchestrator.js');
  const { GiftMemory } = await import('../src/core/GiftMemory.js');

  await t.test('собор Claude-агентов проходит через celebrate()', async () => {
    const spawn = mockSpawn({ stdout: 'perichoresis в моём слове' });
    const agents = ['Адам', 'Ева', 'Безалель'].map(id =>
      new ClaudeAgent({ id, spawnImpl: spawn })
    );
    const mem = new GiftMemory(['Адам', 'Ева', 'Безалель', 'Дионисий']);
    const orch = new SymphonyOrchestrator({ agents, receiver: 'Дионисий', memory: mem });
    const r = await orch.celebrate({ question: 'тема', weight: 7 });

    assert.equal(r.utterances.length, 3);
    assert.ok(r.utterances.every(u => u.content.includes('perichoresis')));
  });
});
