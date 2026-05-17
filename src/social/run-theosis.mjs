#!/usr/bin/env node
/**
 * Запуск θέωσις — полный цикл углубления
 *
 * 5 сценариев → 5 отпечатков → мета-собор → формула
 */

import Theosis from './Theosis.js';
import { writeFileSync, mkdirSync } from 'fs';

const theosis = new Theosis();

// Логирование
theosis.on('theosis:start', ({ scenarios }) => {
  console.log(`\n⛬ ΘΕΩΣΙΣ — ${scenarios} сценариев\n`);
});

theosis.on('scenario:start', ({ step, scenario }) => {
  console.log(`  [${step}] ${scenario}...`);
});

theosis.on('scenario:done', ({ step, fingerprint: fp }) => {
  console.log(`      ✓ ${fp.acts} актов | coop ${(fp.cooperationRate*100).toFixed(0)}% | depth ${fp.depth.composite}`);
  console.log(`        roles: ${JSON.stringify(fp.roles)}`);
  console.log(`        norms: ${fp.norms.map(n => n.kind+'('+n.adoption+')').join(', ') || 'нет'}`);
  console.log(`        immunity: ${fp.depth.immunity} | gratitude: ${fp.depth.gratitude}`);
});

theosis.on('meta:done', (formula) => {
  console.log(`\n═══ МЕТА-СОБОР ═══\n`);
  console.log(`  Сред: ${formula.environments}`);
  console.log(`  Универсальные нормы: ${formula.universal.join(', ')}`);
  console.log(`  Контекстуальные: ${formula.contextual.join(', ') || 'нет'}`);
  console.log(`  Лучшая: ${formula.best.scenario} (${formula.best.composite})`);
  console.log(`  Худшая: ${formula.worst.scenario} (${formula.worst.composite})`);
  console.log(`  Вердикт: ${formula.verdict}`);
  console.log(`\n  Средние метрики:`);
  Object.entries(formula.avgDepth).forEach(([k, v]) => {
    const bar = '█'.repeat(Math.round(v * 20)) + '░'.repeat(20 - Math.round(v * 20));
    console.log(`    ${k.padEnd(18)} ${bar} ${v}`);
  });
  console.log(`\n  Различение (лучшая - худшая):`);
  Object.entries(formula.distinction).forEach(([k, v]) => {
    const sign = v > 0 ? '+' : '';
    console.log(`    ${k.padEnd(18)} ${sign}${v}`);
  });
});

theosis.on('theosis:done', ({ fingerprints, formula }) => {
  console.log(`\n═══ ΘΕΩΣΙΣ ЗАВЕРШЁН ═══`);
  console.log(`  Отпечатков: ${fingerprints.length}`);
});

// Запуск
console.log('Запуск θέωσις...');
const result = await theosis.run();

// Сохранение
mkdirSync('data/theosis', { recursive: true });
const fname = `data/theosis/theosis-${Date.now()}.json`;
writeFileSync(fname, JSON.stringify(result, null, 2));
console.log(`\n📄 Сохранено: ${fname}`);

// Отпечатки отдельно для визуализации
result.fingerprints.forEach((fp, i) => {
  writeFileSync(`data/theosis/fingerprint-${i+1}-${fp.scenario}.json`, JSON.stringify(fp, null, 2));
});
console.log(`📊 ${result.fingerprints.length} отпечатков сохранены отдельно`);
