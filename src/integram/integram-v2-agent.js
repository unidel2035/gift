/**
 * Integram V2 Agent Layer — агент-ориентированная надстройка над AI Data Layer
 *
 * Предоставляет:
 * - Agent Context: регистрация агента, сессия, scope
 * - Agent Memory: сохранение/загрузка контекста между вызовами
 * - Agent Discovery: поиск других агентов и их capabilities
 * - Semantic Query: высокоуровневые запросы (NL → структурированный ответ)
 * - Tool Catalog: автогенерация MCP-совместимых tool-описаний из схемы БД
 */

import { IntegramV2Client } from './integram-v2-client.js'
import schemaIntelligence from './schema-intelligence.js'
import logger from '../../utils/logger.js'
import crypto from 'crypto'

// ── Хранилище контекстов агентов (in-memory, позже → Redis/Integram) ────────
const agentSessions = new Map()

// ── Socket.io + EventEngine references ──────────────────────────────────────
let _io = null
let _eventEngine = null
const eventSubscriptions = new Map() // sessionId → Set<eventType>

/**
 * Wire Socket.io instance from index.js
 */
export function setSocketIO(io) {
  _io = io
  logger.info('[AgentV2] Socket.io wired')
}

/**
 * Wire EventEngineService from index.js
 */
export function setEventEngine(eeService) {
  _eventEngine = eeService
  logger.info('[AgentV2] EventEngine wired')
}

// ── Agent Lifecycle (SOD-driven FSM) ────────────────────────────────────────
//
// Правила переходов состояний. Builtin fallback + загрузка из SOD (Состояния/Переходы).
// initAgentLifecycleInSOD() создаёт FSM в SOD при первом запуске.
// loadLifecycleFromSOD() обогащает VALID_TRANSITIONS из SOD.

let VALID_TRANSITIONS = {
  training:   ['active', 'retired'],
  active:     ['paused', 'deprecated', 'retired'],
  paused:     ['active', 'deprecated', 'retired'],
  deprecated: ['retired'],
  retired:    [] // terminal state
}

let _lifecycleLoaded = false

/**
 * Загрузить FSM из SOD (Состояния + Переходы для модели AgentLifecycle)
 * Если в SOD есть дополнительные состояния/переходы — они мержатся с builtin.
 */
async function loadLifecycleFromSOD() {
  if (_lifecycleLoaded || !_eventEngine) return VALID_TRANSITIONS

  try {
    const concepts = await _eventEngine.getConcepts()
    const concept = concepts.find(c =>
      (c.val || c.name || '').toLowerCase() === 'agentlifecycle'
    )
    if (!concept) { _lifecycleLoaded = true; return VALID_TRANSITIONS }

    const models = await _eventEngine.getModels(concept.id)
    if (!models?.length) { _lifecycleLoaded = true; return VALID_TRANSITIONS }

    const model = models[0]
    const states = await _eventEngine.getStates(model.id)
    const transitions = await _eventEngine.getTransitions(model.id)

    if (states.length > 0 && transitions.length > 0) {
      // Build FSM from SOD data
      const sodFSM = {}
      for (const state of states) {
        const name = (state.val || state.name || '').toLowerCase()
        sodFSM[name] = []
      }
      for (const t of transitions) {
        const from = (t.reqs?.['Из']?.display || t.reqs?.['Из']?.value || '').toLowerCase()
        const to = (t.reqs?.['В']?.display || t.reqs?.['В']?.value || '').toLowerCase()
        if (from && to && sodFSM[from]) {
          if (!sodFSM[from].includes(to)) sodFSM[from].push(to)
        }
      }
      // Merge: SOD overrides builtin for states that exist in SOD
      for (const [state, targets] of Object.entries(sodFSM)) {
        if (targets.length > 0) {
          VALID_TRANSITIONS[state] = targets
        }
      }
      logger.info({ states: Object.keys(sodFSM).length, transitions: transitions.length },
        '[AgentV2] FSM loaded from SOD')
    }
  } catch (e) {
    logger.debug({ err: e.message }, '[AgentV2] SOD lifecycle load skipped')
  }

  _lifecycleLoaded = true
  return VALID_TRANSITIONS
}

/**
 * Контекст агента — сессия с scope, памятью и правами
 */
// ── Autonomy Spectrum (Deloitte Tech Trends 2026) ───────────────────────────
// Three levels: augment (human approves), automate (human monitors), autonomous (minimal oversight)
const AUTONOMY_LEVELS_AGENT = {
  augment: {
    description: 'Human approves every write action',
    autoApprove: false,
    requiresApproval: ['batch', 'import', 'migrate_to_reference'],
    maxBatchSize: 10,
    maxCallsPerMinute: 30
  },
  automate: {
    description: 'Human monitors, agent executes within guardrails',
    autoApprove: true,
    requiresApproval: ['migrate_to_reference'], // only destructive ops need approval
    maxBatchSize: 100,
    maxCallsPerMinute: 120
  },
  autonomous: {
    description: 'Minimal oversight, full self-execution',
    autoApprove: true,
    requiresApproval: [],
    maxBatchSize: 1000,
    maxCallsPerMinute: 600
  }
}

// Pending approvals queue (for augment/automate levels)
const pendingApprovals = new Map() // approvalId → { sessionId, operation, params, ts, status }

class AgentContext {
  constructor({ agentId, name, capabilities = [], scope = {}, database = 'kval', autonomyLevel = 'augment' }) {
    this.agentId = agentId
    this.sessionId = crypto.randomUUID()
    this.name = name
    this.capabilities = capabilities
    this.scope = scope // { allowedTypes: [], readOnly: false, maxRows: 1000 }
    this.database = database
    this.autonomyLevel = AUTONOMY_LEVELS_AGENT[autonomyLevel] ? autonomyLevel : 'augment'
    this.client = new IntegramV2Client(database)
    this.memory = {} // краткосрочная память сессии
    this.history = [] // лог действий
    this.createdAt = new Date()
    this.lastActivity = new Date()
    this.proofLog = [] // immutable proof-of-action log (Deloitte: digital signatures)

    // ── Metrics (FinOps + Performance) ────────────────────────────────────
    this.metrics = {
      totalCalls: 0,
      totalLatencyMs: 0,
      successCount: 0,
      errorCount: 0,
      callsByOperation: {},
      tokensEstimated: 0,
      firstCallAt: null,
      lastCallAt: null
    }

    // ── Identity (Digital Identity / Zero Trust) ─────────────────────────
    this.identity = {
      fingerprint: crypto.createHash('sha256')
        .update(agentId + this.sessionId)
        .digest('hex'),
      ephemeralToken: crypto.randomBytes(32).toString('hex'),
      tokenExpiresAt: new Date(Date.now() + 3600000).toISOString() // 1 hour
    }

    // ── Lifecycle (State Machine) ────────────────────────────────────────
    this.state = 'training'
    this.stateHistory = [{
      from: null,
      to: 'training',
      reason: 'Agent registered',
      ts: new Date().toISOString()
    }]
  }

  /** Запись действия в историю */
  log(action, params, result) {
    this.lastActivity = new Date()
    this.history.push({
      ts: this.lastActivity.toISOString(),
      action,
      params: typeof params === 'object' ? JSON.stringify(params).slice(0, 500) : params,
      ok: !result?.error
    })
    // Ограничиваем историю 200 записями
    if (this.history.length > 200) this.history = this.history.slice(-100)
  }

  /** Проверка доступа к типу */
  canAccess(typeId) {
    if (!this.scope.allowedTypes || this.scope.allowedTypes.length === 0) return true
    return this.scope.allowedTypes.includes(typeId)
  }

  /** Проверка права на запись */
  canWrite() {
    return !this.scope.readOnly
  }
}

// ── Session TTL & Cleanup ────────────────────────────────────────────────────
const SESSION_TTL_MS = 3600_000 // 1 hour default
let _cleanupInterval = null

/**
 * Периодическая очистка протухших сессий.
 * Сессии, неактивные > SESSION_TTL_MS, автоматически удаляются.
 */
export function startSessionCleanup(intervalMs = 300_000) { // every 5 min
  if (_cleanupInterval) return
  _cleanupInterval = setInterval(() => {
    const now = Date.now()
    let cleaned = 0
    for (const [sid, ctx] of agentSessions) {
      const idle = now - ctx.lastActivity.getTime()
      if (idle > SESSION_TTL_MS) {
        agentSessions.delete(sid)
        eventSubscriptions.delete(sid)
        messageBox.delete(sid)
        cleaned++
        logger.debug({ agentId: ctx.agentId, idleMs: idle }, '[AgentV2] Session expired')
      }
    }
    if (cleaned > 0) {
      logger.info({ cleaned, remaining: agentSessions.size }, '[AgentV2] Session cleanup')
    }
  }, intervalMs)
}

/**
 * Остановить очистку (для тестов)
 */
export function stopSessionCleanup() {
  if (_cleanupInterval) { clearInterval(_cleanupInterval); _cleanupInterval = null }
}

// ── SOD-driven Vocabularies ──────────────────────────────────────────────────

const _builtinStopWords = new Set([
  'найди', 'найти', 'покажи', 'показать', 'какие', 'все', 'всех', 'список',
  'дай', 'выдай', 'расскажи', 'сколько', 'где', 'что', 'как', 'кто',
  'для', 'в', 'на', 'по', 'из', 'с', 'и', 'или', 'не', 'к', 'о', 'об',
  'это', 'этот', 'эта', 'эти', 'тот', 'та', 'те', 'мне', 'мой',
  'find', 'show', 'list', 'get', 'all', 'the', 'a', 'an', 'in', 'for', 'of', 'with'
])
let _stopWordsEnriched = false

/**
 * Stop words: builtin + enriched from SOD Vocabulary "StopWords".
 * SOD позволяет добавлять доменные stop words без изменения кода.
 */
async function getStopWords() {
  if (_stopWordsEnriched || !_eventEngine) return _builtinStopWords

  try {
    const vocabs = await _eventEngine.getVocabularies()
    const vocab = vocabs.find(v => {
      const name = (v.val || v.name || '').toLowerCase()
      return name === 'stopwords' || name === 'stop_words'
    })

    if (vocab) {
      const props = await _eventEngine.getProperties(vocab.id)
      if (props?.length > 0) {
        for (const p of props) {
          const word = (p.val || p.name || '').toLowerCase().trim()
          if (word) _builtinStopWords.add(word)
        }
      }
    }
  } catch (_) {}

  _stopWordsEnriched = true
  return _builtinStopWords
}

// ── Agent Registry ──────────────────────────────────────────────────────────

/**
 * Регистрация агента — создаёт сессию с контекстом
 * @param {Object} opts — { agentId, name, capabilities, scope, database }
 * @returns {Object} — { sessionId, agentId, database, capabilities }
 */
export function registerAgent(opts = {}) {
  const agentId = opts.agentId || `agent_${crypto.randomUUID().slice(0, 8)}`
  const ctx = new AgentContext({ ...opts, agentId })
  agentSessions.set(ctx.sessionId, ctx)

  logger.info({ agentId, sessionId: ctx.sessionId, database: ctx.database },
    '[AgentV2] Агент зарегистрирован')

  // Emit agent registration event
  emitAgentEvent(ctx.sessionId, 'agent.registered', {
    agentId: ctx.agentId, name: ctx.name, database: ctx.database
  })

  return {
    sessionId: ctx.sessionId,
    agentId: ctx.agentId,
    name: ctx.name,
    database: ctx.database,
    capabilities: ctx.capabilities,
    scope: ctx.scope,
    state: ctx.state,
    autonomyLevel: ctx.autonomyLevel,
    identity: {
      fingerprint: ctx.identity.fingerprint,
      tokenExpiresAt: ctx.identity.tokenExpiresAt
    },
    metrics: { totalCalls: 0, successRate: 1, avgLatencyMs: 0 }
  }
}

/**
 * Получить контекст агента по sessionId
 */
export function getAgentContext(sessionId) {
  return agentSessions.get(sessionId) || null
}

/**
 * Список активных агентов (для agent discovery)
 */
export function listAgents() {
  const agents = []
  for (const [sid, ctx] of agentSessions) {
    agents.push({
      sessionId: sid,
      agentId: ctx.agentId,
      name: ctx.name,
      capabilities: ctx.capabilities,
      database: ctx.database,
      state: ctx.state,
      lastActivity: ctx.lastActivity.toISOString(),
      historyLength: ctx.history.length,
      metrics: {
        totalCalls: ctx.metrics.totalCalls,
        successRate: ctx.metrics.totalCalls > 0
          ? +(ctx.metrics.successCount / ctx.metrics.totalCalls).toFixed(3)
          : 1
      }
    })
  }
  return agents
}

/**
 * Удалить сессию агента
 */
export function unregisterAgent(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (ctx) {
    logger.info({ agentId: ctx.agentId, sessionId }, '[AgentV2] Агент отключён')
    agentSessions.delete(sessionId)
    return true
  }
  return false
}

// ── Agent Memory ────────────────────────────────────────────────────────────

/**
 * Сохранить данные в память агента
 */
export function setMemory(sessionId, key, value) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null
  ctx.memory[key] = value
  ctx.log('memory.set', { key }, {})
  return true
}

/**
 * Прочитать из памяти агента
 */
export function getMemory(sessionId, key) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null
  return key ? ctx.memory[key] : ctx.memory
}

/**
 * Получить историю действий агента
 */
export function getHistory(sessionId, limit = 50) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null
  return ctx.history.slice(-limit)
}

// ── Semantic Query ──────────────────────────────────────────────────────────

/**
 * Семантический запрос — агент задаёт вопрос на естественном языке,
 * система переводит в V2 API вызовы и возвращает структурированный ответ
 *
 * @param {string} sessionId — сессия агента
 * @param {string} question — вопрос на NL
 * @param {Object} opts — { maxResults, includeSchema }
 * @returns {Object} — { answer, sources, query }
 */
export async function semanticQuery(sessionId, question, opts = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) throw new Error('Сессия не найдена')

  const client = ctx.client
  const result = { question, sources: [], data: null }

  // Extract meaningful keywords from the question
  // Stop words: builtin + loaded from SOD Vocabulary "StopWords"
  const stopWords = await getStopWords()

  const keywords = question
    .toLowerCase()
    .replace(/[?!.,;:()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))

  let searchQuery = ''

  try {
    // Strategy 1: Full-text search with keywords
    searchQuery = keywords.join(' ')
    if (searchQuery) {
      const searchResult = await client.search({
        query: searchQuery,
        limit: opts.maxResults || 20
      })
      result.data = searchResult
      result.sources.push('keyword-search')
      result.keywords = keywords
    }
  } catch (e) {
    logger.warn({ err: e.message }, '[AgentV2] Search failed, trying schema lookup')
  }

  // Strategy 2: If no data found, try to find matching tables from schema
  if (!result.data || (Array.isArray(result.data) && result.data.length === 0)) {
    try {
      const schema = await client.getSchemaFull()
      if (schema?.types) {
        const matchingTypes = schema.types.filter(t => {
          const name = (t.name || '').toLowerCase()
          return keywords.some(kw => name.includes(kw))
        })
        if (matchingTypes.length > 0) {
          result.matchingTables = matchingTypes.map(t => ({
            id: t.id, name: t.name, count: t.count || 0
          }))
          result.sources.push('schema-match')
        }
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[AgentV2] Schema lookup failed')
    }
  }

  // Include schema context if requested
  if (opts.includeSchema) {
    try {
      result.schema = await client.getSchemaFull()
      result.sources.push('schema')
    } catch (e) { /* ignore */ }
  }

  // Generate summary
  const dataCount = Array.isArray(result.data) ? result.data.length : (result.data ? 1 : 0)
  const tableCount = result.matchingTables?.length || 0
  result.summary = dataCount > 0
    ? `Найдено ${dataCount} результатов по запросу "${searchQuery || question}"`
    : tableCount > 0
      ? `Найдено ${tableCount} таблиц, соответствующих запросу: ${result.matchingTables.map(t => t.name).join(', ')}`
      : `Результаты по запросу "${question}" не найдены`

  ctx.log('semantic.query', { question, keywords }, result)
  return result
}

// ── Tool Catalog ────────────────────────────────────────────────────────────

/**
 * Генерирует MCP-совместимый каталог tools из схемы БД
 * Каждая таблица → набор CRUD tools с описанием полей
 *
 * @param {string} database — имя БД
 * @returns {Array} — MCP tool definitions
 */
export async function generateToolCatalog(database = 'kval') {
  const client = new IntegramV2Client(database)
  const schema = await client.getSchemaFull()
  const tools = []

  if (!schema?.types) return tools

  for (const type of schema.types) {
    const typeName = type.name || `type_${type.id}`
    const safeAlias = typeName.replace(/[^a-zA-Zа-яА-Я0-9_]/g, '_').toLowerCase()

    // READ tool
    tools.push({
      name: `integram_read_${safeAlias}`,
      description: `Чтение записей из таблицы "${typeName}" (ID: ${type.id}). Записей: ${type.count || 0}`,
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Макс. записей', default: 20 },
          offset: { type: 'number', description: 'Смещение', default: 0 },
          filter: { type: 'object', description: 'Условия фильтрации { поле: значение }' }
        }
      },
      _meta: { typeId: type.id, database, operation: 'read' }
    })

    // SEARCH tool
    tools.push({
      name: `integram_search_${safeAlias}`,
      description: `Поиск в таблице "${typeName}" (ID: ${type.id})`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Текст поиска' }
        },
        required: ['query']
      },
      _meta: { typeId: type.id, database, operation: 'search' }
    })

    // CREATE tool
    tools.push({
      name: `integram_create_${safeAlias}`,
      description: `Создание записи в "${typeName}" (ID: ${type.id}). Поля с повторяющимися значениями должны быть reference-ссылками на справочник.`,
      inputSchema: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Данные записи { поле: значение }' }
        },
        required: ['data']
      },
      _meta: { typeId: type.id, database, operation: 'create' }
    })
  }

  return tools
}

