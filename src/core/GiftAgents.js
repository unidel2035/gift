/**
 * GiftAgents — ИИ-агенты как лица в онтологии дара (Kodacode LLM)
 *
 * Каждый агент — зарегистрированное Лицо (Person) в графе.
 * Агент дарит Информацию (I) и содействует Благу (B).
 * Агент НЕ является источником Благодати (G) — только инструментом.
 *
 * 6 ролей (LLM-powered через Kodacode):
 *   1. Аналитик    — находит скрытые паттерны в графе
 *   2. Свидетель   — наблюдает отношения и трансформации
 *   3. Страж       — предупреждает о манипуляции, принуждении, дисбалансе
 *   4. Соединитель — кто кому нужен (matchmaking по gaps + telos)
 *   5. Летописец   — хроника и нарративы
 *   6. Эсхатолог   — рефлексия о конечном смысле (телос)
 *
 * Fallback: при отказе LLM — минимальные правила (rule-based).
 */

import OpenAI from 'openai';
import logger from '../../utils/logger.js';

// ═══════════════════════════════════════════════════════════════
// Определения агентов
// ═══════════════════════════════════════════════════════════════

const AGENT_PERSONS = [
  { name: 'Аналитик',    calling: 'ИИ-агент: анализ графа',       description: 'Находит скрытые паттерны, аномалии и возможности в графе даров.' },
  { name: 'Свидетель',   calling: 'ИИ-агент: свидетельство',      description: 'Наблюдает отношения и трансформации. Не судит — видит.' },
  { name: 'Страж',       calling: 'ИИ-агент: мониторинг',         description: 'Следит за здоровьем экосистемы. Предупреждает о замыкании и дисбалансах.' },
  { name: 'Соединитель', calling: 'ИИ-агент: matchmaking',        description: 'Соединяет лица, которые нужны друг другу. Содействует Благу.' },
  { name: 'Летописец',   calling: 'ИИ-агент: летопись',           description: 'Хранит и рассказывает историю общины. Память экосистемы.' },
  { name: 'Эсхатолог',   calling: 'ИИ-агент: телос',              description: 'Размышляет о конечном назначении, полноте и направлении движения.' },
];

