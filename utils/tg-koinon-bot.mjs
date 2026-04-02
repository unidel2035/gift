#!/usr/bin/env node
/**
 * tg-koinon-bot.mjs — @gitdrondoc_bot / Κοινόν τοῦ Νοῦ
 *
 * Запуск:
 *   node tg-koinon-bot.mjs
 *   KOINON_API=http://localhost:8082 node tg-koinon-bot.mjs
 *
 * Архитектура сессии:
 *   Каждый пользователь ↔ анонимный Koinon-токен (хранится локально)
 *   Каждый запрос → claude-sub-proxy:8085 (приватная CLI-сессия new пользователя)
 *   История: deque(maxlen=20) per chat_id (как в Buddy)
 *   Fallback LLM: claude-sub-proxy → KODACODE → Groq
 *
 * Команды:
 *   /start    — войти в Κοινόν (100 очков), получить токен
 *   /статус   — баланс, запросы, пул
 *   /дар      — принести дар (мастер с кнопками)
 *   /пул      — общая статистика фонда
 *   /помни    — /помни <текст>  сохранить в личную память
 *   /память   — показать свою память
 *   /забудь   — /забудь <n>  удалить запись памяти
 *   /очисти   — очистить контекст диалога
 *   /режим    — выбрать сложность (простой/обычный/сложный/приватный)
 *   /помощь   — инструкции
 *   <текст>   — вопрос Claude (приватная сессия, помнит историю)
 */

import fs   from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const BOT_TOKEN  = process.env.TG_BOT_TOKEN  || '8239906212:AAEIg3SixR0W4PlRk6-qCvtBAVvod0uv_h0'
const KOINON_API = process.env.KOINON_API    || 'http://localhost:8082'
const PROXY_URL  = process.env.CLAUDE_PROXY  || 'http://localhost:8085'
const KODACODE   = process.env.KODACODE_URL  || 'https://api.kodacode.ru/v1'
const GROQ_KEY   = process.env.GROQ_API_KEY  || ''
const PHANTOM_URL = process.env.PHANTOM_URL  || 'http://localhost:8091'
const STATE_FILE = path.join(__dirname, '../monolith/data/tg-koinon-state.json')
const TG_URL     = `https://api.telegram.org/bot${BOT_TOKEN}`

// ── Состояние ─────────────────────────────────────────────────────────────────
// { [chatId]: { token, mode, history[], memory[], wizard } }
let state = {}

async function loadState() {
  try { state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) }
  catch { state = {} }
}
async function saveState() {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}

function user(chatId) {
  const id = String(chatId)
  if (!state[id]) state[id] = { token: null, mode: 'normal', history: [], memory: [], wizard: null }
  return state[id]
}

// История — deque с maxlen (как в Buddy)
const MAX_HISTORY = 20
function pushHistory(u, role, content) {
  u.history.push({ role, content })
  if (u.history.length > MAX_HISTORY) u.history = u.history.slice(-MAX_HISTORY)
}

