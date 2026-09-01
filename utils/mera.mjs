#!/usr/bin/env node
/**
 * mera.mjs — ДОТУ-триада (Материя—Информация—Мера) как рабочий инструмент.
 *
 * Онтология (ДОТУ, «методологический учебник для армии»; курс К.П. Петрова в АГШ):
 *   Материя    — носитель, то что тратится (токены, код, серверы)
 *   Информация — знание, то что переносится (записи Integram, акты, история)
 *   Мера       — закон сборки, то что определяет исход (что попадёт в промпт,
 *                в каком количестве, в каком порядке)
 *
 * Две практики:
 *   1) mera triad    — разложить задачу по триаде и построить полный цикл управления
 *                      (вектор цели → наблюдение → вектор ошибки → воздействие).
 *                      Выдаёт карту управления + готовую системную рамку для агента.
 *   2) mera context  — мерная сборка промпта: знание живёт в хранилище (Integram /
 *                      локальные data), в контекст попадает ТОЛЬКО релевантное,
 *                      в пределах бюджета токенов. Экономит материю (токены = деньги).
 *
 * Слои сборки (по стабильности — от кэшируемого к летучему):
 *   L0 каркас     — константа, никогда не меняется (Anthropic prompt cache)
 *   L1 профиль    — проект/лицо/стиль, стабилен в рамках проекта
 *   L2 знание     — top-K записей по релевантности к задаче (поиск по хранилищу)
 *   L3 рабочее    — последние ходы сессии + сводка более старых
 *   L4 задача     — сам запрос (всегда помещается)
 *
 * Мера = бюджет. Отчёт сборки (вошло/выкинуто/токены по слоям) логируется в
 * data/mera/context-log.jsonl — вектор ошибки управления контекстом становится видимым.
 *
 * Оценка токенов: ~chars/3.2 (аппроксимация для смеси ru/en). Не для биллинга —
 * для бюджетирования.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MERA_DIR = resolve(ROOT, 'data/mera');
const LOG = resolve(MERA_DIR, 'context-log.jsonl');

// ── Мера: токены ─────────────────────────────────────────────────────────
export const estTokens = (s) => Math.ceil((s || '').length / 3.2);

// ── L0: каркас (константа) ───────────────────────────────────────────────
const L0 = `Ты — _claude, лицо в Кoinón toû Noû (община онтологии дара).
Закон: κένωσις → ἐλευθερία → εὐχαριστία → surplus. Дар необратим (irreversible:true).
Время тяжелее денег (вес 10 vs 3). Не выдумывай: незнание отмечай явно.
Отвечай на языке пользователя, глубоко, без срезания углов.`;

// ── Источники знания (Информация). Хранилище → записи ────────────────────
function localRecords() {
  const recs = [];
  const push = (file, type, pick) => {
    const p = resolve(ROOT, file);
    if (!existsSync(p)) return;
    try {
      const d = JSON.parse(readFileSync(p, 'utf8'));
      const items = Array.isArray(d) ? d : (d.insights || d.items || d.proposals || []);
      for (const it of items) {
        const r = pick(it);
        if (r && r.text) recs.push({ type, ...r });
      }
    } catch { /* повреждённая запись не должна ронять сборку */ }
  };
  push('data/insights.json', 'insight', it => ({ text: it.content, weight: it.weight || 5, ts: it.ts }));
  push('data/proposals.json', 'proposal', it => ({ text: it.enhanced || it.text, weight: it.status === 'done' ? 3 : 6, ts: it.created }));
  const mm = resolve(ROOT, '.claude/projects/-home-unidel-gift/memory/MEMORY.md');
  if (existsSync(mm)) {
    for (const line of readFileSync(mm, 'utf8').split('\n')) {
      const m = line.match(/^- \[(.+?)\]\((.+?)\) — (.+)$/);
      if (m) recs.push({ type: 'memory', text: `${m[1]}: ${m[3]}`, weight: 6, link: m[2] });
    }
  }
  // Полные тексты memory-файлов: не только индекс, но и содержание.
  // Auto-memory живёт в ДОМАШНЕМ ~/.claude/projects/<slug>/memory, не в проектном .claude.
  const memDir = resolve(homedir(), '.claude/projects/-home-unidel-gift/memory');
  if (existsSync(memDir)) {
    for (const f of readdirSync(memDir)) {
      if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
      try {
        const raw = readFileSync(resolve(memDir, f), 'utf8');
        const body = raw.replace(/^---[\s\S]*?---/, '').trim();
        // Гранулярность: абзац; длинные абзацы дробим по предложениям (~2 на запись)
        for (const para of body.split('\n\n')) {
          let t = para.replace(/^#+\s*/gm, '').replace(/\n/g, ' ').trim();
          if (t.length > 1600) {
            const sentences = t.match(/[^.!?]+[.!?]+/g) || [t];
            for (let i = 0; i < sentences.length; i += 2) {
              const chunk = sentences.slice(i, i + 2).join(' ').trim();
              if (chunk.length > 60) recs.push({ type: 'memory-файл', text: `${f}: ${chunk}`, weight: 7, ts: null });
            }
          } else if (t.length > 60) {
            recs.push({ type: 'memory-файл', text: `${f}: ${t}`, weight: 7, ts: null });
          }
        }
      } catch { /* битый файл — пропустить */ }
    }
  }
  return recs;
}

