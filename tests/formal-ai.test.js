import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksDeterministic, route, formalAvailable, askFormal } from '../utils/formal-ai.mjs';

test('looksDeterministic: ловит счёт/процент/валюту/арифметику', () => {
  for (const p of ['What is 8% of $50?', 'Посчитай 1000 рублей в долларах', '15 percent of 200',
                   '2 + 2', 'convert 5 EUR', 'сколько будет 100 USD']) {
    assert.equal(looksDeterministic(p), true, `должно сработать: ${p}`);
  }
});

test('looksDeterministic: НЕ ловит семантику/общее', () => {
  for (const p of ['Напиши спецификацию дара', 'Why is the sky blue?', 'объясни кеносис']) {
    assert.equal(looksDeterministic(p), false, `не должно: ${p}`);
  }
});

test('route: семантика идёт в LLM', async () => {
  const r = await route('объясни кеносис', { llm: async () => 'кеносис — самоумаление' });
  assert.equal(r.source, 'llm');
  assert.equal(r.deterministic, false);
});

test('route: без LLM и без formal — source none', async () => {
  const r = await route('объясни кеносис', {});
  assert.equal(r.source, 'none');
});

// Интеграционный — только если бинарь Кости собран (graceful skip)
test('askFormal: детерминированный ответ на проценты (если собран)', { skip: !formalAvailable() }, () => {
  const a = askFormal('What is 8% of $50?');
  assert.match(a, /4\s*USD/);
});

test('route: детерминированный вопрос идёт в formal-ai (если собран)', { skip: !formalAvailable() }, async () => {
  const r = await route('What is 8% of $50?', { llm: async () => 'НЕ ДОЛЖНО' });
  assert.equal(r.source, 'formal-ai');
  assert.match(r.answer, /4\s*USD/);
});