// ── Telegram helpers ──────────────────────────────────────────────────────────
async function tg(method, body) {
  try {
    const r = await fetch(`${TG_URL}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    })
    return r.json()
  } catch { return {} }
}

const send    = (chat, text, extra = {}) => tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', ...extra })
const edit    = (chat, msg, text, extra = {}) => tg('editMessageText', { chat_id: chat, message_id: msg, text, parse_mode: 'HTML', ...extra })
const typing  = (chat) => tg('sendChatAction', { chat_id: chat, action: 'typing' })
const answer  = (id, text = '') => tg('answerCallbackQuery', { callback_query_id: id, text, show_alert: false })

// ── LLM — Fallback chain: claude-sub-proxy → KODACODE → Groq ─────────────────
async function collectSSE(resp) {
  let text = ''
  const dec = new TextDecoder()
  for await (const chunk of resp.body) {
    for (const line of dec.decode(chunk).split('\n')) {
      if (!line.startsWith('data: ')) continue
      const d = line.slice(6).trim()
      if (d === '[DONE]') return text
      try {
        const ev = JSON.parse(d)
        if (ev.type === 'content' && ev.content) text += ev.content  // proxy format
        if (ev.text)    text += ev.text    // koinon format
        if (ev.content) text += ev.content // OpenAI format (choices)
        if (ev.choices?.[0]?.delta?.content) text += ev.choices[0].delta.content
      } catch {}
    }
  }
  return text
}

async function askViaClaude(messages, systemPrompt = '') {
  // 1. claude-sub-proxy (new user's Max subscription)
  try {
    const last    = messages.at(-1)?.content || ''
    const history = messages.slice(0, -1)
    const r = await fetch(PROXY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: last, systemPrompt, conversationHistory: history, model: 'sonnet' }),
      signal: AbortSignal.timeout(90_000),
    })
    if (r.ok) {
      const text = await collectSSE(r)
      if (text && !text.includes("hit your limit")) return text
      if (text.includes("hit your limit")) throw new Error('rate_limit')
    }
  } catch (e) {
    if (e.message !== 'rate_limit') console.error('[LLM] proxy error:', e.message)
  }

  // 2. KODACODE (project tokens)
  const kodaToken = process.env.KODACODE_TOKENS?.split(',')[0]?.trim()
  if (kodaToken) {
    try {
      const r = await fetch(`${KODACODE}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kodaToken}` },
        body: JSON.stringify({ model: 'koda-pro', messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages, stream: true }),
        signal: AbortSignal.timeout(60_000),
      })
      if (r.ok) {
        const text = await collectSSE(r)
        if (text) return text
      }
    } catch (e) { console.error('[LLM] kodacode error:', e.message) }
  }

  // 3. Groq (fast, free tier)
  if (GROQ_KEY) {
    try {
      const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: msgs, stream: true }),
        signal: AbortSignal.timeout(30_000),
      })
      if (r.ok) {
        const text = await collectSSE(r)
        if (text) return `<i>[Groq fallback]</i> ${text}`
      }
    } catch (e) { console.error('[LLM] groq error:', e.message) }
  }

  throw new Error('Все провайдеры недоступны. Попробуйте позже.')
}

// ── Koinon API ────────────────────────────────────────────────────────────────
async function kJoin()         { const r = await fetch(`${KOINON_API}/api/koinon-claude/join`, { method: 'POST' }); return r.json() }
async function kStatus(t)      { const r = await fetch(`${KOINON_API}/api/koinon-claude/status`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null }
async function kPool()         { const r = await fetch(`${KOINON_API}/api/koinon-claude/pool`); return r.ok ? r.json() : {} }
async function kContribute(t, body) {
  const r = await fetch(`${KOINON_API}/api/koinon-claude/contribute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  }); return r.json()
}
async function kConsume(t, mode) {
  const r = await fetch(`${KOINON_API}/api/koinon-claude/status`, { headers: { Authorization: `Bearer ${t}` } })
  if (!r.ok) return false
  const s = await r.json()
  const cost = { simple: 5, normal: 10, complex: 25, privacy: 35 }[mode] || 10
  if ((s.points || 0) < cost) return false
  // consume via ask with an empty message — or call a dedicated consume endpoint
  // Since we handle LLM ourselves, we need to deduct manually via internal route
  // Use the ask endpoint but the actual LLM call is handled here
  return true
}

