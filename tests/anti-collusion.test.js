import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveImmuneSystem } from '../src/social/CognitiveImmuneSystem.js';

describe('Анти-сговор — detectCollusion', () => {
  it('детектирует синхронное голосование незнакомцев (stranger_sync)', () => {
    const cis = new CognitiveImmuneSystem();
    const voices = [
      { persona: 'Алиса', logos: 'hyper', content: 'Принять план', authority: 3.0 },
      { persona: 'Борис', logos: 'hyper', content: 'Одобрить проект', authority: 2.5 },
    ];
    const wMatrix = { threads: [] }; // нет нитей между ними

    const result = cis.detectCollusion(voices, wMatrix);
    assert.ok(result.anomalies.length > 0);
    assert.equal(result.anomalies[0].type, 'stranger_sync');
    assert.ok(result.trustScore < 1.0);
  });

  it('не фиксирует аномалию когда нить сильная', () => {
    const cis = new CognitiveImmuneSystem();
    const voices = [
      { persona: 'Алиса', logos: 'hyper', content: 'Принять план', authority: 3.0 },
      { persona: 'Борис', logos: 'hyper', content: 'Одобрить проект', authority: 2.5 },
    ];
    const wMatrix = {
      threads: [{ from: 'Алиса', to: 'Борис', weight: 5.0 }],
    };

    const result = cis.detectCollusion(voices, wMatrix);
    const strangerAnoms = result.anomalies.filter(a => a.type === 'stranger_sync');
    assert.equal(strangerAnoms.length, 0);
  });

  it('детектирует текстовую близость (text_echo)', () => {
    const cis = new CognitiveImmuneSystem();
    const text = 'Предлагаю принять план интеграции роевого управления беспилотниками';
    const voices = [
      { persona: 'Алиса', logos: 'hyper', content: text, authority: 3.0 },
      { persona: 'Борис', logos: 'para', content: text + ' немедленно', authority: 2.5 },
    ];
    const wMatrix = { threads: [{ from: 'Алиса', to: 'Борис', weight: 10 }] };

    const result = cis.detectCollusion(voices, wMatrix);
    const echoAnoms = result.anomalies.filter(a => a.type === 'text_echo');
    assert.ok(echoAnoms.length > 0);
  });

  it('детектирует бот-паттерн по таймингу', () => {
    const cis = new CognitiveImmuneSystem();
    const now = Date.now();
    const voices = [
      { persona: 'Бот1', logos: 'hyper', content: 'Да', authority: 1, timestamp: now },
      { persona: 'Бот2', logos: 'hyper', content: 'Конечно', authority: 1, timestamp: now + 500 },
    ];
    const wMatrix = { threads: [{ from: 'Бот1', to: 'Бот2', weight: 5 }] };

    const result = cis.detectCollusion(voices, wMatrix);
    const botAnoms = result.anomalies.filter(a => a.type === 'bot_timing');
    assert.ok(botAnoms.length > 0);
    assert.ok(botAnoms[0].deltaMs < 2000);
  });

  it('trustScore < 0.3 при множественных аномалиях', () => {
    const cis = new CognitiveImmuneSystem();
    const text = 'Одинаковый текст голоса идентичный текст голоса';
    const now = Date.now();
    const voices = [
      { persona: 'X', logos: 'hyper', content: text, authority: 1, timestamp: now },
      { persona: 'Y', logos: 'hyper', content: text, authority: 1, timestamp: now + 100 },
    ];
    const wMatrix = { threads: [] }; // незнакомцы

    const result = cis.detectCollusion(voices, wMatrix);
    // stranger_sync + text_echo + bot_timing = 0.6 + 0.7 + 0.5 = 1.8 → trust ≈ 0
    assert.ok(result.trustScore < 0.3, `trustScore=${result.trustScore} должен быть < 0.3`);
    assert.ok(result.anomalies.length >= 3);
  });

  it('чистое голосование — trust = 1.0', () => {
    const cis = new CognitiveImmuneSystem();
    const voices = [
      { persona: 'А', logos: 'kata', content: 'Возражаю по пункту три', authority: 5 },
      { persona: 'Б', logos: 'hyper', content: 'Принять с учётом правок', authority: 4 },
      { persona: 'В', logos: 'para', content: 'Альтернативный подход через REST', authority: 3 },
    ];
    const wMatrix = {
      threads: [
        { from: 'А', to: 'Б', weight: 8 },
        { from: 'Б', to: 'В', weight: 6 },
        { from: 'А', to: 'В', weight: 4 },
      ],
    };

    const result = cis.detectCollusion(voices, wMatrix);
    assert.equal(result.anomalies.length, 0);
    assert.equal(result.trustScore, 1.0);
  });
});
