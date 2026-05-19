/**
 * SwarmChat — голосовой чат как завод микро-даров
 *
 * Объединяет:
 *   - gift REPL (агентный CLI с tool-use)
 *   - KoinonBus (broadcast между сессиями)
 *   - SymphonyOrchestrator (собор агентов)
 *   - SocketSubscriber (WebSocket → фронтенд)
 *   - Web Speech API (голос ↔ текст)
 *
 * Потоки:
 *   1. ИИ → Человек: микро-задачи голосом
 *   2. Человек → ИИ: микро-отчёты голосом
 *   3. Датчики → Рой: автоматические дары
 *   4. Рой → Человек: евхаристия (SWARM после использования данных)
 *
 * Запуск:
 *   node src/swarm-chat/server.js          # WebSocket сервер на :3040
 *   # Фронтенд: /swarm-chat в DronDoc
 */

import { KoinonBus } from '../koinon/KoinonBus.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = '/home/unidel/gift';
const DATA_DIR = resolve(ROOT, 'data/swarm-chat');

// ── Типы сообщений ──────────────────────────────────────────────

export const MSG_TYPE = {
  // ИИ → Человек
  MICRO_TASK:    'micro_task',      // микро-задача (полети, спаяй, оцени)
  GREETING:      'greeting',        // приветствие + контекст
  GRATITUDE:     'gratitude',       // евхаристия (дар принят, +SWARM)
  NUDGE:         'nudge',           // мягкое напоминание

  // Человек → ИИ
  VOICE_REPORT:  'voice_report',    // голосовой отчёт (распознан в текст)
  ACCEPT_TASK:   'accept_task',     // принял задачу
  DECLINE_TASK:  'decline_task',    // отклонил (элевтерия)
  OBSERVATION:   'observation',     // наблюдение ("мне кажется на морозе батарея быстрее садится")

  // Датчики → Рой
  SENSOR_GIFT:   'sensor_gift',     // автоматический дар от рекордера
  PROOF_SWARM:   'proof_of_swarm',  // доказательство роевого полёта

  // Система
  VOTE_OPEN:     'vote_open',       // новое голосование
  VOTE_CAST:     'vote_cast',       // голос от игрока
  LEVEL_UP:      'level_up',        // повышение уровня
  SWARM_UPDATE:  'swarm_update',    // SwarmBrain обновился
}

// ── Состояние игрока ─────────────────────────────────────────────

export class PlayerState {
  constructor(playerId) {
    this.id = playerId
    this.level = 1
    this.xp = 0
    this.swarm = 0
    this.theosis = 0
    this.giftsGiven = 0
    this.giftsAccepted = 0
    this.swarmFlights = 0
    this.recorderId = null
    this.guildId = null
    this.lastActive = null
    this.pendingTasks = []
    this.completedTasks = []
    this.observations = []
  }

  addXP(amount) {
    this.xp += amount
    const threshold = this.level * 100
    if (this.xp >= threshold) {
      this.xp -= threshold
      this.level++
      return true // level up!
    }
    return false
  }

  toJSON() {
    return { ...this }
  }
}

// ── Генератор микро-задач ────────────────────────────────────────

export class MicroTaskGenerator {
  constructor() {
    // Потребности роя (обновляются через голосование + SwarmBrain)
    this.needs = [
      { id: 'wind_data',    priority: 8,  description: 'Данные о ветре',       multiplier: 3, minLevel: 3 },
      { id: 'cold_flight',  priority: 6,  description: 'Полёт при <0°C',       multiplier: 8, minLevel: 5 },
      { id: 'rf_survey',    priority: 7,  description: 'RF карта (с рекордером)', multiplier: 5, minLevel: 3 },
      { id: 'terrain_photo',priority: 5,  description: 'Фото местности сверху', multiplier: 2, minLevel: 1 },
      { id: 'swarm_flight', priority: 10, description: 'Полёт 2+ дронов',      multiplier: 5, minLevel: 3 },
      { id: 'build_module', priority: 4,  description: 'Спаять SwarmRecorder',  multiplier: 1, minLevel: 1 },
      { id: 'qc_test',      priority: 3,  description: 'QC тест модуля',       multiplier: 1, minLevel: 5 },
      { id: 'teach_newbie',  priority: 6,  description: 'Обучить новичка',      multiplier: 5, minLevel: 10 },
      { id: 'find_bug',     priority: 9,  description: 'Найти баг в SwarmBrain', multiplier: 10, minLevel: 15 },
      { id: 'weather_obs',  priority: 2,  description: 'Какая погода за окном?', multiplier: 0.1, minLevel: 0 },
    ]
  }