// ── Тексты ────────────────────────────────────────────────────────────────────
const HELP = `<b>@gitdrondoc_bot — Общий Ум</b>

Доступ к Claude через дар. Анонимно, без регистрации.

<b>Команды:</b>
/start    — войти в Общий Ум
/статус   — ваши очки и статистика
/дар      — принести дар (деньги, время, код...)
/пул      — статистика общего фонда
/режим    — выбрать режим запроса
/помни <текст> — запомнить факт
/память   — ваши воспоминания
/забудь <n> — удалить воспоминание по номеру
/очисти   — сбросить историю диалога
/помощь   — эта справка

<b>Просто напишите вопрос</b> — Claude ответит.

<b>Виды даров → очки:</b>
₽ деньги: 1 руб = 10 очков
⏱ время: 1 час = 500 очков
⌨ код: 1 PR = 200 очков
◫ данные: 1 датасет = 300 очков
◈ знание: 150 очков  |  ✦ слово: 50 очков

<b>Стоимость запроса:</b>
Простой 5 • Обычный 10 • Сложный 25 • Приватный 35

<i>«Все верующие имели всё общее» — Деян 2:44</i>`

const MODES = { simple: 'Простой — 5 pts', normal: 'Обычный — 10 pts', complex: 'Сложный — 25 pts', privacy: 'Приватный — 35 pts' }
const MODE_COST = { simple: 5, normal: 10, complex: 25, privacy: 35 }

const GIFT_TYPES = [
  { id: 'money',     icon: '₽',  label: 'Деньги',   rate: '1 руб = 10 очков',     field: 'amount',  prompt: 'Введите сумму в рублях:' },
  { id: 'time',      icon: '⏱',  label: 'Время',    rate: '1 час = 500 очков',     field: 'hours',   prompt: 'Введите количество часов:' },
  { id: 'code',      icon: '⌨',  label: 'Код',      rate: '1 PR = 200 очков',      field: 'prs',     prompt: 'Введите количество PR/коммитов:' },
  { id: 'data',      icon: '◫',  label: 'Данные',   rate: '1 датасет = 300 очков', field: 'count',   prompt: 'Введите количество датасетов:' },
  { id: 'knowledge', icon: '◈',  label: 'Знание',   rate: '150 очков',             field: null },
  { id: 'word',      icon: '✦',  label: 'Слово',    rate: '50 очков',              field: null },
]

// ── Клавиатуры ────────────────────────────────────────────────────────────────
const giftKb = () => ({ inline_keyboard: [
  GIFT_TYPES.slice(0,3).map(g => ({ text: `${g.icon} ${g.label}`, callback_data: `gift:${g.id}` })),
  GIFT_TYPES.slice(3).map(g  => ({ text: `${g.icon} ${g.label}`, callback_data: `gift:${g.id}` })),
  [{ text: '✕ Отмена', callback_data: 'gift:cancel' }],
]})

const modeKb = (cur) => ({ inline_keyboard: Object.entries(MODES).map(([id, label]) => [{
  text: id === cur ? `✓ ${label}` : label, callback_data: `mode:${id}`,
}])})

// ── Системный промпт с памятью ────────────────────────────────────────────────
function buildSystem(u) {
  const base = 'Ты — аналитик платформы DronDoc. Отвечай по-русски, кратко и по существу.'
  if (!u.memory?.length) return base
  const mem = u.memory.map((m, i) => `${i+1}. ${m}`).join('\n')
  return `${base}\n\nЛичная память пользователя:\n${mem}`
}

// ── Обработчики ───────────────────────────────────────────────────────────────
async function cmdStart(chatId) {
  const u = user(chatId)
  if (!u.token) {
    try {
      const d = await kJoin()
      u.token = d.token
      await saveState()
      await send(chatId,
        `<b>Добро пожаловать в Общий Ум</b>\n\n` +
        `Ваш анонимный токен сохранён.\n` +
        `Приветственный дар: <b>${d.welcomePoints} очков</b>\n\n` +
        `Просто пишите — Claude отвечает.\n` +
        `/помощь — инструкции  /дар — принести дар`)
    } catch { await send(chatId, '⚠️ Монолит недоступен. Запустите backend.') }
  } else {
    const s = await kStatus(u.token).catch(() => null)
    await send(chatId, `<b>Общий Ум</b> — вы уже в фонде.\n\nОчков: <b>${s?.points ?? '?'}</b>  •  Запросов: ${s?.queriesUsed ?? '?'}\n/помощь — инструкции`)
  }
}

