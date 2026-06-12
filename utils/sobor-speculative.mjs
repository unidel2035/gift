#!/usr/bin/env node
/**
 * sobor-speculative — спекулятивный турнир реализаций (реальность выбирает код).
 *
 * Эмпирика (AgenticFlict, CodeCRDT): несколько агентов, пишущих одно и то же в один
 * файл, дают семантические конфликты («три агента — три класса одной концепции»).
 * Ответ: НЕ давать им конфликтовать. Каждый реализует задачу В СВОЁМ worktree,
 * а потом ИСПЫТАНИЕ РЕАЛЬНОСТЬЮ (тесты/прогон) выбирает прошедшую — не голосование
 * моделей, не merge. Это испытующий судья (sobor-trial-judge), применённый к КОДУ.
 *
 * На вход — задача и N реализаций-кандидатов, у каждой своё испытание:
 *   { id, label, trial: { cmd, dir, result, metric, lowerBetter } }
 * (cmd обычно прогоняет тесты в worktree кандидата → exit 0 = прошло)
 *
 * Победитель — прошедший испытание; при равенстве — по метрике; при полном равенстве —
 * слепой ревьюер (sobor-blind-review) как тонкий разбой: меньше спец-независимых изъянов.
 *
 * Офлайн-безопасно и детерминированно.
 *
 * Запуск:
 *   node utils/sobor-speculative.mjs --candidates impl.json [--task "..."]
 *   node utils/sobor-speculative.mjs --selftest
 */
import { runTournament } from './sobor-coscientist.mjs';
import { makeTrialJudge, makeTrialRunner } from './sobor-trial-judge.mjs';

/**
 * Провести спекулятивный турнир.
 * impls — [{ id, label, trial, code? }]; реальность (испытание) решает.
 * Возвращает { winner, ranked, passed:[], failed:[] }.
 */
export async function speculate(task, impls, { log = false, blindTiebreak = true } = {}) {
  const runTrial = makeTrialRunner({ log });
  // базовый судья на случай полного равенства в испытании: слепой ревью кода (меньше изъянов лучше)
  let baseJudge = () => ({ winner: 'A', why: 'равны в испытании, базовый разбой не задействован' });
  if (blindTiebreak) {
    const { blindReview } = await import('./sobor-blind-review.mjs');
    const cache = new Map();
    const flaws = async (c) => {
      if (!c.code) return 999; // нет кода для ревью — не приоритетен
      if (cache.has(c.id)) return cache.get(c.id);
      const r = await blindReview(c.code);
      const n = (r.findings || []).length;
      cache.set(c.id, n);
      return n;
    };
    // синхронная обёртка не нужна: предварительно посчитаем изъяны
    for (const c of impls) c._flaws = await flaws(c);
    baseJudge = (a, b) => {
      const fa = a._flaws ?? 999, fb = b._flaws ?? 999;
      return { winner: fa <= fb ? 'A' : 'B', why: `равны в испытании → меньше изъянов (слепой ревью): ${Math.min(fa, fb)}` };
    };
  }
  const judge = makeTrialJudge(baseJudge, runTrial);
  const ranked = runTournament(impls, judge);
  const passed = [], failed = [];
  for (const c of impls) {
    const t = runTrial(c);
    (t.passed ? passed : failed).push({ id: c.id, ran: t.ran, status: t.status });
  }
  return { task, winner: ranked[0], ranked, passed, failed };
}

// ── CLI / самопроверка ───────────────────────────────────────────────
function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) {
    const impls = [
      { id: 'impl-A', label: 'наивная', code: 'function f(x){ try{return g(x)}catch(e){} }', trial: { cmd: 'exit 1' } }, // тесты падают
      { id: 'impl-B', label: 'рабочая', code: 'function f(x){ if(x==null) throw new Error("x"); return g(x); }', trial: { cmd: 'exit 0' } }, // тесты проходят
      { id: 'impl-C', label: 'рабочая-2', code: 'function f(x){ return g(x); }', trial: { cmd: 'exit 0' } }, // тоже проходит, но меньше защиты
    ];
    const res = await speculate('реализовать f(x)', impls, { blindTiebreak: true });
    console.log('Прошли испытание:', res.passed.map(p => p.id).join(', ') || '—');
    console.log('Провалили:', res.failed.map(p => p.id).join(', ') || '—');
    console.log('Ранжирование:');
    res.ranked.forEach((c, i) => console.log(`  ${i + 1}. [Elo ${Math.round(c.elo)}] ${c.id} (${c.label})`));
    console.log('\n🏆 Победитель:', res.winner.id, '—', res.winner.label);
    // impl-A провалила тесты → не должна победить; победитель среди прошедших
    const ok = res.winner.id !== 'impl-A' && res.passed.some(p => p.id === res.winner.id);
    console.log(ok ? '\n✓ selftest passed (реальность выбрала прошедшую, не «звучащую»)' : '\n✗ selftest FAILED');
    process.exit(ok ? 0 : 1);
  }
  const candFile = arg('--candidates', null);
  if (!candFile) { console.log('Использование: node utils/sobor-speculative.mjs --candidates impl.json [--task "..."]'); process.exit(0); }
  const { readFileSync } = await import('node:fs');
  const impls = JSON.parse(readFileSync(candFile, 'utf8'));
  const task = arg('--task', 'реализация');
  console.log(`\n🔬 Спекулятивный турнир · задача: «${task}» · кандидатов: ${impls.length}\n`);
  const res = await speculate(task, impls, { log: true });
  console.log('\nПрошли:', res.passed.map(p => p.id).join(', ') || '—', '| Провалили:', res.failed.map(p => p.id).join(', ') || '—');
  res.ranked.forEach((c, i) => console.log(`  ${i + 1}. [Elo ${Math.round(c.elo)}] ${c.id} ${c.label || ''}`));
  console.log('\n🏆 Реальность выбрала:', res.winner.id, res.winner.label || '');
}
