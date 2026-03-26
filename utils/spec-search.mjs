#!/usr/bin/env node
/**
 * spec-search.mjs
 *
 * Семантический поиск по библиотеке спецификаций.
 * Для данного вопрошания (issue) находит релевантные .gift файлы.
 * Возвращает контекст для агента.
 *
 * Использование:
 *   node utils/spec-search.mjs "евхаристический ритм в GiftEngine"
 *   node utils/spec-search.mjs --issue 3
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = resolve(ROOT, 'specs');

// ── Богословский тезаурус — расширяет запрос синонимами ───────────────────
const THESAURUS = {
  'дар':          ['gift', 'δῶρον', 'дарение', 'дарит', 'дарил', 'дарение'],
  'кенозис':      ['kenosis', 'κένωσις', 'умаление', 'истощание'],
  'анамнезис':    ['anamnesis', 'ἀνάμνησις', 'память', 'воспоминание', 'помнит'],
  'перихоресис':  ['perichoresis', 'περιχώρησις', 'взаимопроникновение'],
  'евхаристия':   ['eucharist', 'εὐχαριστία', 'причастие', 'литургия'],
  'суббота':      ['sabbath', 'שַׁבָּת', 'покой', 'отдых', 'sabbath'],
  'благодать':    ['grace', 'χάρις', 'charis', 'gratia'],
  'лицо':         ['person', 'πρόσωπον', 'ипостась', 'hypostasis'],
  'троица':       ['trinity', 'τριάς', 'triнity', 'отец', 'сын', 'дух'],
  'воскресение':  ['resurrection', 'anastasis', 'ἀνάστασις', 'воскрес'],
  'кайрос':       ['kairos', 'καιρός', 'время', 'момент', 'эпоха'],
  'ритм':         ['rhythm', 'ритмический', 'цикл', 'литургический'],
  'энергия':      ['energy', 'ἐνέργεια', 'нетварный', 'divine'],
  'матрица':      ['matrix', 'tensor', 'тензор', 'weight', 'вес'],
  'агент':        ['agent', 'swarm', 'рой', 'мультиагент'],
  'память':       ['memory', 'anamnesis', 'altar', 'хранит'],
  'благодарность':['gratitude', 'εὐχαριστία', 'gratitude', 'благодарить'],
};

// ── Вес категорий (богословски более фундаментальные — выше) ─────────────
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

// ── Загрузить все спецификации ────────────────────────────────────────────
function loadSpecs() {
  const specs = [];
  if (!existsSync(SPECS)) return specs;

  for (const cat of readdirSync(SPECS)) {
    const catDir = resolve(SPECS, cat);
    try {
      for (const file of readdirSync(catDir).filter(f => f.endsWith('.gift'))) {
        const path    = resolve(catDir, file);
        const content = readFileSync(path, 'utf8');
        specs.push({
          file, cat,
          path: `specs/${cat}/${file}`,
          content,
          words: tokenize(content),
        });
      }
    } catch {}
  }
  return specs;
}

// ── Токенизация ───────────────────────────────────────────────────────────
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\wа-яёА-ЯЁ\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

// ── Расширить запрос через тезаурус ──────────────────────────────────────
function expandQuery(query) {
  const tokens = tokenize(query);
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const [key, synonyms] of Object.entries(THESAURUS)) {
      if (key.includes(token) || token.includes(key)) {
        synonyms.forEach(s => expanded.add(s.toLowerCase()));
        expanded.add(key);
      }
      if (synonyms.some(s => s.toLowerCase().includes(token))) {
        expanded.add(key);
        synonyms.forEach(s => expanded.add(s.toLowerCase()));
      }
    }
  }
  return [...expanded];
}

// ── TF-IDF скоринг ────────────────────────────────────────────────────────
function score(spec, queryTerms, totalDocs, docFreq) {
  let s = 0;
  const tf = {};
  for (const w of spec.words) tf[w] = (tf[w] || 0) + 1;

  for (const term of queryTerms) {
    if (!tf[term]) continue;
    const termTf  = tf[term] / spec.words.length;
    const termIdf = Math.log((totalDocs + 1) / ((docFreq[term] || 0) + 1));
    s += termTf * termIdf;
  }

  // Бонус: термин в заголовке/имени файла
  const fname = spec.file.toLowerCase();
  for (const term of queryTerms) {
    if (fname.includes(term)) s += 0.5;
  }

  // Вес категории
  s *= (CAT_WEIGHT[spec.cat] || 1.0);
  return s;
}

// ── Основная функция поиска ───────────────────────────────────────────────
export function searchSpecs(query, topK = 5) {
  const specs      = loadSpecs();
  const queryTerms = expandQuery(query);
  const totalDocs  = specs.length;

  // Построить IDF (сколько документов содержат термин)
  const docFreq = {};
  for (const spec of specs) {
    const seen = new Set(spec.words);
    for (const w of seen) docFreq[w] = (docFreq[w] || 0) + 1;
  }

  // Скоринг
  const scored = specs.map(spec => ({
    ...spec,
    score: score(spec, queryTerms, totalDocs, docFreq),
  }))
  .filter(s => s.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, topK);

  return scored;
}

// ── Форматировать контекст для агента ────────────────────────────────────
export function formatContext(results) {
  if (!results.length) return '';
  const lines = ['# Релевантные спецификации\n'];
  for (const r of results) {
    lines.push(`## ${r.path} (score: ${r.score.toFixed(2)})`);
    // Первые 30 строк спецификации как контекст
    const preview = r.content.split('\n').slice(0, 30).join('\n');
    lines.push('```\n' + preview + '\n```\n');
  }
  return lines.join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let query = process.argv.slice(2).join(' ');

  // --issue N → читать из GitHub issue
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

  const results = searchSpecs(query, 7);

  console.log(`\n═══ Спецификации для: "${query.slice(0, 60)}" ═══\n`);
  if (!results.length) { console.log('Ничего не найдено.'); process.exit(0); }

  for (const r of results) {
    console.log(`  [${r.score.toFixed(2)}] ${r.path}`);
    // Первый комментарий-описание из файла
    const desc = r.content.match(/\/\/\s*(.+)/)?.[1] ?? '';
    if (desc) console.log(`         ${desc}`);
  }

  console.log('\n─── Контекст для агента (первые 2 спецификации) ───\n');
  console.log(formatContext(results.slice(0, 2)));
}
