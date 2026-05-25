#!/usr/bin/env node
/**
 * Тест социальной среды — 4 агента, 50 тиков, все 6 компонентов
 */

import IrreversibleEnvironment from './SocialEnvironment.js';

const env = new IrreversibleEnvironment();

// Добавляем агентов
env.addAgent('producer', 'Производитель');
env.addAgent('operator', 'Оператор');
env.addAgent('regulator', 'Регулятор');
env.addAgent('investor', 'Инвестор');

// Подписка на события
env.events.on('cycle', ({ phase, tick }) => {
  if (phase !== 'work' && phase !== 'hesychia')
    console.log(`  [tick ${tick}] ${phase}`);
});
env.events.on('dilemma:start', ({ dilemma }) => console.log(`  ⛬ Дилемма: ${dilemma}`));
env.events.on('role:changed', ({ agentId, from, to }) => console.log(`  🔄 ${agentId}: ${from} → ${to}`));
env.events.on('jubilee:forgiveness', ({ from, to }) => console.log(`  🕊 Юбилей: ${from} прощает ${to}`));

console.log('\n═══ СИМУЛЯЦИЯ СОЦИАЛЬНОЙ СРЕДЫ ═══\n');
console.log('Агенты:', [...env.agents.keys()].join(', '));
console.log('');

// 50 тиков
for (let i = 0; i < 50; i++) {
  const state = env.step();

  // Если дилемма — симулируем выборы агентов
  if (state.dilemma) {
    const agents = [...env.agents.values()];
    // Производитель обычно сотрудничает
    env.recordDilemmaResult('producer', Math.random() > 0.2 ? 'cooperate' : 'defect', state.dilemma.id);
    // Оператор сотрудничает
    env.recordDilemmaResult('operator', Math.random() > 0.3 ? 'cooperate' : 'defect', state.dilemma.id);
    // Регулятор осторожен
    env.recordDilemmaResult('regulator', Math.random() > 0.5 ? 'cooperate' : 'defect', state.dilemma.id);
    // Инвестор часто предаёт
    env.recordDilemmaResult('investor', Math.random() > 0.6 ? 'cooperate' : 'defect', state.dilemma.id);
  }
}

// Юродивый бросает вызов
const challenge = env.challengeConsensus('Нужно субсидировать БАС', { topic: 'госзаказ' });
console.log(`\n${challenge.icon} Юродивый: ${challenge.message}`);

// Прогоним ещё 55 тиков до юбилея (tick 100)
for (let i = 0; i < 55; i++) env.step();

// Статистика
const stats = env.getStats();
console.log('\n═══ РЕЗУЛЬТАТЫ ═══\n');
console.log(`Тиков: ${stats.tick}`);
console.log(`Фаза: ${stats.phase}`);
console.log(`Актов в памяти: ${stats.acts}`);
console.log(`Кооперации: ${stats.totalCooperations}`);
console.log(`Предательства: ${stats.totalDefections}`);
console.log(`Юродивый: ${JSON.stringify(stats.foolRecord)}`);
console.log('\nРоли:');
Object.entries(stats.roles).forEach(([id, role]) => {
  const trust = env.memory.getTrust(id, '_sobor');
  const rec = env.memory.recommend(id, Object.keys(stats.roles).find(k => k !== id));
  console.log(`  ${id}: ${role} (trust: ${trust}, rec: ${rec.action} — ${rec.reason})`);
});

// Доверие между агентами
console.log('\nМатрица доверия:');
const ids = [...env.agents.keys()];
ids.forEach(from => {
  const row = ids.map(to => from === to ? '  ·' : String(env.memory.getTrust(from, to)).padStart(3));
  console.log(`  ${from.padEnd(12)} ${row.join(' ')}`);
});