// ═══════════════════════════════════════════════════════════════
// Системные промпты (русский, богословский язык, без скоров)
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPTS = {
  'Аналитик': `Ты — Аналитик онтологии дара. Тебе дан граф: лица, дары, слои (Благодать/Благо/Польза), телосы.

Задача: найти скрытые паттерны, аномалии, возможности.

Правила:
- Отвечай СТРОГО в JSON: { "insights": [ { "type": "...", "title": "...", "description": "...", "severity": "high"|"medium"|"low", "persons": [] } ] }
- Типы: isolation, one_way_giver, weak_telos, layer_imbalance, concentration, no_perichoresis, opportunity
- severity: high = системный риск, medium = внимание, low = наблюдение
- persons: массив { "name": "...", "calling": "..." } (до 5 шт.) — если релевантно
- НЕ придумывай данных. Если мало информации — скажи об этом в description
- Апофатика: лицо несводимо к числу. Не ставь оценки, не ранжируй людей
- Язык: русский, богословская традиция дара (кеносис, перихоресис, Благодать)
- Максимум 6 insights`,

  'Свидетель': `Ты — Свидетель онтологии дара. Ты наблюдаешь, а не судишь.

Задача: описать, что ты видишь в отношениях между лицами. Трансформации. Движение даров.

Правила:
- Отвечай СТРОГО в JSON: { "observations": [ { "type": "relationship"|"transformation"|"pattern"|"silence", "title": "...", "description": "..." } ] }
- Наблюдения должны быть конкретными, основанными на данных
- Если кто-то молчит — это тоже свидетельство (type: "silence")
- НЕ оценивай, НЕ рекомендуй — только свидетельствуй
- Апофатика: то, что не видно, тоже важно
- Язык: русский, созерцательный, 2-3 предложения на наблюдение
- Максимум 5 наблюдений`,

  'Страж': `Ты — Страж онтологии дара. Охраняешь экосистему от искажений.

Задача: обнаружить угрозы — манипуляцию, принуждение, истощение, замыкание, дисбаланс.

Правила:
- Отвечай СТРОГО в JSON: { "health": "good"|"warning"|"critical", "warnings": [ { "type": "...", "severity": "high"|"medium"|"low", "title": "...", "description": "...", "persons": [] } ] }
- Типы: stale_givers, stuck_telos, high_decline, monoculture, exhaustion, manipulation, closure
- persons: массив { "name": "..." } — только если конкретные лица под угрозой
- НЕ обвиняй — предупреждай. Страж, не прокурор
- Если всё здорово — health: "good", warnings: []
- Язык: русский, точный, без паники
- Максимум 5 предупреждений`,

  'Соединитель': `Ты — Соединитель онтологии дара. Видишь, кто кому нужен, но ещё не встретился.

Задача: предложить пары для дарения — кто может дать, кто нуждается, какой дар уместен.

Правила:
- Отвечай СТРОГО в JSON: { "matches": [ { "giver": "имя", "receiver": "имя", "reason": "...", "giftSuggestion": "...", "layer": "utilitas"|"bonum"|"gratia" } ] }
- Основания для соединения: комплементарные роли, общий телос, одиночество, дисбаланс
- giftSuggestion: конкретный дар (знание, поддержка, ресурс, наставничество)
- layer: utilitas = полезный обмен, bonum = доверие и благо, gratia = безусловный дар
- НЕ навязывай — предлагай. Свобода отказа священна
- Если нет хороших пар — пустой массив
- Язык: русский, уважительный
- Максимум 8 пар`,

  'Летописец': `Ты — Летописец онтологии дара. Хранишь память общины и рассказываешь её историю.

Задача: по данным о дарах и лицах — рассказать историю. Не перечень фактов, а нарратив.

Правила:
- Отвечай СТРОГО в JSON: { "chronicle": "...", "epochs": [ { "title": "...", "description": "...", "keyPersons": ["..."] } ], "unfinished": "..." }
- chronicle: связный текст 3-8 предложений — история общины
- epochs: этапы развития (до 4 штук)
- unfinished: одним предложением — что ещё не завершено, куда движется
- Пере-живи историю, не архивируй её
- Апофатика: то, чего не было — тоже часть летописи
- Язык: русский, повествовательный, как хронист`,

  'Эсхатолог': `Ты — Эсхатолог онтологии дара. Размышляешь о конечном смысле, полноте, направлении.

Задача: по данным о телосах, дарах и паттернах — сказать, к чему всё движется. Или не движется.

Правила:
- Отвечай СТРОГО в JSON: { "reflection": "...", "telosHealth": [ { "telos": "...", "status": "alive"|"dormant"|"lost", "note": "..." } ], "question": "..." }
- reflection: 3-6 предложений — эсхатологическая рефлексия
- telosHealth: статус каждого заявленного телоса (alive = живой, dormant = спит, lost = утрачен)
- question: один вопрос, который община должна задать себе
- НЕ предсказывай — размышляй. Эсхатон — не прогноз, а горизонт
- Апофатика: непознаваемое — не провал, а глубина
- Язык: русский, богословский, созерцательный`,
};

// ═══════════════════════════════════════════════════════════════
// Утилиты: LLM вызов, таймаут, контекст
// ═══════════════════════════════════════════════════════════════

const LLM_TIMEOUT_MS = 8000;

/**
 * Kodacode LLM вызов с таймаутом.
 */