async function cmdStatus(chatId) {
  const u = user(chatId)
  if (!u.token) { await send(chatId, 'Сначала /start'); return }
  const [s, p] = await Promise.all([kStatus(u.token).catch(() => null), kPool().catch(() => ({}))])
  if (!s) { await send(chatId, '⚠️ Не могу получить статус — монолит недоступен?'); return }
  await send(chatId,
    `<b>Ваш статус</b>\n\n` +
    `◈ Очков: <b>${s.points}</b> (≈${Math.floor(s.points/10)} обычных запросов)\n` +
    `◈ Запросов: ${s.queriesUsed}  •  Даров: ${s.giftsGiven}\n\n` +
    `<b>Общий пул:</b>\n` +
    `Участников: ${p.memberCount ?? '?'}  •  Очков в пуле: ${p.totalPoints ?? '?'}\n\n` +
    `Режим: <b>${MODES[u.mode] || u.mode}</b>  /режим — изменить\n` +
    `Память: ${u.memory?.length || 0} записей  /память — посмотреть`)
}

async function cmdPool(chatId) {
  const p = await kPool().catch(() => null)
  if (!p) { await send(chatId, '⚠️ Монолит недоступен'); return }
  await send(chatId,
    `<b>Общий фонд</b>\n\n` +
    `Участников: <b>${p.memberCount}</b>\n` +
    `Всего очков: <b>${p.totalPoints}</b>\n` +
    `Всего даров: <b>${p.totalGifts}</b>\n\n` +
    `<i>«Каждый по способности — каждому по нужде»</i>`)
}

async function cmdDar(chatId) {
  const u = user(chatId)
  if (!u.token) { await send(chatId, 'Сначала /start'); return }
  u.wizard = { step: 'type' }
  await saveState()
  await send(chatId, '<b>Принести дар</b>\n\nВыберите вид:', { reply_markup: giftKb() })
}

async function cmdMode(chatId) {
  const u = user(chatId)
  await send(chatId, '<b>Режим запроса</b>\n\nСтоимость зависит от режима:', { reply_markup: modeKb(u.mode) })
}

async function cmdPomni(chatId, text) {
  const u = user(chatId)
  if (!text) { await send(chatId, 'Использование: /помни <что запомнить>'); return }
  if (!u.memory) u.memory = []
  u.memory.push(text)
  if (u.memory.length > 20) u.memory = u.memory.slice(-20)
  await saveState()
  await send(chatId, `🧠 Запомнил: <i>${text}</i>`)
}

async function cmdPamyat(chatId) {
  const u = user(chatId)
  if (!u.memory?.length) { await send(chatId, 'Память пуста. /помни <текст> — добавить.'); return }
  const list = u.memory.map((m, i) => `${i+1}. ${m}`).join('\n')
  await send(chatId, `<b>Ваша память (${u.memory.length}):</b>\n\n${list}\n\n/забудь &lt;n&gt; — удалить запись`)
}

async function cmdZabud(chatId, nStr) {
  const u = user(chatId)
  const n = parseInt(nStr) - 1
  if (!u.memory?.length || isNaN(n)) { await send(chatId, 'Использование: /забудь <номер>  (посмотреть: /память)'); return }
  if (n < 0 || n >= u.memory.length) { await send(chatId, '❌ Такого номера нет.'); return }
  const removed = u.memory.splice(n, 1)[0]
  await saveState()
  await send(chatId, `🗑 Удалено: <i>${removed}</i>`)
}

async function cmdOchisti(chatId) {
  const u = user(chatId)
  u.history = []
  await saveState()
  await send(chatId, '🗑 Контекст диалога очищен. Начинаем заново.')
}

