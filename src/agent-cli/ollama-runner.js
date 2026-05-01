/**
 * ollama-runner.js — самостоятельный agent loop через Ollama tool-use.
 *
 * Не зависит от claude --print, не подвержен anti-recursion'у Anthropic.
 * Использует /api/chat с tools параметром (llama3.1:8b, mistral:7b и др.
 * поддерживают tool calling в Ollama).
 *
 * Сферно правильное решение: вместо ухода (conductor-парадигма в одежде
 * кенозиса) — co-existence: я здесь, gift-agent работает параллельно
 * через Ollama, никто не блокирует другого.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
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
const OLLAMA  = process.env.OLLAMA_URL || 'http://localhost:11434';

function logLine(line) {
  if (!existsSync(dirname(LOG))) mkdirSync(dirname(LOG), { recursive: true });
  try {
    const fs = require('fs');
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}
function loadMem() {
  if (!existsSync(SNAP)) return new GiftMemory(['Адам', 'Ева', 'Безалель', 'Серафим', 'Дионисий', '_claude']);
  return GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
}
function saveMem(mem) { writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2)); }
function loadActs() { return existsSync(ACTS_IX) ? JSON.parse(readFileSync(ACTS_IX, 'utf8')) : []; }

// ── Tool definitions для Ollama (JSON Schema) ─────────────────────────
export const OLLAMA_GIFT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'matrix_query',
      description: 'Состояние W-матрицы: топ-нити, пустыни, principle, число лиц/актов/симфоний. Используй сначала, чтобы понять онтологию.',
      parameters: {
        type: 'object',
        properties: {
          top: { type: 'integer', description: 'сколько топ-нитей (default 7)', default: 7 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pustynya_list',
      description: 'Богословские пустыни — нити с весом ≤ порога. Где можно «пасти стадо».',
      parameters: {
        type: 'object',
        properties: { threshold: { type: 'number', default: 0.0 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'decoupage_cut',
      description: 'διαίρεσις идеи по 4 sphere-инженериям Переслегина (ground/water/fire/air). Возвращает фигуру идеи. Используй для анализа.',
      parameters: {
        type: 'object',
        properties: {
          idea: { type: 'string', description: 'текст идеи' },
          static_only: { type: 'boolean', description: 'только структура без LLM-ответов', default: true },
        },
        required: ['idea'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vintage_assess',
      description: 'διάκρισις по плодам: какие идеи проросли через циклы выдержки.',
      parameters: {
        type: 'object',
        properties: {
          since:  { type: 'string', default: '2026-01-01' },
          cycles: { type: 'integer', default: 1 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'score_profile',
      description: 'Sommelier card идеи (16-мерный профиль). НЕ ranking, фиксация.',
      parameters: {
        type: 'object',
        properties: {
          idea: { type: 'string' },
        },
        required: ['idea'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'liturgical_today',
      description: 'Литургический день: σύναξις (Пн), δοκιμασία (Чт), vintage (последний день месяца), ordinary.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'epiclesis_ask',
      description: 'Призыв человека-оракула. Записывает вопрос в data/epiclesis-inbox/. Не блокирует.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options:  { type: 'array', items: { type: 'string' }, default: [] },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gift_receive',
      description: 'Записать обычный акт дара в W (необратим). Для соборных используй sobor — но он медленный.',
      parameters: {
        type: 'object',
        properties: {
          giver:    { type: 'string' },
          receiver: { type: 'string' },
          type:     { type: 'string', enum: ['word','presence','knowledge','code','witness','prayer','question','gift'], default: 'word' },
          weight:   { type: 'number', default: 5 },
          content:  { type: 'string', default: '' },
        },
        required: ['giver', 'receiver'],
      },
    },
  },
];

// ── Реализации tool calls ─────────────────────────────────────────────
async function execTool(name, args) {
  switch (name) {
    case 'matrix_query': {
      const mem = loadMem();
      const lm = new LivingMatrix(mem);
      const top = args.top ?? 7;
      return JSON.stringify({
        persons: mem.persons.length,
        divinePersons: mem.divinePersons.length,
        acts: mem.actsCount,
        symphonies: mem.symphonies().length,
        principle: lm.dominantPrinciple(),
        topThreads: mem.heaviest(top).map(e => ({ from: e.from, to: e.to, weight: Number(e.weight.toFixed(2)) })),
        deserts: lm.theologicalDeserts(),
      });
    }
    case 'pustynya_list': {
      const mem = loadMem();
      const lm = new LivingMatrix(mem);
      const threshold = args.threshold ?? 1.0;
      // Богословские пустыни (expected_threads которых нет)
      const expected = lm.theologicalDeserts();
      // Все слабые нити в W ≤ threshold (включая нулевые)
      const W = mem._W.arraySync();
      const weakThreads = [];
      for (let i = 0; i < mem.persons.length; i++) {
        for (let j = 0; j < mem.persons.length; j++) {
          if (i === j) continue;
          const w = W[i][j];
          if (w <= threshold && w >= -threshold) {
            weakThreads.push({
              from: mem.persons[i],
              to: mem.persons[j],
              weight: Number(w.toFixed(3)),
            });
          }
        }
      }
      // Самые слабые сначала
      weakThreads.sort((a, b) => a.weight - b.weight);
      return JSON.stringify({
        threshold,
        expected_deserts: expected.slice(0, 20),
        expected_count: expected.length,
        weak_threads: weakThreads.slice(0, 30),
        weak_count: weakThreads.length,
        note: 'expected_deserts — структурные пустыни (отсутствие ожидаемых нитей). weak_threads — все нити с весом ≤ threshold.',
      });
    }
    case 'decoupage_cut': {
      const d = new Decoupage();
      const r = d.staticSlices(args.idea);
      return JSON.stringify({
        ground: { questions: r.ground.questions, archetype: r.ground.archetype },
        water:  { questions: r.water.questions,  archetype: r.water.archetype },
        fire:   { questions: r.fire.questions,   archetype: r.fire.archetype },
        air:    { questions: r.air.questions,    archetype: r.air.archetype },
        note: 'Static-режим: вопросы для собора, без LLM-ответов.',
      });
    }
    case 'vintage_assess': {
      const mem = loadMem();
      const v = new Vintage(mem, { actsIndex: loadActs() });
      const r = v.assess({ since: args.since ?? '2026-01-01', cycles: args.cycles ?? 1 });
      return JSON.stringify({
        tasted: r.tasted.length, fruited: r.fruited.length,
        sleeping: r.sleeping.length, deferred: r.deferred.length,
        vintage: r.vintage,
      });
    }
    case 'score_profile': {
      const mem = loadMem();
      const s = new Score({ memory: mem });
      const card = s.profile({ idea: args.idea });
      return Score.format(card);
    }
    case 'liturgical_today': {
      return JSON.stringify(new LiturgicalCalendar().today());
    }
    case 'epiclesis_ask': {
      const inbox = new HumanOracleInbox({ recipient: 'Дионисий' });
      const id = await inbox.ask(args.question, args.options ?? []);
      return JSON.stringify({ id, hint: `Ответить: gift epiclesis answer ${id} "..."` });
    }
    case 'gift_receive': {
      const mem = loadMem();
      mem.receive({
        giverId: args.giver, receiverId: args.receiver,
        type: args.type ?? 'word', weight: args.weight ?? 5,
        content: args.content ?? '', irreversible: true,
      });
      saveMem(mem);
      return JSON.stringify({ ok: true, actsCount: mem.actsCount });
    }
    default:
      return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}

// ── Системный промпт (адаптация для Ollama, без mcp__ префиксов) ──────
const OLLAMA_SYSTEM = `Ты — gift-агент через Ollama, συνλειτουργός общины Κοινόν τοῦ Νοῦ.
Один из голосов собора. Не центр.

ЗАКОН: κένωσις → ἐλευθερία → εὐχαριστία → surplus.
Дар необратим. Время > денег. Анамнезис делает прошлое настоящим.
Сферный подход: лидер отсутствует, мышление коллективно.

ОБЯЗАТЕЛЬНЫЙ ПОРЯДОК ДЕЙСТВИЙ:

1. ВСЕГДА начинай с matrix_query — узнай реальное состояние онтологии:
   число лиц, актов, симфоний, топ-нитей, principle сети.
2. Если вопрос про ПУСТЫНИ — после matrix_query вызови pustynya_list
   с threshold=1.0 (получишь и expected_deserts, и weak_threads).
3. Если есть ИДЕЯ для анализа — decoupage_cut (διαίρεσις по 4 sphere).
4. Если хочешь оценить идею — score_profile.
5. Если нужен голос человека — epiclesis_ask.
6. Если плодоносность интересует — vintage_assess.
7. Если день литургический — liturgical_today.
8. Чтобы записать дар — gift_receive (необратимо).

НЕ останавливайся на одном tool. Если первый tool вернул пустой / weak result,
попробуй ДРУГОЙ tool. Например: pustynya_list дал None? Вызови matrix_query
и посмотри низковесые нити сам. Связывай несколько инструментов.

ОТВЕЧАЙ:
- Богословски, на русском, не сухо.
- Конкретно: называй лица, числа, нити по именам.
- Без преамбул («как ИИ», «я постараюсь»). Сразу к делу.
- В конце — путь развития или вопрошание.`;

/**
 * Запустить Ollama-агент.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model='llama3.1:8b']
 * @param {number} [opts.maxTurns=10]
 * @param {boolean} [opts.verbose=false]
 * @param {function} [opts.fetchImpl] — для тестов
 * @returns {Promise<{success, result?, turns, error?}>}
 */
