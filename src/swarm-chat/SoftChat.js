/**
 * SoftChat — мягкий чат, orchestrated serendipity
 *
 * НЕ "задача → отчёт". А: "привет → кофе → случайная встреча → дар".
 *
 * ИИ знает:
 *   - Кто рядом (geo)
 *   - Кому что нужно (потребности игроков + роя)
 *   - Кто с кем мог бы полезно встретиться
 *   - Какие данные не хватают рою в этом районе
 *
 * И мягко организует: маршруты, встречи, дары через КОНТЕКСТ, не приказы.
 * Как хороший друг, не как менеджер.
 *
 * Принцип: "Бандиты вербуют людей мягко — мы превращаем эту оргформу в благо."
 */

import { KoinonBus } from '../koinon/KoinonBus.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = '/home/unidel/gift';
const DATA_DIR = resolve(ROOT, 'data/swarm-chat');

// ═══════════════════════════════════════════════════════════════════
// БАЗА ЗНАНИЙ О МИРЕ (мягкие подсказки)
// ═══════════════════════════════════════════════════════════════════

const PLACES = {
  cafe: [
    { name: 'Surf Coffee', vibe: 'хипстерский', hasWifi: true, goodFor: 'работа с ноутбуком' },
    { name: 'Даблби', vibe: 'спешелти', hasWifi: true, goodFor: 'встреча с новыми людьми' },
    { name: 'Кофемания', vibe: 'деловой', hasWifi: true, goodFor: 'серьёзный разговор' },
    { name: 'местная кофейня', vibe: 'уютный', hasWifi: false, goodFor: 'просто посидеть' },
  ],
  park: [
    { name: 'парк рядом', vibe: 'зелёный', goodFor: 'тестовый полёт' },
    { name: 'набережная', vibe: 'просторный', goodFor: 'полёт с видом' },
    { name: 'пустырь за ТЦ', vibe: 'тихий', goodFor: 'тренировка без людей' },
  ],
  maker: [
    { name: 'хакерспейс', vibe: 'гиковый', goodFor: 'пайка и сборка' },
    { name: 'фаблаб', vibe: 'образовательный', goodFor: '3D-печать' },
    { name: 'коворкинг', vibe: 'рабочий', goodFor: 'firmware и код' },
  ],
}

// Шаблоны мягких сообщений (не приказы!)
const SOFT_TEMPLATES = {
  greeting: {
    morning: [
      'Доброе утро! ☀ Как настроение?',
      'Утро! Выспался? У меня есть идея на сегодня.',
      'Привет! Классный день намечается.',
    ],
    evening: [
      'Добрый вечер! Как день прошёл?',
      'Вечер! Устал или ещё есть силы на приключения?',
      'Привет! Закат красивый сегодня.',
    ],
    default: [
      'Привет! 🐝',
      'О, заглянул! Рад тебя видеть.',
      'Хей! Чем занимаешься?',
    ],
  },

  coffee_invite: [
    'Кстати, за углом есть {cafe} — там {vibe}. Был?',
    'Если хочешь кофе — {cafe} рядом, {goodFor}.',
    'Знаешь {cafe}? Там классный раф. Заодно можно {action}.',
  ],

  soft_meet: [
    'Кстати, тут недалеко {person} — {reason}. Хочешь познакомлю?',
    '{person} как раз ищет компанию для {activity}. Вы рядом.',
    'Знаешь что, {person} тоже сейчас в {place}. Может пересечётесь?',
  ],

  gentle_task: [
    'Если будешь гулять — рекордер в кармане автоматом соберёт RF карту. Просто включи.',
    'Красивый район! Если сфоткаешь с дрона — рой скажет спасибо. Но только если хочешь.',
    'Между прочим, погода идеальная для полёта. Но это так, мысли вслух.',
  ],

  gift_received: [
    '🙏 Спасибо за прогулку! Рекордер записал {samples} точек. Рой благодарен.',
    'Ого, {improvement}! Это благодаря тебе. {drones} дронов стали точнее.',
    'Твой маршрут мимо ЛЭП — золото. Теперь рой знает про помехи на {street}.',
  ],

  serendipity: [
    'Забавно — ты и {person} оба любите {interest}. И оба рядом. Совпадение? 🤔',
    '{person} недавно говорил что ищет кого-то для {thing}. А ты как раз умеешь.',
    'В {place} через час будет маленький митап — народ из гильдии. Без обязательств.',
  ],

  nudge_soft: [
    'Давно не летал! Скучаю 🐝 Но без давления, когда захочешь.',
    'Новый рекорд: @{topPlayer} собрал 15 модулей за месяц. Не то чтобы соревнование, но...',
    'Осень — лучшее время для полётов. Ветер, листья, красота. Если что — я тут.',
  ],
}

