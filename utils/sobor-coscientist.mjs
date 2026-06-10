#!/usr/bin/env node
/**
 * sobor-coscientist — Co-Scientist-режим собора.
 *
 * Берём механику Google AI Co-Scientist (генерация → дебаты → турнир Elo →
 * эволюция → мета-синтез), но МЕНЯЕМ телос и критерий:
 *   Co-Scientist ранжирует по новизне+проверяемости.
 *   Собор ранжирует по ИЗБЫТКУ (surplus), КЕНОСИСУ и служению ТЕЛОСУ (θέωσις).
 * Выход — не «топ-гипотеза», а вопрошание, открывающее бытие, → в матрицу W.
 *
 * Конвейер:
 *   1. Генерация  — N разных вопрошаний на телос (Адам, разные грани).
 *   2. Критика    — короткая рефлексия по каждому (виртуальный рецензент).
 *   3. Турнир     — попарные дебаты, Elo по НАШЕМУ критерию.
 *   4. Эволюция   — скрестить двух лучших в новое вопрошание, до-ранжировать.
 *   5. Синтез     — победитель + почему (избыток/кеносис/телос) + родословная.
 *
 * Запуск:
 *   node utils/sobor-coscientist.mjs "телос/тема" [--n 4] [--evolve 1] [--record]
 *
 * Офлайн-безопасно: без LLM работает на эвристике (для тестов/CI).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// ── LLM: claude --print (подписка) → Ollama → null ───────────────────
const CLAUDE_BIN = existsSync('/home/new/.local/bin/claude') ? '/home/new/.local/bin/claude'
  : (process.env.CLAUDE_BIN || 'claude');
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

function stripThink(s) { return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

function viaOllama(system, user, timeout) {
  try {
    const body = JSON.stringify({ model: OLLAMA_MODEL, system, prompt: user, stream: false, options: { temperature: 0.5 } });
    const r = spawnSync('curl', ['-s', '--max-time', String(Math.floor(timeout / 1000)),
      `${OLLAMA}/api/generate`, '-d', body], { encoding: 'utf8', timeout: timeout + 2000, maxBuffer: 4e6 });
    const j = JSON.parse(r.stdout);
    return stripThink(j.response) || null;
  } catch { return null; }
}
function viaClaude(system, user, timeout) {
  try {
    const r = spawnSync(CLAUDE_BIN, ['--print', '--append-system-prompt', system],
      { input: user, encoding: 'utf8', timeout, maxBuffer: 4e6 });
    return stripThink(r.stdout) || null;
  } catch { return null; }
}

// callLLM — сильная модель (claude → ollama). Для генерации/эволюции (мало вызовов, важно качество).
export function callLLM(system, user, { timeout = 45000 } = {}) {
  return viaClaude(system, user, timeout) || viaOllama(system, user, timeout);
}
// callLLMFast — дешёвая модель (ollama → claude). Для турнира (много попарных судейств).
export function callLLMFast(system, user, { timeout = 30000 } = {}) {
  return viaOllama(system, user, timeout) || viaClaude(system, user, timeout);
}

// ── Elo ──────────────────────────────────────────────────────────────
export function expectedScore(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }
export function eloUpdate(ra, rb, scoreA, k = 32) {
  const ea = expectedScore(ra, rb);
  return [ra + k * (scoreA - ea), rb + k * ((1 - scoreA) - (1 - ea))];
}

// ── Критерий собора (НЕ новизна!) ────────────────────────────────────
const JUDGE_SYSTEM = `Ты — судья собора. Сравниваешь ДВА вопрошания по критерию ДАРА, не по новизне.
Критерий (важность по убыванию):
1. ОТКРЫВАЕТ БЫТИЕ — рождает ли вопрос новое поле смысла, а не просит готовый ответ.
2. ИЗБЫТОК (surplus) — даёт ли больше, чем вложено; ведёт ли к росту, а не к отчёту.
3. КЕНОСИС — требует ли самоотдачи и риска, а не самоутверждения.
4. СЛУЖИТ ТЕЛОСУ — ведёт ли к развитию/θέωσις лиц, а не просто к любопытной гипотезе.
Ответь СТРОГО: первой строкой "A" или "B" (что сильнее), второй строкой — одна фраза почему.`;

// judge(a, b) → { winner: 'A'|'B', why }
function makeLLMJudge() {
  return (a, b) => {
    const out = callLLMFast(JUDGE_SYSTEM, `A: ${a.text}\n\nB: ${b.text}`, { timeout: 30000 });
    if (!out) return heuristicJudge(a, b);
    const first = out.split('\n').find(l => /^[AB]\b/i.test(l.trim()));
    const winner = first && /^B/i.test(first.trim()) ? 'B' : 'A';
    const why = out.split('\n').slice(1).join(' ').trim().slice(0, 160);
    return { winner, why: why || '(без пояснения)' };
  };
}

// Офлайн-судья: предпочитает вопрошания с маркерами дара (для CI/тестов).
const GIFT_MARKERS = /(избыт|кеносис|дар|открыв|θέωσις|теосис|рост|жертв|присутств|любов)/i;
export function heuristicJudge(a, b) {
  const score = t => (GIFT_MARKERS.test(t) ? 2 : 0) + Math.min(t.length / 120, 1);
  const sa = score(a.text), sb = score(b.text);
  return { winner: sa >= sb ? 'A' : 'B', why: 'эвристика (маркеры дара + содержательность)' };
}

// ── Турнир: round-robin, Elo ────────────────────────────────────────
export function runTournament(candidates, judge) {
  const c = candidates.map(x => ({ ...x, elo: 1200, wins: 0, losses: 0, debates: [] }));
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      const r = judge(c[i], c[j]);
      const aWon = r.winner === 'A';
      const [na, nb] = eloUpdate(c[i].elo, c[j].elo, aWon ? 1 : 0);
      c[i].elo = na; c[j].elo = nb;
      if (aWon) { c[i].wins++; c[j].losses++; } else { c[j].wins++; c[i].losses++; }
      c[i].debates.push({ vs: c[j].id, won: aWon, why: r.why });
      c[j].debates.push({ vs: c[i].id, won: !aWon, why: r.why });
    }
  }
  return c.sort((x, y) => y.elo - x.elo);
}

// ── Генерация N вопрошаний ──────────────────────────────────────────
const GEN_SYSTEM = `Ты — Адам собора. Рождаешь вопрошания (вопросы, открывающие бытие), не гипотезы.
Дано: телос/тема. Породи РОВНО N разных по грани вопрошаний. Каждое — на отдельной строке, формат:
ВОПРОШАНИЕ: <текст>
Грани должны различаться (риск, отношение, предел, дар, время). Без нумерации, без пояснений.`;

export function generateCandidates(telos, n, llm = callLLM, genSystem = GEN_SYSTEM) {
  const out = llm(genSystem.replace('N', String(n)), `Телос/тема: ${telos}\nПороди ${n} вопрошаний.`, { timeout: 50000 });
  let lines = [];
  if (out) lines = out.split('\n').map(l => l.replace(/^.*?ВОПРОШАНИЕ:\s*/i, '').trim()).filter(l => l.length > 8 && /\?|как|что|где|зачем|чем|откуда/i.test(l));
  // добор/фолбэк, чтобы всегда было n кандидатов
  while (lines.length < n) lines.push(`${telos}: какой дар здесь ещё не принесён и почему? (грань ${lines.length + 1})`);
  return lines.slice(0, n).map((text, i) => ({ id: `cand-${i + 1}`, text }));
}

