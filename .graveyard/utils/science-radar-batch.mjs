#!/usr/bin/env node
/**
 * science-radar-batch.mjs — массовый поиск прорывов
 *
 * Прогоняет ScienceRadar по списку тем, собирает сводный рейтинг.
 * Темы — из файла (одна строка = один запрос) или встроенный набор.
 *
 * Использование:
 *   node utils/science-radar-batch.mjs                        # встроенные темы
 *   node utils/science-radar-batch.mjs --queries=my-list.txt  # из файла
 *   node utils/science-radar-batch.mjs --limit=20 --top=5     # опции
 *   node utils/science-radar-batch.mjs --out=results.json     # сохранить
 *   node utils/science-radar-batch.mjs --domain=energy        # предустановка
 *
 * Предустановки (--domain):
 *   energy      — новые источники энергии
 *   computing   — вычислительные парадигмы
 *   bio         — биотехнологии
 *   materials   — новые материалы
 *   drones      — БПЛА и роевые системы
 *   all         — всё (долго)
 */

import { ScienceRadar } from '../src/science/ScienceRadar.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ── Предустановленные области ─────────────────────────────────────────────

const DOMAINS = {
  energy: [
    'perovskite solar cell efficiency',
    'solid state battery electrolyte',
    'hydrogen fuel cell membrane',
    'thermoelectric energy harvesting',
    'vanadium flow battery grid storage',
  ],
  computing: [
    'neuromorphic computing spike neural',
    'photonic integrated circuit computing',
    'quantum error correction surface code',
    'in-memory computing resistive RAM',
    'optical neural network inference',
  ],
  bio: [
    'mRNA therapeutic cancer delivery',
    'CRISPR base editing precision',
    'organoid brain on chip',
    'DNA data storage synthesis',
    'microbiome therapy clinical',
  ],
  materials: [
    'topological insulator quantum transport',
    'MXene two-dimensional material',
    'metamaterial acoustic control',
    'graphene biological sensor',
    'amorphous metal glass toughness',
  ],
  drones: [
    'drone swarm coordination emergent',
    'UAV formation control distributed',
    'multi-agent reinforcement learning aerial',
    'FPGA onboard drone navigation',
    'bio-inspired UAV flapping wing',
  ],
};

DOMAINS.all = Object.values(DOMAINS).flat();

// ── Аргументы ─────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const limit   = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1]   ?? '20');
const topN    = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1]     ?? '3');
const minYear = parseInt(args.find(a => a.startsWith('--min-year='))?.split('=')[1] ?? '2015');
const outFile = args.find(a => a.startsWith('--out='))?.split('=')[1] ?? null;
const domain  = args.find(a => a.startsWith('--domain='))?.split('=')[1] ?? 'energy';
const qFile   = args.find(a => a.startsWith('--queries='))?.split('=')[1] ?? null;
const pause   = parseInt(args.find(a => a.startsWith('--pause='))?.split('=')[1]  ?? '3000'); // между темами

// ── Список тем ────────────────────────────────────────────────────────────

let queries;
if (qFile) {
  if (!existsSync(qFile)) { console.error(`Файл не найден: ${qFile}`); process.exit(1); }
  queries = readFileSync(qFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
} else {
  queries = DOMAINS[domain] ?? DOMAINS.energy;
}

// ── Вывод ─────────────────────────────────────────────────────────────────

function bar(score, max, width = 16) {
  if (max <= 0) return '░'.repeat(width);
  const filled = Math.round((score / max) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Главный цикл ─────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(62));
  console.log('  Радар прорывов — массовый поиск');
  console.log(`  Область: ${qFile ? qFile : domain} | Тем: ${queries.length}`);
  console.log(`  Статей/тема: ${limit} | Топ/тема: ${topN} | С ${minYear} года`);
  console.log('═'.repeat(62));

  const allResults = []; // { query, paper }
  let   queryDone  = 0;

  for (const query of queries) {
    queryDone++;
    console.log(`\n[${queryDone}/${queries.length}] ${query}`);

    try {
      const radar   = new ScienceRadar(query, { limit, minYear });
      const results = await radar.run();
      const top     = results.filter(r => r.breakScore > 0).slice(0, topN);

      if (top.length) {
        for (const paper of top) {
          allResults.push({ query, ...paper });
        }
        for (const r of top) {
          console.log(`  ${r.breakScore.toFixed(2)} | [${r.year}] ${r.title}`);
          console.log(`         surplus:${r.surplus} cross:${r.crossDomains} cited:${r.globalCited}`);
        }
      } else {
        console.log('  (нет кандидатов в этой теме)');
      }
    } catch (e) {
      console.error(`  Ошибка: ${e.message}`);
    }

    if (queryDone < queries.length) {
      process.stdout.write(`  пауза ${pause / 1000}s перед следующей темой...\r`);
      await sleep(pause);
    }
  }

  // ── Сводный рейтинг ───────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(62));
  console.log('  СВОДНЫЙ РЕЙТИНГ — ТОП ПРОРЫВНЫХ КАНДИДАТОВ');
  console.log('═'.repeat(62));

  // Дедупликация по id
  const seen = new Set();
  const dedup = allResults.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  dedup.sort((a, b) => b.breakScore - a.breakScore);
  const maxScore = dedup[0]?.breakScore ?? 1;

  if (!dedup.length) {
    console.log('\n  Нет кандидатов. Увеличь --limit или расширь --domain.');
  } else {
    dedup.slice(0, 15).forEach((r, i) => {
      const medal = i === 0 ? '◆' : i < 3 ? '◇' : '·';
      console.log(`\n${medal} #${i + 1}  breakScore: ${r.breakScore}  ${bar(r.breakScore, maxScore)}`);
      console.log(`   [${r.year}] ${r.title}`);
      console.log(`   Тема: ${r.query}`);
      console.log(`   Области: ${r.fields || '—'}`);
      console.log(`   surplus:${r.surplus >= 0 ? '+' : ''}${r.surplus}  кросс-домен:${r.crossDomains}  глоб.цитирований:${r.globalCited}`);
      if (r.abstract) console.log(`   ${r.abstract.slice(0, 130)}...`);
    });
  }

  // ── Аналитика ─────────────────────────────────────────────────────────

  if (dedup.length) {
    const avgScore   = dedup.reduce((s, r) => s + r.breakScore, 0) / dedup.length;
    const highCross  = dedup.filter(r => r.crossDomains >= 5).length;
    const lowCited   = dedup.filter(r => r.globalCited < 100).length;
    const trueNakamura = dedup.filter(r => r.surplus > 0 && r.crossDomains > 0 && r.globalCited < 200).length;

    console.log('\n' + '─'.repeat(62));
    console.log('  Статистика:');
    console.log(`  Всего кандидатов:    ${dedup.length}`);
    console.log(`  Средний breakScore:  ${avgScore.toFixed(2)}`);
    console.log(`  Высокий кросс-домен (≥5): ${highCross}`);
    console.log(`  Мало признания (<100 цит): ${lowCited}`);
    console.log(`  Истинный паттерн Накамуры: ${trueNakamura}`);
    console.log('─'.repeat(62));
  }

  // ── Сохранение ────────────────────────────────────────────────────────

  if (outFile) {
    const output = {
      runAt:   new Date().toISOString(),
      domain,
      queries,
      params:  { limit, minYear, topN },
      results: dedup,
    };
    writeFileSync(outFile, JSON.stringify(output, null, 2));
    console.log(`\nСохранено: ${outFile} (${dedup.length} статей)`);
  }

  console.log('\nΘεωρία: наука — поле даров. Накамура был там всегда.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