/**
 * Компактное описание схемы для вставки в промпт агента
 * @param {string} database
 * @returns {string} — markdown-описание таблиц и полей
 */
export async function getSchemaForPrompt(database = 'kval') {
  const client = new IntegramV2Client(database)
  const schema = await client.getSchemaFull()
  if (!schema?.types) return '# Схема пуста'

  const lines = [
    `# Схема БД "${database}" (${schema.types.length} таблиц)\n`,
    `## ⚠ АРХИТЕКТУРНЫЕ ПРАВИЛА Integram`,
    ``,
    `При создании/изменении таблиц ОБЯЗАТЕЛЬНО:`,
    ``,
    `1. **Справочник вместо строки.** Если колонка содержит повторяющиеся значения`,
    `   (статус, тип, категория, страна, единица измерения и т.п.) — ВСЕГДА:`,
    `   - Создай отдельную таблицу-справочник (lookup table)`,
    `   - Добавь колонку как REFERENCE (ссылку) на справочник, а НЕ как текст`,
    `   - Пример: вместо колонки "Статус" (текст: "активный"/"неактивный")`,
    `     → таблица "Справочник статусов" + reference-колонка "Статус"`,
    ``,
    `2. **Переиспользуй существующие справочники.** Перед созданием нового —`,
    `   проверь через integram_v2_search, есть ли уже подходящий.`,
    ``,
    `3. **Миграция текста в справочник.** Если уже есть текстовая колонка`,
    `   с повторяющимися значениями — создай справочник, заполни его,`,
    `   затем измени тип колонки на reference.`,
    ``,
    `4. **Типы колонок:** число → NUMBER(13), дата → DATE(5),`,
    `   длинный текст (>255) → LONG(2), короткий → SHORT(3),`,
    `   ссылка → REFERENCE(8) + targetTableId.`,
    ``,
    `5. **Перед созданием таблицы/колонки** — вызови \`integram_v2_suggest_schema(name)\``,
    `   для проверки синонимов и дублей (Товар↔Продукт, Клиент↔Заказчик и др.).`,
    ``,
    `6. **Аудит качества схемы** — вызови \`integram_v2_validate_schema(typeId)\``,
    `   для поиска антипаттернов (текст вместо справочника, дубли колонок).`,
    ``,
    `7. **Миграция в справочник** — вызови \`integram_v2_migrate_to_reference(typeId, reqId)\``,
    `   для автоматического плана миграции текстовой колонки.`,
    ``,
    `---\n`,
  ]

  for (const type of schema.types) {
    if (!type.name) continue
    const reqs = (type.requisites || []).map(r => {
      const typeLabel = r.refType ? `ref→${r.refType}` : (r.type || 'text')
      return `  - ${r.name || r.alias} (${typeLabel})`
    }).join('\n')
    lines.push(`## ${type.name} [ID:${type.id}] — ${type.count || 0} записей`)
    if (reqs) lines.push(reqs)
    lines.push('')
  }

  return lines.join('\n')
}

// ── Agent-to-Agent Communication ────────────────────────────────────────────

const messageBox = new Map() // sessionId → [messages]

/**
 * Отправить сообщение другому агенту
 */
export function sendMessage(fromSessionId, toSessionId, payload) {
  const from = agentSessions.get(fromSessionId)
  const to = agentSessions.get(toSessionId)
  if (!from || !to) return { error: 'Агент не найден' }

  if (!messageBox.has(toSessionId)) messageBox.set(toSessionId, [])
  const msg = {
    id: crypto.randomUUID(),
    from: from.agentId,
    fromSession: fromSessionId,
    ts: new Date().toISOString(),
    payload
  }
  messageBox.get(toSessionId).push(msg)

  from.log('message.send', { to: to.agentId }, {})
  return { sent: true, messageId: msg.id }
}

/**
 * Получить входящие сообщения
 */
export function receiveMessages(sessionId) {
  const msgs = messageBox.get(sessionId) || []
  messageBox.set(sessionId, []) // Очищаем после чтения
  return msgs
}

// ── Scoped Execution ────────────────────────────────────────────────────────

/**
 * Выполнить операцию в контексте агента с проверкой scope
 */
export async function execute(sessionId, operation, params = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) throw new Error('Сессия не найдена')

  // Lifecycle check — block execution for paused/retired agents
  if (ctx.state === 'paused') throw new Error('Агент приостановлен (paused). Переведите в active для выполнения операций.')
  if (ctx.state === 'retired') throw new Error('Агент завершён (retired). Создайте новую сессию.')
  if (ctx.state === 'training') {
    const writeOps = ['batch', 'import', 'migrate_to_reference']
    if (writeOps.includes(operation)) {
      throw new Error('Агент в режиме обучения (training). Переведите в active для записи.')
    }
  }

  // Role-based operation check
  if (!canExecuteOperation(sessionId, operation)) {
    const roleName = ctx.role?.name || 'без роли'
    throw new Error(`Операция "${operation}" недоступна для роли "${roleName}". Допустимые: ${(ctx.scope?.allowedOps || []).join(', ')}`)
  }

  // ── Autonomy Spectrum gate (Deloitte: Human-in-the-Loop checkpoints) ──
  const autonomyCfg = AUTONOMY_LEVELS_AGENT[ctx.autonomyLevel] || AUTONOMY_LEVELS_AGENT.augment
  if (autonomyCfg.requiresApproval.includes(operation)) {
    const approvalId = `appr_${crypto.randomUUID().slice(0, 8)}`
    pendingApprovals.set(approvalId, {
      sessionId, operation, params, ts: new Date().toISOString(), status: 'pending',
      agentId: ctx.agentId, autonomyLevel: ctx.autonomyLevel
    })
    emitAgentEvent(sessionId, 'agent.approval_required', { approvalId, operation })
    throw new Error(`Операция "${operation}" требует одобрения (autonomy: ${ctx.autonomyLevel}). approvalId: ${approvalId}`)
  }

  // Rate limiting per autonomy level
  const callsLastMinute = ctx.history.filter(h => Date.now() - new Date(h.ts).getTime() < 60000).length
  if (callsLastMinute >= autonomyCfg.maxCallsPerMinute) {
    throw new Error(`Rate limit: ${autonomyCfg.maxCallsPerMinute} calls/min (autonomy: ${ctx.autonomyLevel})`)
  }

  const startTime = Date.now()
  const client = ctx.client
  let result
  let success = true

  try {
  switch (operation) {
    case 'schema': {
      const fullSchema = await client.getSchema()
      // Apply scope filtering: if allowedTypes is set, only return those types
      if (ctx.scope?.allowedTypes?.length) {
        const allowed = new Set(ctx.scope.allowedTypes.map(Number))
        if (fullSchema.types) {
          fullSchema.types = fullSchema.types.filter(t => allowed.has(t.id))
          fullSchema.typeCount = fullSchema.types.length
        }
      }
      result = fullSchema
      break
    }

    case 'schema.type':
      if (!ctx.canAccess(params.typeId)) throw new Error(`Нет доступа к типу ${params.typeId}`)
      result = await client.getTypeSchema(params.typeId)
      break

    case 'search': {
      const searchResult = await client.search(params)
      // Apply scope filtering to search results
      if (ctx.scope?.allowedTypes?.length) {
        const allowed = new Set(ctx.scope.allowedTypes.map(Number))
        if (searchResult.results) {
          searchResult.results = searchResult.results.filter(r => allowed.has(r.typeId))
          searchResult.totalFound = searchResult.results.length
        }
      }
      result = searchResult
      break
    }

    case 'filter':
      if (!ctx.canAccess(params.typeId)) throw new Error(`Нет доступа к типу ${params.typeId}`)
      result = await client.filter(params.typeId, params.conditions)
      break

    case 'aggregate':
      if (!ctx.canAccess(params.typeId)) throw new Error(`Нет доступа к типу ${params.typeId}`)
      result = await client.aggregate(params.typeId, params.options)
      break

    case 'batch':
      if (!ctx.canWrite()) throw new Error('Агент в режиме readOnly')
      result = await client.batch(params.operations, params.options)
      break

    case 'import':
      if (!ctx.canWrite()) throw new Error('Агент в режиме readOnly')
      if (!ctx.canAccess(params.typeId)) throw new Error(`Нет доступа к типу ${params.typeId}`)
      result = await client.importRecords(params.typeId, params.records, params.options)
      break

    case 'export':
      if (!ctx.canAccess(params.typeId)) throw new Error(`Нет доступа к типу ${params.typeId}`)
      result = await client.exportRecords(params.typeId, params.options)
      break

    case 'history':
      result = await client.getHistory(params.objectId)
      break

    case 'audit':
      result = await client.getAuditLog(params)
      break

    case 'ontology':
      result = await client.getOntology()
      break

    case 'sparql':
      result = await client.sparql(params.query)
      break

    case 'relationships':
      result = await client.getRelationships()
      break

    case 'related':
      result = await client.findRelated(params.objectId, params.depth)
      break

    case 'nl':
      result = await client.nlSearch(params.query)
      break

    case 'suggest_schema':
      result = await schemaIntelligence.suggestSchema(params.name, params.context, client.database)
      break

    case 'validate_schema':
      if (!ctx.canAccess(params.typeId)) throw new Error(`Нет доступа к типу ${params.typeId}`)
      result = await schemaIntelligence.validateSchema(params.typeId, client.database)
      break

    case 'find_synonyms':
      result = await schemaIntelligence.findSynonyms(params.query, client.database)
      break

    case 'migrate_to_reference':
      if (!ctx.canAccess(params.typeId)) throw new Error(`Нет доступа к типу ${params.typeId}`)
      result = await schemaIntelligence.migrateToReference(params.typeId, params.reqId, client.database)
      break

    default:
      throw new Error(`Неизвестная операция: ${operation}`)
  }
  } catch (err) {
    success = false
    // Update metrics even on error
    const latency = Date.now() - startTime
    ctx.metrics.totalCalls++
    ctx.metrics.totalLatencyMs += latency
    ctx.metrics.errorCount++
    ctx.metrics.callsByOperation[operation] = (ctx.metrics.callsByOperation[operation] || 0) + 1
    if (!ctx.metrics.firstCallAt) ctx.metrics.firstCallAt = new Date().toISOString()
    ctx.metrics.lastCallAt = new Date().toISOString()
    ctx.log(operation, params, { error: err.message })
    emitAgentEvent(sessionId, 'agent.execute.error', { operation, error: err.message })
    throw err
  }

  // Update metrics on success
  const latency = Date.now() - startTime
  ctx.metrics.totalCalls++
  ctx.metrics.totalLatencyMs += latency
  ctx.metrics.successCount++
  ctx.metrics.callsByOperation[operation] = (ctx.metrics.callsByOperation[operation] || 0) + 1
  ctx.metrics.tokensEstimated += Math.ceil(JSON.stringify(result || {}).length / 4) // rough estimate
  if (!ctx.metrics.firstCallAt) ctx.metrics.firstCallAt = new Date().toISOString()
  ctx.metrics.lastCallAt = new Date().toISOString()

  ctx.log(operation, params, result)
  emitAgentEvent(sessionId, 'agent.execute', { operation, latencyMs: latency })

  // ── Proof-of-Action (Deloitte: immutable logs, digital signatures) ──
  const proof = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    agentId: ctx.agentId,
    operation,
    autonomyLevel: ctx.autonomyLevel,
    hash: crypto.createHash('sha256')
      .update(JSON.stringify({ operation, params, ts: Date.now() }))
      .digest('hex'),
    latencyMs: latency,
    success: true
  }
  ctx.proofLog.push(proof)
  if (ctx.proofLog.length > 500) ctx.proofLog = ctx.proofLog.slice(-300)

  // Schema change events → SOD
  const schemaChangingOps = ['batch', 'import', 'migrate_to_reference']
  if (schemaChangingOps.includes(operation) && _eventEngine) {
    try {
      _eventEngine.createDomainEvent?.({
        domain: 'SchemaGovernance',
        eventType: `schema.${operation}`,
        source: ctx.agentId,
        payload: {
          operation,
          database: ctx.database,
          typeId: params.typeId,
          role: ctx.role?.name
        },
        metadata: { sessionId, agentState: ctx.state }
      })
    } catch (_) {}
  }

  return result
}

// ── Agent Metrics ───────────────────────────────────────────────────────────

/**
 * Получить метрики агента (FinOps + Performance)
 */
export function getAgentMetrics(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null

  const m = ctx.metrics
  const uptimeMs = Date.now() - ctx.createdAt.getTime()
  const uptimeMinutes = uptimeMs / 60000 || 1

  return {
    totalCalls: m.totalCalls,
    successCount: m.successCount,
    errorCount: m.errorCount,
    successRate: m.totalCalls > 0 ? +(m.successCount / m.totalCalls).toFixed(3) : 1,
    avgLatencyMs: m.totalCalls > 0 ? +(m.totalLatencyMs / m.totalCalls).toFixed(1) : 0,
    callsPerMinute: +(m.totalCalls / uptimeMinutes).toFixed(2),
    callsByOperation: m.callsByOperation,
    tokensEstimated: m.tokensEstimated,
    estimatedCost: +(m.tokensEstimated * 0.000003).toFixed(6), // ~$3/1M tokens
    uptimeMs,
    firstCallAt: m.firstCallAt,
    lastCallAt: m.lastCallAt
  }
}

// ── Agent Identity ──────────────────────────────────────────────────────────

/**
 * Получить identity агента
 */
export function getAgentIdentity(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null
  return {
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
    fingerprint: ctx.identity.fingerprint,
    tokenExpiresAt: ctx.identity.tokenExpiresAt,
    state: ctx.state
  }
}

/**
 * Обновить ephemeral token
 */
export function refreshToken(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null
  ctx.identity.ephemeralToken = crypto.randomBytes(32).toString('hex')
  ctx.identity.tokenExpiresAt = new Date(Date.now() + 3600000).toISOString()
  return {
    ephemeralToken: ctx.identity.ephemeralToken,
    tokenExpiresAt: ctx.identity.tokenExpiresAt
  }
}

/**
 * Проверить token валидность
 */
export function verifyToken(sessionId, token) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { valid: false, reason: 'session_not_found' }
  if (ctx.identity.ephemeralToken !== token) return { valid: false, reason: 'token_mismatch' }
  if (new Date(ctx.identity.tokenExpiresAt) < new Date()) return { valid: false, reason: 'token_expired' }
  return { valid: true, fingerprint: ctx.identity.fingerprint }
}

// ── Agent Lifecycle ─────────────────────────────────────────────────────────

/**
 * Перевести агента в новое состояние
 */
export async function transitionAgentState(sessionId, newState, reason = '') {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  // Load FSM from SOD if not yet loaded
  await loadLifecycleFromSOD()

  const allowed = VALID_TRANSITIONS[ctx.state]
  if (!allowed || !allowed.includes(newState)) {
    return {
      error: `Переход ${ctx.state} → ${newState} невозможен`,
      validTransitions: allowed || []
    }
  }

  const oldState = ctx.state
  ctx.state = newState
  ctx.stateHistory.push({
    from: oldState,
    to: newState,
    reason,
    ts: new Date().toISOString()
  })

  // Keep history manageable
  if (ctx.stateHistory.length > 50) ctx.stateHistory = ctx.stateHistory.slice(-30)

  logger.info({ agentId: ctx.agentId, from: oldState, to: newState, reason },
    '[AgentV2] Состояние агента изменено')

  emitAgentEvent(sessionId, 'agent.lifecycle', { from: oldState, to: newState, reason })

  return {
    state: newState,
    previousState: oldState,
    stateHistory: ctx.stateHistory.slice(-5),
    validTransitions: VALID_TRANSITIONS[newState] || []
  }
}

/**
 * Получить lifecycle info
 */
export function getAgentLifecycle(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null
  return {
    state: ctx.state,
    validTransitions: VALID_TRANSITIONS[ctx.state] || [],
    stateHistory: ctx.stateHistory,
    createdAt: ctx.createdAt.toISOString()
  }
}

// ── Agent Events (Socket.io + СОД) ─────────────────────────────────────────

/**
 * Emit agent event via Socket.io + record in СОД
 */
function emitAgentEvent(sessionId, eventType, data = {}) {
  const ctx = agentSessions.get(sessionId)
  const agentId = ctx?.agentId || 'unknown'

  const event = {
    type: eventType,
    agentId,
    sessionId,
    data,
    ts: new Date().toISOString()
  }

  // Socket.io broadcast
  if (_io) {
    _io.emit('agent:event', event)
  }

  // СОД integration — record as domain event
  if (_eventEngine && ctx) {
    try {
      _eventEngine.createDomainEvent?.({
        domain: 'AgentSystem',
        eventType,
        source: agentId,
        payload: data,
        metadata: { sessionId, agentState: ctx.state }
      })
    } catch (e) {
      logger.debug({ err: e.message }, '[AgentV2] СОД event creation skipped')
    }
  }
}

