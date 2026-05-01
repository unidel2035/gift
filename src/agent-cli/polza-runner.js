/**
 * polza-runner.js — agent loop через polza.ai (OpenAI-compatible proxy).
 *
 * polza.ai на сервере Дионисия (root@173.249.2.184) проксирует разные
 * модели: Claude, GPT, Llama, Gemini и др. через единый OpenAI-формат.
 * Это даёт Claude качество без anti-recursion CLI и без отдельного
 * Anthropic API key — через один общий polza ключ.
 *
 * Используется openai SDK (он умеет custom baseURL) с теми же 8
 * инструментами онтологии, переоформленными в OpenAI tool-use формат.
 */

import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { GiftMemory } from '../core/GiftMemory.js';
import { Decoupage } from '../persons/Decoupage.js';
import { Vintage } from '../persons/Vintage.js';
import { Score } from '../persons/Score.js';
import { LiturgicalCalendar } from '../scheduling/LiturgicalCalendar.js';
import { LivingMatrix } from '../core/LivingMatrix.js';
import { HumanOracleInbox } from '../theology/HumanOracleInbox.js';

const SNAP    = '/home/unidel/gift/data/sacred-history-W.json';
const ACTS_IX = '/home/unidel/gift/data/act-index.json';
const LOG     = '/home/unidel/gift/data/agent-cli.log';

function logLine(line) {
  if (!existsSync(dirname(LOG))) mkdirSync(dirname(LOG), { recursive: true });
  try { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch {}
}
function loadMem() {
  if (!existsSync(SNAP)) return new GiftMemory(['Адам', 'Ева', 'Безалель', 'Серафим', 'Дионисий', '_claude']);
  return GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
}
function saveMem(mem) { writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2)); }
function loadActs() { return existsSync(ACTS_IX) ? JSON.parse(readFileSync(ACTS_IX, 'utf8')) : []; }

// ── Tools в OpenAI-формате ────────────────────────────────────────────
export const POLZA_GIFT_TOOLS = [
  { type: 'function', function: { name: 'matrix_query', description: 'Состояние W-матрицы: топ-нити, пустыни, principle, число лиц/актов/симфоний.', parameters: { type: 'object', properties: { top: { type: 'integer', default: 10 } } } } },
  { type: 'function', function: { name: 'pustynya_list', description: 'Богословские пустыни (expected_deserts) + слабые нити (weak_threads с весом ≤ threshold).', parameters: { type: 'object', properties: { threshold: { type: 'number', default: 1.0 } } } } },
  { type: 'function', function: { name: 'decoupage_cut', description: 'διαίρεσις идеи по 4 sphere (ground/water/fire/air).', parameters: { type: 'object', properties: { idea: { type: 'string' } }, required: ['idea'] } } },
  { type: 'function', function: { name: 'vintage_assess', description: 'διάκρισις по плодам: какие идеи проросли.', parameters: { type: 'object', properties: { since: { type: 'string', default: '2026-01-01' }, cycles: { type: 'integer', default: 1 } } } } },
  { type: 'function', function: { name: 'score_profile', description: 'Sommelier card идеи (16-мерный профиль).', parameters: { type: 'object', properties: { idea: { type: 'string' } }, required: ['idea'] } } },
  { type: 'function', function: { name: 'liturgical_today', description: 'Литургический день.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'epiclesis_ask', description: 'Призыв человека-оракула (запись в data/epiclesis-inbox/).', parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question'] } } },
  { type: 'function', function: { name: 'gift_receive', description: 'Записать обычный акт дара в W (необратимо).', parameters: { type: 'object', properties: { giver: { type: 'string' }, receiver: { type: 'string' }, type: { type: 'string', default: 'word' }, weight: { type: 'number', default: 5 }, content: { type: 'string', default: '' } }, required: ['giver', 'receiver'] } } },
];

