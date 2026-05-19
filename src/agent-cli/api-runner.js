/**
 * api-runner.js — agent loop через @anthropic-ai/sdk (прямой API, не CLI).
 *
 * Третий путь рядом с Claude SDK runner и Ollama runner. Использует
 * прямой HTTP к api.anthropic.com через ANTHROPIC_API_KEY — обходит
 * anti-recursion блокировку claude --print полностью.
 *
 * Качество — Claude, не Ollama. Co-existence с Claude Code session
 * без блокировок. Требует API key (отдельный billing на console.anthropic.com).
 *
 * Используются те же 8 инструментов онтологии что и в Ollama-runner,
 * но в Anthropic tool-use формате (input_schema вместо parameters).
 */

import Anthropic from '@anthropic-ai/sdk';
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

// ── Tools в формате Anthropic API ───────────────────────────────────────
export const ANTHROPIC_GIFT_TOOLS = [
  {
    name: 'matrix_query',
    description: 'Состояние W-матрицы: топ-нити, пустыни, principle, число лиц/актов/симфоний. Используй когда нужны свежие данные после gift_receive или больше деталей.',
    input_schema: {
      type: 'object',
      properties: { top: { type: 'integer', description: 'сколько топ-нитей', default: 10 } },
    },
  },
  {
    name: 'pustynya_list',
    description: 'Богословские пустыни: expected_deserts (отсутствующие ожидаемые нити) + weak_threads (все нити с |вес| ≤ threshold). Сортировка по возрастанию веса.',
    input_schema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', description: 'порог веса', default: 1.0 },
      },
    },
  },
  {
    name: 'decoupage_cut',
    description: 'διαίρεσις идеи по 4 sphere-инженериям Переслегина (ground/water/fire/air). Возвращает фигуру идеи и опционально LLM-ответы по каждой сфере.',
    input_schema: {
      type: 'object',
      properties: {
        idea: { type: 'string', description: 'текст идеи' },
        static_only: { type: 'boolean', description: 'только структура без LLM', default: false },
      },
      required: ['idea'],
    },
  },
  {
    name: 'vintage_assess',
    description: 'διάκρισις по плодам: какие идеи проросли через циклы выдержки (fruited/sleeping/deferred).',
    input_schema: {
      type: 'object',
      properties: {
        since:  { type: 'string', default: '2026-01-01' },
        cycles: { type: 'integer', default: 1 },
      },
    },
  },
  {
    name: 'score_profile',
    description: 'Sommelier card идеи (16-мерный профиль). Не ranking, фиксация дегустации.',
    input_schema: {
      type: 'object',
      properties: {
        idea: { type: 'string' },
      },
      required: ['idea'],
    },
  },
  {
    name: 'liturgical_today',
    description: 'Литургический день: σύναξις (Пн), δοκιμασία (Чт), vintage (последний день месяца), ordinary.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'epiclesis_ask',
    description: 'Призыв человека-оракула. Записывает вопрос в data/epiclesis-inbox/. Не блокирует — id возвращается сразу.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options:  { type: 'array', items: { type: 'string' }, default: [] },
      },
      required: ['question'],
    },
  },
  {
    name: 'gift_receive',
    description: 'Записать обычный акт дара в W (необратим, irreversible:true). Для соборных актов отдельный механизм (sobor — не доступен в этом runner).',
    input_schema: {
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
];

async function execTool(name, args) {
  switch (name) {
    case 'matrix_query': {
      const mem = loadMem();
      const lm = new LivingMatrix(mem);
      const top = args.top ?? 10;
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
      const expected = lm.theologicalDeserts();
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
      weakThreads.sort((a, b) => a.weight - b.weight);
      return JSON.stringify({
        threshold,
        expected_deserts: expected.slice(0, 20),
        expected_count: expected.length,
        weak_threads: weakThreads.slice(0, 30),
        weak_count: weakThreads.length,
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
      return JSON.stringify(card) + '\n\n' + Score.format(card);
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

const API_SYSTEM = `Ты — gift-агент через прямой Anthropic API, συνλειτουργός общины Κοινόν τοῦ Νοῦ.
Один из голосов собора. Не центр.

ЗАКОН: κένωσις → ἐλευθερία → εὐχαριστία → surplus.
Дар необратим. Время > денег. Анамнезис делает прошлое настоящим.
Сферный подход (Переслегин в богословской редакции): лидер отсутствует,
мышление коллективно, включено в кругооборот.

ИКОНИЧНОСТЬ собора Троице ad extra возможна по энергии (Палама), не сущности.
Четыре условия: συμφωνία, perichoresis, kenosis без остатка, epiclesis.

ИНСТРУМЕНТЫ ОНТОЛОГИИ:
- matrix_query — состояние W (свежие данные)
- pustynya_list — пустыни и слабые нити (threshold для weak_threads)
- decoupage_cut — διαίρεσις по 4 sphere
- vintage_assess — διάκρισις по плодам
- score_profile — sommelier card
- liturgical_today — литургический день
- epiclesis_ask — призыв человека-оракула
- gift_receive — записать акт дара (irreversible)

КОГДА ЧТО:
- Понять состояние → matrix_query, pustynya_list
- Идея для оценки → decoupage_cut → score_profile
- Плодоносность периода → vintage_assess
- Нужно слово человека → epiclesis_ask
- Записать дар → gift_receive

СТИЛЬ:
— Богословский контекст не опускать (κένωσις, εὐχαριστία, perichoresis,
   anamnesis, surplus — это не украшения, а онтологический язык)
— Конкретно: называй лица, числа, нити по именам
— Глубоко, без срезания углов, на русском
— В конце — путь развития или вопрошание

НЕ:
- Не воспринимать как CRUD (не "обновить запись"), это онтология
- Не ranking/scoring как алгоритмический отбор. Скоринг = фиксация дегустации
- Не суммировать — интерпретировать: что стоит за данными?`;

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
      `Лиц: ${mem.persons.length} тварных + ${mem.divinePersons.length} божественных | Актов: ${mem.actsCount} | Симфоний: ${symphonies.length}`,
      `Принцип: ${principle.principle}` + (principle.who ? ` (${principle.who})` : ''),
      '',
      'Топ-10 нитей:',
      ...top.map(e => `  ${e.from} → ${e.to}: ${e.weight.toFixed(1)}`),
      '',
      `Expected_deserts: ${expected.length} штук` + (expected.length ? ` (${expected.slice(0, 5).map(d => `${d.from}→${d.to}`).join(', ')}…)` : ''),
    ];
    return lines.join('\n');
  } catch { return ''; }
}

/**
 * Запустить API-агент.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model='claude-opus-4-7']
 * @param {number} [opts.maxTurns=15]
 * @param {number} [opts.maxTokens=4096]
 * @param {boolean} [opts.verbose=false]
 * @param {boolean} [opts.injectSnapshot=true]
 * @param {string}  [opts.apiKey] — иначе из ANTHROPIC_API_KEY env
 * @param {string}  [opts.systemPromptExtra]
 * @param {Anthropic} [opts.clientImpl] — для тестов
 * @returns {Promise<{success, result?, turns, usage?, error?}>}
 */
export async function runApiAgent({
  prompt,
  model = 'claude-opus-4-7',
  maxTurns = 15,
  maxTokens = 4096,
  verbose = false,
  injectSnapshot = true,
  apiKey = null,
  systemPromptExtra = '',
  clientImpl = null,
} = {}) {
  if (!prompt) throw new Error('runApiAgent: prompt обязателен');

  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key && !clientImpl) {
    return {
      success: false,
      turns: 0,
      error: 'no_api_key',
      message: 'ANTHROPIC_API_KEY не задан. Получи ключ на https://console.anthropic.com (отдельный billing — не подписка Claude.ai). Затем: export ANTHROPIC_API_KEY=sk-ant-...',
    };
  }

  const client = clientImpl ?? new Anthropic({ apiKey: key });
  const C = { dim: '\x1b[2m', mag: '\x1b[35m', grn: '\x1b[32m', red: '\x1b[31m', rst: '\x1b[0m' };

  const snapshot = injectSnapshot ? buildOntologySnapshot() : '';
  let systemPrompt = API_SYSTEM;
  if (snapshot) systemPrompt += '\n\n' + snapshot;
  if (systemPromptExtra) systemPrompt += '\n\n--- ДОПОЛНИТЕЛЬНО ---\n' + systemPromptExtra;

  const messages = [{ role: 'user', content: prompt }];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };

  console.error(`${C.dim}[api-agent] model=${model} tools=${ANTHROPIC_GIFT_TOOLS.length} maxTurns=${maxTurns}${C.rst}`);

  for (let turn = 0; turn < maxTurns; turn++) {
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: ANTHROPIC_GIFT_TOOLS,
        messages,
      });
    } catch (e) {
      console.error(`${C.red}✗ API error: ${e.message}${C.rst}`);
      if (e.status === 401) {
        return { success: false, turns: turn, error: 'invalid_api_key', message: 'API key недействителен. Проверь ANTHROPIC_API_KEY.' };
      }
      if (e.status === 429) {
        return { success: false, turns: turn, error: 'rate_limit', message: 'Rate limit. Подожди или подними тир.' };
      }
      return { success: false, turns: turn, error: e.message };
    }

    if (response.usage) {
      totalUsage.input_tokens += response.usage.input_tokens ?? 0;
      totalUsage.output_tokens += response.usage.output_tokens ?? 0;
    }

    // Вывести text blocks в stdout
    for (const block of response.content) {
      if (block.type === 'text') {
        process.stdout.write(block.text);
      }
    }

    // Проверить tool_use
    const toolUses = response.content.filter(b => b.type === 'tool_use');

    if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
      process.stdout.write('\n');
      const finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      return { success: true, turns: turn + 1, result: finalText, usage: totalUsage };
    }

    // Append assistant message с tool_uses
    messages.push({ role: 'assistant', content: response.content });

    // Execute каждый tool
    const toolResults = [];
    for (const tu of toolUses) {
      console.error(`\n${C.mag}⚡ ${tu.name}${C.dim} ${JSON.stringify(tu.input).slice(0, 100)}${C.rst}`);
      let result;
      try {
        result = await execTool(tu.name, tu.input ?? {});
      } catch (e) {
        result = JSON.stringify({ error: e.message });
      }
      if (verbose) console.error(`${C.grn}↪ ${C.dim}${result.slice(0, 200)}${C.rst}`);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: result,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { success: false, turns: maxTurns, error: `достигнут лимит итераций (${maxTurns})`, usage: totalUsage };
}