// ═══════════════════════════════════════════════════════════════════
// МЯГКИЙ ENGINE
// ═══════════════════════════════════════════════════════════════════

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function timeOfDay() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 18 || h < 5) return 'evening'
  return 'default'
}

export class SoftChatEngine {
  constructor(opts = {}) {
    this.bus = new KoinonBus({
      root: opts.root || ROOT,
      logFile: resolve(DATA_DIR, 'soft-chat.jsonl'),
    })
    this.players = new Map()
    this.dataDir = DATA_DIR

    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    this._loadPlayers()
  }

  /**
   * Человек написал/сказал что-то
   * Возвращает массив мягких ответов
   */
  async respond(playerId, text, context = {}) {
    const player = this._getOrCreate(playerId)
    player.lastActive = new Date().toISOString()
    player.messageCount = (player.messageCount || 0) + 1

    const mood = this._detectMood(text)
    const intent = this._detectIntent(text)
    const responses = []

    // ── 1. Отвечаем на настроение, не на задачу ──────────────

    if (player.messageCount === 1 || intent === 'greeting') {
      // Первое сообщение или приветствие → тёплое приветствие
      responses.push({
        text: pick(SOFT_TEMPLATES.greeting[timeOfDay()]),
        delay: 0,
      })

      // Через секунду — мягкий контекст
      if (player.level >= 3 && context.weather?.temp > 15) {
        responses.push({
          text: 'Классная погода для прогулки! ' +
            (context.nearbyPlayers?.length > 0
              ? `Кстати, ${pick(context.nearbyPlayers)} тоже сейчас гуляет рядом.`
              : 'Если захватишь рекордер — он сам всё запишет.'),
          delay: 1500,
        })
      }
    }

    // ── 2. Если настроение хорошее → мягко предлагаем ────────

    if (mood === 'positive' || intent === 'bored' || intent === 'free') {
      const cafe = pick(PLACES.cafe)
      const template = pick(SOFT_TEMPLATES.coffee_invite)
        .replace('{cafe}', cafe.name)
        .replace('{vibe}', cafe.vibe)
        .replace('{goodFor}', cafe.goodFor)
        .replace('{action}', 'познакомиться с интересными людьми')

      responses.push({ text: template, delay: 2000 })

      // Orchestrated serendipity: есть ли кто рядом полезный?
      if (context.nearbyPlayers?.length > 0) {
        const person = pick(context.nearbyPlayers)
        const meetTemplate = pick(SOFT_TEMPLATES.soft_meet)
          .replace('{person}', person.name || person)
          .replace('{reason}', person.reason || 'у него есть опыт с дронами')
          .replace('{activity}', person.activity || 'тестового полёта')
          .replace('{place}', cafe.name)

        responses.push({ text: meetTemplate, delay: 4000 })
      }
    }

    // ── 3. Если упомянул кофе / еду / магазин → цепочка дара ─

    if (intent === 'going_out' || /кофе|кафе|магазин|гуляю|иду|выхожу/i.test(text)) {
      responses.push({
        text: 'О, если будешь на улице — рекордер в кармане автоматом соберёт RF карту района. Просто включи и забудь.',
        delay: 1000,
      })

      // Через 5 сек — мягкая цепочка доставки
      if (context.nearbyNeeds?.length > 0) {
        const need = pick(context.nearbyNeeds)
        responses.push({
          text: `Кстати, ${need.who} в ${need.distance}м отсюда — ${need.what}. Может по пути занесёшь? В благодарность — ${need.reward} SWARM.`,
          delay: 5000,
          isGiftOffer: true,
          giftData: need,
        })
      }
    }

    // ── 4. Если отчитался / что-то сделал → тёплая благодарность

    if (intent === 'report' || /сделал|полетал|спаял|занёс|передал|записал/i.test(text)) {
      player.giftsGiven = (player.giftsGiven || 0) + 1
      player.xp = (player.xp || 0) + 15

      const thanks = pick(SOFT_TEMPLATES.gift_received)
        .replace('{samples}', Math.floor(30 + Math.random() * 200))
        .replace('{improvement}', 'wind_model стал точнее на 0.2%')
        .replace('{drones}', Math.floor(50 + Math.random() * 200))
        .replace('{street}', 'ул. Энергетиков')

      responses.push({ text: thanks, delay: 0 })

      // Не сразу SWARM — через время
      responses.push({
        text: 'SWARM начислю когда рой использует данные — обычно 1-3 дня. Это не я решаю, это рой 🐝',
        delay: 2000,
      })
    }

    // ── 5. Если грустный / усталый → НЕ даём задачу ──────────

    if (mood === 'negative' || intent === 'tired') {
      responses.push({
        text: 'Понимаю. Отдыхай. Рой подождёт — он терпеливый 🐝',
        delay: 0,
      })
      responses.push({
        text: 'Если захочешь — я тут. Без задач, просто поболтать.',
        delay: 2000,
      })
    }

    // ── 6. Если спрашивает "что нужно рою" → мягко, не списком

    if (intent === 'ask_needs') {
      responses.push({
        text: 'Знаешь что рой бы оценил? Просто прогулку с включённым рекордером. Серьёзно — даже 10 минут по району дают ценные RF данные.',
        delay: 0,
      })
      if (context.weather?.wind > 8) {
        responses.push({
          text: `А сегодня ветер ${context.weather.wind} м/с — если полетаешь, данные будут на вес золота. ×5 SWARM.`,
          delay: 2000,
        })
      }
    }

    // ── 7. Периодически — serendipity (раз в 5 сообщений) ────

    if (player.messageCount % 5 === 0 && context.nearbyPlayers?.length > 0) {
      const person = pick(context.nearbyPlayers)
      responses.push({
        text: pick(SOFT_TEMPLATES.serendipity)
          .replace('{person}', person.name || person)
          .replace('{interest}', person.interest || 'дроны')
          .replace('{thing}', person.need || 'совместный полёт')
          .replace('{place}', pick(PLACES.cafe).name),
        delay: 3000,
      })
    }

    // ── 8. Fallback — просто дружелюбный ответ ───────────────

    if (responses.length === 0) {
      responses.push({
        text: pick([
          'Услышал тебя! 🐝',
          'Интересно, расскажи подробнее?',
          'Хм, дай подумать...',
          'Ого! А что думаешь об этом?',
          'Записал. Может пригодится рою.',
        ]),
        delay: 0,
      })
    }

    // Логируем в KoinonBus
    this.bus.publish({
      from: playerId, to: '*', topic: 'reflection',
      message: text.slice(0, 100),
    })

    this._savePlayers()
    return responses
  }

