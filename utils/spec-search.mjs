#!/usr/bin/env node
/**
 * spec-search.mjs
 *
 * Семантический поиск по библиотеке спецификаций.
 * Для данного вопрошания (issue) находит релевантные .gift файлы.
 *
 * Стратегия (трёхуровневая):
 *   1. Вектор (Ollama nomic-embed-text) × категорийный вес × W-буст
 *   2. Если Ollama недоступен — TF-IDF с богословским тезаурусом
 *   3. W-матрица: спецификации лиц с высоким весом получают буст
 *
 * Использование:
 *   node utils/spec-search.mjs "евхаристический ритм в GiftEngine"
 *   node utils/spec-search.mjs --issue 3
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = resolve(ROOT, 'specs');

// ── Богословский тезаурус ─────────────────────────────────────────────────
const THESAURUS = {
  'дар':           ['gift', 'δῶρον', 'дарение', 'дарит', 'дарил'],
  'кенозис':       ['kenosis', 'κένωσις', 'умаление', 'истощание'],
  'анамнезис':     ['anamnesis', 'ἀνάμνησις', 'память', 'воспоминание', 'помнит'],
  'перихоресис':   ['perichoresis', 'περιχώρησις', 'взаимопроникновение'],
  'евхаристия':    ['eucharist', 'εὐχαριστία', 'причастие', 'литургия'],
  'суббота':       ['sabbath', 'שַׁבָּת', 'покой', 'отдых'],
  'благодать':     ['grace', 'χάρις', 'charis', 'gratia'],
  'лицо':          ['person', 'πρόσωπον', 'ипостась', 'hypostasis'],
  'троица':        ['trinity', 'τριάς', 'отец', 'сын', 'дух'],
  'воскресение':   ['resurrection', 'anastasis', 'ἀνάστασις', 'воскрес'],
  'кайрос':        ['kairos', 'καιρός', 'время', 'момент', 'эпоха'],
  'ритм':          ['rhythm', 'ритмический', 'цикл', 'литургический'],
  'энергия':       ['energy', 'ἐνέργεια', 'нетварный', 'divine'],
  'матрица':       ['matrix', 'tensor', 'тензор', 'weight', 'вес'],
  'агент':         ['agent', 'swarm', 'рой', 'мультиагент'],
  'память':        ['memory', 'anamnesis', 'altar', 'хранит'],
  'благодарность': ['gratitude', 'εὐχαριστία', 'благодарить'],
};

// ── Вес категорий ─────────────────────────────────────────────────────────
const CAT_WEIGHT = {
  'axioms':         2.0,
  'theology':       1.8,
  'sacred-history': 1.6,
  'liturgy':        1.4,
  'persons':        1.3,
  'community':      1.2,
  'technical':      1.0,
  'uncategorized':  0.8,
};

// ── W-буст из матрицы W (какие категории «живые» прямо сейчас) ───────────
async function getWBoost() {
  try {
    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    const snap = JSON.parse(readFileSync(resolve(ROOT, 'data/sacred-history-W.json'), 'utf8'));
    const mem  = GiftMemory.fromSnapshot(snap);

    // Топ-5 нитей: смотрим на активных лиц, ищем связи с категориями
    const top   = mem.heaviest(5);
    const boost = {};

    // Лица-агенты → усиливают технические спецификации
    const techPersons = new Set(['_claude', '_codex', '_ci', '_reviewer']);
    const hasTech = top.some(e =>
      techPersons.has(e.from) || techPersons.has(e.to)
    );
    if (hasTech) boost['technical'] = 1.3;

    // Богослов активен → усиливаем теологию
    const hasTheolog = top.some(e =>
      e.from === 'Дионисий' || e.to === 'Дионисий'
    );
    if (hasTheolog) {
      boost['theology']       = (boost['theology'] ?? 1.0) * 1.2;
      boost['sacred-history'] = (boost['sacred-history'] ?? 1.0) * 1.1;
    }

    return boost;
  } catch {
    return {};
  }
}

// ── Векторный поиск (Ollama) ──────────────────────────────────────────────
async function vectorSearch(query, topK, wBoost) {
  const { getEmbeddingService } = await import(resolve(ROOT, 'src/kag/EmbeddingService.js'));
  const { getSQLiteVectorStore } = await import(resolve(ROOT, 'src/kag/SQLiteVectorStore.js'));

  const emb   = getEmbeddingService();
  const store = getSQLiteVectorStore();

  if (!(await emb.isAvailable())) return null;
  if (!store.isAvailable() || store.count() === 0) return null;

  const qVec = await emb.embed(query);
  if (!qVec) return null;

  // Категорийный буст = W-буст × CAT_WEIGHT
  const combinedBoost = {};
  for (const [cat, cw] of Object.entries(CAT_WEIGHT)) {
    combinedBoost[cat] = cw * (wBoost[cat] ?? 1.0);
  }

  const results = store.search(qVec, topK * 2, combinedBoost);

  // Нормализуем и форматируем
  return results.slice(0, topK).map(r => ({
    file:    r.path.split('/').pop(),
    cat:     r.cat,
    path:    r.path,
    content: getSpecContent(r.path),
    score:   r.score,
    source:  'vector',
    similarity: r.similarity,
  }));
}

// ── Загрузить контент спецификации ────────────────────────────────────────
function getSpecContent(relPath) {
  const abs = resolve(ROOT, relPath);
  try { return readFileSync(abs, 'utf8'); } catch { return ''; }
}

// ── Загрузить все спецификации для TF-IDF ────────────────────────────────
function loadSpecs() {
  const specs = [];
  if (!existsSync(SPECS)) return specs;
  for (const cat of readdirSync(SPECS)) {
    const catDir = resolve(SPECS, cat);
    try {
      if (!existsSync(catDir) || catDir.endsWith('index.json')) continue;
      for (const file of readdirSync(catDir).filter(f => f.endsWith('.gift'))) {
        const path    = resolve(catDir, file);
        const content = readFileSync(path, 'utf8');
        specs.push({ file, cat, path: `specs/${cat}/${file}`, content,
                     words: tokenize(content) });
      }
    } catch {}
  }
  return specs;
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\wа-яёА-ЯЁ\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function expandQuery(query) {
  const tokens  = tokenize(query);
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const [key, synonyms] of Object.entries(THESAURUS)) {
      if (key.includes(token) || token.includes(key) ||
          synonyms.some(s => s.toLowerCase().includes(token))) {
        expanded.add(key);
        synonyms.forEach(s => expanded.add(s.toLowerCase()));
      }
    }
  }
  return [...expanded];
}

function tfidfScore(spec, queryTerms, totalDocs, docFreq, wBoost) {
  let s = 0;
  const tf = {};
  for (const w of spec.words) tf[w] = (tf[w] || 0) + 1;
  for (const term of queryTerms) {
    if (!tf[term]) continue;
    const termTf  = tf[term] / spec.words.length;
    const termIdf = Math.log((totalDocs + 1) / ((docFreq[term] || 0) + 1));
    s += termTf * termIdf;
  }
  const fname = spec.file.toLowerCase();
  for (const term of queryTerms) {
    if (fname.includes(term)) s += 0.5;
  }
  s *= (CAT_WEIGHT[spec.cat] || 1.0) * (wBoost[spec.cat] ?? 1.0);
  return s;
}

function tfidfSearch(query, topK, wBoost) {
  const specs      = loadSpecs();
  const queryTerms = expandQuery(query);
  const totalDocs  = specs.length;
  const docFreq    = {};
  for (const spec of specs) {
    const seen = new Set(spec.words);
    for (const w of seen) docFreq[w] = (docFreq[w] || 0) + 1;
  }
  return specs
    .map(spec => ({ ...spec, score: tfidfScore(spec, queryTerms, totalDocs, docFreq, wBoost),
                    source: 'tfidf' }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ── Основная функция поиска ───────────────────────────────────────────────
export async function searchSpecs(query, topK = 5) {
  const wBoost = await getWBoost();

  // Попытка 1: векторный поиск
  const vectorResults = await vectorSearch(query, topK, wBoost);
  if (vectorResults && vectorResults.length > 0) return vectorResults;

  // Fallback: TF-IDF
  return tfidfSearch(query, topK, wBoost);
}

// ── Синхронная версия для обратной совместимости (TF-IDF только) ─────────
export function searchSpecsSync(query, topK = 5) {
  return tfidfSearch(query, topK, {});
}

// ── Форматировать контекст для агента ────────────────────────────────────
export function formatContext(results) {
  if (!results.length) return '';
  const lines = ['# Релевантные спецификации\n'];
  for (const r of results) {
    const src = r.source === 'vector'
      ? `sim: ${r.similarity?.toFixed(3)}, score: ${r.score?.toFixed(3)}`
      : `score: ${r.score?.toFixed(2)}`;
    lines.push(`## ${r.path} (${src})`);
    const preview = r.content.split('\n').slice(0, 30).join('\n');
    lines.push('```\n' + preview + '\n```\n');
  }
  return lines.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let query = process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ');

  const issueArg = process.argv.indexOf('--issue');
  if (issueArg !== -1) {
    const num = process.argv[issueArg + 1];
    try {
      const issue = JSON.parse(execSync(
        `gh issue view ${num} --json title,body`, { cwd: ROOT }
      ).toString());
      query = `${issue.title} ${issue.body || ''}`;
      console.log(`Issue #${num}: ${issue.title}\n`);
    } catch { console.error('Issue не найден'); process.exit(1); }
  }

  if (!query.trim()) {
    console.log('Использование: node utils/spec-search.mjs "запрос"');
    console.log('           или: node utils/spec-search.mjs --issue N');
    process.exit(0);
  }

  const results = await searchSpecs(query, 7);
  const mode    = results[0]?.source ?? 'none';

  console.log(`\n═══ Спецификации для: "${query.slice(0, 60)}" ═══`);
  console.log(`    Режим: ${mode === 'vector' ? '🔮 Вектор (Ollama)' : '📊 TF-IDF (fallback)'}\n`);

  if (!results.length) { console.log('Ничего не найдено.'); process.exit(0); }

  for (const r of results) {
    const scoreStr = r.source === 'vector'
      ? `sim=${r.similarity?.toFixed(3)}`
      : `tfidf=${r.score?.toFixed(2)}`;
    console.log(`  [${scoreStr}] ${r.path}`);
    const desc = r.content.match(/\/\/\s*(.+)/)?.[1] ?? '';
    if (desc) console.log(`         ${desc}`);
  }

  console.log('\n─── Контекст для агента (первые 2 спецификации) ───\n');
  console.log(formatContext(results.slice(0, 2)));
}
