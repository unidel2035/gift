#!/usr/bin/env node
/**
 * gift-reg.mjs — CLI для REG (Registry Graph) Мета КБ
 *
 * Реестр-граф проектных решений. Не RAG, а REG — provenance + связи.
 *
 * Использование:
 *   node utils/gift-reg.mjs decide --project "Крыло БПЛА" \
 *     --domain "aerodynamics" --title "Профиль CLARK-Y" \
 *     --description "Выбран для подъёмной силы 5 кг" --by "Петров" \
 *     --team "Петров,Иванов"
 *
 *   node utils/gift-reg.mjs link --from dec-xxx --to dec-yyy --type compatible_with
 *   node utils/gift-reg.mjs anamnesis --query "композитное крыло" --domain "materials"
 *   node utils/gift-reg.mjs compat --teamA "Петров,Иванов" --teamB "Сидоров"
 *   node utils/gift-reg.mjs stats
 *   node utils/gift-reg.mjs demo   — загрузить демо-данные для прототипа
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const { DecisionGraph } = await import(resolve(ROOT, 'src/reg/DecisionGraph.js'));
  const reg = new DecisionGraph();

  const CMD = process.argv[2];

  // ── decide ──────────────────────────────────────────────────────────
  if (CMD === 'decide') {
    const get = (flag) => {
      const idx = process.argv.indexOf(flag);
      return idx >= 0 ? process.argv[idx + 1] : null;
    };
    const d = reg.recordDecision({
      project: get('--project') || 'general',
      domain: get('--domain') || 'general',
      title: get('--title') || 'Untitled',
      description: get('--description') || '',
      madeBy: get('--by') || 'unknown',
      team: (get('--team') || 'unknown').split(',').map(s => s.trim()),
      files: (get('--files') || '').split(',').map(s => s.trim()).filter(Boolean),
      verdict: get('--verdict') || 'decided',
      weight: parseFloat(get('--weight') || '1'),
    });
    console.log(JSON.stringify(d, null, 2));
    console.log(`  ✓ Решение записано: ${d.id}`);
    return;
  }

  // ── link ─────────────────────────────────────────────────────────────
  if (CMD === 'link') {
    const from = process.argv.find((_, i) => process.argv[i-1] === '--from');
    const to = process.argv.find((_, i) => process.argv[i-1] === '--to');
    const type = process.argv.find((_, i) => process.argv[i-1] === '--type') || 'compatible_with';
    if (!from || !to) { console.error('link --from <id> --to <id> --type <type>'); process.exit(1); }
    const link = reg.linkDecisions(from, to, type);
    console.log(JSON.stringify(link, null, 2));
    console.log(`  ✓ Связь: ${from} --[${type}]--> ${to}`);
    return;
  }

  // ── anamnesis ────────────────────────────────────────────────────────
  if (CMD === 'anamnesis') {
    const query = process.argv.find((_, i) => process.argv[i-1] === '--query') || '';
    const domain = process.argv.find((_, i) => process.argv[i-1] === '--domain');
    const project = process.argv.find((_, i) => process.argv[i-1] === '--project');
    const result = reg.anamnesis(query, { domain, project });
    console.log(JSON.stringify(result, null, 2));

    if (result.previousWork.length > 0) {
      console.log(`\n  Анамнезис запроса "${query}":`);
      console.log(`  Найдено решений: ${result.previousWork.length}`);
      for (const w of result.previousWork) {
        console.log(`    [${w.verdict}] ${w.title} — ${w.team?.join(', ')} (${w.when?.slice(0,10)})`);
      }
    }
    if (result.failures.length > 0) {
      console.log(`\n  ⚠ Неудачные/отклонённые подходы:`);
      for (const f of result.failures) {
        console.log(`    ✗ ${f.title} (${f.reason})`);
      }
    }
    if (result.compatibility.length > 0) {
      console.log(`\n  ✓ Совместимые решения:`);
      for (const c of result.compatibility) {
        console.log(`    ${c.title} — ${c.team?.join(', ')}`);
      }
    }
    return;
  }

  // ── compat ───────────────────────────────────────────────────────────
  if (CMD === 'compat') {
    const a = (process.argv.find((_, i) => process.argv[i-1] === '--teamA') || '').split(',').map(s => s.trim());
    const b = (process.argv.find((_, i) => process.argv[i-1] === '--teamB') || '').split(',').map(s => s.trim());
    if (!a.length || !b.length) { console.error('compat --teamA "A,B" --teamB "C,D"'); process.exit(1); }
    const result = reg.teamCompatibility(a, b);
    console.log(JSON.stringify(result, null, 2));
    console.log(`\n  ${result.compatible ? '✓ Совместимы' : '✗ Конфликтуют'}`);
    console.log(`  Совместных проектов: ${result.sharedProjects}`);
    console.log(`  Оценка совместимости: ${result.score}`);
    return;
  }

  // ── stats ────────────────────────────────────────────────────────────
  if (CMD === 'stats') {
    const s = reg.stats();
    console.log(JSON.stringify(s, null, 2));
    console.log(`\n  ═══ REG Статистика ═══`);
    console.log(`  Решений: ${s.totalDecisions} | Связей: ${s.totalLinks}`);
    console.log(`  Активных: ${s.activeDecisions} | Заменённых: ${s.supersededDecisions}`);
    console.log(`  Доменов: ${Object.keys(s.byDomain).length}`);
    console.log(`  Уникальных участников: ${s.teamCount}`);
    console.log(`  Ценность по Риду (2^N): ${s.reedValue.toExponential(0)}`);
    return;
  }

  // ── demo ─────────────────────────────────────────────────────────────
  if (CMD === 'demo') {
    console.log('  Загружаю демо-данные Мета КБ...');

    // Домен: аэродинамика
    const d1 = reg.recordDecision({
      project: 'БПЛА-5кг', domain: 'aerodynamics', title: 'Профиль крыла CLARK-Y',
      description: 'Выбран для подъёмной силы 5 кг на скорости 15 м/с. Расчётный Су = 0.45.',
      madeBy: 'Петров', team: ['Петров', 'Иванов'],
      files: ['wing-profile-v1.stp'], verdict: 'decided', weight: 4,
    });
    const d2 = reg.recordDecision({
      project: 'БПЛА-5кг', domain: 'aerodynamics', title: 'Профиль NACA 2412 (отклонено)',
      description: 'Рассматривался но дал слишком большое лобовое сопротивление на целевой скорости.',
      madeBy: 'Иванов', team: ['Петров', 'Иванов'],
      verdict: 'rejected', weight: 2,
    });
    reg.linkDecisions(d1.id, d2.id, 'supersedes');

    // Домен: материалы
    const d3 = reg.recordDecision({
      project: 'БПЛА-5кг', domain: 'materials', title: 'Углепластик 3K для крыла',
      description: 'Выбран после испытаний. Вес 340г, прочность достаточная. Проблема: расслоение на 4-м часу вибрации.',
      madeBy: 'Сидоров', team: ['Сидоров', 'Петров'],
      files: ['material-test-3k.json'], verdict: 'decided', weight: 3,
    });
    const d4 = reg.recordDecision({
      project: 'БПЛА-5кг', domain: 'materials', title: 'Стеклопластик (отклонено)',
      description: 'Вес 520г — превышает бюджет массы на крыло. Не подходит.',
      madeBy: 'Сидоров', team: ['Сидоров'],
      verdict: 'rejected', weight: 1,
    });
    reg.linkDecisions(d3.id, d4.id, 'supersedes');

    // Домен: силовая установка
    const d5 = reg.recordDecision({
      project: 'БПЛА-5кг', domain: 'propulsion', title: 'Двигатель X450 900KV',
      description: 'Выбран для взлётной массы 5кг. Проблема: резонанс с крылом из углепластика на 3000 RPM.',
      madeBy: 'Козлов', team: ['Козлов', 'Петров'],
      files: ['motor-test-x450.json'], verdict: 'decided', weight: 3,
    });
    const d6 = reg.recordDecision({
      project: 'БПЛА-5кг', domain: 'propulsion', title: 'Винт 12x6 (отклонено)',
      description: 'Слишком большой крутящий момент для X450. Двигатель перегревается.',
      madeBy: 'Козлов', team: ['Козлов'],
      verdict: 'rejected', weight: 1,
    });
    reg.linkDecisions(d5.id, d6.id, 'supersedes');

    // Связи между доменами
    reg.linkDecisions(d1.id, d3.id, 'depends_on');  // профиль зависит от материала
    reg.linkDecisions(d3.id, d5.id, 'conflicts_with'); // углепластик конфликтует с X450
    reg.linkDecisions(d1.id, d5.id, 'compatible_with'); // профиль совместим с двигателем

    // Проект: авионика
    const d7 = reg.recordDecision({
      project: 'БПЛА-5кг', domain: 'avionics', title: 'Полетный контроллер Cube Orange+',
      description: 'Выбран как стандарт НТИ. Совместим с ArduPilot. Вес 73г.',
      madeBy: 'Петров', team: ['Петров', 'Козлов'],
      verdict: 'decided', weight: 5,
    });

    console.log(`  ✓ Загружено решений: ${reg.decisions.length}, связей: ${reg.links.length}`);
    console.log(`\n  Готово к демонстрации. Запусти:`);
    console.log(`    node utils/gift-reg.mjs anamnesis --query "крыло" --project "БПЛА-5кг"`);
    return;
  }

  // ── search ───────────────────────────────────────────────────────────
  if (CMD === 'search') {
    const q = process.argv.find((_, i) => process.argv[i-1] === '--query') || '';
    const all = reg.decisions.filter(d => {
      const ql = q.toLowerCase();
      const haystack = [d.title, d.description, d.domain, d.project, ...d.team].join(' ').toLowerCase();
      return haystack.includes(ql);
    });
    console.log(JSON.stringify(all, null, 2));
    console.log(`\n  Найдено: ${all.length} решений по запросу "${q}"`);
    return;
  }

  console.error('gift-reg: decide | link | anamnesis | compat | stats | search | demo');
  process.exit(1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