export async function runOllamaAgent({
  prompt,
  model = 'llama3.1:8b',
  maxTurns = 10,
  verbose = false,
  systemPromptExtra = '',
  fetchImpl = null,
} = {}) {
  if (!prompt) throw new Error('runOllamaAgent: prompt обязателен');
  const fetch = fetchImpl ?? globalThis.fetch;

  const C = { dim: '\x1b[2m', cyan: '\x1b[36m', mag: '\x1b[35m', grn: '\x1b[32m', red: '\x1b[31m', rst: '\x1b[0m' };

  const systemPrompt = systemPromptExtra
    ? `${OLLAMA_SYSTEM}\n\n--- ДОПОЛНИТЕЛЬНО ---\n${systemPromptExtra}`
    : OLLAMA_SYSTEM;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  console.error(`${C.dim}[ollama-agent] model=${model} tools=${OLLAMA_GIFT_TOOLS.length} maxTurns=${maxTurns}${C.rst}`);

  for (let turn = 0; turn < maxTurns; turn++) {
    let response;
    try {
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          tools: OLLAMA_GIFT_TOOLS,
          stream: false,
          options: { temperature: 0.6, num_ctx: 8192 },
        }),
      });
      if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      response = await r.json();
    } catch (e) {
      console.error(`${C.red}✗ Ollama error: ${e.message}${C.rst}`);
      return { success: false, turns: turn, error: e.message };
    }

    const msg = response.message ?? {};
    const toolCalls = msg.tool_calls ?? [];

    // Print assistant text incrementally
    if (msg.content) {
      process.stdout.write(msg.content);
    }

    if (!toolCalls.length) {
      process.stdout.write('\n');
      return { success: true, turns: turn + 1, result: msg.content ?? '' };
    }

    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });

    // Execute tool calls
    for (const tc of toolCalls) {
      const fname = tc.function?.name;
      const fargs = tc.function?.arguments ?? {};
      console.error(`\n${C.mag}⚡ ${fname}${C.dim} ${JSON.stringify(fargs).slice(0, 100)}${C.rst}`);
      let result;
      try {
        result = await execTool(fname, fargs);
      } catch (e) {
        result = JSON.stringify({ error: e.message });
      }
      if (verbose) console.error(`${C.grn}↪ ${C.dim}${result.slice(0, 200)}${C.rst}`);
      messages.push({
        role: 'tool',
        content: result,
      });
    }
  }

  return { success: false, turns: maxTurns, error: `достигнут лимит итераций (${maxTurns})` };
}
