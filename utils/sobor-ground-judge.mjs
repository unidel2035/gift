#!/usr/bin/env node
/**
 * sobor-ground-judge — заземление собора на реальный корпус.
 *
 * То, что есть у Google Co-Scientist (глубокая сверка с литературой/данными) и
 * чего нам не хватало: судья оценивал вопрошания ОНТОЛОГИЧЕСКИ (риторика дара),
 * но не ЗАЗЕМЛЁННО (против реальных знаний). Этот слой добавляет заземление.
 *
 * Заземлённый смысл (не риторика и не фантазия):
 *   • ЗАЯКОРЕН — касается реального материала корпуса (не выдуман);
 *   • но НЕ ЭХО — не повторяет уже сказанное (иначе он не нов);
 *   • целит в ЗАЗОР (gap) — туда, где знаний разреженно (пустыня базы).
 * Заземлён = заякорен И не эхо. Это и есть «proximity к пустыням общей базы».
 *
 * Для мета-КБ (integram): укажи свой корпус через CORPUS_FILE (jsonl {text}) или
 * CORPUS_DIR (папка .md/.txt/.gift). По умолчанию — корпус gift (insights + спеки).
 *
 * Мера близости: embeddings (Ollama nomic) если доступны, иначе лексическая
 * косинусная по частотам слов (детерминированно, без сети).
 *
 * Запуск:
 *   node utils/sobor-ground-judge.mjs "вопрошание"      — отчёт заземления
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fetchCorpus as integramFetchCorpus, available as integramAvailable } from './sobor-corpus-integram.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text:latest';

// Пороги (калибруются под меру; env переопределяет)
const TH = {
  lex: { anchor: Number(process.env.GROUND_ANCHOR_LEX || 0.08), dup: Number(process.env.GROUND_DUP_LEX || 0.55) },
  emb: { anchor: Number(process.env.GROUND_ANCHOR_EMB || 0.45), dup: Number(process.env.GROUND_DUP_EMB || 0.85) },
};

// ── Токенизация и лексическая близость ──────────────────────────────
const STOP = new Set('и в во не на я с со что как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если или быть для это эта эти этот тот'.split(' '));
export function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-zа-яё0-9 ]/gi, ' ').split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}
function tf(text) { const m = new Map(); for (const w of tokenize(text)) m.set(w, (m.get(w) || 0) + 1); return m; }
export function lexicalSim(a, b) {
  const ta = tf(a), tb = tf(b);
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of ta) na += v * v;
  for (const [, v] of tb) nb += v * v;
  for (const [w, v] of ta) if (tb.has(w)) dot += v * tb.get(w);
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ── Embeddings (best-effort, проба ОДИН раз) ────────────────────────
const embCache = new Map();
let embUp = null; // null=не проверяли, true/false=результат пробы
const EMBED_OFF = process.env.GROUND_EMBED === 'off';

function tryEmbed(text, maxTime) {
  for (const [path, key, pick] of [
    ['/api/embeddings', 'prompt', j => j.embedding],
    ['/api/embed', 'input', j => j.embeddings && j.embeddings[0]],
  ]) {
    try {
      const body = JSON.stringify({ model: EMBED_MODEL, [key]: text });
      const r = spawnSync('curl', ['-s', '--max-time', String(maxTime), `${OLLAMA}${path}`, '-d', body], { encoding: 'utf8', maxBuffer: 8e6 });
      const v = pick(JSON.parse(r.stdout));
      if (Array.isArray(v) && v.length) return v;
    } catch { /* next */ }
  }
  return null;
}

export function embed(text) {
  if (EMBED_OFF) return null;
  if (embCache.has(text)) return embCache.get(text);
  if (embUp === false) return null;            // уже знаем, что недоступны — мгновенно лексика
  if (embUp === null) { embUp = tryEmbed(text, 12) !== null; } // проба один раз, короткий таймаут
  const vec = embUp ? tryEmbed(text, 12) : null;
  embCache.set(text, vec);
  return vec;
}
function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0; }

/** Универсальная близость: embeddings если есть, иначе лексика. Возвращает {sim, mode}. */
export function similarity(a, b) {
  const ea = embed(a), eb = embed(b);
  if (ea && eb) return { sim: cosine(ea, eb), mode: 'emb' };
  return { sim: lexicalSim(a, b), mode: 'lex' };
}