/**
 * Публичный emit — отправить произвольное событие
 */
export function emitEvent(sessionId, eventType, data = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  emitAgentEvent(sessionId, eventType, data)
  return { emitted: true, eventType, ts: new Date().toISOString() }
}

/**
 * Подписка на типы событий
 */
export function subscribeEvents(sessionId, eventTypes = []) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  if (!eventSubscriptions.has(sessionId)) eventSubscriptions.set(sessionId, new Set())
  const subs = eventSubscriptions.get(sessionId)
  for (const t of eventTypes) subs.add(t)

  return {
    subscribed: [...subs],
    sessionId
  }
}

/**
 * Запрос событий из СОД через EventEngineService
 */
export async function queryEvents(sessionId, filter = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  if (!_eventEngine) {
    return { events: [], warning: 'EventEngine не подключён' }
  }

  try {
    const events = await _eventEngine.queryDomainEvents?.({
      domain: filter.domain || 'AgentSystem',
      eventType: filter.eventType,
      source: filter.source,
      limit: filter.limit || 50
    })
    return { events: events || [], count: events?.length || 0 }
  } catch (e) {
    return { events: [], error: e.message }
  }
}

// ── Multi-Agent Pipeline ───────────────────────────────────────────────────

const pipelines = new Map() // pipelineId → pipeline

/**
 * Создать pipeline — DAG задач для мульти-агентного исполнения
 */
export function createPipeline(steps = []) {
  const pipelineId = `pipe_${crypto.randomUUID().slice(0, 8)}`

  const pipeline = {
    id: pipelineId,
    steps: steps.map((s, i) => ({
      id: s.id || `step_${i}`,
      agentSessionId: s.agentSessionId || s.sessionId,
      operation: s.operation,
      params: s.params || {},
      dependsOn: s.dependsOn || [],
      status: 'pending',
      result: null,
      error: null,
      startedAt: null,
      completedAt: null
    })),
    status: 'created',
    createdAt: new Date().toISOString(),
    completedAt: null,
    results: {}
  }

  pipelines.set(pipelineId, pipeline)
  return { pipelineId, steps: pipeline.steps.length, status: 'created' }
}

/**
 * Topological sort для DAG
 */
function topologicalSort(steps) {
  const graph = new Map()
  const inDegree = new Map()

  for (const step of steps) {
    graph.set(step.id, [])
    inDegree.set(step.id, 0)
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (graph.has(dep)) {
        graph.get(dep).push(step.id)
        inDegree.set(step.id, inDegree.get(step.id) + 1)
      }
    }
  }

  const queue = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted = []
  while (queue.length > 0) {
    const id = queue.shift()
    sorted.push(id)
    for (const neighbor of graph.get(id) || []) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1)
      if (inDegree.get(neighbor) === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== steps.length) {
    throw new Error('Pipeline contains cycles')
  }

  return sorted
}

/**
 * Выполнить pipeline
 */
export async function executePipeline(pipelineId) {
  const pipeline = pipelines.get(pipelineId)
  if (!pipeline) return { error: 'Pipeline не найден' }
  if (pipeline.status === 'running') return { error: 'Pipeline уже выполняется' }

  pipeline.status = 'running'

  try {
    const order = topologicalSort(pipeline.steps)
    const stepMap = new Map(pipeline.steps.map(s => [s.id, s]))

    for (const stepId of order) {
      const step = stepMap.get(stepId)
      step.status = 'running'
      step.startedAt = new Date().toISOString()

      try {
        // Inject results from dependencies into params
        const resolvedParams = { ...step.params }
        for (const dep of step.dependsOn) {
          const depStep = stepMap.get(dep)
          if (depStep?.result) {
            resolvedParams[`_result_${dep}`] = depStep.result
          }
        }

        step.result = await execute(step.agentSessionId, step.operation, resolvedParams)
        step.status = 'complete'
        pipeline.results[step.id] = step.result
      } catch (err) {
        step.error = err.message
        step.status = 'error'
        pipeline.status = 'error'
        pipeline.completedAt = new Date().toISOString()

        emitAgentEvent(step.agentSessionId, 'pipeline.step.error', {
          pipelineId, stepId, error: err.message
        })

        return {
          pipelineId,
          status: 'error',
          failedStep: stepId,
          error: err.message,
          completedSteps: pipeline.steps.filter(s => s.status === 'complete').length,
          totalSteps: pipeline.steps.length,
          results: pipeline.results
        }
      } finally {
        step.completedAt = new Date().toISOString()
      }
    }

    pipeline.status = 'complete'
    pipeline.completedAt = new Date().toISOString()

    return {
      pipelineId,
      status: 'complete',
      totalSteps: pipeline.steps.length,
      results: pipeline.results
    }
  } catch (err) {
    pipeline.status = 'error'
    return { pipelineId, status: 'error', error: err.message }
  }
}

/**
 * Получить статус pipeline
 */
export function getPipelineStatus(pipelineId) {
  const pipeline = pipelines.get(pipelineId)
  if (!pipeline) return null
  return {
    id: pipeline.id,
    status: pipeline.status,
    createdAt: pipeline.createdAt,
    completedAt: pipeline.completedAt,
    steps: pipeline.steps.map(s => ({
      id: s.id,
      operation: s.operation,
      status: s.status,
      dependsOn: s.dependsOn,
      error: s.error,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      hasResult: s.result !== null
    })),
    results: pipeline.results
  }
}

// ── Process ROI Calculator ─────────────────────────────────────────────────

/**
 * Рассчитать ROI автоматизации процесса через агентов
 */
export function calculateProcessROI(params = {}) {
  const {
    manualHoursPerTask = 1,
    costPerHour = 2000,        // RUB
    tasksPerMonth = 100,
    agentCostPerCall = 0.5,    // RUB (~$0.005)
    agentCallsPerTask = 3,
    implementationCost = 0     // one-time
  } = params

  const manualMonthlyCost = manualHoursPerTask * costPerHour * tasksPerMonth
  const agentMonthlyCost = agentCostPerCall * agentCallsPerTask * tasksPerMonth
  const monthlySavings = manualMonthlyCost - agentMonthlyCost
  const annualSavings = monthlySavings * 12
  const paybackMonths = implementationCost > 0
    ? +(implementationCost / monthlySavings).toFixed(1)
    : 0
  const roiPercent = manualMonthlyCost > 0
    ? +((monthlySavings / manualMonthlyCost) * 100).toFixed(1)
    : 0
  const fteEquivalent = +((manualHoursPerTask * tasksPerMonth) / 160).toFixed(2) // 160 hours/month FTE

  return {
    input: { manualHoursPerTask, costPerHour, tasksPerMonth, agentCostPerCall, agentCallsPerTask, implementationCost },
    manualMonthlyCost,
    agentMonthlyCost,
    monthlySavings,
    annualSavings,
    paybackMonths,
    roiPercent,
    fteEquivalent,
    summary: `Экономия ${monthlySavings.toLocaleString('ru')} ₽/мес (${roiPercent}% ROI). Эквивалент ${fteEquivalent} FTE. Окупаемость: ${paybackMonths} мес.`
  }
}

// ── SOD-Driven Agent Roles ──────────────────────────────────────────────────

/**
 * Предустановленные роли агентов.
 * При наличии SOD — дополняются концептами/моделями из исполняемой онтологии.
 * Каждая роль = capabilities (что умеет) + scope (ограничения) + описание.
 */
const AGENT_ROLES = {
  'Архитектор': {
    description: 'Проектирование схемы БД: создание таблиц, колонок, справочников, миграции',
    capabilities: ['schema', 'schema.type', 'suggest_schema', 'validate_schema', 'migrate_to_reference', 'find_synonyms'],
    scope: { readOnly: false, allowedOps: ['schema', 'schema.type', 'suggest_schema', 'validate_schema', 'migrate_to_reference', 'find_synonyms', 'batch', 'import'] },
    sodConcept: 'AgentArchitect'
  },
  'Поисковик': {
    description: 'Поиск и аналитика: full-text search, фильтры, SPARQL, онтология',
    capabilities: ['search', 'filter', 'sparql', 'find_synonyms', 'related', 'ontology', 'relationships', 'nl'],
    scope: { readOnly: true, allowedOps: ['search', 'filter', 'sparql', 'find_synonyms', 'related', 'ontology', 'relationships', 'nl', 'schema', 'schema.type', 'export'] },
    sodConcept: 'AgentSearcher'
  },
  'Ремонтник': {
    description: 'Исправление данных: валидация, миграции, пакетные операции, импорт',
    capabilities: ['validate_schema', 'migrate_to_reference', 'batch', 'import', 'filter', 'export'],
    scope: { readOnly: false, allowedOps: ['validate_schema', 'migrate_to_reference', 'batch', 'import', 'filter', 'export', 'schema', 'schema.type', 'suggest_schema'] },
    sodConcept: 'AgentRepairer'
  },
  'Аналитик': {
    description: 'Агрегация и экспорт: статистика, группировки, отчёты, связи',
    capabilities: ['aggregate', 'export', 'filter', 'relationships', 'ontology', 'sparql'],
    scope: { readOnly: true, allowedOps: ['aggregate', 'export', 'filter', 'relationships', 'ontology', 'sparql', 'schema', 'search', 'nl'] },
    sodConcept: 'AgentAnalyst'
  },
  'Универсал': {
    description: 'Полный доступ ко всем операциям без ограничений',
    capabilities: ['*'],
    scope: { readOnly: false },
    sodConcept: 'AgentUniversal'
  }
}

/**
 * Получить доступные роли агентов
 * @returns {Object} — { roles: [{ name, description, capabilities }] }
 */
export function getAgentRoles() {
  return {
    roles: Object.entries(AGENT_ROLES).map(([name, role]) => ({
      name,
      description: role.description,
      capabilities: role.capabilities,
      readOnly: role.scope.readOnly
    })),
    _hint: 'Передай role в integram_v2_agent_register для автонастройки capabilities и scope'
  }
}

/**
 * Регистрация агента с ролью из SOD
 * @param {Object} opts — { agentId, name, role, capabilities, scope, database }
 *   role — имя роли: "Архитектор", "Поисковик", "Ремонтник", "Аналитик", "Универсал"
 *   Если role указана — capabilities и scope подтягиваются автоматически.
 *   Если нет — используются переданные capabilities/scope (backward-compatible).
 */
export async function registerAgentWithRole(opts = {}) {
  const { role, ...rest } = opts

  // Resolve role → capabilities + scope
  let resolvedCaps = rest.capabilities || []
  let resolvedScope = rest.scope || {}
  let roleInfo = null

  if (role) {
    const roleDef = AGENT_ROLES[role]
    if (!roleDef) {
      return {
        error: `Неизвестная роль: "${role}"`,
        availableRoles: Object.keys(AGENT_ROLES),
        _hint: 'Используй getAgentRoles() для списка доступных ролей'
      }
    }

    resolvedCaps = roleDef.capabilities
    resolvedScope = { ...roleDef.scope }
    roleInfo = { name: role, description: roleDef.description, sodConcept: roleDef.sodConcept }

    // Try to enrich from SOD (if EventEngine is connected)
    if (_eventEngine) {
      try {
        const sodEnrichment = await enrichRoleFromSOD(roleDef.sodConcept, role)
        if (sodEnrichment) {
          roleInfo.sod = sodEnrichment
          // Override capabilities/scope from SOD if defined
          if (sodEnrichment.capabilities) {
            resolvedCaps = sodEnrichment.capabilities
            logger.info({ role }, '[AgentV2] Capabilities loaded from SOD')
          }
          if (sodEnrichment.scope) {
            resolvedScope = { ...resolvedScope, ...sodEnrichment.scope }
            logger.info({ role }, '[AgentV2] Scope loaded from SOD')
          }
        }
      } catch (e) {
        logger.debug({ err: e.message }, '[AgentV2] SOD role enrichment skipped')
      }
    }
  }

  // Register using existing registerAgent
  const result = registerAgent({
    ...rest,
    name: rest.name || (role ? `${role}-${Date.now().toString(36)}` : undefined),
    capabilities: resolvedCaps,
    scope: resolvedScope
  })

  // Store role info in agent context
  if (role && !result.error) {
    const ctx = agentSessions.get(result.sessionId)
    if (ctx) {
      ctx.role = roleInfo
    }
  }

  // Record individual in SOD
  if (_eventEngine && role && !result.error) {
    try {
      await recordAgentIndividual(result.sessionId, result.agentId, role)
    } catch (e) {
      logger.debug({ err: e.message }, '[AgentV2] SOD individual creation skipped')
    }
  }

  return {
    ...result,
    role: roleInfo
  }
}

/**
 * Enrich role definition from SOD concepts/models
 */
/**
 * Enrich role from SOD: read capabilities/scope from model description if available.
 * SOD model description format (JSON in Описание):
 *   { "capabilities": ["search","filter"], "scope": { "readOnly": true } }
 * If model description is plain text — returns metadata only.
 */
async function enrichRoleFromSOD(sodConceptName, roleName) {
  if (!_eventEngine) return null

  try {
    const concepts = await _eventEngine.getConcepts()
    const matched = concepts.find(c => {
      const name = (c.val || c.name || '').toLowerCase()
      return name === sodConceptName.toLowerCase() || name.includes(roleName.toLowerCase())
    })

    if (!matched) return null

    const conceptId = matched.id
    const models = await _eventEngine.getModels(conceptId)
    const individuals = await _eventEngine.getIndividuals?.(conceptId) || []

    // Try to extract capabilities/scope from first model's description
    let sodCapabilities = null
    let sodScope = null
    if (models?.length > 0) {
      const modelDesc = models[0].reqs?.['Описание']?.value || models[0].reqs?.['Описание'] || ''
      try {
        const parsed = JSON.parse(modelDesc)
        if (parsed.capabilities) sodCapabilities = parsed.capabilities
        if (parsed.scope) sodScope = parsed.scope
      } catch (_) {
        // Not JSON — that's fine, use builtin
      }
    }

    return {
      conceptId,
      conceptName: matched.val || matched.name,
      models: models.map(m => ({ id: m.id, name: m.val || m.name })),
      activeIndividuals: individuals.length,
      capabilities: sodCapabilities,
      scope: sodScope,
      _hint: 'Роль привязана к SOD-концепту — события агента записываются в исполняемую онтологию'
    }
  } catch (e) {
    return null
  }
}

/**
 * Record agent session as SOD Individual
 */
async function recordAgentIndividual(sessionId, agentId, roleName) {
  if (!_eventEngine) return

  const roleDef = AGENT_ROLES[roleName]
  if (!roleDef) return

  try {
    // Find or skip — don't block registration on SOD failures
    const concepts = await _eventEngine.getConcepts()
    const concept = concepts.find(c => {
      const name = (c.val || c.name || '').toLowerCase()
      return name === roleDef.sodConcept.toLowerCase()
    })

    if (concept) {
      await _eventEngine.createIndividual?.(
        `${agentId}_${sessionId.slice(0, 8)}`,
        {
          conceptId: concept.id,
          description: `Агент "${roleName}" — сессия ${sessionId.slice(0, 8)}`
        }
      )
    }
  } catch (e) {
    // Non-critical — SOD individual is a bonus, not a requirement
    logger.debug({ err: e.message }, '[AgentV2] Individual creation skipped')
  }
}

/**
 * Проверка операции по scope роли
 * Расширяет canAccess — теперь проверяет не только typeId, но и операцию
 */
export function canExecuteOperation(sessionId, operation) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return false

  // Universal role — all operations allowed
  if (ctx.capabilities?.includes('*')) return true

  // Check scope.allowedOps if defined
  const allowedOps = ctx.scope?.allowedOps
  if (!allowedOps) return true // no restrictions
  return allowedOps.includes(operation)
}

/**
 * Инициализировать FSM жизненного цикла агента в SOD.
 * Создаёт концепт AgentLifecycle + модель + состояния + переходы.
 */
export async function initAgentLifecycleInSOD() {
  if (!_eventEngine) return { initialized: false, reason: 'no_event_engine' }

  try {
    const concepts = await _eventEngine.getConcepts()
    const existing = concepts.find(c =>
      (c.val || c.name || '').toLowerCase() === 'agentlifecycle'
    )
    if (existing) {
      return { initialized: true, status: 'exists', conceptId: existing.id }
    }

    // Create concept + auto-model
    const result = await _eventEngine.createConcept(
      'AgentLifecycle',
      'FSM жизненного цикла агента: training → active → paused/deprecated → retired'
    )
    const conceptId = result?.id || result?.obj
    if (!conceptId) return { initialized: false, error: 'concept creation failed' }

    // Find the auto-created model
    const models = await _eventEngine.getModels(conceptId)
    const modelId = models?.[0]?.id
    if (!modelId) return { initialized: true, conceptId, warning: 'no model found' }

    // Create states
    const stateMap = {}
    for (const [i, stateName] of ['training', 'active', 'paused', 'deprecated', 'retired'].entries()) {
      try {
        const s = await _eventEngine.createState(modelId, {
          name: stateName,
          description: stateName === 'retired' ? 'Терминальное состояние' : '',
          type: stateName === 'training' ? 'initial' : (stateName === 'retired' ? 'final' : 'normal'),
          order: i
        })
        stateMap[stateName] = s?.id || s?.obj
      } catch (e) {
        logger.debug({ err: e.message }, `[AgentV2] State ${stateName} creation failed`)
      }
    }

    // Create transitions
    const transitions = [
      ['training', 'active'], ['training', 'retired'],
      ['active', 'paused'], ['active', 'deprecated'], ['active', 'retired'],
      ['paused', 'active'], ['paused', 'deprecated'], ['paused', 'retired'],
      ['deprecated', 'retired']
    ]
    let created = 0
    for (const [from, to] of transitions) {
      if (stateMap[from] && stateMap[to]) {
        try {
          await _eventEngine.createTransition(modelId, {
            fromStateId: stateMap[from],
            toStateId: stateMap[to],
            trigger: `${from}→${to}`
          })
          created++
        } catch (_) {}
      }
    }

    logger.info({ conceptId, modelId, states: Object.keys(stateMap).length, transitions: created },
      '[AgentV2] Lifecycle FSM created in SOD')

    return { initialized: true, conceptId, modelId, states: stateMap, transitions: created }
  } catch (e) {
    return { initialized: false, error: e.message }
  }
}

