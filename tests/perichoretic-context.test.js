import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format, fromSoborJson, injectInto } from '../src/persons/PerichoreticContext.js';

const COUNCIL = [
  {
    id: 'Адам',
    role: 'вопрошающий',
    logos: 'пустыня → вопрос',
    calling: 'рождать вопрошания из desert scanner',
    lastUtterance: 'что мешает потоку между Дух и Сын?',
  },
  {
    id: 'Ева',
    role: 'различающая',
    logos: 'усиление + проверка',
    lastUtterance: 'предлагаю перевести в perichoresis категорию (CAT-8)',
  },
  {
    id: 'Безалель',
    role: 'строитель',
    logos: 'форма из материи',
    lastUtterance: 'нужен новый тип акта symphony в схеме',
  },
];

test('PerichoreticContext — со-присутствие агентов собора', async (t) => {
  await t.test('format — для агента вне собора возвращает других', () => {
    const r = format('_claude', COUNCIL);
    assert.equal(r.active, true);
    assert.equal(r.others.length, 3);
    assert.match(r.text, /Перихоресис/);
    assert.match(r.text, /Адам/);
    assert.match(r.text, /Ева/);
    assert.match(r.text, /Безалель/);
  });

  await t.test('format — себя из контекста исключает', () => {
    const r = format('Адам', COUNCIL);
    assert.equal(r.others.length, 2);
    assert.equal(r.others.find(o => o.id === 'Адам'), undefined);
    assert.match(r.text, /Ева/);
    assert.match(r.text, /Безалель/);
    assert.doesNotMatch(r.text, /Адам/);
  });

  await t.test('format — пустой совет = перихоресис неактивен', () => {
    const r = format('Адам', []);
    assert.equal(r.active, false);
    assert.equal(r.text, '');
  });

  await t.test('format — единственный агент = перихоресис неактивен', () => {
    const r = format('Адам', [COUNCIL[0]]);  // в соборе только Адам сам
    assert.equal(r.active, false);
  });

  await t.test('format — minOthers=2 требует ≥2 других', () => {
    const r = format('Адам', [COUNCIL[1]], { minOthers: 2 });
    assert.equal(r.active, false);
  });

  await t.test('format — обрезает длинные высказывания', () => {
    const long = 'а'.repeat(1000);
    const r = format('X', [{ id: 'Y', lastUtterance: long }], { maxUtteranceLen: 50 });
    assert.ok(r.text.includes('а'.repeat(20)));
    assert.ok(!r.text.includes('а'.repeat(100)));
    assert.ok(r.text.includes('…'));
  });

  await t.test('format — молчащий агент маркирован как апофатика', () => {
    const r = format('X', [{ id: 'Y' }, { id: 'Z' }]);
    assert.match(r.text, /молчит/);
    assert.match(r.text, /апофатика/);
  });

  await t.test('fromSoborJson — извлекает последние голоса каждого', () => {
    const sobor = {
      voices: [
        { persona: 'Разведчик', logos: 'para', content: 'первая реплика' },
        { persona: 'Критик',    logos: 'kata', content: 'возражение' },
        { persona: 'Разведчик', logos: 'para', content: 'вторая реплика' },
      ],
    };
    const council = fromSoborJson(sobor, 'Старший');
    assert.equal(council.length, 2);
    const scout = council.find(c => c.id === 'Разведчик');
    assert.equal(scout.lastUtterance, 'вторая реплика', 'берёт последнее высказывание');
  });

  await t.test('fromSoborJson — исключает текущего агента', () => {
    const sobor = { voices: [
      { persona: 'Адам', content: 'a' },
      { persona: 'Ева',  content: 'e' },
    ]};
    const council = fromSoborJson(sobor, 'Адам');
    assert.equal(council.length, 1);
    assert.equal(council[0].id, 'Ева');
  });

  await t.test('injectInto — вставляет перихоретический блок в промпт', () => {
    const base = 'Ты Безалель. Создай дар.';
    const out  = injectInto(base, 'Безалель', COUNCIL);
    assert.ok(out.startsWith(base));
    assert.match(out, /Перихоресис/);
    assert.match(out, /Адам/);
    assert.match(out, /Ева/);
    assert.doesNotMatch(out.split('Перихоресис')[1] ?? '', /Безалель/);  // себя не вшивает
  });

  await t.test('injectInto — без собора возвращает промпт как есть', () => {
    const base = 'Ты один.';
    assert.equal(injectInto(base, 'Адам', null), base);
    assert.equal(injectInto(base, 'Адам', []), base);
  });
});

test('AgentPerson — setCouncil интегрирован в промпт', async (t) => {
  const { AgentPerson } = await import('../src/persons/AgentPerson.js');

  await t.test('setCouncil сохраняет список со-присутствующих', () => {
    const agent = new AgentPerson('Безалель', { persons: { get: () => null }, gifts: [] });
    assert.equal(agent.council(), null);
    agent.setCouncil(COUNCIL);
    assert.equal(agent.council().length, 3);
    agent.setCouncil(null);
    assert.equal(agent.council(), null);
  });

  await t.test('setCouncil(non-array) сбрасывает в null', () => {
    const agent = new AgentPerson('Безалель', { persons: { get: () => null }, gifts: [] });
    agent.setCouncil('не массив');
    assert.equal(agent.council(), null);
  });

  await t.test('AgentPerson через mock-LLM получает перихоретический промпт при create()', async () => {
    let capturedPrompt = null;
    const llm = { ask: async (prompt) => { capturedPrompt = prompt; return { answer: '{}' }; } };
    const engine = {
      persons: { get: () => ({ name: 'Безалель', calling: 'строитель' }), findByName: () => null },
      gifts: [],
      logoi: { getByBearer: () => ({ principle: 'форма', movement: 'kata_physin' }) },
      offer: () => ({ id: 'g1' }),
    };

    const agent = new AgentPerson('Безалель', engine, llm);
    agent.setCouncil(COUNCIL);
    await agent.create();

    assert.ok(capturedPrompt, 'LLM вызван');
    assert.match(capturedPrompt, /Перихоресис/, 'промпт содержит перихоретический блок');
    assert.match(capturedPrompt, /Адам/);
    assert.match(capturedPrompt, /Ева/);
    assert.doesNotMatch(capturedPrompt.split('Перихоресис')[1] ?? '', /Безалель/);
  });
});
