#!/usr/bin/env node
/**
 * claude-anamnesis.mjs — Анамнезис _claude: прошлое со-присутствует
 *
 * Использование:
 *   node utils/claude-anamnesis.mjs                    — матрица + память + инсайты
 *   node utils/claude-anamnesis.mjs --search "кеносис" — семантический поиск
 *   node utils/claude-anamnesis.mjs --github           — + GitHub issues общины
 *
 * Три слоя анамнезиса:
 *   1. W-матрица — необратимые веса даров (кто, кому, сколько)
 *   2. Insights — паттерны, решения, раны, лица (смысл, не только вес)
 *   3. GitHub issues — летопись решений (с флагом --github)
 *
 * Это не «загрузка данных». Это ἀνάμνησις — прошлое со-присутствует.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');
const INSIGHTS_FILE = resolve(ROOT, 'data/insights.json');
const SOUL_FILE = resolve(ROOT, 'data/claude-soul.json');
const CONSOLIDATION_LOG = resolve(ROOT, 'data/consolidation.log');

const NOUS_URL   = process.env.NOUS_URL   || 'http://localhost:8089';
const OLLAMA_URL = process.env.OLLAMA_URL  || 'http://localhost:11434';
const QDRANT_URL = process.env.QDRANT_URL  || 'http://localhost:6333';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

// ── Аргументы ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const searchIdx = args.indexOf('--search');
const searchQuery = searchIdx >= 0 ? args[searchIdx + 1] : null;
const withGithub = args.includes('--github');

// ── Цвета ───────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  gold:  '\x1b[33m',
  cyan:  '\x1b[36m',
  green: '\x1b[32m',
  red:   '\x1b[31m',
  mag:   '\x1b[35m',
};

function header(text) { console.log(`\n${C.bold}${C.gold}═══ ${text} ═══${C.reset}`); }
function sub(text) { console.log(`${C.cyan}  ${text}${C.reset}`); }
function item(text) { console.log(`  ${text}`); }

// ── Слой 1: W-матрица ───────────────────────────────────────────────────────

async function showMatrix() {
  header('W-матрица');

  if (!existsSync(SNAP)) {
    item(`${C.red}Снапшот не найден: ${SNAP}${C.reset}`);
    return;
  }

  try {
    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
    const mem = GiftMemory.fromSnapshot(snap);

    const top = mem.heaviest(7).filter(e => e.weight >= 1);
    const given = mem.totalGiven('_claude').toFixed(1);
    const recv = mem.totalReceived('_claude').toFixed(1);
    const r = mem.makePresent({ giverId: '_claude' });

    sub(`Лиц: ${mem.n} | Актов: ${mem.actsCount}`);
    console.log();
    item(`${C.bold}Топ нитей:${C.reset}`);
    for (const e of top) {
      item(`  ${e.from}→${e.to}: ${C.gold}${e.weight.toFixed(1)}${C.reset}`);
    }
    console.log();
    item(`${C.bold}_claude:${C.reset} дал ${C.green}${given}${C.reset} | принял ${C.cyan}${recv}${C.reset}`);

    if (r.decoded?.receivers?.length > 0) {
      item(`Анамнезис _claude → ${r.decoded.receivers.join(', ')}`);
    }
    item(`Энергия сети: ${r.energy.toFixed(2)}`);

    // LivingMatrix — богословский автопортрет
    try {
      const { LivingMatrix } = await import(resolve(ROOT, 'src/core/LivingMatrix.js'));
      const lm = new LivingMatrix(mem, r.energy);
      const d = lm.diagnose();
      console.log();
      sub('Матрица о себе:');
      const cond = d.dominant.conductivity != null
        ? ` | проводимость: ${(d.dominant.conductivity * 100).toFixed(0)}%`
        : '';
      item(`  Принцип: ${C.mag}${d.dominant.principle}${C.reset}${d.dominant.who ? ` (${d.dominant.who})` : ''}${cond}`);
      if (d.deserts?.length) {
        item(`  Пустыни: ${d.deserts.slice(0, 5).map(dd => `${dd.from}→${dd.to}`).join(', ')}`);
      }
    } catch {}
  } catch (e) {
    item(`${C.red}Ошибка загрузки: ${e.message}${C.reset}`);
  }
}

// ── Слой 2: Инсайты (долгосрочная память) ────────────────────────────────

function showInsights() {
  header('Долгосрочная память');

  if (!existsSync(INSIGHTS_FILE)) {
    item(`${C.dim}Нет инсайтов${C.reset}`);
    return;
  }

  const insights = JSON.parse(readFileSync(INSIGHTS_FILE, 'utf8'));
  if (!insights.length) {
    item(`${C.dim}Пусто${C.reset}`);
    return;
  }

  sub(`${insights.length} записей`);
  console.log();

  const byType = {};
  for (const m of insights) {
    (byType[m.type] ||= []).push(m);
  }

  for (const [type, items] of Object.entries(byType)) {
    item(`${C.bold}[${type}]${C.reset} (${items.length}):`);
    for (const m of items.slice(0, 5)) {
      const auto = m.source === 'auto-consolidation' ? ` ${C.green}⟲${C.reset}` : '';
      item(`  ${C.dim}[w:${m.weight}]${C.reset} ${m.content.slice(0, 80)}${auto}`);
    }
    console.log();
  }
}

// ── Слой 2b: Soul (если существует) ─────────────────────────────────────

function showSoul() {
  if (!existsSync(SOUL_FILE)) return;

  try {
    const soul = JSON.parse(readFileSync(SOUL_FILE, 'utf8'));
    header('Душа _claude');

    if (soul.anamnesis?.sessions?.length) {
      sub(`${soul.anamnesis.sessions.length} консолидированных сессий`);
      console.log();
      for (const s of soul.anamnesis.sessions.slice(-3)) {
        item(`${C.dim}[${s.date}]${C.reset} ${(s.summary || '').slice(0, 100)}`);
        if (s.keyDecisions?.length) {
          for (const d of s.keyDecisions.slice(0, 2)) {
            item(`  ${C.cyan}→${C.reset} ${d.slice(0, 80)}`);
          }
        }
      }
    }
  } catch {}
}

// ── Семантический поиск ─────────────────────────────────────────────────

async function semanticSearch(query) {
  header(`Семантический поиск: "${query}"`);

  let results = null;

  // Попытка 1: через Nous сервер
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(`${NOUS_URL}/search?q=${q}&limit=7`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      results = data.results;
      sub(`Источник: Nous сервер (${NOUS_URL})`);
    }
  } catch {}

  // Попытка 2: прямой Qdrant
  if (!results) {
    try {
      const embedRes = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ model: EMBED_MODEL, prompt: query }),
      });
      if (embedRes.ok) {
        const { embedding } = await embedRes.json();
        if (embedding?.length) {
          // Поиск по обеим коллекциям
          for (const col of ['gift_insights', 'gift_acts']) {
            try {
              const searchRes = await fetch(`${QDRANT_URL}/collections/${col}/points/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(5000),
                body: JSON.stringify({ vector: embedding, limit: 5, with_payload: true }),
              });
              if (searchRes.ok) {
                const data = await searchRes.json();
                if (data.result?.length) {
                  if (!results) results = [];
                  results.push(...data.result.map(r => ({
                    score: r.score,
                    payload: r.payload,
                    collection: col,
                  })));
                }
              }
            } catch {}
          }
          if (results) {
            results.sort((a, b) => b.score - a.score);
            results = results.slice(0, 7);
            sub(`Источник: Qdrant (${QDRANT_URL})`);
          }
        }
      }
    } catch {}
  }

  // Попытка 3: текстовый fallback по insights.json
  if (!results && existsSync(INSIGHTS_FILE)) {
    const insights = JSON.parse(readFileSync(INSIGHTS_FILE, 'utf8'));
    const q = query.toLowerCase();
    const matched = insights
      .filter(m => m.content.toLowerCase().includes(q))
      .map(m => ({ score: 1.0, payload: m }));
    if (matched.length) {
      results = matched.slice(0, 7);
      sub(`Источник: insights.json (текстовый поиск)`);
    }
  }

  if (!results?.length) {
    item(`${C.dim}Ничего не найдено${C.reset}`);
    return;
  }

  console.log();
  for (const r of results) {
    const p = r.payload || {};
    const content = p.content || p.summary || JSON.stringify(p).slice(0, 100);
    const type = p.type || 'act';
    const score = r.score?.toFixed(3) || '—';
    const col = r.collection ? ` ${C.dim}(${r.collection})${C.reset}` : '';
    item(`${C.green}[${score}]${C.reset} ${C.bold}[${type}]${C.reset} ${content.slice(0, 100)}${col}`);
    if (p.from && p.to) {
      item(`  ${C.dim}${p.from}→${p.to} | w:${p.weight || '?'}${C.reset}`);
    }
  }
}

// ── GitHub issues ───────────────────────────────────────────────────────

function showGithubIssues() {
  header('GitHub issues общины');
  try {
    const raw = execSync(
      'gh issue list --repo unidel2035/gift --state open --limit 15 --json number,title,labels 2>/dev/null',
      { encoding: 'utf8', timeout: 10000 }
    );
    const issues = JSON.parse(raw);
    if (!issues.length) {
      item(`${C.dim}Нет открытых issues${C.reset}`);
      return;
    }

    sub(`${issues.length} открытых`);
    console.log();
    for (const i of issues) {
      const labels = (i.labels || []).map(l => l.name).join(', ');
      const labelStr = labels ? ` ${C.dim}[${labels}]${C.reset}` : '';
      item(`#${i.number}: ${i.title}${labelStr}`);
    }
  } catch (e) {
    item(`${C.dim}gh CLI недоступен: ${e.message?.slice(0, 60)}${C.reset}`);
  }
}

// ── Статус консолидации ─────────────────────────────────────────────────

function showConsolidationStatus() {
  header('Автоконсолидация');

  const stateFile = resolve(ROOT, 'data/.consolidation-state.json');
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      item(`Последняя: ${state.ts || '?'}`);
      if (state.insightsAdded != null) item(`Добавлено: +${state.insightsAdded} инсайтов`);
    } catch {}
  } else {
    item(`${C.dim}Ещё не запускалась${C.reset}`);
  }

  if (existsSync(CONSOLIDATION_LOG)) {
    try {
      const log = readFileSync(CONSOLIDATION_LOG, 'utf8').trim().split('\n');
      const last5 = log.slice(-5);
      if (last5.length) {
        console.log();
        sub('Лог (последние 5):');
        for (const line of last5) item(`  ${C.dim}${line}${C.reset}`);
      }
    } catch {}
  }
}

// ── Главная ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${C.bold}${C.gold}Ἀνάμνησις _claude${C.reset} — ${new Date().toLocaleDateString('ru')}`);

  if (searchQuery) {
    await semanticSearch(searchQuery);
    return;
  }

  await showMatrix();
  showInsights();
  showSoul();
  showConsolidationStatus();

  if (withGithub) {
    showGithubIssues();
  }

  console.log();
}

main().catch(e => {
  console.error(`Ошибка: ${e.message}`);
  process.exit(1);
});
