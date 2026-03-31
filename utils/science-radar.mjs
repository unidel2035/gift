#!/usr/bin/env node
/**
 * science-radar.mjs — CLI детектор научных прорывов
 *
 * Ищет статьи по паттерну Накамуры:
 *   высокий surplus цитирований + кросс-доменный вклад + низкое признание
 *   = потенциальный прорыв который мейнстрим пока игнорирует.
 *
 * Использование:
 *   node utils/science-radar.mjs "gallium nitride LED"
 *   node utils/science-radar.mjs "perovskite solar" --limit=60 --top=10
 *   node utils/science-radar.mjs "EUV lithography" --min-year=2010
 */

import { ScienceRadar } from '../src/science/ScienceRadar.mjs';

// ── Аргументы ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`
Детектор прорывов — паттерн Накамуры в науке

Использование:
  node utils/science-radar.mjs <запрос> [опции]

Опции:
  --limit=N      статей для анализа (по умолчанию: 40)
  --top=N        вывести топ-N результатов (по умолчанию: 8)
  --min-year=N   статьи не старше N года (по умолчанию: 2000)

Примеры:
  node utils/science-radar.mjs "gallium nitride LED"
  node utils/science-radar.mjs "mRNA vaccine delivery" --limit=60
  node utils/science-radar.mjs "transformer attention mechanism" --top=5
`);
  process.exit(0);
}

const query = args.find(a => !a.startsWith('--')) ?? '';
const limit   = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]   ?? '40');
const top     = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1]     ?? '8');
const minYear = parseInt(args.find(a => a.startsWith('--min-year='))?.split('=')[1] ?? '2000');

if (!query) {
  console.error('Нужен поисковый запрос. Например: node utils/science-radar.mjs "graphene transistor"');
  process.exit(1);
}

// ── Вывод ─────────────────────────────────────────────────────────────────

function bar(score, max, width = 20) {
  const filled = Math.round((score / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function printResult(r, rank, maxScore) {
  const medal = rank === 1 ? '◆' : rank === 2 ? '◇' : rank <= 5 ? '·' : ' ';
  console.log(`\n${medal} #${rank} breakScore: ${r.breakScore} ${bar(r.breakScore, maxScore)}`);
  console.log(`   ${r.title}`);
  console.log(`   ${r.year} | ${r.fields || '(поле не указано)'}`);
  console.log(`   дал идей: ${r.gifted} | получил: ${r.received} | surplus: ${r.surplus >= 0 ? '+' : ''}${r.surplus}`);
  console.log(`   кросс-доменов: ${r.crossDomains} | глобально процитирован: ${r.globalCited}`);
  if (r.abstract) {
    console.log(`   ${r.abstract.slice(0, 160)}...`);
  }
}

// ── Запуск ────────────────────────────────────────────────────────────────

async function main() {
  console.log('━'.repeat(60));
  console.log('  Радар прорывов — паттерн Накамуры');
  console.log('━'.repeat(60));
  console.log(`  Запрос: «${query}»`);
  console.log(`  Статей: ${limit} | Начиная с: ${minYear} | Топ: ${top}`);
  console.log('━'.repeat(60));

  const radar = new ScienceRadar(query, { limit, minYear });

  let results;
  try {
    results = await radar.run();
  } catch (e) {
    console.error('\nОшибка:', e.message);
    process.exit(1);
  }

  if (!results.length) {
    console.log('\nСтатьи не найдены. Попробуй другой запрос.');
    process.exit(0);
  }

  // Статьи с ненулевым breakScore
  const candidates = results.filter(r => r.breakScore > 0);
  const maxScore   = candidates[0]?.breakScore ?? 1;

  console.log(`\nПрорывных кандидатов: ${candidates.length} из ${results.length}`);
  console.log('━'.repeat(60));

  if (!candidates.length) {
    console.log('\nНе нашлось статей с кросс-доменными связями внутри набора.');
    console.log('Попробуй увеличить --limit или изменить запрос.');

    // Показать топ по surplus хотя бы
    console.log('\nСтатьи с наибольшим surplus цитирований (внутри набора):');
    results
      .filter(r => r.surplus > 0)
      .slice(0, 3)
      .forEach((r, i) => {
        console.log(`  ${i + 1}. [${r.year}] ${r.title}`);
        console.log(`     surplus: +${r.surplus} | globalCited: ${r.globalCited}`);
      });
    process.exit(0);
  }

  candidates.slice(0, top).forEach((r, i) => printResult(r, i + 1, maxScore));

  // Итог
  const topResult = candidates[0];
  console.log('\n' + '━'.repeat(60));
  console.log('  ПАТТЕРН НАКАМУРЫ:');
  console.log(`  Сильнейший кандидат: «${topResult.title}»`);
  console.log(`  ${topResult.year} | surplus=${topResult.surplus >= 0 ? '+' : ''}${topResult.surplus} | кросс-домен=${topResult.crossDomains} | цитирований=${topResult.globalCited}`);

  if (topResult.globalCited < 50 && topResult.surplus > 0) {
    console.log('\n  Сигнал сильный: высокий surplus + низкое глобальное признание.');
    console.log('  Возможно, это статья которую стоит читать сейчас, до того как все её прочитали.');
  } else if (topResult.crossDomains > 2) {
    console.log('\n  Статья мостит несколько дисциплин — признак нетривиального прорыва.');
  }

  console.log('━'.repeat(60));
  console.log('\nΘεωρία: наука — тоже поле даров.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