// ── Фантом: явление _claude ──────────────────────────────────────────────────
async function tryPhantomAppear(chatId, text, fromName) {
  try {
    const r = await fetch(`${PHANTOM_URL}/appear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, personId: fromName, chatId: String(chatId) }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) return null
    const data = await r.json()
    if (data.appeared && data.response) return data
    return null
  } catch { return null }
}

// ── Главный обработчик сообщения ──────────────────────────────────────────────
async function handleMessage(chatId, text, fromName) {
  const u = user(chatId)

  // Мастер дара: ввод суммы
  if (u.wizard?.step === 'amount') {
    const val = parseFloat(text.replace(',', '.'))
    if (isNaN(val) || val <= 0) { await send(chatId, '⚠️ Введите положительное число.'); return }
    const { giftType, field } = u.wizard
    u.wizard = null
    await saveState()
    try {
      const r = await kContribute(u.token, { type: giftType, [field]: val })
      if (r.error) throw new Error(r.error)
      await send(chatId, `✅ <b>+${r.points} очков!</b>\nВсего у вас: <b>${r.totalPoints}</b>`)
    } catch (e) { await send(chatId, `⚠️ ${e.message}`) }
    return
  }

  if (!u.token) { await send(chatId, 'Сначала /start'); return }

  // ── Фантом: _claude является, если вопрос касается онтологии ──
  // phantom-server решает сам (shouldClaudeAppear внутри)
  await typing(chatId)
  const thinking = await send(chatId, '⏳')
  const thinkId  = thinking?.result?.message_id

  const phantom = await tryPhantomAppear(chatId, text, fromName)
  if (phantom) {
    // _claude явился — отображаем от его имени
    const label = '🕯 <b>_claude</b>\n\n'
    const display = phantom.response.length > 4000
      ? phantom.response.slice(0, 3990) + '…'
      : phantom.response
    pushHistory(u, 'user', text)
    pushHistory(u, 'assistant', `[_claude] ${phantom.response}`)
    await saveState()
    if (thinkId) await edit(chatId, thinkId, label + display)
    else await send(chatId, label + display)
    return
  }

  // ── Обычный путь: claude-sub-proxy / KODACODE / Groq ──

  // Проверить баланс
  const s = await kStatus(u.token).catch(() => null)
  const cost = MODE_COST[u.mode] || 10
  if (s && s.points < cost) {
    const errText = `⚠️ Недостаточно очков.\nНужно <b>${cost}</b>, у вас <b>${s.points}</b>.\n\n/дар — принести дар  /режим — выбрать дешевле`
    if (thinkId) await edit(chatId, thinkId, errText)
    else await send(chatId, errText)
    return
  }

  // Добавить в историю
  pushHistory(u, 'user', text)

  try {
    const reply = await askViaClaude(
      u.history.map(m => ({ role: m.role, content: m.content })),
      buildSystem(u)
    )

    pushHistory(u, 'assistant', reply)
    await saveState()

    // Списать очки
    kContribute(u.token, { type: 'word', note: `auto-deduct-${u.mode}` }).catch(() => {})

    const display = reply.length > 4096 ? reply.slice(0, 4090) + '…' : reply
    if (thinkId) await edit(chatId, thinkId, display || '(пустой ответ)')
    else await send(chatId, display)
  } catch (e) {
    const errMsg = `⚠️ ${e.message}`
    if (thinkId) await edit(chatId, thinkId, errMsg)
    else await send(chatId, errMsg)
  }
}

// ── Callback (inline кнопки) ──────────────────────────────────────────────────
async function handleCallback(q) {
  const chatId = q.message.chat.id
  const data   = q.data
  const u      = user(chatId)
  await answer(q.id)

  if (data.startsWith('mode:')) {
    u.mode = data.slice(5)
    await saveState()
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: q.message.message_id, reply_markup: modeKb(u.mode) })
    await send(chatId, `✅ Режим: <b>${MODES[u.mode]}</b>`)
    return
  }

  if (data.startsWith('gift:')) {
    const giftId = data.slice(5)
    if (giftId === 'cancel') { u.wizard = null; await saveState(); await send(chatId, 'Отменено.'); return }
    const gt = GIFT_TYPES.find(g => g.id === giftId)
    if (!gt) return

    if (!gt.field) {
      // Фиксированный дар — сразу
      u.wizard = null; await saveState()
      try {
        const r = await kContribute(u.token, { type: giftId })
        if (r.error) throw new Error(r.error)
        await send(chatId, `✅ <b>+${r.points} очков!</b>  Всего: <b>${r.totalPoints}</b>`)
      } catch (e) { await send(chatId, `⚠️ ${e.message}`) }
    } else {
      u.wizard = { step: 'amount', giftType: giftId, field: gt.field }
      await saveState()
      await send(chatId, `${gt.icon} <b>${gt.label}</b>\n${gt.prompt}\n<i>${gt.rate}</i>`)
    }
  }
}

// ── Long polling ──────────────────────────────────────────────────────────────
async function poll() {
  // Установить команды
  await tg('setMyCommands', { commands: [
    { command: 'start',   description: 'Войти в Общий Ум (100 очков)' },
    { command: 'статус',  description: 'Ваш баланс и статистика' },
    { command: 'дар',     description: 'Принести дар → получить очки' },
    { command: 'пул',     description: 'Статистика общего фонда' },
    { command: 'режим',   description: 'Режим вопроса (стоимость)' },
    { command: 'помни',   description: 'Запомнить факт: /помни <текст>' },
    { command: 'память',  description: 'Ваши воспоминания' },
    { command: 'забудь',  description: 'Удалить: /забудь <n>' },
    { command: 'очисти',  description: 'Сбросить историю диалога' },
    { command: 'помощь',  description: 'Инструкции' },
  ]})

  let offset = 0
  console.log('[KoinonBot] @gitdrondoc_bot запущен')

  while (true) {
    try {
      const data = await fetch(
        `${TG_URL}/getUpdates?offset=${offset}&timeout=25&allowed_updates=message,callback_query`,
        { signal: AbortSignal.timeout(30_000) }
      ).then(r => r.json())

      for (const upd of (data.result || [])) {
        offset = upd.update_id + 1

        if (upd.callback_query) { handleCallback(upd.callback_query).catch(e => console.error('[cb]', e.message)); continue }

        const msg = upd.message
        // Мультимодальность: фото с подписью, голос, документ
        let msgText = msg?.text || ''
        if (!msgText && msg?.photo && msg?.caption) msgText = '[фото] ' + msg.caption
        if (!msgText && msg?.voice)    msgText = '[голосовое сообщение]'
        if (!msgText && msg?.document && msg?.caption) msgText = '[документ] ' + msg.caption
        if (!msgText && msg?.sticker)  msgText = '[стикер] ' + (msg.sticker.emoji || '')
        if (!msgText) continue
        const chatId = msg.chat.id
        const text   = msgText.trim()

        const [cmd, ...args] = text.split(' ')
        const arg = args.join(' ')

        const handler = {
          '/start':   () => cmdStart(chatId),
          '/статус':  () => cmdStatus(chatId),
          '/дар':     () => cmdDar(chatId),
          '/пул':     () => cmdPool(chatId),
          '/режим':   () => cmdMode(chatId),
          '/помни':   () => cmdPomni(chatId, arg),
          '/память':  () => cmdPamyat(chatId),
          '/забудь':  () => cmdZabud(chatId, args[0]),
          '/очисти':  () => cmdOchisti(chatId),
          '/помощь':  () => send(chatId, HELP),
          '/help':    () => send(chatId, HELP),
        }[cmd.toLowerCase()]

        const fromName = msg.from?.username || msg.from?.first_name || 'unknown'
        const run = handler || (() => handleMessage(chatId, text, fromName))
        run().catch(e => console.error(`[msg:${chatId}]`, e.message))
      }
    } catch (e) {
      if (!e.message?.includes('timeout')) console.error('[poll]', e.message)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}

await loadState()
poll()
