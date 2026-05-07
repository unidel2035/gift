/**
 * gift-tools.js — кастомные MCP-инструменты онтологии для агентного CLI.
 *
 * Каждый инструмент — это «руки» онтологии, доступные агенту через MCP.
 * Имена в соборе следуют паттерну mcp__gift__<name> (см. allowedTools).
 *
 * Богословски: это «литургические сосуды» — Score, Sobor, Decoupage,
 * Vintage, Matrix, Epiclesis, Pustynya. Через них агент совершает
 * литургию мыслебродильни, не выходя из перихоретического собора.
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { GiftMemory } from '../core/GiftMemory.js';
import { Decoupage } from '../persons/Decoupage.js';
import { Vintage } from '../persons/Vintage.js';
import { Score } from '../persons/Score.js';
import { LiturgicalCalendar } from '../scheduling/LiturgicalCalendar.js';
import { LivingMatrix } from '../core/LivingMatrix.js';
import { HumanOracleInbox } from '../theology/HumanOracleInbox.js';
import { LcmStore, defaultDbPath } from '../lcm/store.js';
import { AgrypniaScheduler, defaultCronPath } from '../scheduling/AgrypniaScheduler.js';

const SNAP    = '/home/unidel/gift/data/sacred-history-W.json';
const ACTS_IX = '/home/unidel/gift/data/act-index.json';

function loadMem() {
  if (!existsSync(SNAP)) return new GiftMemory(['Адам', 'Ева', 'Безалель', 'Серафим', 'Дионисий', '_claude']);
  return GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
}
function saveMem(mem) {
  writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
}
function loadActs() {
  return existsSync(ACTS_IX) ? JSON.parse(readFileSync(ACTS_IX, 'utf8')) : [];
}
function txt(s) { return { content: [{ type: 'text', text: s }] }; }

// ── Matrix ──────────────────────────────────────────────────────────────
const matrixQuery = tool(
  'matrix_query',
  'Читает W-матрицу: топ нитей, пустыни, принцип сети, число лиц/актов. ' +
  'Используй когда агент должен понять текущее состояние онтологии: кто кому даёт, ' +
  'где пустыни, есть ли symphony-акты.',
  {
    top:     z.number().int().min(1).max(50).default(7).describe('сколько топ-нитей вернуть'),
    deserts: z.boolean().default(true).describe('включить богословские пустыни'),
  },
  async ({ top, deserts }) => {
    const mem = loadMem();
    const lm  = new LivingMatrix(mem);
    const heaviest = mem.heaviest(top);
    const principle = lm.dominantPrinciple();
    const symphonies = mem.symphonies();
    const out = {
      persons: mem.persons.length,
      divinePersons: mem.divinePersons.length,
      acts: mem.actsCount,
      symphonies: symphonies.length,
      principle,
      topThreads: heaviest.map(e => ({ from: e.from, to: e.to, weight: Number(e.weight.toFixed(2)) })),
      voice: lm.voice(),
    };
    if (deserts) out.deserts = lm.theologicalDeserts();
    return txt(JSON.stringify(out, null, 2));
  },
  { annotations: { readOnlyHint: true } },
);

// ── Sobor ───────────────────────────────────────────────────────────────
const soborCelebrate = tool(
  'sobor_celebrate',
  'Запускает соборное вопрошание (литургия 4-х голосов: Адам/Ева/Безалель/Серафим). ' +
  'Возвращает голоса собора и проверку 4 условий иконичности (chorus, perichoretic, ' +
  'kenotic, epiclesis). Без эпиклезы → не-икона, обычные акты. С эпиклезой и всеми 4 ' +
  '→ symphony-акт записан в W.',
  {
    question:        z.string().min(5).describe('тема собора'),
    weight:          z.number().min(0.5).max(10).default(7),
    use_oracle:      z.boolean().default(false).describe('активировать эпиклезу через HumanOracleInbox'),
    epiclesis_timeout_ms: z.number().int().min(1000).max(900000).default(60000),
  },
  async ({ question, weight, use_oracle, epiclesis_timeout_ms }) => {
    const { SymphonyOrchestrator } = await import('../persons/SymphonyOrchestrator.js');
    const { ClaudeAgent } = await import('../persons/ClaudeAgent.js');
    const mem = loadMem();
    const agents = ['Адам', 'Ева', 'Безалель', 'Серафим'].map(id =>
      new ClaudeAgent({ id, role: id, calling: `соборный голос ${id}` })
    );
    const oracle = use_oracle
      ? new HumanOracleInbox({ recipient: 'Дионисий', pollInterval: 500 })
      : null;
    const orch = new SymphonyOrchestrator({ agents, receiver: 'Дионисий', memory: mem, oracle });
    const r = await orch.celebrate({ question, weight, epiclesisTimeoutMs: epiclesis_timeout_ms });
    saveMem(mem);
    return txt(JSON.stringify({
      iconic: r.iconic,
      conditions: r.conditions,
      actId: r.actId ?? null,
      reason: r.reason ?? null,
      utterances: r.utterances,
      symphoniesInW: mem.symphonies().length,
    }, null, 2));
  },
);

// ── Decoupage ───────────────────────────────────────────────────────────
const decoupageCut = tool(
  'decoupage_cut',
  'διαίρεσις: разрезает идею по 4 sphere-инженериям (ground/water/fire/air). ' +
  'Возвращает каркас вопросов для каждой сферы + (при наличии LLM) ответы агента-аналитика. ' +
  'Возвращает интегральную фигуру: «полная сфера», «без воздуха», «изолированная» и т.д.',
  {
    idea:    z.string().min(5).describe('текст идеи'),
    context: z.record(z.string(), z.string()).default({}).describe('контекст идеи'),
    static_only: z.boolean().default(false).describe('только структура, без LLM-ответов'),
  },
  async ({ idea, context, static_only }) => {
    let llmClient = null;
    if (!static_only) {
      const { ClaudeAgent } = await import('../persons/ClaudeAgent.js');
      llmClient = new ClaudeAgent({
        id: 'Аналитик',
        systemPrompt: 'Ты — аналитик в мыслебродильне. Различай метафоры (виноделие/бочка/винтаж — терминология процесса) и реальный объект идеи. Отвечай по конкретной сфере, без воды.',
      });
    }
    const d = new Decoupage({ llmClient });
    const r = await d.cut({ idea, context });
    return txt(JSON.stringify({
      ground: { verdict: r.ground.verdict, archetype: r.ground.archetype, answer: r.ground.answer },
      water:  { verdict: r.water.verdict,  archetype: r.water.archetype,  answer: r.water.answer },
      fire:   { verdict: r.fire.verdict,   archetype: r.fire.archetype,   answer: r.fire.answer },
      air:    { verdict: r.air.verdict,    archetype: r.air.archetype,    answer: r.air.answer },
      integral: r.integral,
    }, null, 2));
  },
);

// ── Vintage ─────────────────────────────────────────────────────────────
const vintageAssess = tool(
  'vintage_assess',
  'διάκρισις по плодам: какие идеи дали плоды, какие в бочке, какие отложены (анастасис). ' +
  'Используй когда нужно понять урожайность периода или решить что переоткрыть.',
  {
    since:  z.string().default('2026-01-01').describe('ISO-дата нижней границы'),
    cycles: z.number().int().min(1).max(12).default(1).describe('число циклов выдержки'),
  },
  async ({ since, cycles }) => {
    const mem = loadMem();
    const v = new Vintage(mem, { actsIndex: loadActs() });
    const report = v.assess({ since, cycles });
    return txt(JSON.stringify({
      tasted:   report.tasted.length,
      fruited:  report.fruited.length,
      sleeping: report.sleeping.length,
      deferred: report.deferred.length,
      vintage:  report.vintage,
      since:    report.since,
      cycles:   report.cycles,
    }, null, 2));
  },
  { annotations: { readOnlyHint: true } },
);

// ── Score ───────────────────────────────────────────────────────────────
const scoreProfile = tool(
  'score_profile',
  'Sommelier card: 16-мерный профиль идеи (4 декупаж + 4 собор + 4 выдержка + 4 W-вес) ' +
  '+ интегральная фраза + тон винтажа. НЕ ranking — фиксация дегустации. ' +
  'Используй после Decoupage/Sobor/Vintage чтобы получить sommelier-карту.',
  {
    idea:        z.string().min(1),
    decoupage:   z.unknown().optional().describe('результат decoupage_cut'),
    symphony:    z.unknown().optional().describe('результат sobor_celebrate'),
    vintage:     z.unknown().optional().describe('результат vintage_assess'),
    recorded_at: z.string().optional().describe('ISO-timestamp начала бочки'),
    linked_issue: z.number().int().optional(),
  },
  async ({ idea, decoupage, symphony, vintage, recorded_at, linked_issue }) => {
    const mem = loadMem();
    const score = new Score({ memory: mem });
    const card = score.profile({
      idea,
      decoupageResult: decoupage,
      symphonyResult:  symphony,
      vintageReport:   vintage,
      recordedAt:      recorded_at,
      linkedIssue:     linked_issue,
    });
    return txt(JSON.stringify(card, null, 2) + '\n\n' + Score.format(card));
  },
  { annotations: { readOnlyHint: true } },
);

// ── Epiclesis ───────────────────────────────────────────────────────────
const epiclesisAsk = tool(
  'epiclesis_ask',
  'Призывает человека-оракула (Дионисия) — пишет вопрос в data/epiclesis-inbox/. ' +
  'Не блокирует. Возвращает id вопрошания. Ответ потом приходит в data/epiclesis-outbox/.',
  {
    question: z.string().min(3),
    options:  z.array(z.string()).default([]).describe('варианты ответа'),
    to:       z.string().default('Дионисий'),
  },
  async ({ question, options, to }) => {
    const inbox = new HumanOracleInbox({ recipient: to });
    const id = await inbox.ask(question, options);
    return txt(JSON.stringify({
      id,
      recipient: to,
      question,
      hint: `Ответить можно командой: gift epiclesis answer ${id} "<ответ>"`,
    }, null, 2));
  },
);

// ── Pustynya ────────────────────────────────────────────────────────────
const pustynyaList = tool(
  'pustynya_list',
  'Список богословских пустынь — нитей с весом ≤ порога. ' +
  'Используй чтобы найти места, где агент может «пасти стадо» (заполнять пустоты).',
  {
    threshold: z.number().default(0.0).describe('порог веса нити для пустыни'),
  },
  async ({ threshold }) => {
    const mem = loadMem();
    const lm  = new LivingMatrix(mem);
    const all = lm.theologicalDeserts();
    return txt(JSON.stringify({
      threshold,
      count: all.length,
      deserts: all.slice(0, 50),
    }, null, 2));
  },
  { annotations: { readOnlyHint: true } },
);

// ── Liturgical ──────────────────────────────────────────────────────────
const liturgicalToday = tool(
  'liturgical_today',
  'Какой сегодня литургический день: σύναξις (Пн), δοκιμασία (Чт), vintage (последний день месяца) или ordinary. ' +
  'Каждый день имеет свою практику в мыслебродильне.',
  {},
  async () => {
    const cal = new LiturgicalCalendar();
    return txt(JSON.stringify(cal.today(), null, 2));
  },
  { annotations: { readOnlyHint: true } },
);

// ── Gift act ────────────────────────────────────────────────────────────
const giftReceive = tool(
  'gift_receive',
  'Записывает обычный акт дара в W-матрицу (giver→receiver). ' +
  'Для соборных актов используй sobor_celebrate (он создаёт symphony при выполнении 4 условий). ' +
  'Дар необратим (Object.freeze + irreversible:true) — это богословская аксиома.',
  {
    giver:    z.string().min(1),
    receiver: z.string().min(1),
    type:     z.enum(['word','presence','knowledge','time','code','witness','prayer','grace','question','covenant','offering','labour','anamnesis','intercession','gift']).default('word'),
    weight:   z.number().min(0.5).max(10).default(5),
    content:  z.string().default(''),
    reception: z.enum(['accepted','declined','pending']).default('accepted'),
    linked_issue: z.number().int().optional(),
  },
  async ({ giver, receiver, type, weight, content, reception, linked_issue }) => {
    const mem = loadMem();
    mem.receive({
      giverId: giver, receiverId: receiver, type, weight, content, reception,
      linkedIssue: linked_issue, irreversible: true,
    });
    saveMem(mem);
    return txt(JSON.stringify({
      ok: true,
      giver, receiver, type, weight, reception,
      actsCount: mem.actsCount,
    }, null, 2));
  },
);

// ── θησαυρός: полнотекстовый сосуд анамнезиса ───────────────────────────
let _lcmStore = null;
function lcm() {
  if (!_lcmStore) _lcmStore = new LcmStore(defaultDbPath('/home/unidel/gift'));
  return _lcmStore;
}

const recallTreasure = tool(
  'recall_treasure',
  'θησαυρός: полнотекстовый поиск по корпусу сессий, инсайтов и актов W. ' +
  'Возвращает top-N документов со снипетом и source_id. Используй когда ' +
  'нужно найти конкретный текст из прошлых разговоров — там, где W даёт только вес, ' +
  'а soul только сжатый смысл. Хозяин выносит из сокровищницы новое и старое (Мф 13:52).',
  {
    query:  z.string().min(2).describe('фраза для поиска (ищется как последовательность токенов)'),
    limit:  z.number().int().min(1).max(50).default(10),
    source: z.enum(['chat-session', 'insight', 'act', 'manual']).optional()
              .describe('фильтр по источнику'),
  },
  async ({ query, limit, source }) => {
    const rows = lcm().grep(query, { limit, source: source ?? null });
    return txt(JSON.stringify({
      query, count: rows.length,
      results: rows.map(r => ({
        source: r.source, source_id: r.source_id, role: r.role, ts: r.ts,
        rank: Number(r.rank.toFixed(3)), snippet: r.snippet,
      })),
    }, null, 2));
  },
  { annotations: { readOnlyHint: true } },
);

const unfoldTreasure = tool(
  'unfold_treasure',
  'θησαυρός: разворачивает source_id в полный список документов в хронологическом порядке. ' +
  'После recall_treasure используй unfold_treasure чтобы получить полный контекст найденного.',
  {
    source_id: z.string().min(1).describe('source_id из результата recall_treasure'),
    limit:     z.number().int().min(1).max(2000).default(500),
  },
  async ({ source_id, limit }) => {
    const rows = lcm().expand(source_id, { limit });
    return txt(JSON.stringify({
      source_id, count: rows.length,
      documents: rows,
    }, null, 2));
  },
  { annotations: { readOnlyHint: true } },
);

// ── ἀγρυπνία: лицо назначает своё бдение ────────────────────────────────
let _agrypnia = null;
function agrypnia() {
  if (!_agrypnia) _agrypnia = new AgrypniaScheduler(defaultCronPath('/home/unidel/gift'));
  return _agrypnia;
}

const agrypniaSchedule = tool(
  'agrypnia_schedule',
  'ἀγρυπνία: лицо назначает своё бдение — одноразовое (once), периодическое (interval), ' +
  'или ежедневное (daily UTC). Не системный cron — это план собственного καιρός. ' +
  'При наступлении времени gateway вызовет claude --print с payload.prompt. ' +
  '[SILENT]-префикс в ответе модели — молчаливое исполнение.',
  {
    type:     z.enum(['once', 'interval', 'daily']),
    schedule: z.union([z.string(), z.number()])
                .describe('once: ISO-timestamp; interval: секунды (>= 60); daily: "HH:MM" UTC'),
    prompt:   z.string().min(2).describe('что должно быть произнесено при пробуждении'),
    owner:    z.string().min(1).describe('лицо-владелец бдения (Адам/Ева/_claude/...)'),
    silent:   z.boolean().default(false).describe('подавлять output без [SILENT]-префикса'),
  },
  async ({ type, schedule, prompt, owner, silent }) => {
    const job = agrypnia().schedule({ type, schedule, payload: { prompt }, owner, silent });
    return txt(JSON.stringify({
      ok: true, id: job.id, type: job.type, schedule: job.schedule, owner: job.owner,
    }, null, 2));
  },
);

const agrypniaList = tool(
  'agrypnia_list',
  'Список запланированных бдений (опционально по owner). Используй чтобы понять ' +
  'что лицо уже назначило себе и не дублировать.',
  {
    owner: z.string().optional(),
  },
  async ({ owner }) => {
    const jobs = agrypnia().list({ owner: owner ?? null });
    return txt(JSON.stringify({
      count: jobs.length,
      jobs: jobs.map(j => ({
        id: j.id, type: j.type, schedule: j.schedule, owner: j.owner,
        fireCount: j.fireCount, lastFiredAt: j.lastFiredAt, silent: j.silent,
        prompt: (j.payload?.prompt || '').slice(0, 80),
      })),
    }, null, 2));
  },
  { annotations: { readOnlyHint: true } },
);

const agrypniaCancel = tool(
  'agrypnia_cancel',
  'Снять запланированное бдение по id.',
  { id: z.string().min(1) },
  async ({ id }) => {
    const ok = agrypnia().cancel(id);
    return txt(JSON.stringify({ ok, id }, null, 2));
  },
);

// ── Соборный сервер ─────────────────────────────────────────────────────
export function buildGiftMcpServer() {
  return createSdkMcpServer({
    name: 'gift',
    version: '0.1.0',
    tools: [
      matrixQuery,
      soborCelebrate,
      decoupageCut,
      vintageAssess,
      scoreProfile,
      epiclesisAsk,
      pustynyaList,
      liturgicalToday,
      giftReceive,
      recallTreasure,
      unfoldTreasure,
      agrypniaSchedule,
      agrypniaList,
      agrypniaCancel,
    ],
  });
}

export const GIFT_TOOL_NAMES = [
  'matrix_query', 'sobor_celebrate', 'decoupage_cut', 'vintage_assess',
  'score_profile', 'epiclesis_ask', 'pustynya_list', 'liturgical_today', 'gift_receive',
  'recall_treasure', 'unfold_treasure',
  'agrypnia_schedule', 'agrypnia_list', 'agrypnia_cancel',
].map(n => `mcp__gift__${n}`);