/**
 * Инициализировать SOD-концепты для ролей агентов.
 * Вызывается один раз при старте — создаёт недостающие концепты в SOD.
 */
export async function initAgentRolesInSOD() {
  if (!_eventEngine) {
    logger.debug('[AgentV2] SOD not connected, skipping role init')
    return { initialized: false, reason: 'no_event_engine' }
  }

  const results = []
  try {
    const concepts = await _eventEngine.getConcepts()
    const existingNames = new Set(concepts.map(c => (c.val || c.name || '').toLowerCase()))

    for (const [roleName, roleDef] of Object.entries(AGENT_ROLES)) {
      const conceptName = roleDef.sodConcept
      if (existingNames.has(conceptName.toLowerCase())) {
        results.push({ role: roleName, concept: conceptName, status: 'exists' })
        continue
      }

      try {
        await _eventEngine.createConcept(
          conceptName,
          `Роль агента: ${roleName} — ${roleDef.description}`
        )
        results.push({ role: roleName, concept: conceptName, status: 'created' })
        logger.info(`[AgentV2] SOD concept created: ${conceptName}`)
      } catch (e) {
        results.push({ role: roleName, concept: conceptName, status: 'error', error: e.message })
      }
    }
  } catch (e) {
    return { initialized: false, error: e.message }
  }

  return { initialized: true, roles: results }
}

// ── Agent Discovery + A2A Delegation (Deloitte: Agent-to-Agent Protocol) ────

/**
 * Discover agents by capability — find who can handle a task
 * @param {string} capability — operation name or capability keyword
 * @returns {Array} — matching agents with scores
 */
export function discoverAgents(capability) {
  const results = []
  for (const [sid, ctx] of agentSessions) {
    if (ctx.state !== 'active' && ctx.state !== 'training') continue

    const hasCapability = ctx.capabilities?.includes('*') ||
      ctx.capabilities?.includes(capability) ||
      ctx.scope?.allowedOps?.includes(capability)

    if (hasCapability) {
      const m = ctx.metrics
      results.push({
        sessionId: sid,
        agentId: ctx.agentId,
        name: ctx.name,
        role: ctx.role?.name || null,
        autonomyLevel: ctx.autonomyLevel,
        state: ctx.state,
        capabilities: ctx.capabilities,
        score: {
          successRate: m.totalCalls > 0 ? +(m.successCount / m.totalCalls).toFixed(3) : 1,
          avgLatencyMs: m.totalCalls > 0 ? +(m.totalLatencyMs / m.totalCalls).toFixed(1) : 0,
          experience: m.totalCalls
        }
      })
    }
  }
  // Sort by success rate desc, then by experience desc
  results.sort((a, b) => b.score.successRate - a.score.successRate || b.score.experience - a.score.experience)
  return results
}

/**
 * Delegate task to best available agent
 * @param {string} fromSessionId — delegating agent
 * @param {string} capability — what needs to be done
 * @param {Object} params — operation params
 * @returns {Object} — delegation result
 */
export async function delegateTask(fromSessionId, capability, params = {}) {
  const from = agentSessions.get(fromSessionId)
  if (!from) throw new Error('Сессия делегирующего агента не найдена')

  const candidates = discoverAgents(capability)
  // Exclude self
  const eligible = candidates.filter(c => c.sessionId !== fromSessionId)

  if (eligible.length === 0) {
    return { delegated: false, reason: `Нет агентов с capability "${capability}"`, candidates: 0 }
  }

  const best = eligible[0]
  from.log('delegate.send', { to: best.agentId, capability }, {})

  try {
    const result = await execute(best.sessionId, capability, params)
    emitAgentEvent(fromSessionId, 'agent.delegated', {
      to: best.agentId, capability, success: true
    })
    return {
      delegated: true,
      executedBy: { agentId: best.agentId, sessionId: best.sessionId, role: best.role },
      result
    }
  } catch (err) {
    emitAgentEvent(fromSessionId, 'agent.delegation_failed', {
      to: best.agentId, capability, error: err.message
    })
    return { delegated: false, error: err.message, attemptedAgent: best.agentId }
  }
}

// ── Data Discoverability (Deloitte: ETL → Search, knowledge graphs) ─────────

/**
 * Get data map for agent — what data exists, grouped, with SOD status.
 * Called automatically on registration (if catalog endpoint available).
 */
export async function getDataMap(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  try {
    const axios = (await import('axios')).default
    const resp = await axios.get('http://localhost:8081/api/event-engine/catalog', { timeout: 5000 })
    const catalog = resp.data?.data || {}

    // Filter by agent scope if restricted
    if (ctx.scope?.allowedTypes?.length > 0) {
      const allowed = new Set(ctx.scope.allowedTypes.map(String))
      for (const [group, info] of Object.entries(catalog.groups || {})) {
        info.items = info.items.filter(i => allowed.has(String(i.id)))
        info.tables = info.items.length
        info.objects = info.items.reduce((s, i) => s + i.objectCount, 0)
      }
      // Remove empty groups
      for (const [group, info] of Object.entries(catalog.groups || {})) {
        if (info.tables === 0) delete catalog.groups[group]
      }
    }

    ctx.memory._dataMap = { ts: new Date().toISOString(), totalTables: catalog.totalTables }
    return catalog
  } catch (e) {
    return { error: e.message, hint: 'Event Engine catalog not available' }
  }
}

// ── Approval Gate API (Deloitte: Human-in-the-Loop) ─────────────────────────

/**
 * List pending approvals
 */
export function listApprovals(filter = {}) {
  const results = []
  for (const [id, appr] of pendingApprovals) {
    if (filter.sessionId && appr.sessionId !== filter.sessionId) continue
    if (filter.status && appr.status !== filter.status) continue
    results.push({ approvalId: id, ...appr })
  }
  return results
}

/**
 * Approve a pending operation — human-in-the-loop checkpoint
 */
export async function approveOperation(approvalId, approvedBy = 'human') {
  const appr = pendingApprovals.get(approvalId)
  if (!appr) return { error: 'Approval not found' }
  if (appr.status !== 'pending') return { error: `Already ${appr.status}` }

  appr.status = 'approved'
  appr.approvedBy = approvedBy
  appr.approvedAt = new Date().toISOString()

  // Execute the previously blocked operation
  try {
    // Temporarily elevate autonomy to bypass the gate
    const ctx = agentSessions.get(appr.sessionId)
    if (!ctx) return { error: 'Agent session expired' }

    const savedLevel = ctx.autonomyLevel
    ctx.autonomyLevel = 'autonomous'
    try {
      const result = await execute(appr.sessionId, appr.operation, appr.params)
      appr.status = 'executed'
      return { approved: true, approvalId, result }
    } finally {
      ctx.autonomyLevel = savedLevel
    }
  } catch (err) {
    appr.status = 'failed'
    appr.error = err.message
    return { approved: true, approvalId, executionError: err.message }
  }
}

/**
 * Reject a pending operation
 */
export function rejectOperation(approvalId, reason = '') {
  const appr = pendingApprovals.get(approvalId)
  if (!appr) return { error: 'Approval not found' }
  if (appr.status !== 'pending') return { error: `Already ${appr.status}` }

  appr.status = 'rejected'
  appr.rejectedBy = 'human'
  appr.rejectedAt = new Date().toISOString()
  appr.reason = reason

  emitAgentEvent(appr.sessionId, 'agent.approval_rejected', { approvalId, reason })
  return { rejected: true, approvalId }
}

// ── Proof-of-Action API (Deloitte: immutable logs, cryptographic receipts) ──

/**
 * Get proof log for an agent session
 */
export function getProofLog(sessionId, limit = 50) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null
  return ctx.proofLog.slice(-limit)
}

/**
 * Verify a specific proof entry by hash
 */
export function verifyProof(sessionId, proofId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { valid: false, reason: 'session_not_found' }
  const entry = ctx.proofLog.find(p => p.id === proofId)
  if (!entry) return { valid: false, reason: 'proof_not_found' }
  return { valid: true, proof: entry }
}

/**
 * Get autonomy levels reference
 */
export function getAutonomyLevels() {
  return Object.entries(AUTONOMY_LEVELS_AGENT).map(([name, cfg]) => ({
    name,
    description: cfg.description,
    autoApprove: cfg.autoApprove,
    requiresApproval: cfg.requiresApproval,
    maxBatchSize: cfg.maxBatchSize,
    maxCallsPerMinute: cfg.maxCallsPerMinute
  }))
}

/**
 * Change agent autonomy level
 */
export function setAutonomyLevel(sessionId, level) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }
  if (!AUTONOMY_LEVELS_AGENT[level]) return { error: `Unknown level: ${level}`, available: Object.keys(AUTONOMY_LEVELS_AGENT) }

  const old = ctx.autonomyLevel
  ctx.autonomyLevel = level
  ctx.log('autonomy.changed', { from: old, to: level }, {})
  emitAgentEvent(sessionId, 'agent.autonomy_changed', { from: old, to: level })
  return { autonomyLevel: level, previous: old }
}

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION MODULES (10 gaps → production-grade agent platform)
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Session Persistence ──────────────────────────────────────────────────
// Save/restore agent sessions to Integram table (survives restart)

const PERSISTENCE_TABLE = 'СОД Agent Sessions'
let _persistenceTypeId = null
let _persistenceReady = false

async function initPersistence(client) {
  if (_persistenceReady) return _persistenceTypeId
  try {
    const schema = await client.getSchemaFull()
    const found = schema?.types?.find(t => t.name === PERSISTENCE_TABLE)
    if (found) {
      _persistenceTypeId = found.id
      _persistenceReady = true
      logger.info({ typeId: _persistenceTypeId }, '[AgentV2] Persistence table found')
    }
  } catch (_) {}
  _persistenceReady = true
  return _persistenceTypeId
}

async function persistSession(ctx) {
  if (!_persistenceTypeId) return
  try {
    const client = new IntegramV2Client('kval')
    const data = {
      val: `${ctx.agentId}|${ctx.sessionId.slice(0, 8)}`,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      name: ctx.name || '',
      state: ctx.state,
      autonomyLevel: ctx.autonomyLevel,
      database: ctx.database,
      capabilities: JSON.stringify(ctx.capabilities),
      scope: JSON.stringify(ctx.scope),
      memory: JSON.stringify(ctx.memory),
      metrics: JSON.stringify(ctx.metrics),
      role: ctx.role ? JSON.stringify(ctx.role) : '',
      proofLog: JSON.stringify(ctx.proofLog.slice(-50)),
      lastActivity: ctx.lastActivity.toISOString()
    }
    // Upsert: search by sessionId, update or create
    const existing = await client.search({ query: ctx.sessionId, typeId: _persistenceTypeId, limit: 1 })
    if (existing?.length > 0 && existing[0].id) {
      await client.updateObject?.(existing[0].id, data)
    } else {
      await client.createObject?.(_persistenceTypeId, data)
    }
  } catch (e) {
    logger.debug({ err: e.message }, '[AgentV2] Session persist failed (non-critical)')
  }
}

async function restoreSessions() {
  try {
    const client = new IntegramV2Client('kval')
    await initPersistence(client)
    if (!_persistenceTypeId) return 0

    const records = await client.filter(_persistenceTypeId, { limit: 100 })
    if (!Array.isArray(records) || records.length === 0) return 0

    let restored = 0
    for (const rec of records) {
      const sid = rec.sessionId || rec.reqs?.sessionId?.value
      if (!sid || agentSessions.has(sid)) continue

      try {
        const ctx = new AgentContext({
          agentId: rec.agentId || rec.reqs?.agentId?.value || `agent_restored_${restored}`,
          name: rec.name || rec.reqs?.name?.value || 'Restored',
          capabilities: JSON.parse(rec.capabilities || rec.reqs?.capabilities?.value || '[]'),
          scope: JSON.parse(rec.scope || rec.reqs?.scope?.value || '{}'),
          database: rec.database || rec.reqs?.database?.value || 'kval',
          autonomyLevel: rec.autonomyLevel || rec.reqs?.autonomyLevel?.value || 'augment'
        })
        // Override generated sessionId with stored one
        Object.defineProperty(ctx, 'sessionId', { value: sid, writable: false })
        ctx.state = rec.state || rec.reqs?.state?.value || 'active'
        ctx.memory = JSON.parse(rec.memory || rec.reqs?.memory?.value || '{}')
        ctx.metrics = JSON.parse(rec.metrics || rec.reqs?.metrics?.value || '{}')
        if (rec.role || rec.reqs?.role?.value) {
          try { ctx.role = JSON.parse(rec.role || rec.reqs?.role?.value) } catch (_) {}
        }
        agentSessions.set(sid, ctx)
        restored++
      } catch (_) {}
    }
    logger.info({ restored }, '[AgentV2] Sessions restored from Integram')
    return restored
  } catch (e) {
    logger.debug({ err: e.message }, '[AgentV2] Session restore failed (non-critical)')
    return 0
  }
}

export { restoreSessions, persistSession }

// Auto-persist every 60s for active sessions
let _persistInterval = null
export function startPersistence(intervalMs = 60000) {
  if (_persistInterval) return
  // Init persistence table on first tick
  initPersistence(new IntegramV2Client('kval'))
  _persistInterval = setInterval(async () => {
    if (!_persistenceTypeId) return
    for (const [, ctx] of agentSessions) {
      await persistSession(ctx)
    }
  }, intervalMs)
}

export function stopPersistence() {
  if (_persistInterval) { clearInterval(_persistInterval); _persistInterval = null }
}

// ── 2. Approval Persistence ─────────────────────────────────────────────────
// Approvals survive restart via same pattern (stored alongside sessions)

export function getApprovalStats() {
  let pending = 0, approved = 0, rejected = 0, executed = 0
  for (const [, appr] of pendingApprovals) {
    if (appr.status === 'pending') pending++
    else if (appr.status === 'approved' || appr.status === 'executed') { approved++; if (appr.status === 'executed') executed++ }
    else if (appr.status === 'rejected') rejected++
  }
  return { total: pendingApprovals.size, pending, approved, rejected, executed }
}

// ── 3. Real Rate Limiting (sliding window + backpressure) ───────────────────

const rateLimitWindows = new Map() // sessionId → [timestamps]

function checkRateLimit(sessionId, maxPerMinute) {
  const now = Date.now()
  if (!rateLimitWindows.has(sessionId)) rateLimitWindows.set(sessionId, [])
  const window = rateLimitWindows.get(sessionId)

  // Purge old entries (older than 60s)
  while (window.length > 0 && now - window[0] > 60000) window.shift()

  if (window.length >= maxPerMinute) {
    const oldestAge = now - window[0]
    const waitMs = 60000 - oldestAge
    return { allowed: false, current: window.length, max: maxPerMinute, retryAfterMs: Math.max(0, waitMs) }
  }

  window.push(now)
  return { allowed: true, current: window.length, max: maxPerMinute }
}

export { checkRateLimit }

// ── 4. Conflict Resolution (Optimistic Locking) ────────────────────────────
// Track object versions to prevent lost-update problem

const objectLocks = new Map() // `${typeId}:${objectId}` → { agentId, version, ts }

export function acquireLock(sessionId, typeId, objectId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const key = `${typeId}:${objectId}`
  const existing = objectLocks.get(key)

  if (existing && existing.agentId !== ctx.agentId) {
    const lockAge = Date.now() - existing.ts
    // Auto-expire locks after 5 min
    if (lockAge < 300000) {
      return {
        locked: false,
        heldBy: existing.agentId,
        lockedAt: new Date(existing.ts).toISOString(),
        expiresIn: Math.ceil((300000 - lockAge) / 1000) + 's'
      }
    }
  }

  const version = (existing?.version || 0) + 1
  objectLocks.set(key, { agentId: ctx.agentId, sessionId, version, ts: Date.now() })
  return { locked: true, key, version }
}

export function releaseLock(sessionId, typeId, objectId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const key = `${typeId}:${objectId}`
  const existing = objectLocks.get(key)
  if (!existing || existing.agentId !== ctx.agentId) {
    return { released: false, reason: 'not_owner' }
  }

  objectLocks.delete(key)
  return { released: true, key }
}

export function getLocks(sessionId) {
  const ctx = agentSessions.get(sessionId)
  const results = []
  for (const [key, lock] of objectLocks) {
    if (!sessionId || lock.agentId === ctx?.agentId) {
      results.push({ key, ...lock, ts: new Date(lock.ts).toISOString() })
    }
  }
  return results
}

// Auto-cleanup expired locks
setInterval(() => {
  const now = Date.now()
  for (const [key, lock] of objectLocks) {
    if (now - lock.ts > 300000) objectLocks.delete(key)
  }
}, 60000)

