#!/usr/bin/env node
/**
 * coscientist-meta — Meta-review петля собора (вторая шестерёнка Co-Scientist).
 *
 * Чего не хватало: coscientist давал топ-гипотезу РАЗОВО. Инсайты прогонов
 * (что подтвердилось испытанием, что опровергнуто) никуда не возвращались —
 * следующий запуск начинал с чистого листа. У Google это Meta-review Agent:
 * «synthesizes insights from the debates and tournament to continuously optimize».
 *
 * Здесь петля честнее, чем у DeepMind: возвращается не «что лучше звучало в дебатах»,
 * а ЧТО ВЫДЕРЖАЛО ИСПЫТАНИЕ РЕАЛЬНОСТЬЮ (sobor-trial-judge) и что провалилось.
 *   • ПОДТВЕРЖДЕНО (passed trial / победитель)  → развивать в следующем раунде;
 *   • ОПРОВЕРГНУТО (failed trial)               → не повторять тупик.
 *
 * Журнал: data/coscientist-meta.json (массив записей прогонов).
 * Память накапливается → собор перестаёт быть оракулом и становится исследователем.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from './sobor-ground-judge.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const META_PATH = process.env.COSCI_META || join(ROOT, 'data', 'coscientist-meta.json');

function load() {
  if (!existsSync(META_PATH)) return [];
  try { const j = JSON.parse(readFileSync(META_PATH, 'utf8')); return Array.isArray(j) ? j : []; }
  catch { return []; }
}
function save(arr) { writeFileSync(META_PATH, JSON.stringify(arr, null, 2)); }

// Близость двух телосов по доле общих корней (Жаккар + лёгкий стемминг префиксом).
// Префикс 4 символа грубо снимает русскую морфологию: контур/контура, ветер/ветре.
const stem = w => w.slice(0, 4);
function telosSim(a, b) {
  const sa = new Set(tokenize(a).map(stem)), sb = new Set(tokenize(b).map(stem));
  if (!sa.size || !sb.size) return 0;
  let inter = 0; for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Записать прогон в журнал. ts передаётся снаружи (детерминизм/тестируемость).
 * res — результат coscientist(); trialRunner — опц. функция испытания для отметки confirmed/refuted.
 */
export function recordRun(res, { ts = new Date().toISOString(), trials } = {}) {
  const arr = load();
  // confirmed/refuted из явно переданных результатов испытаний или из ранжирования
  const confirmed = [], refuted = [];
  if (trials) {
    for (const t of trials) (t.passed ? confirmed : (t.ran ? refuted : [])).push?.(t.text);
  }
  // победитель всегда «подтверждён» как направление (он вершина турнира)
  if (res.winner && !confirmed.includes(res.winner.text)) confirmed.unshift(res.winner.text);
  const entry = {
    ts,
    telos: res.telos,
    winner: res.winner ? { text: res.winner.text, elo: Math.round(res.winner.elo || 0) } : null,
    confirmed: [...new Set(confirmed)].slice(0, 8),
    refuted: [...new Set(refuted)].slice(0, 8),
    lineage: res.lineage || [],
  };
  arr.push(entry);
  save(arr);
  return entry;
}

/**
 * Вспомнить релевантные прошлым прогонам инсайты для телоса.
 * Возвращает { confirmed:[], refuted:[], runs:n } — для затравки генерации.
 */
export function recallMeta(telos, { minSim = 0.12, limit = 6 } = {}) {
  const arr = load();
  const relevant = arr
    .map(e => ({ e, sim: telosSim(telos, e.telos) }))
    .filter(x => x.sim >= minSim)
    .sort((a, b) => b.sim - a.sim);
  const confirmed = [], refuted = [];
  for (const { e } of relevant) {
    for (const c of (e.confirmed || [])) if (!confirmed.includes(c)) confirmed.push(c);
    for (const r of (e.refuted || [])) if (!refuted.includes(r)) refuted.push(r);
  }
  return { confirmed: confirmed.slice(0, limit), refuted: refuted.slice(0, limit), runs: relevant.length };
}

/** Сформировать блок контекста для генератора (Адама) из памяти прогонов. */
export function metaContext(telos, opts) {
  const m = recallMeta(telos, opts);
  if (!m.runs) return '';
  let s = `\n\nПАМЯТЬ ПРОШЛЫХ ПРОГОНОВ (${m.runs} по близкой теме) — учитывай при генерации:`;
  if (m.confirmed.length) s += `\nПОДТВЕРЖДЕНО испытанием (развивай, не изобретай заново):\n` + m.confirmed.map(c => `  • ${c}`).join('\n');
  if (m.refuted.length) s += `\nОПРОВЕРГНУТО испытанием (тупик, не повторяй):\n` + m.refuted.map(r => `  • ${r}`).join('\n');
  return s;
}

// ── CLI ──────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'recall') {
    const telos = process.argv.slice(3).join(' ').trim();
    if (!telos) { console.log('node utils/coscientist-meta.mjs recall "телос"'); process.exit(0); }
    const m = recallMeta(telos);
    console.log(`Память по «${telos}»: ${m.runs} релевантных прогонов`);
    if (m.confirmed.length) { console.log('\nПОДТВЕРЖДЕНО:'); m.confirmed.forEach(c => console.log('  ✓ ' + c)); }
    if (m.refuted.length) { console.log('\nОПРОВЕРГНУТО:'); m.refuted.forEach(r => console.log('  ✗ ' + r)); }
    if (!m.runs) console.log('(журнал пуст или нет близких тем)');
  } else if (cmd === 'list') {
    const arr = load();
    console.log(`Журнал прогонов: ${arr.length} записей (${META_PATH})`);
    for (const e of arr.slice(-10)) console.log(`  [${e.ts.slice(0, 10)}] «${e.telos}» → ${e.winner?.text?.slice(0, 60) || '?'}`);
  } else {
    console.log('Использование: node utils/coscientist-meta.mjs recall "телос" | list');
  }
}
