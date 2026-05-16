#!/usr/bin/env node
/**
 * kairos-forecast.mjs — что ждёт общину в ближайшие N дней.
 *
 * Проекция литургического горизонта: посты, праздники, воскресенья,
 * дни Пасхи и Пятидесятницы. Для #61 (long-horizon decomposer) — горизонт,
 * по которому раскладываются шаги дарения.
 *
 * Использование:
 *   node utils/kairos-forecast.mjs                # 40 дней
 *   node utils/kairos-forecast.mjs --days 70
 *   node utils/kairos-forecast.mjs --json         # машиночитаемо
 *   node utils/kairos-forecast.mjs --only-kairos  # только καιρός-дни
 */

import { EschatonClock } from '../src/theology/EschatonClock.js';
import { Kairology } from '../src/theology/Kairology.js';

const args = process.argv.slice(2);
function flag(name) { return args.includes(name); }
function value(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const days = Math.max(1, parseInt(value('--days', '40'), 10));
const asJson = flag('--json');
const onlyKairos = flag('--only-kairos');

const now = new Date();
const clock = new EschatonClock(now);
const forecast = clock.forecast(days);
const filtered = onlyKairos
  ? forecast.filter((d) => d.mode === 'kairos' || d.highFeast)
  : forecast;

if (asJson) {
  const kairology = new Kairology(now);
  console.log(JSON.stringify({
    now: kairology.now(),
    horizonDays: days,
    forecast: filtered,
  }, null, 2));
  process.exit(0);
}

// ── Человекочитаемый отчёт ────────────────────────────────────────────────

const kairology = new Kairology(now);
const ctx = kairology.now();

const icon = {
  chronos: '·',
  kairos:  '✦',
  aion:    '☀',
};
const seasonName = {
  paschal: 'Пасха',
  lent:    'Великий пост',
  advent:  'Рождественский пост',
  svyatki: 'Святки',
  'dormition-fast':  'Успенский пост',
  'apostles-fast':   'Петров пост',
};
const highFeastName = {
  pascha:    '★ ПАСХА ★',
  pentecost: '★ ПЯТИДЕСЯТНИЦА ★',
};

console.log('\n═══ КАЙРОС-ГОРИЗОНТ ═══\n');
console.log(`Сейчас: ${ctx.at}`);
console.log(`Модус:  ${icon[ctx.mode]} ${ctx.mode}`);
console.log(`Сезон:  ${ctx.season ? seasonName[ctx.season] || ctx.season : '—'}`);
console.log(`Радость: ${ctx.joy}`);
console.log(`Фаза:   ${ctx.phase} (следующая: ${ctx.nextPhase} через ${ctx.nextPhaseInMinutes} мин)`);
console.log(`Суббота: ${ctx.sabbath} (интенсивность ${ctx.sabbathIntensity})`);
if (ctx.highFeast) console.log(`\n  ${highFeastName[ctx.highFeast]}`);
console.log();

console.log(`Горизонт ${days} дней:\n`);
const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
for (const d of filtered) {
  const date = new Date(d.date + 'T00:00:00Z');
  const dn = dayNames[date.getUTCDay()];
  const mark = d.highFeast
    ? highFeastName[d.highFeast]
    : d.mode === 'kairos'
      ? `✦ καιρός ${d.kairosName || ''}`.trim()
      : '  χρόνος';
  const season = d.season ? `  [${seasonName[d.season] || d.season}]` : '';
  console.log(`  ${d.date} ${dn}  ${mark}${season}`);
}

// Следующая Пасха, если не в пасхальном периоде сейчас
if (ctx.season !== 'paschal' && !filtered.some((d) => d.highFeast === 'pascha')) {
  const y = now.getUTCFullYear();
  const { orthodoxPascha } = await import('../src/theology/Paschalia.js');
  const next = orthodoxPascha(y + 1);
  console.log(`\n★ Следующая Пасха вне горизонта: ${next.toISOString().slice(0, 10)}`);
}

console.log();