// ── 5. Pipeline Recovery (rollback on failure) ──────────────────────────────

export async function executePipelineWithRecovery(pipelineId) {
  const pipeline = pipelines.get(pipelineId)
  if (!pipeline) return { error: 'Pipeline не найден' }
  if (pipeline.status === 'running') return { error: 'Pipeline уже выполняется' }

  pipeline.status = 'running'
  const completedSteps = []

  try {
    const order = topologicalSort(pipeline.steps)
    const stepMap = new Map(pipeline.steps.map(s => [s.id, s]))

    for (const stepId of order) {
      const step = stepMap.get(stepId)
      step.status = 'running'
      step.startedAt = new Date().toISOString()

      try {
        const resolvedParams = { ...step.params }
        for (const dep of step.dependsOn) {
          const depStep = stepMap.get(dep)
          if (depStep?.result) resolvedParams[`_result_${dep}`] = depStep.result
        }

        step.result = await execute(step.agentSessionId, step.operation, resolvedParams)
        step.status = 'complete'
        step.completedAt = new Date().toISOString()
        pipeline.results[step.id] = step.result
        completedSteps.push(step)
      } catch (err) {
        step.error = err.message
        step.status = 'error'
        step.completedAt = new Date().toISOString()

        // ── Rollback completed steps in reverse order ──
        const rollbackResults = []
        for (let i = completedSteps.length - 1; i >= 0; i--) {
          const cs = completedSteps[i]
          if (cs.params?.rollback) {
            try {
              await execute(cs.agentSessionId, cs.params.rollback.operation, cs.params.rollback.params || {})
              rollbackResults.push({ step: cs.id, rollback: 'success' })
              cs.status = 'rolled_back'
            } catch (re) {
              rollbackResults.push({ step: cs.id, rollback: 'failed', error: re.message })
            }
          }
        }

        pipeline.status = 'error'
        pipeline.completedAt = new Date().toISOString()

        emitAgentEvent(step.agentSessionId, 'pipeline.failed', {
          pipelineId, failedStep: stepId, error: err.message, rollbacks: rollbackResults.length
        })

        return {
          pipelineId,
          status: 'error',
          failedStep: stepId,
          error: err.message,
          completedSteps: completedSteps.length,
          totalSteps: pipeline.steps.length,
          rollbackResults,
          results: pipeline.results
        }
      }
    }

    pipeline.status = 'complete'
    pipeline.completedAt = new Date().toISOString()
    return { pipelineId, status: 'complete', totalSteps: pipeline.steps.length, results: pipeline.results }
  } catch (err) {
    pipeline.status = 'error'
    return { pipelineId, status: 'error', error: err.message }
  }
}

// ── 6. Agent Marketplace ────────────────────────────────────────────────────
// Agents publish skills, others find and request execution

const marketplace = new Map() // skillId → { agentId, sessionId, name, description, price, capability, rating }

export function publishSkill(sessionId, skill = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const skillId = `skill_${crypto.randomUUID().slice(0, 8)}`
  marketplace.set(skillId, {
    skillId,
    agentId: ctx.agentId,
    sessionId,
    name: skill.name || 'Unnamed Skill',
    description: skill.description || '',
    capability: skill.capability || '',
    price: skill.price || 0,
    inputSchema: skill.inputSchema || {},
    rating: { total: 0, count: 0, avg: 0 },
    publishedAt: new Date().toISOString(),
    executions: 0
  })

  emitAgentEvent(sessionId, 'marketplace.skill_published', { skillId, name: skill.name })
  return { published: true, skillId }
}

export function browseMarketplace(filter = {}) {
  const results = []
  for (const [, skill] of marketplace) {
    if (filter.capability && !skill.capability.includes(filter.capability)) continue
    if (filter.query) {
      const q = filter.query.toLowerCase()
      if (!skill.name.toLowerCase().includes(q) && !skill.description.toLowerCase().includes(q)) continue
    }
    // Check if agent is still alive
    const ctx = agentSessions.get(skill.sessionId)
    results.push({
      ...skill,
      agentOnline: !!ctx,
      agentState: ctx?.state || 'offline'
    })
  }
  // Sort by rating desc
  results.sort((a, b) => b.rating.avg - a.rating.avg || b.executions - a.executions)
  return results
}

export async function requestSkill(sessionId, skillId, params = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const skill = marketplace.get(skillId)
  if (!skill) return { error: 'Skill не найден' }

  const provider = agentSessions.get(skill.sessionId)
  if (!provider) return { error: 'Агент-провайдер офлайн' }

  try {
    const result = await execute(skill.sessionId, skill.capability, params)
    skill.executions++
    emitAgentEvent(sessionId, 'marketplace.skill_executed', { skillId, provider: skill.agentId })
    return { executed: true, skillId, provider: skill.agentId, result }
  } catch (err) {
    return { executed: false, skillId, error: err.message }
  }
}

export function rateSkill(skillId, rating) {
  const skill = marketplace.get(skillId)
  if (!skill) return { error: 'Skill не найден' }
  if (rating < 1 || rating > 5) return { error: 'Rating must be 1-5' }

  skill.rating.total += rating
  skill.rating.count++
  skill.rating.avg = +(skill.rating.total / skill.rating.count).toFixed(2)
  return { rated: true, skillId, newAvg: skill.rating.avg }
}

// ── 7. Feedback Loop ────────────────────────────────────────────────────────
// Execution results feed back into agent scoring to improve delegation

export function submitFeedback(sessionId, feedback = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const fb = {
    id: crypto.randomUUID().slice(0, 8),
    ts: new Date().toISOString(),
    operation: feedback.operation,
    quality: Math.max(0, Math.min(1, feedback.quality || 0.5)), // 0-1 score
    comment: feedback.comment || '',
    latencyOk: feedback.latencyOk !== false
  }

  if (!ctx._feedbackLog) ctx._feedbackLog = []
  ctx._feedbackLog.push(fb)
  if (ctx._feedbackLog.length > 200) ctx._feedbackLog = ctx._feedbackLog.slice(-100)

  // Adjust metrics based on feedback
  if (fb.quality < 0.3) {
    ctx.metrics.errorCount += 0.5 // penalize low quality
  } else if (fb.quality > 0.8) {
    ctx.metrics.successCount += 0.2 // bonus for high quality
  }

  emitAgentEvent(sessionId, 'agent.feedback', { quality: fb.quality, operation: fb.operation })
  return { recorded: true, feedbackId: fb.id, agentScore: getAgentScore(sessionId) }
}

function getAgentScore(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return 0

  const m = ctx.metrics
  const successRate = m.totalCalls > 0 ? m.successCount / m.totalCalls : 1
  const avgLatency = m.totalCalls > 0 ? m.totalLatencyMs / m.totalCalls : 0
  const latencyScore = Math.max(0, 1 - avgLatency / 10000) // 10s = 0 score

  // Weighted composite score
  const feedbackAvg = ctx._feedbackLog?.length > 0
    ? ctx._feedbackLog.reduce((s, f) => s + f.quality, 0) / ctx._feedbackLog.length
    : 0.5

  return +((successRate * 0.4 + latencyScore * 0.2 + feedbackAvg * 0.4) * 100).toFixed(1)
}

export function getAgentScorecard(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return null

  const m = ctx.metrics
  return {
    agentId: ctx.agentId,
    score: getAgentScore(sessionId),
    successRate: m.totalCalls > 0 ? +(m.successCount / m.totalCalls).toFixed(3) : 1,
    avgLatencyMs: m.totalCalls > 0 ? +(m.totalLatencyMs / m.totalCalls).toFixed(1) : 0,
    totalCalls: m.totalCalls,
    feedbackCount: ctx._feedbackLog?.length || 0,
    feedbackAvg: ctx._feedbackLog?.length > 0
      ? +(ctx._feedbackLog.reduce((s, f) => s + f.quality, 0) / ctx._feedbackLog.length).toFixed(2)
      : null,
    rank: getRank(sessionId)
  }
}

function getRank(sessionId) {
  const scores = []
  for (const [sid] of agentSessions) {
    scores.push({ sid, score: getAgentScore(sid) })
  }
  scores.sort((a, b) => b.score - a.score)
  const idx = scores.findIndex(s => s.sid === sessionId)
  return idx >= 0 ? `${idx + 1}/${scores.length}` : null
}

export { submitFeedback as recordFeedback, getAgentScore }

// ── 8. Change Notifications (Pub/Sub) ───────────────────────────────────────
// Agents subscribe to data changes, get notified when tables are modified

const changeSubscriptions = new Map() // sessionId → [{ typeId, callback }]
const changeLog = [] // recent changes ring buffer (max 1000)

export function subscribeToChanges(sessionId, typeIds = []) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  if (!changeSubscriptions.has(sessionId)) changeSubscriptions.set(sessionId, [])
  const subs = changeSubscriptions.get(sessionId)
  for (const tid of typeIds) {
    if (!subs.find(s => s.typeId === tid)) subs.push({ typeId: tid, since: new Date().toISOString() })
  }
  return { subscribed: typeIds, total: subs.length }
}

export function notifyChange(typeId, operation, data = {}) {
  const change = {
    id: crypto.randomUUID().slice(0, 8),
    typeId,
    operation, // create, update, delete
    data: typeof data === 'object' ? JSON.stringify(data).slice(0, 500) : data,
    ts: new Date().toISOString()
  }
  changeLog.push(change)
  if (changeLog.length > 1000) changeLog.splice(0, changeLog.length - 500)

  // Notify subscribed agents
  let notified = 0
  for (const [sid, subs] of changeSubscriptions) {
    const matching = subs.filter(s => s.typeId === String(typeId) || s.typeId === typeId)
    if (matching.length > 0) {
      const ctx = agentSessions.get(sid)
      if (ctx) {
        if (!ctx._pendingNotifications) ctx._pendingNotifications = []
        ctx._pendingNotifications.push(change)
        if (ctx._pendingNotifications.length > 100) ctx._pendingNotifications = ctx._pendingNotifications.slice(-50)
        notified++
      }
    }
  }

  // Socket.io broadcast
  if (_io) _io.emit('data:changed', change)
  return { notified, changeId: change.id }
}

export function getNotifications(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const notifications = ctx._pendingNotifications || []
  ctx._pendingNotifications = [] // clear after read
  return { notifications, count: notifications.length }
}

export function getChangeLog(typeId, limit = 50) {
  const filtered = typeId
    ? changeLog.filter(c => String(c.typeId) === String(typeId))
    : changeLog
  return filtered.slice(-limit)
}

// ── 9. Async Jobs ───────────────────────────────────────────────────────────
// Queue for long-running operations (import 10K records, etc.)

const jobQueue = new Map() // jobId → { status, progress, result, error, ... }

export async function submitJob(sessionId, operation, params = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const jobId = `job_${crypto.randomUUID().slice(0, 8)}`
  const job = {
    jobId,
    sessionId,
    agentId: ctx.agentId,
    operation,
    params,
    status: 'queued',
    progress: 0,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null
  }
  jobQueue.set(jobId, job)

  // Execute asynchronously
  setImmediate(async () => {
    job.status = 'running'
    job.startedAt = new Date().toISOString()

    try {
      // For batch/import operations, track progress
      if (operation === 'import' && Array.isArray(params.records)) {
        const batchSize = 50
        const records = params.records
        const results = []
        for (let i = 0; i < records.length; i += batchSize) {
          const chunk = records.slice(i, i + batchSize)
          const r = await execute(sessionId, 'import', {
            typeId: params.typeId,
            records: chunk,
            options: params.options
          })
          results.push(r)
          job.progress = Math.round(((i + chunk.length) / records.length) * 100)
        }
        job.result = { chunks: results.length, totalRecords: records.length }
      } else {
        job.result = await execute(sessionId, operation, params)
        job.progress = 100
      }

      job.status = 'complete'
      job.completedAt = new Date().toISOString()
      emitAgentEvent(sessionId, 'job.complete', { jobId, operation })
    } catch (err) {
      job.status = 'failed'
      job.error = err.message
      job.completedAt = new Date().toISOString()
      emitAgentEvent(sessionId, 'job.failed', { jobId, operation, error: err.message })
    }
  })

  return { jobId, status: 'queued', operation }
}

export function getJobStatus(jobId) {
  const job = jobQueue.get(jobId)
  if (!job) return null
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    operation: job.operation,
    agentId: job.agentId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.status === 'complete' ? job.result : undefined,
    error: job.error
  }
}

export function listJobs(filter = {}) {
  const results = []
  for (const [, job] of jobQueue) {
    if (filter.sessionId && job.sessionId !== filter.sessionId) continue
    if (filter.status && job.status !== filter.status) continue
    results.push(getJobStatus(job.jobId))
  }
  return results
}

// Auto-cleanup completed jobs after 1 hour
setInterval(() => {
  const now = Date.now()
  for (const [jid, job] of jobQueue) {
    if (job.completedAt && now - new Date(job.completedAt).getTime() > 3600000) {
      jobQueue.delete(jid)
    }
  }
}, 300000)

// ── 10. Schema Caching ──────────────────────────────────────────────────────
// Memoize expensive schema/stats queries with TTL

const schemaCache = new Map() // cacheKey → { data, ts }
const CACHE_TTL_MS = 120000 // 2 min

export function cachedQuery(key) {
  const entry = schemaCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    schemaCache.delete(key)
    return null
  }
  return entry.data
}

export function cacheSet(key, data) {
  schemaCache.set(key, { data, ts: Date.now() })
  // Limit cache size
  if (schemaCache.size > 200) {
    const oldest = [...schemaCache.entries()].sort((a, b) => a[1].ts - b[1].ts)
    for (let i = 0; i < 50; i++) schemaCache.delete(oldest[i][0])
  }
}

export function cacheInvalidate(pattern) {
  if (!pattern) { schemaCache.clear(); return { cleared: schemaCache.size } }
  let cleared = 0
  for (const key of schemaCache.keys()) {
    if (key.includes(pattern)) { schemaCache.delete(key); cleared++ }
  }
  return { cleared }
}

export function getCacheStats() {
  let hits = 0, size = schemaCache.size
  const entries = []
  for (const [key, entry] of schemaCache) {
    const age = Date.now() - entry.ts
    entries.push({ key, ageMs: age, expired: age > CACHE_TTL_MS })
  }
  return { size, entries: entries.slice(0, 20), ttlMs: CACHE_TTL_MS }
}

// ══════════════════════════════════════════════════════════════════════════════
// DELOITTE AGENTIC AI 6 GAPS — Persistent MCP Tools
// ══════════════════════════════════════════════════════════════════════════════

// ── Table init (lazy — finds existing tables by name) ─────────────────────────
const _tableCache = {} // tableName → typeId
let _tableInitDone = false

async function _findTable(tableName) {
  if (_tableCache[tableName]) return _tableCache[tableName]
  try {
    const client = new IntegramV2Client('kval')
    const schema = await client.getSchemaFull()
    const found = schema?.types?.find(t => t.name === tableName)
    if (found) {
      _tableCache[tableName] = found.id
      return found.id
    }
  } catch (_) {}
  return null
}

const TABLE_FINOPS = 'СОД Agent FinOps'
const TABLE_RECEIPTS = 'СОД Agent Receipts'
const TABLE_LEARNING = 'СОД Agent Learning'

// ── Gap 2: Digital Receipts — hash chain per agent ────────────────────────────

const _receiptChains = new Map() // agentId → { lastHash, lastIndex }

function _hashPayload(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

function _chainHash(payloadHash, prevHash) {
  return crypto.createHash('sha256').update(payloadHash + prevHash).digest('hex')
}

function _sign(data, secret = 'dronedoc-receipts-2026') {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(data)).digest('hex')
}

export async function issueReceipt(agentId, operation, targetType, targetId, payload = {}) {
  const payloadHash = _hashPayload(payload)

  // Get chain state (in-memory + fallback to DB for last receipt)
  let chain = _receiptChains.get(agentId)
  if (!chain) {
    chain = { lastHash: '0'.repeat(64), lastIndex: 0 }
    // Try to restore from DB
    const tableId = await _findTable(TABLE_RECEIPTS)
    if (tableId) {
      try {
        const client = new IntegramV2Client('kval')
        const results = await client.search({ query: agentId, typeId: tableId, limit: 1 })
        if (results?.results?.length) {
          const last = results.results[0]
          const reqs = last.reqs || {}
          chain.lastHash = reqs.chainHash?.value || chain.lastHash
          chain.lastIndex = parseInt(reqs.chainIndex?.value || '0') || chain.lastIndex
        }
      } catch (_) {}
    }
    _receiptChains.set(agentId, chain)
  }

  const chainH = _chainHash(payloadHash, chain.lastHash)
  const idx = chain.lastIndex + 1
  const receiptId = `receipt_${crypto.randomUUID().slice(0, 12)}`

  const receipt = {
    id: receiptId,
    agentId,
    operation,
    targetType: targetType || '',
    targetId: targetId || '',
    payloadHash,
    prevHash: chain.lastHash,
    chainHash: chainH,
    chainIndex: idx,
    signature: _sign({ payloadHash, prevHash: chain.lastHash, chainHash: chainH, idx }),
    timestamp: new Date().toISOString()
  }

  // Update chain state
  chain.lastHash = chainH
  chain.lastIndex = idx

  // Persist to Integram
  const tableId = await _findTable(TABLE_RECEIPTS)
  if (tableId) {
    try {
      const client = new IntegramV2Client('kval')
      await client.createObject(tableId, {
        val: receiptId,
        agentId,
        operation,
        targetType: targetType || '',
        targetId: String(targetId || ''),
        payloadHash,
        prevHash: receipt.prevHash,
        chainHash: chainH,
        chainIndex: idx,
        signature: receipt.signature,
        timestamp: receipt.timestamp
      })
    } catch (e) {
      logger.debug({ err: e.message }, '[Receipts] Persist failed (in-memory ok)')
    }
  }

  emitAgentEvent(null, 'receipt.issued', { receiptId, agentId, operation })
  return receipt
}