// ── Корпус ──────────────────────────────────────────────────────────
export function loadCorpus() {
  const chunks = [];
  // Живая мета-КБ integram как корпус (приоритет): заземление на реальные знания компании.
  if (integramAvailable()) {
    try {
      const fromKb = integramFetchCorpus();
      if (fromKb.length) return fromKb;
    } catch { /* fallthrough к локальному корпусу */ }
  }
  if (process.env.CORPUS_FILE && existsSync(process.env.CORPUS_FILE)) {
    for (const line of readFileSync(process.env.CORPUS_FILE, 'utf8').split('\n').filter(Boolean)) {
      try { const o = JSON.parse(line); if (o.text) chunks.push({ id: o.id || `c${chunks.length}`, text: o.text, source: 'corpus' }); }
      catch { chunks.push({ id: `c${chunks.length}`, text: line, source: 'corpus' }); }
    }
    return chunks;
  }
  if (process.env.CORPUS_DIR && existsSync(process.env.CORPUS_DIR)) {
    for (const f of readdirSync(process.env.CORPUS_DIR)) {
      if (['.md', '.txt', '.gift'].includes(extname(f))) {
        try { chunks.push({ id: f, text: readFileSync(join(process.env.CORPUS_DIR, f), 'utf8').slice(0, 800), source: f }); } catch { /* skip */ }
      }
    }
    return chunks;
  }
  // По умолчанию — корпус gift: инсайты + спеки
  try {
    const ins = JSON.parse(readFileSync(join(ROOT, 'data', 'insights.json'), 'utf8'));
    const arr = Array.isArray(ins) ? ins : (ins.insights || ins.items || []);
    for (const x of arr) if (x.content) chunks.push({ id: `insight:${chunks.length}`, text: x.content, source: 'insights' });
  } catch { /* нет инсайтов */ }
  try {
    const specDir = join(ROOT, 'specs');
    if (existsSync(specDir)) for (const f of readdirSync(specDir)) if (f.endsWith('.gift')) {
      try { chunks.push({ id: `spec:${f}`, text: readFileSync(join(specDir, f), 'utf8').slice(0, 600), source: 'specs' }); } catch { /* skip */ }
    }
  } catch { /* нет спеков */ }
  return chunks;
}

// ── Заземление одного вопрошания ────────────────────────────────────
export function grounding(text, corpus, simFn = similarity) {
  let top = { sim: 0, chunk: null }, mode = 'lex';
  const scored = [];
  for (const c of corpus) {
    const { sim, mode: m } = simFn(text, c.text); mode = m;
    scored.push({ id: c.id, sim, snippet: c.text.slice(0, 90).replace(/\s+/g, ' ') });
    if (sim > top.sim) top = { sim, chunk: c };
  }
  const th = TH[mode] || TH.lex;
  const anchored = top.sim >= th.anchor;     // касается реального материала
  const echo = top.sim >= th.dup;            // повторяет уже сказанное
  const grounded = anchored && !echo;        // заякорен, но нов → целит в зазор
  scored.sort((a, b) => b.sim - a.sim);
  return { topSim: Number(top.sim.toFixed(3)), anchored, echo, grounded, mode, evidence: scored.slice(0, 3) };
}

/**
 * Заземляющий судья поверх базового (критерий дара).
 * Фантазия (не заякорена) и эхо (дубль) проигрывают заземлённому.
 * Среди равно-заземлённых — решает базовый судья (избыток/кеносис/телос).
 */
export function makeGroundedJudge(corpus, baseJudge, simFn = similarity) {
  return (a, b) => {
    const ga = grounding(a.text, corpus, simFn);
    const gb = grounding(b.text, corpus, simFn);
    if (ga.grounded !== gb.grounded) {
      return { winner: ga.grounded ? 'A' : 'B', why: `заземление: ${ga.grounded ? 'A' : 'B'} опирается на корпус, другой — ${(ga.grounded ? gb : ga).echo ? 'эхо' : 'без опоры'}` };
    }
    const r = baseJudge(a, b);
    return { winner: r.winner, why: `равно заземлены → дар: ${r.why}` };
  };
}

// ── CLI ─────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) { console.log('Использование: node utils/sobor-ground-judge.mjs "вопрошание"'); process.exit(0); }
  const corpus = loadCorpus();
  console.log(`Корпус: ${corpus.length} фрагментов`);
  const g = grounding(text, corpus);
  console.log(`\nЗаземление «${text.slice(0, 70)}...»`);
  console.log(`  мера: ${g.mode} | top-близость: ${g.topSim}`);
  console.log(`  заякорен: ${g.anchored ? '✓' : '✗'} | эхо: ${g.echo ? '✓ (повтор)' : '✗'} | ЗАЗЕМЛЁН: ${g.grounded ? '✓ целит в зазор' : '✗'}`);
  console.log('  опора:');
  for (const e of g.evidence) console.log(`    [${e.sim.toFixed(3)}] ${e.id}: ${e.snippet}`);
}