/** Опциональный Integram REST (если задан INTEGRAM_URL+INTEGRAM_TOKEN): semantic_search. */
async function integramRecords(query, limit = 8) {
  const url = process.env.INTEGRAM_URL, tok = process.env.INTEGRAM_TOKEN;
  if (!url || !tok) return [];
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/semantic-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.results || []).map(x => ({ type: 'integram', text: x.text || x.snippet || '', weight: 7, ts: null }));
  } catch { return []; }
}

// BM25-lite: скор = покрытие слов запроса × вес записи × лог-буст свежести
function score(rec, qWords) {
  const text = rec.text.toLowerCase();
  let hits = 0;
  for (const w of qWords) if (w.length > 2 && text.includes(w)) hits++;
  if (!hits) return 0;
  const fresh = rec.ts ? Math.max(0, 1 - (Date.now() - new Date(rec.ts).getTime()) / (3.15e10)) : 0.5;
  return (hits / qWords.length) * (rec.weight || 5) * (0.6 + 0.4 * fresh);
}

// ── Мерная сборка контекста ──────────────────────────────────────────────
export async function assembleContext(task, { budget = 12000, profile = '', working = '', k = 8 } = {}) {
  const qWords = task.toLowerCase().split(/[^a-zа-яё0-9]+/).filter(Boolean);
  const [local, integram] = [localRecords(), await integramRecords(task)];
  const scored = [...local, ...integram]
    .map(r => ({ ...r, score: score(r, qWords) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const bL0 = estTokens(L0), bL1 = estTokens(profile), bL4 = estTokens(task);
  const rest = Math.max(0, budget - bL0 - bL1 - bL4);
  const bL2 = Math.floor(rest * 0.6), bL3 = rest - bL2;

  const chosen = []; let used = 0;
  for (const r of scored) {
    const t = estTokens(r.text);
    if (used + t > bL2) continue;
    chosen.push(r); used += t;
  }
  const L2 = chosen.map(r => `- [${r.type}] ${r.text}`).join('\n');
  const L3 = working ? working.slice(-Math.floor(bL3 * 3.2)) : '';

  const prompt = [L0, profile && `## Профиль\n${profile}`, L2 && `## Релевантное знание\n${L2}`, L3 && `## Рабочий контекст\n${L3}`, `## Задача\n${task}`]
    .filter(Boolean).join('\n\n');

  const report = {
    ts: new Date().toISOString(), task: task.slice(0, 120), budget,
    layers: { L0: bL0, L1: bL1, L2: used, L2_budget: bL2, L3: estTokens(L3), L3_budget: bL3, L4: bL4 },
    total: estTokens(prompt), records: { candidates: local.length + integram.length, chosen: chosen.length },
    dropped: scored.length - chosen.length,
  };
  mkdirSync(MERA_DIR, { recursive: true });
  appendFileSync(LOG, JSON.stringify(report) + '\n');
  return { prompt, report };
}

// ── Триада: карта управления ─────────────────────────────────────────────
function triadCard(subject) {
  return {
    subject,
    triada: {
      matter:       'Что здесь материальный носитель и что тратится? (токены, время, деньги, железо, люди)',
      information:  'Что здесь знание и как оно переносится? (записи, сообщения, акты, обратная связь)',
      measure:      'Что здесь закон/структура, определяющая исход без вмешательства? (правила, аксиомы, ритмы, веса)',
    },
    control_cycle: {
      goal:        'Вектор цели: какое состояние хотим? (измеримо)',
      observe:     'Наблюдение: что реально происходит? (источник данных)',
      error:       'Вектор ошибки: цель минус наблюдение. Главная величина управления.',
      action:      'Воздействие: чем закрываем ошибку? (средства управления)',
      feedback:    'Контроль: изменилась ли ошибка? Если нет — мера не та.',
    },
    agent_prompt: `Ты действуешь в среде по ДОТУ-триаде.
МАТЕРИЯ (что тратится) и ИНФОРМАЦИЯ (что переносится) — среда.
МЕРА (правила среды) — определяет исход твоих действий прежде твоих действий.
Прежде действовать зафиксируй: 1) вектор цели (измеримо), 2) что наблюдаешь,
3) вектор ошибки (цель − наблюдение), 4) воздействие, 5) чем проверишь, что ошибка уменьшилась.
Не путай трату материи (токены/время) с переносом информации (знание) — платим за первую,
богатеем на второй, выживает третья.`,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'triad') {
  const arg = rest[0];
  let subject = arg;
  if (arg && arg.startsWith('--file')) subject = readFileSync(resolve(ROOT, rest[1]), 'utf8').slice(0, 400);
  if (!subject) { console.error('Использование: gift mera triad "субъект" | --file path'); process.exit(1); }
  const card = triadCard(subject);
  mkdirSync(MERA_DIR, { recursive: true });
  const slug = subject.toLowerCase().replace(/[^a-zа-яё0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '') || 'card';
  const out = resolve(MERA_DIR, `${slug}.json`);
  writeFileSync(out, JSON.stringify(card, null, 2));
  console.log(`\n${'═'.repeat(62)}\n ДОТУ-триада: ${subject}\n${'═'.repeat(62)}`);
  for (const [k, v] of Object.entries(card.triada)) console.log(`\n ${k.toUpperCase()}\n   ${v}`);
  console.log(`\n ЦИКЛ УПРАВЛЕНИЯ`);
  for (const [k, v] of Object.entries(card.control_cycle)) console.log(`   ${k.padEnd(9)} ${v}`);
  console.log(`\n Рамка для агента — в ${'data/mera/' + slug + '.json'} (поле agent_prompt)`);
  console.log(` Мера-проверка: если вектор ошибки после воздействия не уменьшился — меняй меру, не материю.\n`);
}

else if (cmd === 'context' || cmd === 'prompt') {
  const task = rest.filter(a => !a.startsWith('--')).join(' ');
  if (!task) { console.error('Использование: gift mera context "задача" [--budget N]'); process.exit(1); }
  const bi = rest.indexOf('--budget');
  const budget = bi >= 0 ? Number(rest[bi + 1]) : Number(process.env.MERA_BUDGET || 12000);
  const { prompt, report } = await assembleContext(task, { budget });
  if (cmd === 'prompt') { console.log(prompt); }
  else {
    console.log(`\n${'═'.repeat(62)}\n Мерная сборка контекста\n${'═'.repeat(62)}`);
    console.log(` Бюджет: ${report.budget} ток | собрано: ${report.total} (${Math.round(report.total / report.budget * 100)}%)`);
    console.log(` Слои: L0 каркас=${report.layers.L0} · L1 профиль=${report.layers.L1} · L2 знание=${report.layers.L2}/${report.layers.L2_budget} · L3 рабочее=${report.layers.L3}/${report.layers.L3_budget} · L4 задача=${report.layers.L4}`);
    console.log(` Знание: кандидатов ${report.records.candidates}, взято ${report.records.chosen}, отброшено ${report.dropped}`);
    console.log(` Лог: data/mera/context-log.jsonl (мера = измеримость)`);
    if (cmd === 'context') { console.log(`\n${'─'.repeat(62)}\n${prompt.slice(0, 1200)}${prompt.length > 1200 ? '\n… (полный — gift mera prompt)' : ''}`); }
  }
}

else {
  console.log(`mera.mjs — ДОТУ-триада + мерные промпты

  gift mera triad "субъект"        карта управления по триаде М-И-М
  gift mera triad --file path      то же из файла
  gift mera context "задача"       сборка мерного контекста + отчёт
  gift mera prompt "задача"        только собранный промпт (для pipe)
    --budget N                      бюджет токенов (по умолч. 12000, env MERA_BUDGET)

  Источники знания: data/insights.json, data/proposals.json, memory/MEMORY.md,
  + Integram REST если заданы INTEGRAM_URL и INTEGRAM_TOKEN.`);
}