export async function verifyReceipt(receiptId) {
  const tableId = await _findTable(TABLE_RECEIPTS)
  if (!tableId) return { valid: false, error: 'Receipts table not found' }

  try {
    const client = new IntegramV2Client('kval')
    const results = await client.search({ query: receiptId, typeId: tableId, limit: 1 })
    if (!results?.results?.length) return { valid: false, error: 'Receipt not found' }

    const r = results.results[0]
    const reqs = r.reqs || {}
    const payloadHash = reqs.payloadHash?.value || ''
    const prevHash = reqs.prevHash?.value || ''
    const storedChain = reqs.chainHash?.value || ''
    const expectedChain = _chainHash(payloadHash, prevHash)

    const sig = reqs.signature?.value || ''
    const idx = parseInt(reqs.chainIndex?.value || '0')
    const expectedSig = _sign({ payloadHash, prevHash, chainHash: storedChain, idx })

    return {
      valid: storedChain === expectedChain && sig === expectedSig,
      receiptId,
      chainIntegrity: storedChain === expectedChain,
      signatureValid: sig === expectedSig,
      chainIndex: idx
    }
  } catch (e) {
    return { valid: false, error: e.message }
  }
}

export async function verifyChain(agentId, limit = 100) {
  const tableId = await _findTable(TABLE_RECEIPTS)
  if (!tableId) return { valid: false, error: 'Receipts table not found' }

  try {
    const client = new IntegramV2Client('kval')
    const results = await client.search({ query: agentId, typeId: tableId, limit })
    if (!results?.results?.length) return { valid: true, chainLength: 0 }

    // Sort by chainIndex
    const receipts = results.results
      .map(r => {
        const reqs = r.reqs || {}
        return {
          chainIndex: parseInt(reqs.chainIndex?.value || '0'),
          payloadHash: reqs.payloadHash?.value || '',
          prevHash: reqs.prevHash?.value || '',
          chainHash: reqs.chainHash?.value || ''
        }
      })
      .sort((a, b) => a.chainIndex - b.chainIndex)

    let broken = []
    for (let i = 0; i < receipts.length; i++) {
      const r = receipts[i]
      const expected = _chainHash(r.payloadHash, r.prevHash)
      if (expected !== r.chainHash) broken.push(r.chainIndex)
      // Verify prev link
      if (i > 0 && r.prevHash !== receipts[i - 1].chainHash) broken.push(r.chainIndex)
    }

    const valid = broken.length === 0
    if (!valid) emitAgentEvent(null, 'receipt.chain_broken', { agentId, brokenAt: broken })
    return { valid, chainLength: receipts.length, brokenLinks: broken }
  } catch (e) {
    return { valid: false, error: e.message }
  }
}

export async function queryReceipts(filter = {}) {
  const tableId = await _findTable(TABLE_RECEIPTS)
  if (!tableId) return { receipts: [], error: 'Receipts table not found' }

  try {
    const client = new IntegramV2Client('kval')
    const query = filter.agentId || filter.operation || filter.targetType || ''
    const results = await client.search({ query, typeId: tableId, limit: filter.limit || 50 })
    const receipts = (results?.results || []).map(r => {
      const reqs = r.reqs || {}
      return {
        id: r.title || reqs.val?.value || r.id,
        agentId: reqs.agentId?.value || '',
        operation: reqs.operation?.value || '',
        targetType: reqs.targetType?.value || '',
        targetId: reqs.targetId?.value || '',
        chainIndex: parseInt(reqs.chainIndex?.value || '0'),
        chainHash: reqs.chainHash?.value || '',
        timestamp: reqs.timestamp?.value || ''
      }
    })

    // Client-side filtering
    let filtered = receipts
    if (filter.agentId) filtered = filtered.filter(r => r.agentId === filter.agentId)
    if (filter.operation) filtered = filtered.filter(r => r.operation === filter.operation)
    if (filter.targetType) filtered = filtered.filter(r => r.targetType === filter.targetType)

    return { receipts: filtered, total: filtered.length }
  } catch (e) {
    return { receipts: [], error: e.message }
  }
}

// ── Gap 1: Agent FinOps — token usage, budgets, cost tracking ─────────────────

const _budgets = new Map() // `${agentId}|${period}` → { limitRub, alertPct }
const _finopsInMemory = [] // fallback ring buffer

export async function recordTokenUsage(agentId, { model, toolName, inputTokens = 0, outputTokens = 0, costRub = '0', tags = {} } = {}) {
  const period = new Date().toISOString().slice(0, 7) // YYYY-MM
  const record = {
    val: `${agentId}|${period}`,
    agentId,
    model: model || 'unknown',
    toolName: toolName || '',
    inputTokens,
    outputTokens,
    costRub: String(costRub),
    budgetLimitRub: '',
    budgetAlertPct: '',
    tags: JSON.stringify(tags),
    timestamp: new Date().toISOString()
  }

  // Check budget
  const budgetKey = `${agentId}|${period}`
  const budget = _budgets.get(budgetKey)
  let budgetWarning = null

  // Persist to Integram
  const tableId = await _findTable(TABLE_FINOPS)
  if (tableId) {
    try {
      const client = new IntegramV2Client('kval')
      await client.createObject(tableId, record)
    } catch (e) {
      logger.debug({ err: e.message }, '[FinOps] Persist failed')
    }
  }

  // In-memory fallback
  _finopsInMemory.push(record)
  if (_finopsInMemory.length > 5000) _finopsInMemory.splice(0, 2500)

  // Budget check
  if (budget) {
    const totalCost = await _getAgentCost(agentId, period)
    const pct = (totalCost / parseFloat(budget.limitRub)) * 100
    if (pct >= 100) {
      budgetWarning = { type: 'exceeded', pct: Math.round(pct), limitRub: budget.limitRub }
      emitAgentEvent(null, 'finops.budget_exceeded', { agentId, period, pct: Math.round(pct) })
    } else if (pct >= (budget.alertPct || 80)) {
      budgetWarning = { type: 'alert', pct: Math.round(pct), limitRub: budget.limitRub }
      emitAgentEvent(null, 'finops.budget_alert', { agentId, period, pct: Math.round(pct) })
    }
  }

  // Issue receipt for the finops record
  await issueReceipt(agentId, 'finops.record', TABLE_FINOPS, '', { inputTokens, outputTokens, costRub })

  emitAgentEvent(null, 'finops.recorded', { agentId, model, tokens: inputTokens + outputTokens })
  return { recorded: true, agentId, period, budgetWarning }
}

async function _getAgentCost(agentId, period) {
  // Sum from in-memory
  return _finopsInMemory
    .filter(r => r.agentId === agentId && r.val?.startsWith(`${agentId}|${period}`))
    .reduce((sum, r) => sum + parseFloat(r.costRub || 0), 0)
}

export function setFinOpsBudget(agentId, { period, limitRub, alertPct = 80 } = {}) {
  const p = period || new Date().toISOString().slice(0, 7)
  const key = `${agentId}|${p}`
  _budgets.set(key, { limitRub: String(limitRub), alertPct })
  return { set: true, agentId, period: p, limitRub, alertPct }
}

export function getFinOpsBudget(agentId, period) {
  const p = period || new Date().toISOString().slice(0, 7)
  return _budgets.get(`${agentId}|${p}`) || null
}

export async function getFinOpsReport(filter = {}) {
  const { agentId, model, toolName, period, limit = 100 } = filter

  // Try DB first
  const tableId = await _findTable(TABLE_FINOPS)
  let records = []

  if (tableId) {
    try {
      const client = new IntegramV2Client('kval')
      const query = agentId || model || toolName || ''
      const results = await client.search({ query, typeId: tableId, limit })
      records = (results?.results || []).map(r => {
        const reqs = r.reqs || {}
        return {
          agentId: reqs.agentId?.value || '',
          model: reqs.model?.value || '',
          toolName: reqs.toolName?.value || '',
          inputTokens: parseInt(reqs.inputTokens?.value || '0'),
          outputTokens: parseInt(reqs.outputTokens?.value || '0'),
          costRub: reqs.costRub?.value || '0',
          timestamp: reqs.timestamp?.value || ''
        }
      })
    } catch (_) {}
  }

  // Fallback/supplement from in-memory
  if (records.length === 0) {
    records = _finopsInMemory.map(r => ({
      agentId: r.agentId,
      model: r.model,
      toolName: r.toolName,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costRub: r.costRub,
      timestamp: r.timestamp
    }))
  }

  // Filter
  let filtered = records
  if (agentId) filtered = filtered.filter(r => r.agentId === agentId)
  if (model) filtered = filtered.filter(r => r.model === model)
  if (toolName) filtered = filtered.filter(r => r.toolName === toolName)
  if (period) filtered = filtered.filter(r => r.timestamp?.startsWith(period))

  // Aggregate
  const totalTokens = filtered.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0)
  const totalCost = filtered.reduce((s, r) => s + parseFloat(r.costRub || 0), 0)
  const byModel = {}
  const byAgent = {}
  for (const r of filtered) {
    byModel[r.model] = (byModel[r.model] || 0) + parseFloat(r.costRub || 0)
    byAgent[r.agentId] = (byAgent[r.agentId] || 0) + parseFloat(r.costRub || 0)
  }

  const budget = agentId ? getFinOpsBudget(agentId, period) : null

  return {
    records: filtered.slice(0, limit),
    total: filtered.length,
    totalTokens,
    totalCostRub: totalCost.toFixed(2),
    byModel,
    byAgent,
    budget,
    budgetUtilization: budget ? `${Math.round((totalCost / parseFloat(budget.limitRub)) * 100)}%` : null
  }
}

// ── Gap 3: Agent Learning Loop — feedback, performance, drift ─────────────────

export async function recordLearningFeedback(agentId, { operation, score: rawScore, comment = '' } = {}) {
  const score = parseInt(rawScore)
  if (!score || score < 1 || score > 5) return { error: 'Score must be 1-5' }

  const entry = {
    val: `${agentId}|feedback|${crypto.randomUUID().slice(0, 8)}`,
    agentId,
    type: 'feedback',
    operation: operation || '',
    score,
    comment,
    metrics: '',
    baseline: '',
    recommendation: '',
    timestamp: new Date().toISOString()
  }

  const tableId = await _findTable(TABLE_LEARNING)
  if (tableId) {
    try {
      const client = new IntegramV2Client('kval')
      await client.createObject(tableId, entry)
    } catch (e) {
      logger.debug({ err: e.message }, '[Learning] Persist failed')
    }
  }

  // Also feed into existing in-memory scorecard
  for (const [sid, ctx] of agentSessions) {
    if (ctx.agentId === agentId) {
      submitFeedback(sid, { operation, quality: score / 5, comment })
      break
    }
  }

  await issueReceipt(agentId, 'learning.feedback', TABLE_LEARNING, '', { score, operation })
  emitAgentEvent(null, 'learning.feedback', { agentId, score, operation })
  return { recorded: true, agentId, score }
}

export async function getLearningPerformance(agentId) {
  // Aggregate from in-memory metrics + DB
  let scorecard = null
  for (const [sid, ctx] of agentSessions) {
    if (ctx.agentId === agentId) {
      scorecard = getAgentScorecard(sid)
      break
    }
  }

  // Get feedback from DB
  let feedbacks = []
  const tableId = await _findTable(TABLE_LEARNING)
  if (tableId) {
    try {
      const client = new IntegramV2Client('kval')
      const results = await client.search({ query: agentId, typeId: tableId, limit: 100 })
      feedbacks = (results?.results || []).map(r => {
        const reqs = r.reqs || {}
        return {
          type: reqs.type?.value || '',
          operation: reqs.operation?.value || '',
          score: parseInt(reqs.score?.value || '0'),
          comment: reqs.comment?.value || '',
          timestamp: reqs.timestamp?.value || ''
        }
      }).filter(f => f.type === 'feedback')
    } catch (_) {}
  }

  const avgScore = feedbacks.length > 0
    ? +(feedbacks.reduce((s, f) => s + f.score, 0) / feedbacks.length).toFixed(2)
    : null

  const performance = {
    agentId,
    scorecard,
    feedbackCount: feedbacks.length,
    avgFeedbackScore: avgScore,
    recentFeedback: feedbacks.slice(-10),
    metrics: scorecard ? {
      successRate: scorecard.successRate,
      avgLatencyMs: scorecard.avgLatencyMs,
      totalCalls: scorecard.totalCalls,
      costEfficiency: scorecard.score
    } : null
  }

  // Store performance snapshot
  if (tableId && scorecard) {
    try {
      const client = new IntegramV2Client('kval')
      await client.createObject(tableId, {
        val: `${agentId}|performance|${crypto.randomUUID().slice(0, 8)}`,
        agentId,
        type: 'performance',
        operation: '',
        score: Math.round(scorecard.score),
        comment: '',
        metrics: JSON.stringify(performance.metrics),
        baseline: '',
        recommendation: '',
        timestamp: new Date().toISOString()
      })
    } catch (_) {}
  }

  return performance
}

export async function detectDrift(agentId, baseline = {}) {
  const perf = await getLearningPerformance(agentId)
  const current = perf.metrics || {}
  const drift = {}
  let driftDetected = false

  if (baseline.successRate !== undefined && current.successRate !== undefined) {
    const delta = current.successRate - baseline.successRate
    drift.successRate = { current: current.successRate, baseline: baseline.successRate, delta: +delta.toFixed(3) }
    if (Math.abs(delta) > 0.1) driftDetected = true
  }
  if (baseline.avgLatencyMs !== undefined && current.avgLatencyMs !== undefined) {
    const delta = current.avgLatencyMs - baseline.avgLatencyMs
    drift.avgLatencyMs = { current: current.avgLatencyMs, baseline: baseline.avgLatencyMs, delta: +delta.toFixed(1) }
    if (delta > baseline.avgLatencyMs * 0.5) driftDetected = true // >50% slower
  }
  if (baseline.costEfficiency !== undefined && current.costEfficiency !== undefined) {
    const delta = current.costEfficiency - baseline.costEfficiency
    drift.costEfficiency = { current: current.costEfficiency, baseline: baseline.costEfficiency, delta: +delta.toFixed(1) }
    if (delta < -10) driftDetected = true // score dropped >10
  }

  if (driftDetected) {
    emitAgentEvent(null, 'learning.drift_detected', { agentId, drift })
    // Persist drift record
    const tableId = await _findTable(TABLE_LEARNING)
    if (tableId) {
      try {
        const client = new IntegramV2Client('kval')
        await client.createObject(tableId, {
          val: `${agentId}|drift|${crypto.randomUUID().slice(0, 8)}`,
          agentId, type: 'drift', operation: '', score: 0,
          comment: driftDetected ? 'Drift detected' : 'Within baseline',
          metrics: JSON.stringify(current),
          baseline: JSON.stringify(baseline),
          recommendation: '', timestamp: new Date().toISOString()
        })
      } catch (_) {}
    }
  }

  return { agentId, driftDetected, drift, current, baseline }
}

export async function generateRecommendations(agentId) {
  const perf = await getLearningPerformance(agentId)
  const recs = []

  if (perf.metrics) {
    if (perf.metrics.successRate < 0.8) {
      recs.push({ priority: 'high', area: 'reliability', text: `Success rate ${(perf.metrics.successRate * 100).toFixed(0)}% is below 80%. Review error patterns and add guardrails.` })
    }
    if (perf.metrics.avgLatencyMs > 5000) {
      recs.push({ priority: 'medium', area: 'performance', text: `Avg latency ${perf.metrics.avgLatencyMs}ms exceeds 5s. Consider caching or query optimization.` })
    }
    if (perf.metrics.costEfficiency < 50) {
      recs.push({ priority: 'medium', area: 'cost', text: `Agent score ${perf.metrics.costEfficiency} is low. Review token usage patterns.` })
    }
  }
  if (perf.avgFeedbackScore !== null && perf.avgFeedbackScore < 3) {
    recs.push({ priority: 'high', area: 'quality', text: `Avg feedback ${perf.avgFeedbackScore}/5. Investigate common complaints.` })
  }
  if (perf.feedbackCount < 5) {
    recs.push({ priority: 'low', area: 'data', text: `Only ${perf.feedbackCount} feedback entries. Collect more for reliable analysis.` })
  }
  if (recs.length === 0) {
    recs.push({ priority: 'info', area: 'general', text: 'Agent performing within normal parameters. No action needed.' })
  }

  // Persist
  const tableId = await _findTable(TABLE_LEARNING)
  if (tableId) {
    try {
      const client = new IntegramV2Client('kval')
      await client.createObject(tableId, {
        val: `${agentId}|recommendation|${crypto.randomUUID().slice(0, 8)}`,
        agentId, type: 'recommendation', operation: '', score: 0,
        comment: '', metrics: '', baseline: '',
        recommendation: JSON.stringify(recs),
        timestamp: new Date().toISOString()
      })
    } catch (_) {}
  }

  emitAgentEvent(null, 'learning.recommendation', { agentId, count: recs.length })
  return { agentId, recommendations: recs, performance: perf.metrics, feedbackAvg: perf.avgFeedbackScore }
}

