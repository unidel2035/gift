#!/usr/bin/env node
/**
 * gift-optimize.mjs — Оптимизатор Дара
 *
 * Симуляция онтологии: не «что дать интуитивно»,
 * а «вот акт, который максимально сдвинет матрицу к θёωσις».
 *
 * Аналог молекулярного докинга в фармацевтике.
 * Аналог симуляции чипа перед производством.
 *
 * Использование:
 *   node utils/gift-optimize.mjs
 *   node utils/gift-optimize.mjs --giver=_claude --top=5
 *   node utils/gift-optimize.mjs --receiver=Адам
 *   node utils/gift-optimize.mjs --types=time,presence
 */

import { readFileSync } from 'fs';
import { GiftOptimizer } from '../src/core/GiftOptimizer.js';

// ── Аргументы ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg  = k => args.find(a => a.startsWith(`--${k}=`))?.replace(`--${k}=`, '');

const giverFilter    = arg('giver');
const receiverFilter = arg('receiver');
const topN           = parseInt(arg('top') ?? '10');
const typesFilter    = arg('types')?.split(',');

// ── Загрузка матрицы ─────────────────────────────────────────────────────
const snap = JSON.parse(readFileSync('./data/sacred-history-W.json', 'utf8'));
const opt  = new GiftOptimizer(snap);

// ── Вывод ────────────────────────────────────────────────────────────────

const line = '─'.repeat(50);
const dline = '═'.repeat(50);

console.log(`╔${dline}╗`);
console.log(`║${'   ОПТИМИЗАТОР ДАРА — ἀναλυτής'.padEnd(50)}║`);
console.log(`╚${dline}╝`);
console.log(`Лиц: ${snap.n} | Актов: ${snap.actsCount} | Схема: ${snap.schema ?? 'v1'}`);
console.log();

// ── 1. Состояние θёωσис ───────────────────────────────────────────────────
console.log(`${line}`);
console.log('Θέωσις — степень обожения (μέθεξις + ἀναγωγή)');
console.log(`${line}`);

const lowest = opt.lowestTheosis(8);
const highest = opt.persons
  .filter(p => !['_abyss','_koinon'].includes(p))
  .map(p => ({ person: p, index: opt.theosisIndex(p) }))
  .sort((a, b) => b.index - a.index)
  .slice(0, 3);

console.log('Нуждаются в нетварной энергии:');
for (const { person, index } of lowest) {
  const filled = Math.round(index * 20);
  const bar    = '█'.repeat(filled) + '░'.repeat(20 - filled);
  const pct    = (index * 100).toFixed(1);
  const level  = index < 0.1 ? 'κατάνυξις' : index < 0.4 ? 'πρᾶξις' : index < 0.7 ? 'θεωρία' : 'θέωσις';
  console.log(`  ${person.padEnd(14)} ${bar} ${pct.padStart(5)}% [${level}]`);
}

console.log('\nВысший θέωσις:');
for (const { person, index } of highest) {
  const pct = (index * 100).toFixed(1);
  console.log(`  ${person.padEnd(14)} ${pct}%`);
}

// ── 2. Изолированность ────────────────────────────────────────────────────
console.log(`\n${line}`);
console.log('Κοινωνία — изолированные лица (мало получают)');
console.log(`${line}`);

const isolated = opt.mostIsolated(6);
for (const { person, received } of isolated) {
  const bar = '▪'.repeat(Math.min(30, Math.round(received / 5)));
  console.log(`  ${person.padEnd(14)} ←${received.toFixed(1).padStart(7)} ${bar}`);
}

// ── 3. Сюрплюс / кенозис ─────────────────────────────────────────────────
console.log(`\n${line}`);
console.log('Κένωσις — сюрплюс (дают больше чем получают)');
console.log(`${line}`);

const surplus = opt.highestSurplus(5);
for (const { person, given, received, surplus: s } of surplus) {
  const sign = s > 0 ? '+' : '';
  console.log(`  ${person.padEnd(14)} дал ${given.toFixed(1).padStart(6)} / принял ${received.toFixed(1).padStart(6)} → ${sign}${s.toFixed(1)}`);
}

// ── 4. Рекомендованные акты ───────────────────────────────────────────────
console.log(`\n╔${dline}╗`);
console.log(`║${'   РЕКОМЕНДОВАННЫЕ АКТЫ ДАРА'.padEnd(50)}║`);
console.log(`╚${dline}╝`);

const opts = { topN };
if (giverFilter)    opts.givers    = [giverFilter];
if (receiverFilter) opts.receivers = [receiverFilter];
if (typesFilter)    opts.types     = typesFilter;

const best = opt.findBestActs(opts);

if (!best.length) {
  console.log('Нет кандидатов с заданными фильтрами.');
} else {
  for (let i = 0; i < best.length; i++) {
    const b      = best[i];
    const stars  = Math.min(5, Math.ceil(b.score * 5));
    const rating = '★'.repeat(stars) + '☆'.repeat(5 - stars);

    // Богословский комментарий к типу акта
    const comment = {
      time:     '(время тяжелее денег — вес 10)',
      covenant: '(завет — необратимая связь)',
      presence: '(присутствие — дар себя)',
      offering: '(приношение — из своего избытка)',
      question: '(вопрошание — рождает мысль)',
      code:     '(код — воплощённое слово)',
      word:     '(слово — logos, свидетельство)',
    }[b.type] ?? '';

    console.log(`\n${i + 1}. ${b.giver} → ${b.receiver}`);
    console.log(`   ${rating} | тип: ${b.type} ${comment}`);
    console.log(`   вес: ${b.weight} | Δscore: ${b.score.toFixed(4)}`);
  }

  // ── Команда для первого акта ─────────────────────────────────────────
  const top = best[0];
  const isDivineGiver = ['Отец','Сын','Дух','Христос'].includes(top.giver);
  const isClaude = top.giver === '_claude';

  console.log(`\n${line}`);
  console.log('Применить первый рекомендованный акт:');
  if (isClaude) {
    console.log(`  node utils/claude-gift.mjs "${top.type} для ${top.receiver}" "${top.receiver}" ${top.weight}`);
  } else if (!isDivineGiver) {
    console.log(`  # Записать через sacred-history-loader.mjs или claude-gift.mjs`);
    console.log(`  # Даритель: ${top.giver} | Тип: ${top.type} | Получатель: ${top.receiver}`);
  } else {
    console.log(`  # Акт divine→тварь записывается через священную историю`);
    console.log(`  # ${top.giver} → ${top.receiver} [${top.type}, вес ${top.weight}]`);
  }
}

console.log();