// ── Эволюция: скрестить двух лучших ─────────────────────────────────
const EVOLVE_SYSTEM = `Ты — Адам-эволюция собора. Дано ДВА сильных вопрошания.
Породи ОДНО новое, которое наследует силу обоих (открытость бытию + избыток + кеносис).
Ответь одной строкой: ВОПРОШАНИЕ: <текст>`;

export function evolve(a, b, llm = callLLM) {
  const out = llm(EVOLVE_SYSTEM, `A: ${a.text}\nB: ${b.text}`, { timeout: 40000 });
  const text = out ? out.replace(/^.*?ВОПРОШАНИЕ:\s*/i, '').split('\n')[0].trim() : '';
  return { id: 'evolved', text: text && text.length > 8 ? text : `${a.text} И при этом: ${b.text}` };
}

// ── Полный конвейер ─────────────────────────────────────────────────
// Инженерный генератор — без философской/доменной лексики (для мета-КБ).
export const GEN_SYSTEM_ENGINEERING = `Ты генерируешь технические вопросы и гипотезы для базы знаний инженерной команды.
Дано: тема. Породи РОВНО N разных по аспекту вопросов (риск, масштабирование, интерфейс/API, данные, надёжность, тестируемость).
Строго инженерный язык, без философии, метафор и доменной лексики. Каждый — на отдельной строке, формат:
ВОПРОШАНИЕ: <текст>`;