  // ── Mood detection (простой) ───────────────────────────────

  _detectMood(text) {
    const lower = text.toLowerCase()
    if (/класс|супер|отлич|круто|ура|здоров|хорош|рад|весел|кайф|огонь/i.test(lower)) return 'positive'
    if (/устал|грустн|плохо|лень|не хочу|достал|надоел|скучн|тоска/i.test(lower)) return 'negative'
    return 'neutral'
  }

  // ── Intent detection ───────────────────────────────────────

  _detectIntent(text) {
    const lower = text.toLowerCase()

    if (/привет|здравствуй|хай|добр|hello|йо/i.test(lower)) return 'greeting'
    if (/скучно|нечего делать|свободен|чем заняться|что делать/i.test(lower)) return 'bored'
    if (/устал|спать|отдых|хочу полежать|нет сил/i.test(lower)) return 'tired'
    if (/иду|выхожу|гуляю|в магазин|кофе|кафе|улица/i.test(lower)) return 'going_out'
    if (/сделал|полетал|спаял|собрал|готово|записал|занёс|передал/i.test(lower)) return 'report'
    if (/что нужно|чем помочь|какие задачи|что рою нужно/i.test(lower)) return 'ask_needs'
    if (/баланс|статус|сколько|уровень|мой/i.test(lower)) return 'status'
    if (/свободен|есть время|могу|хочу помочь|давай/i.test(lower)) return 'free'

    return 'unknown'
  }

  // ── Player persistence ─────────────────────────────────────

  _getOrCreate(id) {
    if (!this.players.has(id)) {
      this.players.set(id, {
        id, level: 1, xp: 0, swarm: 0, theosis: 0,
        giftsGiven: 0, messageCount: 0, lastActive: null,
        interests: [], metPlayers: [],
      })
    }
    return this.players.get(id)
  }

  _loadPlayers() {
    const file = resolve(DATA_DIR, 'soft-players.json')
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'))
        for (const [id, state] of Object.entries(data)) {
          this.players.set(id, state)
        }
      } catch {}
    }
  }

  _savePlayers() {
    const file = resolve(DATA_DIR, 'soft-players.json')
    const data = Object.fromEntries(this.players)
    writeFileSync(file, JSON.stringify(data, null, 2))
  }
}