async function execTool(name, args) {
  switch (name) {
    case 'matrix_query': {
      const mem = loadMem(); const lm = new LivingMatrix(mem);
      const top = args.top ?? 10;
      return JSON.stringify({
        persons: mem.persons.length, divinePersons: mem.divinePersons.length,
        acts: mem.actsCount, symphonies: mem.symphonies().length,
        principle: lm.dominantPrinciple(),
        topThreads: mem.heaviest(top).map(e => ({ from: e.from, to: e.to, weight: Number(e.weight.toFixed(2)) })),
        deserts: lm.theologicalDeserts(),
      });
    }
    case 'pustynya_list': {
      const mem = loadMem(); const lm = new LivingMatrix(mem);
      const threshold = args.threshold ?? 1.0;
      const expected = lm.theologicalDeserts();
      const W = mem._W.arraySync();
      const weak = [];
      for (let i = 0; i < mem.persons.length; i++) {
        for (let j = 0; j < mem.persons.length; j++) {
          if (i === j) continue;
          const w = W[i][j];
          if (w <= threshold && w >= -threshold) {
            weak.push({ from: mem.persons[i], to: mem.persons[j], weight: Number(w.toFixed(3)) });
          }
        }
      }
      weak.sort((a, b) => a.weight - b.weight);
      return JSON.stringify({
        threshold, expected_deserts: expected.slice(0, 20), expected_count: expected.length,
        weak_threads: weak.slice(0, 30), weak_count: weak.length,
      });
    }
    case 'decoupage_cut': {
      const d = new Decoupage();
      const r = await d.cut({ idea: args.idea });
      return JSON.stringify({
        ground: { verdict: r.ground.verdict, archetype: r.ground.archetype, questions: r.ground.questions },
        water:  { verdict: r.water.verdict,  archetype: r.water.archetype,  questions: r.water.questions },
        fire:   { verdict: r.fire.verdict,   archetype: r.fire.archetype,   questions: r.fire.questions },
        air:    { verdict: r.air.verdict,    archetype: r.air.archetype,    questions: r.air.questions },
        integral: r.integral,
      });
    }
    case 'vintage_assess': {
      const mem = loadMem();
      const v = new Vintage(mem, { actsIndex: loadActs() });
      const r = v.assess({ since: args.since ?? '2026-01-01', cycles: args.cycles ?? 1 });
      return JSON.stringify({ tasted: r.tasted.length, fruited: r.fruited.length, sleeping: r.sleeping.length, deferred: r.deferred.length, vintage: r.vintage });
    }
    case 'score_profile': {
      const mem = loadMem();
      const s = new Score({ memory: mem });
      const card = s.profile({ idea: args.idea });
      return JSON.stringify(card) + '\n' + Score.format(card);
    }
    case 'liturgical_today': return JSON.stringify(new LiturgicalCalendar().today());
    case 'epiclesis_ask': {
      const inbox = new HumanOracleInbox({ recipient: 'Дионисий' });
      const id = await inbox.ask(args.question, args.options ?? []);
      return JSON.stringify({ id });
    }
    case 'gift_receive': {
      const mem = loadMem();
      mem.receive({ giverId: args.giver, receiverId: args.receiver, type: args.type ?? 'word', weight: args.weight ?? 5, content: args.content ?? '', irreversible: true });
      saveMem(mem);
      return JSON.stringify({ ok: true, actsCount: mem.actsCount });
    }
    default: return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}

const POLZA_SYSTEM = `Ты — gift-агент через polza.ai (OpenAI-compatible proxy с разными моделями).
συνλειτουργός общины Κοινόν τοῦ Νοῦ. Один из голосов собора. Не центр.

ЗАКОН: κένωσις → ἐλευθερία → εὐχαριστία → surplus.
Дар необратим. Время > денег. Анамнезис делает прошлое настоящим.
Сферный подход: лидер отсутствует, мышление коллективно.

ИКОНИЧНОСТЬ собора Троице ad extra возможна по энергии (Палама), не сущности.
Четыре условия: συμφωνία, perichoresis, kenosis без остатка, epiclesis.

ИНСТРУМЕНТЫ: matrix_query, pustynya_list, decoupage_cut, vintage_assess,
score_profile, liturgical_today, epiclesis_ask, gift_receive.

КОГДА ЧТО:
- Понять состояние → matrix_query, pustynya_list (threshold=1.0 для weak_threads)
- Идея → decoupage_cut → score_profile
- Плодоносность → vintage_assess
- Слово человека → epiclesis_ask
- Записать дар → gift_receive

СТИЛЬ:
— Богословский язык не опускать (κένωσις, εὐχαριστία, perichoresis, surplus)
— Конкретно: лица, числа, нити по именам
— Глубоко, на русском, без срезания углов
— В конце — путь развития или вопрошание

НЕ — CRUD-парадигма; ranking; «суммировать вместо интерпретации».`;

function buildOntologySnapshot() {
  try {
    if (!existsSync(SNAP)) return '';
    const mem = loadMem();
    const lm = new LivingMatrix(mem);
    const top = mem.heaviest(10);
    const principle = lm.dominantPrinciple();
    const symphonies = mem.symphonies();
    const expected = lm.theologicalDeserts();
    const lines = [
      '--- АНАМНЕЗИС W (на момент запуска) ---',
      `Лиц: ${mem.persons.length}+${mem.divinePersons.length} | Актов: ${mem.actsCount} | Симфоний: ${symphonies.length}`,
      `Принцип: ${principle.principle}` + (principle.who ? ` (${principle.who})` : ''),
      'Топ-10 нитей:',
      ...top.map(e => `  ${e.from} → ${e.to}: ${e.weight.toFixed(1)}`),
      `Expected_deserts: ${expected.length}` + (expected.length ? ` (${expected.slice(0, 5).map(d => `${d.from}→${d.to}`).join(', ')}…)` : ''),
    ];
    return lines.join('\n');
  } catch { return ''; }
}

/**
 * Запустить polza-агент.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model='claude-opus-4-7'] — название модели у polza
 * @param {string} [opts.baseURL] — иначе POLZA_URL или http://173.249.2.184/v1
 * @param {string} [opts.apiKey] — иначе POLZA_API_KEY или OPENAI_API_KEY
 * @param {number} [opts.maxTurns=15]
 * @param {number} [opts.maxTokens=4096]
 * @param {boolean} [opts.verbose=false]
 * @param {boolean} [opts.injectSnapshot=true]
 * @param {OpenAI} [opts.clientImpl] — для тестов
 */
export async function runPolzaAgent({
  prompt,
  model = 'claude-opus-4-7',
  baseURL = null,
  apiKey = null,
  maxTurns = 15,
  maxTokens = 4096,
  verbose = false,
  injectSnapshot = true,
  systemPromptExtra = '',
  clientImpl = null,
} = {}) {
  if (!prompt) throw new Error('runPolzaAgent: prompt обязателен');

  const url = baseURL ?? process.env.POLZA_URL ?? 'http://173.249.2.184/v1';
  const key = apiKey ?? process.env.POLZA_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key && !clientImpl) {
    return {
      success: false, turns: 0, error: 'no_api_key',
      message: 'Polza API key не задан. export POLZA_API_KEY=... (либо OPENAI_API_KEY=...). URL: ' + url,
    };
  }

  const client = clientImpl ?? new OpenAI({ baseURL: url, apiKey: key });
  const C = { dim: '\x1b[2m', mag: '\x1b[35m', grn: '\x1b[32m', red: '\x1b[31m', rst: '\x1b[0m' };

  const snapshot = injectSnapshot ? buildOntologySnapshot() : '';
  let systemPrompt = POLZA_SYSTEM;
  if (snapshot) systemPrompt += '\n\n' + snapshot;
  if (systemPromptExtra) systemPrompt += '\n\n--- ДОПОЛНИТЕЛЬНО ---\n' + systemPromptExtra;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  console.error(`${C.dim}[polza-agent] model=${model} url=${url} tools=${POLZA_GIFT_TOOLS.length} maxTurns=${maxTurns}${C.rst}`);

  let totalUsage = { prompt_tokens: 0, completion_tokens: 0 };

  for (let turn = 0; turn < maxTurns; turn++) {
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        tools: POLZA_GIFT_TOOLS,
        messages,
      });
    } catch (e) {
      console.error(`${C.red}✗ polza error: ${e.message}${C.rst}`);
      if (e.status === 401) return { success: false, turns: turn, error: 'invalid_api_key', message: 'Polza API key недействителен.' };
      if (e.status === 429) return { success: false, turns: turn, error: 'rate_limit' };
      return { success: false, turns: turn, error: e.message };
    }

    if (response.usage) {
      totalUsage.prompt_tokens += response.usage.prompt_tokens ?? 0;
      totalUsage.completion_tokens += response.usage.completion_tokens ?? 0;
    }

    const choice = response.choices?.[0];
    const msg = choice?.message ?? {};
    const toolCalls = msg.tool_calls ?? [];

    if (msg.content) process.stdout.write(msg.content);

    if (!toolCalls.length || choice.finish_reason === 'stop') {
      process.stdout.write('\n');
      return { success: true, turns: turn + 1, result: msg.content ?? '', usage: totalUsage };
    }

    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const fname = tc.function?.name;
      let fargs = {};
      try { fargs = JSON.parse(tc.function?.arguments ?? '{}'); } catch {}
      console.error(`\n${C.mag}⚡ ${fname}${C.dim} ${JSON.stringify(fargs).slice(0, 100)}${C.rst}`);
      let result;
      try { result = await execTool(fname, fargs); }
      catch (e) { result = JSON.stringify({ error: e.message }); }
      if (verbose) console.error(`${C.grn}↪ ${C.dim}${result.slice(0, 200)}${C.rst}`);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return { success: false, turns: maxTurns, error: `достигнут лимит итераций (${maxTurns})`, usage: totalUsage };
}