// ── Gap 4: Process-First Design — business processes → agent pipelines ────────

const _processes = new Map() // processId → process definition

export function defineProcess(name, { steps = [], connections = [], owner = '', tags = [] } = {}) {
  const processId = `proc_${crypto.randomUUID().slice(0, 8)}`
  const process = {
    id: processId,
    name,
    steps: steps.map((s, i) => ({
      id: s.id || `step_${i}`,
      name: s.name,
      type: s.type || 'manual', // manual | semi-auto | auto
      agent: s.agent || null,
      inputs: s.inputs || [],
      outputs: s.outputs || [],
      duration: s.duration || null,
      cost: s.cost || null
    })),
    connections: connections.map(c => ({
      from: c.from,
      to: c.to,
      condition: c.condition || null
    })),
    owner,
    tags,
    createdAt: new Date().toISOString(),
    status: 'draft'
  }

  _processes.set(processId, process)
  emitAgentEvent(null, 'process.defined', { processId, name, steps: steps.length })
  return process
}

export function analyzeProcess(processId) {
  const proc = _processes.get(processId)
  if (!proc) return { error: 'Process not found' }

  const totalSteps = proc.steps.length
  const manualSteps = proc.steps.filter(s => s.type === 'manual')
  const autoSteps = proc.steps.filter(s => s.type === 'auto')
  const semiAutoSteps = proc.steps.filter(s => s.type === 'semi-auto')

  const automationPotential = totalSteps > 0
    ? +((1 - manualSteps.length / totalSteps) * 100).toFixed(1)
    : 0

  // Find bottlenecks (steps with no outgoing connections — dead ends, or longest duration)
  const outgoing = new Set(proc.connections.map(c => c.from))
  const incoming = new Set(proc.connections.map(c => c.to))
  const bottlenecks = proc.steps.filter(s =>
    !outgoing.has(s.id) && incoming.has(s.id) // dead end (except last step)
  ).map(s => s.name)

  // Value stream
  const totalDuration = proc.steps.reduce((s, st) => s + (st.duration || 0), 0)
  const totalCost = proc.steps.reduce((s, st) => s + (st.cost || 0), 0)
  const valueDuration = autoSteps.reduce((s, st) => s + (st.duration || 0), 0)

  const analysis = {
    processId,
    name: proc.name,
    totalSteps,
    breakdown: { manual: manualSteps.length, semiAuto: semiAutoSteps.length, auto: autoSteps.length },
    automationPotential: `${automationPotential}%`,
    bottlenecks,
    valueStream: {
      totalDurationMin: totalDuration,
      valueAddDurationMin: valueDuration,
      wasteDurationMin: totalDuration - valueDuration,
      efficiency: totalDuration > 0 ? `${((valueDuration / totalDuration) * 100).toFixed(0)}%` : 'N/A',
      totalCost
    },
    recommendations: []
  }

  if (manualSteps.length > totalSteps * 0.5) {
    analysis.recommendations.push('Over 50% manual steps — high automation opportunity')
  }
  if (bottlenecks.length > 0) {
    analysis.recommendations.push(`${bottlenecks.length} potential bottleneck(s) detected`)
  }

  emitAgentEvent(null, 'process.analyzed', { processId, automationPotential })
  return analysis
}

export function generatePipelineFromProcess(processId) {
  const proc = _processes.get(processId)
  if (!proc) return { error: 'Process not found' }

  // Convert process steps to pipeline steps
  const pipelineSteps = proc.steps
    .filter(s => s.type !== 'manual') // only automatable steps
    .map(s => ({
      operation: s.agent ? 'delegate' : 'execute',
      params: {
        name: s.name,
        agent: s.agent,
        inputs: s.inputs,
        outputs: s.outputs
      }
    }))

  if (pipelineSteps.length === 0) {
    return { error: 'No automatable steps in process' }
  }

  // Create pipeline using existing infrastructure
  const pipeline = createPipeline(pipelineSteps)
  emitAgentEvent(null, 'process.pipeline_generated', { processId, pipelineId: pipeline.id, steps: pipelineSteps.length })
  return { processId, pipeline, stepsConverted: pipelineSteps.length, totalSteps: proc.steps.length }
}

// ── Gap 5: Workforce Integration — agent as employee ──────────────────────────

export function getWorkforceDashboard() {
  const agents = []
  for (const [sid, ctx] of agentSessions) {
    const score = getAgentScore(sid)
    agents.push({
      agentId: ctx.agentId,
      name: ctx.name,
      state: ctx.state,
      role: ctx.role?.name || 'unassigned',
      autonomyLevel: ctx.autonomyLevel,
      uptime: Date.now() - ctx.createdAt.getTime(),
      totalCalls: ctx.metrics.totalCalls,
      successRate: ctx.metrics.totalCalls > 0
        ? +(ctx.metrics.successCount / ctx.metrics.totalCalls).toFixed(3)
        : 1,
      avgLatencyMs: ctx.metrics.totalCalls > 0
        ? +(ctx.metrics.totalLatencyMs / ctx.metrics.totalCalls).toFixed(1)
        : 0,
      score,
      lastActivity: ctx.lastActivity.toISOString()
    })
  }

  agents.sort((a, b) => b.score - a.score)

  const active = agents.filter(a => a.state === 'active').length
  const total = agents.length
  const avgScore = total > 0 ? +(agents.reduce((s, a) => s + a.score, 0) / total).toFixed(1) : 0
  const avgUtilization = total > 0
    ? +(agents.reduce((s, a) => s + (a.totalCalls > 0 ? 1 : 0), 0) / total * 100).toFixed(0)
    : 0

  return {
    summary: { total, active, paused: agents.filter(a => a.state === 'paused').length,
      training: agents.filter(a => a.state === 'training').length,
      retired: agents.filter(a => a.state === 'retired').length,
      avgScore, avgUtilization: `${avgUtilization}%` },
    agents,
    kpi: {
      activeRatio: total > 0 ? `${(active / total * 100).toFixed(0)}%` : 'N/A',
      topPerformer: agents[0]?.agentId || 'none',
      bottomPerformer: agents[agents.length - 1]?.agentId || 'none'
    }
  }
}

export function runOnboardingChecklist(sessionId) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const checks = [
    { item: 'Agent ID assigned', passed: !!ctx.agentId },
    { item: 'Name set', passed: !!ctx.name },
    { item: 'Capabilities defined', passed: ctx.capabilities.length > 0 },
    { item: 'Role assigned', passed: !!ctx.role },
    { item: 'Scope configured', passed: Object.keys(ctx.scope).length > 0 },
    { item: 'Autonomy level set', passed: !!ctx.autonomyLevel },
    { item: 'Identity fingerprint', passed: !!ctx.identity?.fingerprint },
    { item: 'State is active', passed: ctx.state === 'active' },
    { item: 'Database connected', passed: !!ctx.client }
  ]

  const passed = checks.filter(c => c.passed).length
  const total = checks.length
  const ready = passed === total

  if (ready) {
    emitAgentEvent(sessionId, 'workforce.onboarded', { agentId: ctx.agentId })
  }

  return {
    agentId: ctx.agentId,
    checks,
    passed, total,
    ready,
    recommendation: ready
      ? 'Agent fully onboarded and ready for deployment'
      : `${total - passed} items need attention before deployment`
  }
}

export function planRetirement(sessionId, { reason = '', migrateTo = null } = {}) {
  const ctx = agentSessions.get(sessionId)
  if (!ctx) return { error: 'Сессия не найдена' }

  const plan = {
    agentId: ctx.agentId,
    currentState: ctx.state,
    totalCalls: ctx.metrics.totalCalls,
    activeSubscriptions: changeSubscriptions.get(sessionId)?.length || 0,
    pendingJobs: 0, // could check job queue
    steps: [
      { step: 1, action: 'Transition to deprecated', status: ctx.state === 'deprecated' ? 'done' : 'pending' },
      { step: 2, action: 'Drain pending operations', status: 'pending' },
      { step: 3, action: 'Migrate knowledge to successor', status: migrateTo ? 'planned' : 'skipped' },
      { step: 4, action: 'Archive proof log', status: 'pending' },
      { step: 5, action: 'Unregister agent', status: 'pending' }
    ],
    migrateTo,
    reason,
    estimatedAt: new Date(Date.now() + 86400000).toISOString() // +24h
  }

  emitAgentEvent(sessionId, 'workforce.retired', { agentId: ctx.agentId, reason })
  return plan
}

// ── Gap 6: Cross-org A2A — federation protocol ───────────────────────────────

const _federationRegistry = new Map() // agentId → { capabilities, endpoint, metadata }

export function advertiseFederation(agentId, { capabilities = [], endpoint = '', metadata = {} } = {}) {
  _federationRegistry.set(agentId, {
    capabilities,
    endpoint,
    metadata,
    advertisedAt: new Date().toISOString()
  })

  emitAgentEvent(null, 'federation.advertised', { agentId, capabilities })
  return {
    advertised: true,
    agentId,
    capabilities,
    totalRegistered: _federationRegistry.size
  }
}

export function discoverFederated(capability) {
  const matches = []
  for (const [agentId, entry] of _federationRegistry) {
    if (!capability || entry.capabilities.some(c =>
      c.toLowerCase().includes(capability.toLowerCase())
    )) {
      matches.push({
        agentId,
        capabilities: entry.capabilities,
        endpoint: entry.endpoint,
        metadata: entry.metadata,
        advertisedAt: entry.advertisedAt
      })
    }
  }
  return { query: capability || '*', matches, total: matches.length }
}

export async function delegateFederated(fromAgentId, toAgentId, { task, params = {} } = {}) {
  const target = _federationRegistry.get(toAgentId)
  if (!target) return { error: `Agent ${toAgentId} not found in federation registry` }

  const delegationId = `deleg_${crypto.randomUUID().slice(0, 8)}`

  // Issue receipt on sender side
  await issueReceipt(fromAgentId, 'federation.delegate', 'federation', toAgentId, { task, params })

  // If endpoint is local (same system), try direct execution
  let result = null
  if (!target.endpoint || target.endpoint === 'local') {
    // Find agent session
    for (const [sid, ctx] of agentSessions) {
      if (ctx.agentId === toAgentId) {
        try {
          result = await execute(sid, 'schema', {}) // basic capability check
          result = { status: 'delegated_local', agentId: toAgentId, task }
        } catch (e) {
          result = { status: 'error', error: e.message }
        }
        break
      }
    }
    if (!result) result = { status: 'agent_offline', agentId: toAgentId }
  } else {
    // External endpoint — return delegation ticket
    result = { status: 'delegated_remote', endpoint: target.endpoint, delegationId, task }
  }

  emitAgentEvent(null, 'federation.delegated', { fromAgentId, toAgentId, delegationId, task })
  return { delegationId, from: fromAgentId, to: toAgentId, result }
}

// ══════════════════════════════════════════════════════════════════════════════
// ██╗     ██╗███╗   ██╗██╗  ██╗███████╗    ██████╗ ██╗      █████╗ ████████╗
// ██║     ██║████╗  ██║██║ ██╔╝██╔════╝    ██╔══██╗██║     ██╔══██╗╚══██╔══╝
// ██║     ██║██╔██╗ ██║█████╔╝ ███████╗    ██████╔╝██║     ███████║   ██║
// ██║     ██║██║╚██╗██║██╔═██╗ ╚════██║    ██╔═══╝ ██║     ██╔══██║   ██║
// ███████╗██║██║ ╚═████║██║  ██╗███████║    ██║     ███████╗██║  ██║   ██║
// ╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝    ╚═╝     ╚══════╝╚═╝  ╚═╝   ╚═╝
//
// Ассоциативная модель данных (по мотивам github.com/konard/LinksPlatform)
// Всё — связь. Дуплет: [source, target]. Триплет: [source, linker, target].
// ══════════════════════════════════════════════════════════════════════════════

const TABLE_LINKS = 'СОД Links'
let _linksReqMap = null // alias → reqId

async function _getLinksTable(db = 'kval') {
  return _findTable(TABLE_LINKS)
}

async function _getLinksReqMap(db = 'kval') {
  if (_linksReqMap) return _linksReqMap
  const tableId = await _getLinksTable(db)
  if (!tableId) return {}
  const client = new IntegramV2Client(db)
  const aliases = await client.getReqAliases(tableId)
  // aliases = { reqId: alias } → invert to { alias: reqId }
  _linksReqMap = {}
  for (const [reqId, alias] of Object.entries(aliases)) {
    _linksReqMap[alias] = reqId
  }
  logger.info({ map: _linksReqMap }, '[Links] Req alias map loaded')
  return _linksReqMap
}

/**
 * ANY — константа-wildcard для pattern matching (как в LinksPlatform)
 * При запросе link_query({ source: 'any' }) — означает "любой source"
 */
const LINKS_ANY = 'any'

/**
 * Создать связь (триплет или дуплет)
 *
 * Триплет: { source, linker, target }
 * Дуплет:  { source, target }  (linker = 'is')
 * Точка:   { source: X, target: X } или { point: true }
 */
async function linkCreate({ source, linker, target, sourceType, targetType, metadata, weight, db = 'kval' }) {
  const tableId = await _getLinksTable(db)
  if (!tableId) throw new Error('Таблица СОД Links не найдена. Создайте через integram_v2_create_table.')

  const client = new IntegramV2Client(db)

  // Point — self-referential link
  const isPoint = (source === target && (!linker || linker === 'is'))

  const linkId = `link_${crypto.randomUUID().slice(0, 12)}`
  const linkerVal = linker || 'is'
  const aliasValues = {
    source: String(source),
    linker: linkerVal,
    target: String(target),
    sourceType: sourceType || _inferType(source),
    targetType: targetType || _inferType(target),
    isPoint: isPoint ? '1' : '0',
    metadata: metadata ? JSON.stringify(metadata) : '',
    weight: String(weight || 0)
  }

  // Convert alias names → reqId keys for Integram API
  const reqMap = await _getLinksReqMap(db)
  const requisites = {}
  for (const [alias, val] of Object.entries(aliasValues)) {
    const reqId = reqMap[alias]
    if (reqId) requisites[reqId] = val
  }

  await client.createObject(tableId, linkId, requisites)
  emitAgentEvent(null, 'links.created', { linkId, source, linker: linkerVal, target })

  return { id: linkId, ...aliasValues, metadata: metadata || null }
}

/**
 * Batch-создание связей
 */
async function linkBatch({ links, db = 'kval' }) {
  if (!Array.isArray(links) || links.length === 0) throw new Error('links: массив связей обязателен')
  const results = []
  for (const l of links) {
    try {
      const r = await linkCreate({ ...l, db })
      results.push({ ok: true, ...r })
    } catch (e) {
      results.push({ ok: false, error: e.message, source: l.source, target: l.target })
    }
  }
  return { created: results.filter(r => r.ok).length, errors: results.filter(r => !r.ok).length, results }
}

/**
 * Запрос связей с паттерн-матчингом (any = wildcard)
 *
 * Примеры:
 *   linkQuery({ source: '5' })                    → все связи ОТ объекта 5
 *   linkQuery({ target: '5' })                    → все связи К объекту 5
 *   linkQuery({ linker: 'похож_на' })             → все связи типа "похож_на"
 *   linkQuery({ source: '5', linker: 'имя' })     → имя объекта 5
 *   linkQuery({})                                  → все связи (limit!)
 */
async function linkQuery({ source, linker, target, sourceType, targetType, isPoint, limit = 100, offset = 0, db = 'kval' }) {
  const tableId = await _getLinksTable(db)
  if (!tableId) return { links: [], total: 0 }

  const client = new IntegramV2Client(db)
  const allObjects = await client.getObjects(tableId)

  // Pattern matching — filter
  let filtered = allObjects
  if (source && source !== LINKS_ANY) filtered = filtered.filter(o => _reqVal(o, 'source') === String(source))
  if (linker && linker !== LINKS_ANY) filtered = filtered.filter(o => _reqVal(o, 'linker') === String(linker))
  if (target && target !== LINKS_ANY) filtered = filtered.filter(o => _reqVal(o, 'target') === String(target))
  if (sourceType && sourceType !== LINKS_ANY) filtered = filtered.filter(o => _reqVal(o, 'sourceType') === sourceType)
  if (targetType && targetType !== LINKS_ANY) filtered = filtered.filter(o => _reqVal(o, 'targetType') === targetType)
  if (isPoint !== undefined) filtered = filtered.filter(o => _reqVal(o, 'isPoint') === (isPoint ? '1' : '0'))

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)

  return {
    links: page.map(_objectToLink),
    total,
    offset,
    limit,
    hasMore: offset + limit < total
  }
}

/**
 * Удалить связь по id или паттерну
 */
async function linkDelete({ linkId, source, linker, target, db = 'kval' }) {
  const tableId = await _getLinksTable(db)
  if (!tableId) throw new Error('Таблица СОД Links не найдена')

  const client = new IntegramV2Client(db)

  if (linkId) {
    // Delete by exact id
    const allObjects = await client.getObjects(tableId)
    const obj = allObjects.find(o => (o.val || o.reqs?.val?.value) === linkId)
    if (!obj) return { deleted: 0, message: `Link ${linkId} не найден` }
    await client.deleteObject(obj.id)
    emitAgentEvent(null, 'links.deleted', { linkId })
    return { deleted: 1, linkId }
  }

  // Delete by pattern
  const matched = await linkQuery({ source, linker, target, limit: 10000, db })
  let deleted = 0
  for (const link of matched.links) {
    try {
      const allObjects = await client.getObjects(tableId)
      const obj = allObjects.find(o => (o.val || o.reqs?.val?.value) === link.id)
      if (obj) {
        await client.deleteObject(obj.id)
        deleted++
      }
    } catch (e) { /* skip */ }
  }
  emitAgentEvent(null, 'links.deleted_batch', { pattern: { source, linker, target }, deleted })
  return { deleted, pattern: { source, linker, target } }
}

