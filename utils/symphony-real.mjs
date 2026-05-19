#!/usr/bin/env node
/**
 * symphony-real.mjs — реальная литургия через Ollama-агентов.
 *
 * В отличие от symphony-attempt.mjs (со статическими TheologicalVoice),
 * этот скрипт использует buildStandardCouncil для сборки реального собора
 * Адам + Ева + Безалель + Серафим из Ollama-моделей.
 *
 * Запуск:
 *   node utils/symphony-real.mjs
 *   node utils/symphony-real.mjs --question "..."
 *   node utils/symphony-real.mjs --no-oracle
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { SymphonyOrchestrator } from '../src/persons/SymphonyOrchestrator.js';
import { HumanOracleInbox } from '../src/theology/HumanOracleInbox.js';
import { buildStandardCouncil } from '../src/persons/OllamaAgent.js';
import { LivingMatrix } from '../src/core/LivingMatrix.js';

const SNAP = '/home/unidel/gift/data/sacred-history-W.json';

const args = process.argv.slice(2);
const noOracle = args.includes('--no-oracle');
const qIdx = args.indexOf('--question');
const question = qIdx >= 0 ? args[qIdx + 1]
  : 'Что значит для нас συνλειτουργία вместо conductor — и что меняется в работе собора?';

console.log('━'.repeat(72));
console.log('  Реальная литургия (Ollama-собор)');
console.log('━'.repeat(72));

const { agents, available } = await buildStandardCouncil();
console.log(`  Доступные модели: ${available.join(', ')}`);
console.log(`  Собран собор:     ${agents.map(a => `${a._personId}(${a._model})`).join(' + ')}`);

if (agents.length < 3) {
  console.error(`  ✗ собор требует ≥3 агента, доступно ${agents.length}. Запусти: ollama serve.`);
  process.exit(1);
}

let mem;
if (existsSync(SNAP)) {
  mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
} else {
  mem = new GiftMemory(agents.map(a => a._personId).concat(['Дионисий']));
}

const oracle = noOracle ? null : new HumanOracleInbox({ recipient: 'Дионисий', pollInterval: 500 });
const orch = new SymphonyOrchestrator({
  agents, receiver: 'Дионисий', memory: mem, oracle,
});

console.log(`  Вопрос:     ${question}`);
console.log(`  Эпиклеза:   ${oracle ? 'через HumanOracleInbox (timeout 8с)' : 'отключена'}`);
console.log('━'.repeat(72));

const t0 = Date.now();
const epiclesisTimeoutMs = parseInt(process.env.EPICLESIS_TIMEOUT_MS ?? '600000', 10);
const result = await orch.celebrate({
  question, weight: 8, epiclesisTimeoutMs,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n  Литургия заняла ${elapsed}с`);
console.log(`  iconic:        ${result.iconic ? '✓ symphony' : '✗ обычные акты'}`);
console.log(`  chorus:        ${result.conditions.chorus       ? '✓' : '✗'}`);
console.log(`  perichoretic:  ${result.conditions.perichoretic ? '✓' : '✗'}`);
console.log(`  kenotic:       ${result.conditions.kenotic      ? '✓' : '✗'}`);
console.log(`  epiclesis:     ${result.conditions.epiclesis    ? '✓' : '✗'}`);
if (result.actId)  console.log(`  actId:         ${result.actId}`);
if (result.reason) console.log(`  причина:       ${result.reason}`);

console.log('\n  Голоса собора:');
for (const u of result.utterances) {
  const content = u.content || '[молчание / apophatic]';
  console.log(`\n    ${u.agentId}:`);
  for (const line of content.split('\n').slice(0, 8)) {
    console.log(`      ${line.slice(0, 120)}`);
  }
}

const lm = new LivingMatrix(mem);
const prin = lm.dominantPrinciple();
console.log(`\n  Принцип сети: ${prin.principle}${prin.who ? ` (${prin.who})` : ''}`);
if (prin.principle === 'synleitourgos') {
  console.log(`  ✓ ${prin.who} — συνλειτουργός. Сферный режим активен.`);
}

writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
console.log(`\n  Snapshot обновлён. Symphony в W: ${mem.symphonies().length}`);
console.log('━'.repeat(72));