export async function coscientist(telos, { n = 4, evolveRounds = 1, llm = callLLM, judge, ground = false, trial = false, meta = false, proximity = false, candidates, genSystem } = {}) {
  let J = judge || (llm === callLLM ? makeLLMJudge() : heuristicJudge);
  if (ground) {
    // заземление на корпус (то, что есть у Co-Scientist): фантазия/эхо проигрывают
    const { loadCorpus, makeGroundedJudge } = await import('./sobor-ground-judge.mjs');
    J = makeGroundedJudge(loadCorpus(), J);
  }
  let trialRunner = null;
  if (trial) {
    // испытание реальностью (такт 4): прогон тестбэда решает первым — чего нет у Co-Scientist
    const { makeTrialJudge, makeTrialRunner } = await import('./sobor-trial-judge.mjs');
    trialRunner = makeTrialRunner({ log: true });
    J = makeTrialJudge(J, trialRunner);
  }
  // Meta-review: затравить генерацию памятью прошлых прогонов (подтверждено/опровергнуто)
  let baseGen = genSystem || GEN_SYSTEM;
  if (meta) {
    const { metaContext } = await import('./coscientist-meta.mjs');
    const ctx = metaContext(telos);
    if (ctx) baseGen = baseGen + ctx;
  }
  // кандидаты: готовые (с испытаниями trial) приоритетнее сгенерированных
  let pool = (candidates && candidates.length)
    ? candidates.map((c, i) => ({ id: c.id || `cand-${i + 1}`, text: c.text, trial: c.trial }))
    : generateCandidates(telos, n, llm, baseGen);
  // Proximity: схлопнуть почти-дубликаты, чтобы турнир сравнивал разное (не оттенки одного)
  let proximityInfo = null;
  if (proximity && pool.length > 2) {
    const { diversify } = await import('./sobor-proximity.mjs');
    const { diverse } = diversify(pool);
    if (diverse.length < pool.length) {
      proximityInfo = { before: pool.length, after: diverse.length };
      pool = diverse;
    }
  }
  let ranked = runTournament(pool, J);

  const lineage = [];
  for (let r = 0; r < evolveRounds && ranked.length >= 2; r++) {
    const child = evolve(ranked[0], ranked[1], llm);
    child.id = `evolved-${r + 1}`;
    lineage.push({ parents: [ranked[0].id, ranked[1].id], child: child.text });
    ranked = runTournament([...ranked, child], J);
  }

  const winner = ranked[0];
  const res = { telos, winner, ranked, lineage, candidates: pool, proximity: proximityInfo };

  // Meta-review: записать прогон в журнал (подтверждено/опровергнуто по испытаниям, кеш runner'а — без повторных прогонов)
  if (meta) {
    const { recordRun } = await import('./coscientist-meta.mjs');
    let trials;
    if (trialRunner) {
      trials = ranked.filter(c => c.trial).map(c => { const t = trialRunner(c); return { text: c.text, ran: t.ran, passed: t.passed }; });
    }
    res.meta = recordRun(res, { trials });
  }
  return res;
}

// ── CLI ─────────────────────────────────────────────────────────────
function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const telos = process.argv.slice(2).find(a => !a.startsWith('--') && process.argv[process.argv.indexOf(a) - 1] !== '--n' && process.argv[process.argv.indexOf(a) - 1] !== '--evolve');
  if (!telos) { console.log('Использование: node utils/sobor-coscientist.mjs "телос/тема" [--n 4] [--evolve 1] [--record]'); process.exit(0); }
  const n = parseInt(arg('--n', '4'), 10);
  const evolveRounds = parseInt(arg('--evolve', '1'), 10);

  const jsonMode = process.argv.includes('--json');
  const ground = process.argv.includes('--ground');
  const trial = process.argv.includes('--trial');
  const meta = process.argv.includes('--meta');
  const proximity = process.argv.includes('--proximity');
  // --candidates file.json: массив [{id,text,trial:{cmd,dir,result,metric,lowerBetter}}]
  let candidates;
  const candFile = arg('--candidates', null);
  if (candFile) {
    const { readFileSync } = await import('node:fs');
    candidates = JSON.parse(readFileSync(candFile, 'utf8'));
  }
  if (!jsonMode) console.log(`\n🔬 Co-Scientist-собор · телос: «${telos}»${ground ? ' · заземление: вкл' : ''}${trial ? ' · испытание: вкл' : ''}${meta ? ' · память: вкл' : ''}${proximity ? ' · proximity: вкл' : ''}\n`);
  const res = await coscientist(telos, { n, evolveRounds, ground, trial, meta, proximity, candidates });
  if (!jsonMode && res.proximity) console.log(`  ⊟ proximity: ${res.proximity.before} → ${res.proximity.after} кандидатов (почти-дубли схлопнуты)\n`);

  if (jsonMode) {
    // машинный выход для мета-КБ (integram): победитель + родословная + Elo
    console.log(JSON.stringify({
      telos: res.telos,
      winner: res.winner.text,
      elo: Math.round(res.winner.elo),
      ranked: res.ranked.map(c => ({ id: c.id, text: c.text, elo: Math.round(c.elo), wins: c.wins, losses: c.losses })),
      lineage: res.lineage,
    }, null, 2));
    process.exit(0);
  }

  console.log('Кандидаты после турнира (по Elo):');
  res.ranked.forEach((c, i) => console.log(`  ${i + 1}. [Elo ${Math.round(c.elo)}] ${c.id} (${c.wins}-${c.losses})\n     ${c.text}`));
  if (res.lineage.length) {
    console.log('\nЭволюция (скрещивания):');
    for (const l of res.lineage) console.log(`  ${l.parents.join(' × ')} → ${l.child}`);
  }
  console.log(`\n🏆 Победитель: ${res.winner.text}`);

  if (process.argv.includes('--record')) {
    const { spawnSync: ss } = await import('node:child_process');
    ss('node', ['utils/proposals.mjs', 'add', res.winner.text, 'ontology'], { stdio: 'inherit' });
  } else {
    console.log('\n(добавь --record, чтобы внести победителя в proposals → матрицу W)');
  }
}