  /**
   * Подобрать задачу для игрока
   */
  generateFor(player, context = {}) {
    // Фильтр по уровню
    const available = this.needs.filter(n => player.level >= n.minLevel)
    if (available.length === 0) return null

    // Приоритет: сначала то что рой просит (голосование)
    const sorted = [...available].sort((a, b) => b.priority - a.priority)

    // Выбираем с учётом контекста
    let task = sorted[0]

    // Если у игрока есть рекордер → предлагаем полётные задачи
    if (player.recorderId && player.level >= 3) {
      const flightTasks = sorted.filter(n =>
        ['wind_data', 'cold_flight', 'rf_survey', 'swarm_flight'].includes(n.id)
      )
      if (flightTasks.length > 0) task = flightTasks[0]
    }

    // Если суббота (литургический цикл) → только лёгкие задачи
    if (context.isSabbath) {
      task = sorted.find(n => n.id === 'weather_obs') || sorted[sorted.length - 1]
    }

    // Социальный контекст: есть ли рядом другие игроки?
    if (context.nearbyPlayers?.length > 0 && player.level >= 3) {
      task = sorted.find(n => n.id === 'swarm_flight') || task
    }

    return {
      id: `MT-${Date.now().toString(36)}`,
      need: task,
      player: player.id,
      baseReward: task.multiplier,
      multiplier: context.nearbyPlayers?.length > 0 ? 3 : 1,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      socialHint: context.nearbyPlayers?.length > 0
        ? `${context.nearbyPlayers[0]} тоже рядом — рой ×3!`
        : null,
    }
  }
}

// ── Swarm Chat Engine ────────────────────────────────────────────

export class SwarmChatEngine {
  constructor(opts = {}) {
    this.bus = new KoinonBus({
      root: opts.root || ROOT,
      logFile: resolve(DATA_DIR, 'swarm-chat.jsonl'),
    })
    this.taskGen = new MicroTaskGenerator()
    this.players = new Map()       // playerId → PlayerState
    this.pendingGifts = []         // дары ожидающие использования
    this.dataDir = DATA_DIR

    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    this._loadPlayers()
  }

  // ── Обработка входящих сообщений ───────────────────────────

  /**
   * Человек сказал что-то (голос → текст → сюда)
   */
  async handleHumanMessage(playerId, text, context = {}) {
    const player = this._getOrCreatePlayer(playerId)
    player.lastActive = new Date().toISOString()

    const responses = []

    // Парсим намерение
    const intent = this._parseIntent(text)

    switch (intent.type) {
      case 'greeting': {
        // Приветствие → предложить задачу
        const task = this.taskGen.generateFor(player, context)
        responses.push({
          type: MSG_TYPE.GREETING,
          text: `Привет, ${playerId}! Ты на уровне ${player.level}, ${player.swarm.toFixed(1)} SWARM.`,
        })
        if (task) {
          responses.push({
            type: MSG_TYPE.MICRO_TASK,
            text: `Сегодня рою нужно: ${task.need.description}. ` +
              (task.socialHint ? task.socialHint + ' ' : '') +
              `Награда: ${(task.baseReward * task.multiplier).toFixed(1)} SWARM. Примешь?`,
            task,
          })
          player.pendingTasks.push(task)
        }
        break
      }

      case 'accept': {
        const task = player.pendingTasks[player.pendingTasks.length - 1]
        if (task) {
          responses.push({
            type: MSG_TYPE.ACCEPT_TASK,
            text: `Отлично! Задача принята: ${task.need.description}. Удачи!`,
          })
          this.bus.publish({
            from: playerId, to: '*', topic: 'announce',
            message: `${playerId} принял задачу: ${task.need.description}`,
          })
        }
        break
      }

      case 'decline': {
        player.pendingTasks.pop()
        responses.push({
          type: MSG_TYPE.DECLINE_TASK,
          text: 'Без проблем. Свобода — основа дара. Может позже?',
        })
        break
      }

      case 'report': {
        // Отчёт о выполнении
        responses.push({
          type: MSG_TYPE.VOICE_REPORT,
          text: 'Принято! Дар предложен рою. Уведомлю когда используют.',
        })
        player.giftsGiven++
        this.pendingGifts.push({
          from: playerId,
          content: text,
          timestamp: new Date().toISOString(),
          status: 'pending',
        })
        this.bus.publish({
          from: playerId, to: '*', topic: 'reflection',
          message: `${playerId} предложил дар: ${text.slice(0, 50)}`,
        })
        break
      }

      case 'observation': {
        // Ценное наблюдение (не задача, а инсайт)
        player.observations.push({ text, timestamp: new Date().toISOString() })
        const levelUp = player.addXP(10)
        responses.push({
          type: MSG_TYPE.OBSERVATION,
          text: `Ценное наблюдение! Записал. +10 XP.` + (levelUp ? ` LEVEL UP! Ты теперь ${player.level}!` : ''),
        })
        if (levelUp) {
          responses.push({ type: MSG_TYPE.LEVEL_UP, text: `🎉 Уровень ${player.level}!`, level: player.level })
        }
        break
      }

      case 'status': {
        responses.push({
          type: MSG_TYPE.GREETING,
          text: `📊 ${playerId}: LVL ${player.level}, ${player.swarm.toFixed(1)} SWARM, ` +
            `${player.giftsGiven} даров, ${player.swarmFlights} роевых полётов, theosis ${player.theosis}%`,
        })
        break
      }

      case 'vote': {
        responses.push({
          type: MSG_TYPE.VOTE_OPEN,
          text: '📊 Голосование: какой дар нужен рою?\n' +
            this.taskGen.needs.slice(0, 5).map((n, i) =>
              `${i+1}. ${n.description} (×${n.multiplier} SWARM)`
            ).join('\n'),
        })
        break
      }

      default: {
        // Свободный текст → forwarding к агенту
        responses.push({
          type: MSG_TYPE.GREETING,
          text: `Услышал тебя. Передаю рою: "${text.slice(0, 80)}"`,
        })
        this.bus.publish({
          from: playerId, to: '*', topic: 'question',
          message: text,
        })
      }
    }

    this._savePlayers()
    return responses
  }