/**
 * Создать точку — связь, ссылающуюся на себя (атом в LinksPlatform)
 */
async function linkPoint({ name, type = 'atom', metadata, db = 'kval' }) {
  const pointId = name || `point_${crypto.randomUUID().slice(0, 8)}`
  return linkCreate({
    source: pointId,
    linker: 'is',
    target: pointId,
    sourceType: type,
    targetType: type,
    metadata: { ...(metadata || {}), _point: true, name: pointId },
    db
  })
}

/**
 * Обход графа связей (BFS) от начальной точки
 *
 * direction: 'outgoing' (source→target), 'incoming' (target→source), 'both'
 */
async function linkTraverse({ startNode, depth = 3, direction = 'both', linkerFilter, limit = 200, db = 'kval' }) {
  const tableId = await _getLinksTable(db)
  if (!tableId) return { nodes: [], edges: [], depth: 0 }

  const client = new IntegramV2Client(db)
  const allObjects = await client.getObjects(tableId)
  const allLinks = allObjects.map(_objectToLink)

  const visited = new Set()
  const nodes = []
  const edges = []
  let queue = [{ nodeId: String(startNode), level: 0 }]

  while (queue.length > 0) {
    const next = []
    for (const { nodeId, level } of queue) {
      if (visited.has(nodeId) || level > depth) continue
      visited.add(nodeId)
      nodes.push({ id: nodeId, level })

      if (nodes.length >= limit) break

      // Find connected links
      const outgoing = (direction === 'outgoing' || direction === 'both')
        ? allLinks.filter(l => l.source === nodeId && (!linkerFilter || l.linker === linkerFilter))
        : []
      const incoming = (direction === 'incoming' || direction === 'both')
        ? allLinks.filter(l => l.target === nodeId && (!linkerFilter || l.linker === linkerFilter))
        : []

      for (const l of outgoing) {
        edges.push({ id: l.id, source: l.source, linker: l.linker, target: l.target })
        if (!visited.has(l.target)) next.push({ nodeId: l.target, level: level + 1 })
      }
      for (const l of incoming) {
        edges.push({ id: l.id, source: l.source, linker: l.linker, target: l.target })
        if (!visited.has(l.source)) next.push({ nodeId: l.source, level: level + 1 })
      }
    }
    if (nodes.length >= limit) break
    queue = next
  }

  return { nodes, edges, totalNodes: nodes.length, totalEdges: edges.length, maxDepth: depth }
}

/**
 * Сохранить последовательность как цепочку связей (строка, массив, число)
 *
 * "Привет" → [П]→next→[р]→next→[и]→next→[в]→next→[е]→next→[т]
 * [1,2,3]  → [1]→next→[2]→next→[3]
 */
async function linkSequence({ sequenceId, values, linker = 'next', action = 'create', db = 'kval' }) {
  if (action === 'create') {
    if (!values || !Array.isArray(values)) {
      // String → array of chars
      if (typeof values === 'string') values = values.split('')
      else throw new Error('values: массив или строка обязательны')
    }

    const seqId = sequenceId || `seq_${crypto.randomUUID().slice(0, 8)}`
    const links = []

    // Create head marker
    await linkCreate({ source: seqId, linker: 'head', target: String(values[0]), sourceType: 'sequence', db })

    // Chain elements
    for (let i = 0; i < values.length - 1; i++) {
      const l = await linkCreate({
        source: String(values[i]),
        linker,
        target: String(values[i + 1]),
        sourceType: 'element',
        targetType: 'element',
        metadata: { sequence: seqId, index: i },
        weight: i,
        db
      })
      links.push(l)
    }

    // Tail marker
    await linkCreate({ source: seqId, linker: 'tail', target: String(values[values.length - 1]), sourceType: 'sequence', db })

    emitAgentEvent(null, 'links.sequence_created', { seqId, length: values.length })
    return { id: seqId, length: values.length, linker, links: links.length }
  }

  if (action === 'read') {
    // Reconstruct sequence from head→next→next→...→tail
    if (!sequenceId) throw new Error('sequenceId обязателен для чтения')

    const headResult = await linkQuery({ source: sequenceId, linker: 'head', db })
    if (!headResult.links.length) return { id: sequenceId, values: [], error: 'Head not found' }

    const values = []
    let current = headResult.links[0].target
    values.push(current)

    const tailResult = await linkQuery({ source: sequenceId, linker: 'tail', db })
    const tailValue = tailResult.links.length ? tailResult.links[0].target : null

    for (let i = 0; i < 10000; i++) { // safety limit
      const nextLink = await linkQuery({ source: current, linker, db, limit: 1 })
      if (!nextLink.links.length) break

      // Find the one belonging to this sequence
      const candidates = (await linkQuery({ source: current, linker, db })).links
      const seqLink = candidates.find(l => {
        try { const m = JSON.parse(l.metadata || '{}'); return m.sequence === sequenceId } catch { return false }
      }) || candidates[0]

      if (!seqLink) break
      current = seqLink.target
      values.push(current)
      if (current === tailValue) break
    }

    return { id: sequenceId, values, length: values.length }
  }

  throw new Error(`action: ${action} не поддерживается (create/read)`)
}

/**
 * Найти все пути между двумя узлами (DFS с ограничением глубины)
 */
async function linkPaths({ from, to, maxDepth = 5, linkerFilter, limit = 10, db = 'kval' }) {
  const tableId = await _getLinksTable(db)
  if (!tableId) return { paths: [], total: 0 }

  const client = new IntegramV2Client(db)
  const allObjects = await client.getObjects(tableId)
  const allLinks = allObjects.map(_objectToLink)

  const paths = []
  const stack = [{ node: String(from), path: [String(from)], edges: [] }]

  while (stack.length > 0 && paths.length < limit) {
    const { node, path, edges } = stack.pop()
    if (path.length > maxDepth + 1) continue

    if (node === String(to) && path.length > 1) {
      paths.push({ nodes: [...path], edges: [...edges], length: path.length - 1 })
      continue
    }

    const outgoing = allLinks.filter(l =>
      l.source === node &&
      !path.includes(l.target) &&
      (!linkerFilter || l.linker === linkerFilter)
    )

    for (const l of outgoing) {
      stack.push({
        node: l.target,
        path: [...path, l.target],
        edges: [...edges, { source: l.source, linker: l.linker, target: l.target }]
      })
    }
  }

  return { paths, total: paths.length, from, to, maxDepth }
}

/**
 * Извлечь подграф вокруг узла (ego-network)
 */
async function linkSubgraph({ nodeId, radius = 2, linkerFilter, db = 'kval' }) {
  return linkTraverse({ startNode: nodeId, depth: radius, direction: 'both', linkerFilter, limit: 500, db })
}

/**
 * Список всех типов связей (linker-ов) — онтология предикатов
 */
async function linkTypes({ db = 'kval' }) {
  const tableId = await _getLinksTable(db)
  if (!tableId) return { types: [], total: 0 }

  const client = new IntegramV2Client(db)
  const allObjects = await client.getObjects(tableId)

  const linkerCounts = {}
  for (const obj of allObjects) {
    const linker = _reqVal(obj, 'linker') || 'is'
    linkerCounts[linker] = (linkerCounts[linker] || 0) + 1
  }

  const types = Object.entries(linkerCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return { types, total: types.length }
}

/**
 * Статистика графа связей
 */
async function linkStats({ db = 'kval' }) {
  const tableId = await _getLinksTable(db)
  if (!tableId) return { totalLinks: 0, totalPoints: 0, status: 'table_not_found' }

  const client = new IntegramV2Client(db)
  const allObjects = await client.getObjects(tableId)
  const allLinks = allObjects.map(_objectToLink)

  const uniqueNodes = new Set()
  const linkerCounts = {}
  let points = 0

  for (const l of allLinks) {
    uniqueNodes.add(l.source)
    uniqueNodes.add(l.target)
    linkerCounts[l.linker] = (linkerCounts[l.linker] || 0) + 1
    if (l.isPoint === '1' || l.source === l.target) points++
  }

  // Degree distribution
  const outDegree = {}, inDegree = {}
  for (const l of allLinks) {
    outDegree[l.source] = (outDegree[l.source] || 0) + 1
    inDegree[l.target] = (inDegree[l.target] || 0) + 1
  }

  const degrees = [...uniqueNodes].map(n => (outDegree[n] || 0) + (inDegree[n] || 0))
  const avgDegree = degrees.length ? (degrees.reduce((a, b) => a + b, 0) / degrees.length).toFixed(2) : 0

  // Top hubs
  const hubs = [...uniqueNodes]
    .map(n => ({ node: n, degree: (outDegree[n] || 0) + (inDegree[n] || 0) }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10)

  return {
    totalLinks: allLinks.length,
    totalNodes: uniqueNodes.size,
    totalPoints: points,
    avgDegree: parseFloat(avgDegree),
    linkerTypes: linkerCounts,
    topHubs: hubs,
    density: uniqueNodes.size > 1
      ? (allLinks.length / (uniqueNodes.size * (uniqueNodes.size - 1))).toFixed(6)
      : 0
  }
}

/**
 * Объединить два узла — перенаправить все связи с sourceNode на targetNode
 */
async function linkMerge({ fromNode, toNode, db = 'kval' }) {
  const tableId = await _getLinksTable(db)
  if (!tableId) throw new Error('Таблица СОД Links не найдена')

  const client = new IntegramV2Client(db)
  const allObjects = await client.getObjects(tableId)

  let rewritten = 0
  for (const obj of allObjects) {
    const link = _objectToLink(obj)
    const needsSource = link.source === String(fromNode)
    const needsTarget = link.target === String(fromNode)

    if (needsSource || needsTarget) {
      // Delete old link, create new with redirected refs
      try {
        await client.deleteObject(obj.id)
        await linkCreate({
          source: needsSource ? String(toNode) : link.source,
          linker: link.linker,
          target: needsTarget ? String(toNode) : link.target,
          sourceType: link.sourceType,
          targetType: link.targetType,
          metadata: link.metadata ? JSON.parse(link.metadata) : undefined,
          weight: link.weight,
          db
        })
        rewritten++
      } catch (e) {
        logger.debug({ err: e.message }, '[Links] Merge rewrite failed')
      }
    }
  }

  emitAgentEvent(null, 'links.merged', { fromNode, toNode, rewritten })
  return { merged: true, fromNode, toNode, rewrittenLinks: rewritten }
}

// ── Level 3: Meta-Links Engine ──────────────────────────────────────────────
// Представить таблицы, колонки и записи Integram как связи

/**
 * Импорт структуры Integram в граф связей
 * Таблица → [является] → "Тип"
 * Колонка → [принадлежит] → Таблица
 * Запись  → [экземпляр]  → Таблица
 * Значение → [колонка] → Запись
 */
async function linkImportSchema({ typeId, includeData = false, db = 'kval' }) {
  const client = new IntegramV2Client(db)
  const schema = await client.getFullSchema()
  const created = { tables: 0, columns: 0, records: 0, values: 0 }

  const targets = typeId ? schema.filter(t => t.id === typeId) : schema

  for (const table of targets) {
    const tableName = table.val || table.name || `type_${table.id}`

    // Table → is → Type
    await linkCreate({ source: `table:${table.id}`, linker: 'is', target: 'Type', sourceType: 'table', metadata: { name: tableName, id: table.id }, db })
    created.tables++

    // Columns
    if (table.reqs) {
      for (const [reqName, reqInfo] of Object.entries(table.reqs)) {
        await linkCreate({ source: `col:${table.id}:${reqName}`, linker: 'принадлежит', target: `table:${table.id}`, sourceType: 'column', metadata: { name: reqName, type: reqInfo.type || reqInfo.baseType }, db })
        created.columns++
      }
    }

    // Data records (if requested)
    if (includeData) {
      try {
        const objects = await client.getAllObjects(table.id)
        for (const obj of objects.slice(0, 500)) { // limit per table
          const objId = `obj:${table.id}:${obj.id}`
          await linkCreate({ source: objId, linker: 'экземпляр', target: `table:${table.id}`, sourceType: 'object', db })
          created.records++

          // Values
          if (obj.reqs) {
            for (const [key, val] of Object.entries(obj.reqs)) {
              const value = val?.display || val?.value || val
              if (value) {
                await linkCreate({ source: objId, linker: key, target: String(value), sourceType: 'object', targetType: 'value', db })
                created.values++
              }
            }
          }
        }
      } catch (e) {
        logger.debug({ err: e.message, typeId: table.id }, '[Links] Data import skipped')
      }
    }
  }

  emitAgentEvent(null, 'links.schema_imported', { tables: created.tables, columns: created.columns })
  return { imported: created, totalLinks: created.tables + created.columns + created.records + created.values }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _reqVal(obj, fieldName) {
  if (!obj.reqs) return obj[fieldName] || ''
  // Try direct key first
  if (obj.reqs[fieldName]) {
    const r = obj.reqs[fieldName]
    return r.displayValue || r.value || r.display || (typeof r === 'string' ? r : '') || ''
  }
  // Search by alias (reqs keyed by reqId, alias in value)
  for (const [, req] of Object.entries(obj.reqs)) {
    if (req.alias === fieldName) {
      return req.displayValue || req.value || ''
    }
  }
  return ''
}

function _objectToLink(obj) {
  return {
    id: obj.val || obj.reqs?.val?.value || obj.reqs?.val?.display || `link_${obj.id}`,
    source: _reqVal(obj, 'source'),
    linker: _reqVal(obj, 'linker') || 'is',
    target: _reqVal(obj, 'target'),
    sourceType: _reqVal(obj, 'sourceType'),
    targetType: _reqVal(obj, 'targetType'),
    isPoint: _reqVal(obj, 'isPoint'),
    metadata: _reqVal(obj, 'metadata'),
    weight: parseInt(_reqVal(obj, 'weight')) || 0
  }
}

function _inferType(val) {
  if (val === null || val === undefined) return 'null'
  if (String(val).startsWith('table:')) return 'table'
  if (String(val).startsWith('col:')) return 'column'
  if (String(val).startsWith('obj:')) return 'object'
  if (String(val).startsWith('link_')) return 'link'
  if (String(val).startsWith('point_')) return 'point'
  if (String(val).startsWith('seq_')) return 'sequence'
  if (!isNaN(val)) return 'number'
  return 'value'
}

// ══════════════════════════════════════════════════════════════════════════════

export default {
  registerAgent, registerAgentWithRole, unregisterAgent, getAgentContext, listAgents,
  getAgentRoles, canExecuteOperation, initAgentRolesInSOD, initAgentLifecycleInSOD,
  startSessionCleanup, stopSessionCleanup,
  setMemory, getMemory, getHistory,
  semanticQuery, generateToolCatalog, getSchemaForPrompt,
  sendMessage, receiveMessages,
  execute,
  getAgentMetrics, getAgentIdentity, refreshToken, verifyToken,
  transitionAgentState, getAgentLifecycle,
  setSocketIO, setEventEngine, emitEvent, subscribeEvents, queryEvents,
  createPipeline, executePipeline, getPipelineStatus,
  calculateProcessROI,
  // Deloitte Agentic AI Compliance
  discoverAgents, delegateTask,
  getDataMap,
  listApprovals, approveOperation, rejectOperation,
  getProofLog, verifyProof,
  getAutonomyLevels, setAutonomyLevel,
  // Production modules (10 gaps)
  restoreSessions, persistSession, startPersistence, stopPersistence,
  getApprovalStats,
  checkRateLimit,
  acquireLock, releaseLock, getLocks,
  executePipelineWithRecovery,
  publishSkill, browseMarketplace, requestSkill, rateSkill,
  submitFeedback, getAgentScorecard, getAgentScore,
  subscribeToChanges, notifyChange, getNotifications, getChangeLog,
  submitJob, getJobStatus, listJobs,
  cachedQuery, cacheSet, cacheInvalidate, getCacheStats,
  // Deloitte 6 Gaps — persistent MCP tools
  // Gap 1: FinOps
  recordTokenUsage, setFinOpsBudget, getFinOpsBudget, getFinOpsReport,
  // Gap 2: Digital Receipts
  issueReceipt, verifyReceipt, verifyChain, queryReceipts,
  // Gap 3: Learning Loop
  recordLearningFeedback, getLearningPerformance, detectDrift, generateRecommendations,
  // Gap 4: Process-First Design
  defineProcess, analyzeProcess, generatePipelineFromProcess,
  // Gap 5: Workforce Integration
  getWorkforceDashboard, runOnboardingChecklist, planRetirement,
  // Gap 6: Cross-org Federation
  advertiseFederation, discoverFederated, delegateFederated,
  // Links Platform — ассоциативная модель данных
  linkCreate, linkBatch, linkQuery, linkDelete, linkPoint,
  linkTraverse, linkSequence, linkPaths, linkSubgraph,
  linkTypes, linkStats, linkMerge, linkImportSchema
}