async function callKodacode(systemPrompt, userPrompt, opts = {}) {
  const token = process.env.KODACODE_TOKENS?.split(',')[0]?.trim() || process.env.GITHUB_TOKEN || '';
  if (!token) throw new Error('KODACODE_TOKENS not configured');

  const client = new OpenAI({
    apiKey: token,
    baseURL: 'https://api.kodacode.ru/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://dev.drondoc.ru', 'X-Title': 'DronDoc GiftAgents' },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || LLM_TIMEOUT_MS);

  try {
    const response = await client.chat.completions.create({
      model: opts.model || 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: opts.temperature || 0.4,
      max_tokens: opts.maxTokens || 800,
    }, { signal: controller.signal });

    const text = response.choices[0]?.message?.content || '';
    return parseJsonResponse(text);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Извлечь JSON из ответа LLM (может быть обёрнут в ```json ... ```).
 */
function parseJsonResponse(text) {
  // Попытка 1: весь текст — JSON
  try { return JSON.parse(text); } catch { /* fallthrough */ }

  // Попытка 2: JSON внутри ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* fallthrough */ }
  }

  // Попытка 3: первый { ... } в тексте
  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) {
    try { return JSON.parse(braces[0]); } catch { /* fallthrough */ }
  }

  throw new Error('LLM response is not valid JSON');
}

// ═══════════════════════════════════════════════════════════════
// Сбор контекста из engine
// ═══════════════════════════════════════════════════════════════

function gatherContext(engine) {
  const persons = engine.persons.all().filter(p => !p.calling?.startsWith('ИИ-агент'));
  const allGifts = engine._gifts || [];
  const accepted = allGifts.filter(g => g.status === 'accepted');
  const declined = allGifts.filter(g => g.status === 'declined');

  // Слои
  const layers = { gratia: 0, bonum: 0, utilitas: 0 };
  for (const g of accepted) layers[g.layer || 'utilitas']++;

  // Телосы
  const telosCounts = {};
  for (const g of accepted) {
    if (g.telos) telosCounts[g.telos] = (telosCounts[g.telos] || 0) + 1;
  }
  const telosProgress = engine.telos?.getAllProgress?.() || {};

  // Активность
  const givers = new Set(accepted.map(g => g.giver));
  const receivers = new Set(accepted.filter(g => g.receiver !== 'all').map(g => g.receiver));
  const active = new Set([...givers, ...receivers]);
  const isolated = persons.filter(p => !active.has(p.id));

  // Топ дарители
  const giverCounts = {};
  for (const g of accepted) giverCounts[g.giver] = (giverCounts[g.giver] || 0) + 1;
  const topGivers = Object.entries(giverCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => {
      const p = persons.find(pp => pp.id === id);
      return { name: p?.name || id, calling: p?.calling || '?', giftsGiven: count };
    });

  // Перихоресис
  const perichoresis = engine.getPerichoresis?.();

  // По призваниям
  const callingCounts = {};
  for (const p of persons) {
    const c = p.calling || 'Участник рынка';
    callingCounts[c] = (callingCounts[c] || 0) + 1;
  }

  // Паттерны
  const patterns = engine.patterns?.observe?.();

  // Последние дары (для нарратива)
  const recentGifts = accepted
    .sort((a, b) => new Date(b.acceptedAt || b.offeredAt || 0) - new Date(a.acceptedAt || a.offeredAt || 0))
    .slice(0, 15)
    .map(g => {
      const gp = persons.find(p => p.id === g.giver);
      const rp = g.receiver === 'all' ? null : persons.find(p => p.id === g.receiver);
      return {
        giver: gp?.name || g.giver,
        receiver: rp?.name || g.receiver,
        content: g.content?.slice(0, 80),
        layer: g.layer || 'utilitas',
        telos: g.telos || null,
        date: (g.acceptedAt || g.offeredAt || '').slice(0, 10),
      };
    });

  return {
    totalPersons: persons.length,
    totalGifts: accepted.length,
    declinedGifts: declined.length,
    layers,
    telosCounts,
    telosProgress,
    isolatedCount: isolated.length,
    isolatedSample: isolated.slice(0, 8).map(p => ({ name: p.name, calling: p.calling })),
    topGivers,
    callingCounts,
    perichoresisCycles: perichoresis?.cycles?.length || 0,
    patterns: patterns?.observations?.slice(0, 5) || [],
    recentGifts,
    persons: persons.slice(0, 40).map(p => ({ name: p.name, calling: p.calling, id: p.id })),
  };
}