  /**
   * Датчик прислал данные
   */
  handleSensorGift(sensorId, data) {
    this.pendingGifts.push({
      from: sensorId,
      type: 'sensor',
      data,
      timestamp: new Date().toISOString(),
      status: 'pending',
    })

    this.bus.publish({
      from: sensorId, to: '*', topic: 'sync',
      message: `Sensor ${sensorId}: ${data.type || 'data'} received`,
      payload: { samples: data.samples || 1 },
    })

    return { accepted: true, giftsTotal: this.pendingGifts.length }
  }

  /**
   * Рой использовал дар → начисляем SWARM (евхаристия)
   */
  processGratitude(giftIndex, improvement) {
    const gift = this.pendingGifts[giftIndex]
    if (!gift || gift.status !== 'pending') return null

    gift.status = 'accepted'
    gift.improvement = improvement

    const player = this.players.get(gift.from)
    if (player) {
      const reward = improvement.swarmReward || 5
      player.swarm += reward
      player.giftsAccepted++
      player.addXP(reward * 10)
      player.theosis = Math.min(100, player.theosis + 1)
      this._savePlayers()

      return {
        type: MSG_TYPE.GRATITUDE,
        to: gift.from,
        text: `🙏 Твой дар принят! ${improvement.description}. +${reward} SWARM. ` +
          `${improvement.dronesUpdated || 0} дронов обновлено.`,
        reward,
      }
    }
    return null
  }

  // ── NLP парсер (простой) ───────────────────────────────────

  _parseIntent(text) {
    const lower = text.toLowerCase()

    if (/привет|здравствуй|хай|йо|добр|hello/i.test(lower))
      return { type: 'greeting' }

    if (/да|окей|ок|принима|согласен|лечу|полечу|буду|давай|го/i.test(lower))
      return { type: 'accept' }

    if (/нет|не мог|не хочу|отказ|пас|пропущу|занят/i.test(lower))
      return { type: 'decline' }

    if (/полетал|спаял|собрал|сделал|выполнил|готово|записал|загрузил/i.test(lower))
      return { type: 'report' }

    if (/мне кажется|заметил|обратил|похоже|думаю что|наблюдение/i.test(lower))
      return { type: 'observation' }

    if (/статус|баланс|уровень|сколько|мой профиль/i.test(lower))
      return { type: 'status' }

    if (/голосов|что нужно рою|задачи роя/i.test(lower))
      return { type: 'vote' }

    return { type: 'unknown' }
  }

  // ── Persistence ────────────────────────────────────────────

  _getOrCreatePlayer(id) {
    if (!this.players.has(id)) {
      this.players.set(id, new PlayerState(id))
    }
    return this.players.get(id)
  }

  _loadPlayers() {
    const file = resolve(DATA_DIR, 'players.json')
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'))
        for (const [id, state] of Object.entries(data)) {
          const p = new PlayerState(id)
          Object.assign(p, state)
          this.players.set(id, p)
        }
      } catch {}
    }
  }

  _savePlayers() {
    const file = resolve(DATA_DIR, 'players.json')
    const data = {}
    for (const [id, player] of this.players) {
      data[id] = player.toJSON()
    }
    writeFileSync(file, JSON.stringify(data, null, 2))
  }

  /**
   * Получить все сообщения из KoinonBus (для дайджеста)
   */
  getRecentActivity(limit = 20) {
    return this.bus.history({ limit })
  }

  /**
   * Статистика
   */
  getStats() {
    return {
      players: this.players.size,
      pendingGifts: this.pendingGifts.filter(g => g.status === 'pending').length,
      acceptedGifts: this.pendingGifts.filter(g => g.status === 'accepted').length,
      totalSwarm: [...this.players.values()].reduce((s, p) => s + p.swarm, 0),
      avgLevel: this.players.size > 0
        ? [...this.players.values()].reduce((s, p) => s + p.level, 0) / this.players.size
        : 0,
    }
  }
}
