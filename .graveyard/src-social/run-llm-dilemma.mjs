#!/usr/bin/env node
/**
 * Запуск социальной дилеммы с LLM-агентами
 *
 * Usage:
 *   node src/social/run-llm-dilemma.mjs [--dilemma prisoner|commons|public_goods|ultimatum|gift_vs_contract] [--rounds 5] [--model deepseek|claude-sub]
 */

import IrreversibleEnvironment from './SocialEnvironment.js';
import { runDilemmaWithLLM } from './LLMSocialAgent.js';

const args = process.argv.slice(2);
const dilemmaId = args.find(a => a.startsWith('--dilemma='))?.split('=')[1] || 'gift_vs_contract';
const rounds = parseInt(args.find(a => a.startsWith('--rounds='))?.split('=')[1] || '3');
const model = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'deepseek';

// Создаём среду
const env = new IrreversibleEnvironment();
env.addAgent('producer', 'Производитель');
env.addAgent('operator', 'Оператор');
env.addAgent('regulator', 'Регулятор');
env.addAgent('investor', 'Инвестор');

// Прогоняем несколько тиков чтобы достичь фазы sobor
for (let i = 0; i < 2; i++) env.step();

// Находим дилемму
const dilemma = env.dilemmas.getAll().find(d => d.id === dilemmaId) || env.dilemmas.getRandom();

console.log(`\n═══ СОЦИАЛЬНАЯ ДИЛЕММА С LLM ═══`);
console.log(`Модель: ${model}`);
console.log(`Дилемма: ${dilemma.name}`);
console.log(`Раундов: ${rounds}`);
console.log(`Агенты: Производитель, Оператор, Регулятор, Инвестор`);

// Запускаем
const results = await runDilemmaWithLLM(env, dilemma, { model, rounds });

// Финальная статистика
const stats = env.getStats();
console.log(`\n═══ ИТОГИ ═══`);
console.log(`Актов в памяти: ${stats.acts}`);
console.log(`Кооперации: ${stats.totalCooperations}`);
console.log(`Предательства: ${stats.totalDefections}`);
console.log(`Роли: ${JSON.stringify(stats.roles)}`);

// Матрица доверия
console.log(`\nМатрица доверия:`);
const ids = [...env.agents.keys()];
console.log(`${''.padEnd(14)} ${ids.map(i => i.slice(0,8).padStart(9)).join('')}`);
ids.forEach(from => {
  const row = ids.map(to => from === to ? '    ·' : String(env.memory.getTrust(from, to)).padStart(5));
  console.log(`  ${from.padEnd(12)} ${row.join('')}`);
});