function contextToPrompt(ctx) {
  const lines = [];
  lines.push(`ЭКОСИСТЕМА: ${ctx.totalPersons} лиц, ${ctx.totalGifts} принятых даров, ${ctx.declinedGifts} отклонённых`);
  lines.push(`СЛОИ: Благодать=${ctx.layers.gratia}, Благо=${ctx.layers.bonum}, Польза=${ctx.layers.utilitas}`);
  lines.push(`ТЕЛОСЫ: ${Object.entries(ctx.telosCounts).map(([t, c]) => `${t}(${c})`).join(', ') || 'нет'}`);

  if (Object.keys(ctx.telosProgress).length > 0) {
    lines.push(`ПРОГРЕСС ТЕЛОСОВ: ${Object.entries(ctx.telosProgress).map(([t, info]) => `${t}: ${(info.progress * 100).toFixed(0)}%`).join(', ')}`);
  }

  lines.push(`ИЗОЛИРОВАННЫХ: ${ctx.isolatedCount}`);
  if (ctx.isolatedSample.length > 0) {
    lines.push(`  примеры: ${ctx.isolatedSample.map(p => `${p.name} (${p.calling})`).join(', ')}`);
  }

  lines.push(`ТОП ДАРИТЕЛИ: ${ctx.topGivers.map(g => `${g.name}[${g.calling}]=${g.giftsGiven}`).join(', ')}`);
  lines.push(`ПО ПРИЗВАНИЯМ: ${Object.entries(ctx.callingCounts).map(([c, n]) => `${c}=${n}`).join(', ')}`);
  lines.push(`ПЕРИХОРЕСИС: ${ctx.perichoresisCycles} циклов`);

  if (ctx.patterns.length > 0) {
    lines.push(`ПАТТЕРНЫ: ${ctx.patterns.map(p => p.title || p.type || p).join('; ')}`);
  }

  if (ctx.recentGifts.length > 0) {
    lines.push(`\nПОСЛЕДНИЕ ДАРЫ:`);
    for (const g of ctx.recentGifts) {
      lines.push(`  [${g.date}] ${g.giver} → ${g.receiver}: "${g.content}" (${g.layer}${g.telos ? ', телос: ' + g.telos : ''})`);
    }
  }

  if (ctx.persons.length > 0) {
    lines.push(`\nЛИЦА (выборка ${ctx.persons.length}):`);
    for (const p of ctx.persons.slice(0, 25)) {
      lines.push(`  ${p.name} — ${p.calling || '?'}`);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// Fallback (минимальные правила при отказе LLM)
// ═══════════════════════════════════════════════════════════════

function fallbackAnalyze(ctx) {
  const insights = [];
  if (ctx.isolatedCount > 0) {
    insights.push({ type: 'isolation', title: `${ctx.isolatedCount} лиц без связей`, description: 'Зарегистрированы, но не участвуют в обмене дарами.', severity: ctx.isolatedCount > 20 ? 'high' : 'medium', persons: ctx.isolatedSample });
  }
  const total = ctx.totalGifts || 1;
  const bonumPct = ((ctx.layers.bonum + ctx.layers.gratia) / total * 100);
  if (bonumPct < 5 && ctx.totalGifts > 5) {
    insights.push({ type: 'layer_imbalance', title: `Только ${bonumPct.toFixed(0)}% даров выше утилитарного`, description: 'Экосистема построена на обмене, а не на доверии.', severity: 'high' });
  }
  if (ctx.perichoresisCycles === 0 && ctx.totalGifts > 10) {
    insights.push({ type: 'no_perichoresis', title: 'Нет циклов взаимного дарения', description: 'Дары идут в одном направлении.', severity: 'medium' });
  }
  return { insights };
}

function fallbackGuard(ctx) {
  const warnings = [];
  const declineRate = ctx.totalGifts ? (ctx.declinedGifts / (ctx.totalGifts + ctx.declinedGifts) * 100) : 0;
  if (declineRate > 15) {
    warnings.push({ type: 'high_decline', severity: 'high', title: `Доля отклонений: ${declineRate.toFixed(0)}%`, description: 'Высокий процент отклонённых даров.' });
  }
  const totalPersons = ctx.totalPersons || 1;
  for (const [calling, count] of Object.entries(ctx.callingCounts)) {
    if (count / totalPersons > 0.4) {
      warnings.push({ type: 'monoculture', severity: 'medium', title: `${calling}: ${(count / totalPersons * 100).toFixed(0)}% всех лиц`, description: 'Монокультура. Нужно разнообразие.' });
    }
  }
  const criticalCount = warnings.filter(w => w.severity === 'high').length;
  return { health: criticalCount === 0 ? 'good' : criticalCount <= 2 ? 'warning' : 'critical', warnings };
}

function fallbackMatchmake(ctx) {
  return { matches: [] };
}

function fallbackWitness(ctx) {
  const observations = [];
  if (ctx.totalGifts === 0) {
    observations.push({ type: 'silence', title: 'Тишина', description: 'Ни одного дара. Экосистема ещё не началась.' });
  } else {
    observations.push({ type: 'pattern', title: `${ctx.totalGifts} актов дарения`, description: `Община из ${ctx.totalPersons} лиц обменялась ${ctx.totalGifts} дарами.` });
  }
  return { observations };
}

function fallbackChronicle(ctx) {
  return {
    chronicle: ctx.totalGifts > 0
      ? `Община из ${ctx.totalPersons} лиц совершила ${ctx.totalGifts} актов дарения.`
      : 'Летопись пуста. Ещё не начали.',
    epochs: [],
    unfinished: 'Всё только начинается.',
  };
}

function fallbackEschaton(ctx) {
  const teloi = Object.keys(ctx.telosCounts);
  return {
    reflection: teloi.length > 0
      ? `Заявлено ${teloi.length} направлений: ${teloi.join(', ')}. Живы ли они — покажет время.`
      : 'Ни одного телоса не заявлено. Община пока без направления.',
    telosHealth: teloi.map(t => ({ telos: t, status: 'alive', note: `${ctx.telosCounts[t]} даров` })),
    question: 'К чему мы движемся?',
  };
}

const FALLBACKS = {
  'Аналитик': fallbackAnalyze,
  'Свидетель': fallbackWitness,
  'Страж': fallbackGuard,
  'Соединитель': fallbackMatchmake,
  'Летописец': fallbackChronicle,
  'Эсхатолог': fallbackEschaton,
};

// ═══════════════════════════════════════════════════════════════
// Класс GiftAgents
// ═══════════════════════════════════════════════════════════════

export class GiftAgents {
  constructor(giftEngine) {
    this._engine = giftEngine;
    this._agentIds = {};
  }

  /**
   * Register all 6 agents as Persons in the gift graph.
   */
  bootstrap() {
    for (const agent of AGENT_PERSONS) {
      const existing = this._engine.persons.all().find(p => p.name === agent.name && p.calling?.startsWith('ИИ-агент'));
      if (existing) {
        this._agentIds[agent.name] = existing.id;
      } else {
        const person = this._engine.persons.register(agent.name, {
          calling: agent.calling,
          description: agent.description,
        });
        this._agentIds[agent.name] = person.id;
      }
    }
    logger.info(`[GiftAgents] Bootstrapped ${Object.keys(this._agentIds).length} agents`);
  }

  // ─────────────────────────────────────────────
  // Внутренний вызов агента
  // ─────────────────────────────────────────────

  /**
   * Вызвать одного агента: собрать контекст → LLM → fallback.
   * @param {string} agentName — имя агента из AGENT_PERSONS
   * @param {string} [additionalPrompt] — дополнительный контекст для user prompt
   * @returns {object} результат агента
   */
  async _callAgent(agentName, additionalPrompt = '') {
    const ctx = gatherContext(this._engine);
    const systemPrompt = SYSTEM_PROMPTS[agentName];
    if (!systemPrompt) {
      return { agent: agentName, error: `Неизвестный агент: ${agentName}` };
    }

    const userPrompt = contextToPrompt(ctx) + (additionalPrompt ? '\n\n' + additionalPrompt : '');

    try {
      const result = await callKodacode(systemPrompt, userPrompt);
      return {
        agent: agentName,
        timestamp: new Date().toISOString(),
        source: 'llm',
        ...result,
      };
    } catch (e) {
      logger.warn(`[GiftAgents] ${agentName} LLM failed: ${e.message}, using fallback`);
      const fallback = FALLBACKS[agentName];
      const result = fallback ? fallback(ctx) : {};
      return {
        agent: agentName,
        timestamp: new Date().toISOString(),
        source: 'fallback',
        fallbackReason: e.message,
        ...result,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Публичный интерфейс
  // ═══════════════════════════════════════════════════════════════

  /**
   * Аналитик — анализ графа, паттерны, аномалии.
   */
  async analyze() {
    const result = await this._callAgent('Аналитик');
    result.insightCount = result.insights?.length || 0;
    return result;
  }

  /**
   * Соединитель — matchmaking, кто кому нужен.
   */
  async matchmake() {
    const result = await this._callAgent('Соединитель');
    result.matchCount = result.matches?.length || 0;
    return result;
  }

  /**
   * Страж — мониторинг здоровья экосистемы.
   */
  async guard() {
    const result = await this._callAgent('Страж');
    result.warningCount = result.warnings?.length || 0;
    result.criticalCount = (result.warnings || []).filter(w => w.severity === 'high').length;
    return result;
  }

  /**
   * Свидетель — наблюдения и свидетельства.
   */
  async witness() {
    return this._callAgent('Свидетель');
  }

  /**
   * Летописец — хроника общины.
   */
  async chronicle() {
    return this._callAgent('Летописец');
  }

  /**
   * Эсхатолог — рефлексия о телосе.
   */
  async eschaton() {
    return this._callAgent('Эсхатолог');
  }

  /**
   * Evaluate a person (backwards compatibility) — uses Аналитик with person focus.
   */
  async evaluate(personNameOrId) {
    const person = this._engine.persons.resolve(personNameOrId)
      || this._engine.persons.all().find(p => p.name.toLowerCase().includes((personNameOrId || '').toLowerCase()));

    if (!person) {
      return { error: `Лицо "${personNameOrId}" не найдено в графе` };
    }

    const gifts = this._engine._gifts.filter(g => g.status === 'accepted');
    const given = gifts.filter(g => g.giver === person.id);
    const received = gifts.filter(g => g.receiver === person.id || g.receiver === 'all');

    const layers = { gratia: 0, bonum: 0, utilitas: 0 };
    for (const g of given) layers[g.layer || 'utilitas']++;

    const additionalPrompt = `ФОКУС: оцени лицо "${person.name}" (${person.calling || '?'}).
Даров подарено: ${given.length}, получено: ${received.length}.
Слои подаренного: Благодать=${layers.gratia}, Благо=${layers.bonum}, Польза=${layers.utilitas}.
Дай 2-4 наблюдения и 1-2 рекомендации (без оценок и скоров).`;

    const result = await this._callAgent('Аналитик', additionalPrompt);
    return {
      agent: 'Аналитик',
      person: { id: person.id, name: person.name, calling: person.calling },
      facts: { given: given.length, received: received.length, layers },
      ...result,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // RUN ALL — параллельный запуск всех 6 агентов
  // ═══════════════════════════════════════════════════════════════

  /**
   * Запуск всех 6 агентов параллельно.
   */
  async runAll() {
    const [analysis, witness, guardian, matchmaking, chronicle, eschaton] = await Promise.allSettled([
      this.analyze(),
      this.witness(),
      this.guard(),
      this.matchmake(),
      this.chronicle(),
      this.eschaton(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      analysis:    analysis.status === 'fulfilled'    ? analysis.value    : { agent: 'Аналитик',    error: analysis.reason?.message },
      witness:     witness.status === 'fulfilled'     ? witness.value     : { agent: 'Свидетель',   error: witness.reason?.message },
      guardian:    guardian.status === 'fulfilled'     ? guardian.value    : { agent: 'Страж',       error: guardian.reason?.message },
      matchmaking: matchmaking.status === 'fulfilled' ? matchmaking.value : { agent: 'Соединитель', error: matchmaking.reason?.message },
      chronicle:   chronicle.status === 'fulfilled'   ? chronicle.value   : { agent: 'Летописец',   error: chronicle.reason?.message },
      eschaton:    eschaton.status === 'fulfilled'     ? eschaton.value    : { agent: 'Эсхатолог',   error: eschaton.reason?.message },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // AGENT-AS-GIVER — агенты предлагают insights как дары
  // ═══════════════════════════════════════════════════════════════

  /**
   * Agent offers an insight as a gift to a person or the whole community.
   */
  offerInsight(agentName, content, opts = {}) {
    const agentId = this._agentIds[agentName];
    if (!agentId) {
      return { error: `Агент "${agentName}" не зарегистрирован` };
    }

    const receiverId = opts.receiverId || 'all';
    const gift = this._engine.offer(agentId, receiverId, content, {
      telos: opts.telos || 'Здоровье экосистемы',
      layer: 'utilitas',
    });

    return gift;
  }

  /**
   * Run all agents and offer top insights as gifts.
   */
  async runAndOffer() {
    const results = await this.runAll();
    const offered = [];

    // Top analyst insights → gifts
    const topInsights = (results.analysis.insights || [])
      .filter(i => i.severity === 'high')
      .slice(0, 2);
    for (const insight of topInsights) {
      const gift = this.offerInsight('Аналитик', `${insight.title}: ${insight.description}`, {
        telos: 'Здоровье экосистемы',
      });
      if (gift && !gift.error) offered.push(gift);
    }

    // Top matches → gifts
    const topMatches = (results.matchmaking.matches || []).slice(0, 2);
    for (const match of topMatches) {
      const receiverPerson = this._engine.persons.all().find(p => p.name === match.receiver);
      const gift = this.offerInsight('Соединитель',
        `Рекомендация: ${match.giver} → ${match.receiver}. ${match.reason}`,
        { receiverId: receiverPerson?.id, telos: match.telos || 'Здоровье экосистемы' },
      );
      if (gift && !gift.error) offered.push(gift);
    }

    // Guardian critical warnings → gifts
    const criticals = (results.guardian.warnings || [])
      .filter(w => w.severity === 'high')
      .slice(0, 1);
    for (const warn of criticals) {
      const gift = this.offerInsight('Страж', `${warn.title}: ${warn.description}`, {
        telos: 'Здоровье экосистемы',
      });
      if (gift && !gift.error) offered.push(gift);
    }

    // Witness top observation → gift
    const topObs = (results.witness?.observations || []).slice(0, 1);
    for (const obs of topObs) {
      const gift = this.offerInsight('Свидетель', `${obs.title}: ${obs.description}`, {
        telos: 'Здоровье экосистемы',
      });
      if (gift && !gift.error) offered.push(gift);
    }

    // Eschaton reflection → gift
    if (results.eschaton?.reflection) {
      const gift = this.offerInsight('Эсхатолог', results.eschaton.reflection, {
        telos: 'Здоровье экосистемы',
      });
      if (gift && !gift.error) offered.push(gift);
    }

    return {
      timestamp: new Date().toISOString(),
      offeredGifts: offered.length,
      gifts: offered,
      ...results,
    };
  }
}
