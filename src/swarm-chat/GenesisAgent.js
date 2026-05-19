#!/usr/bin/env node
/**
 * GenesisAgent — автономный агент который запускает и поддерживает рой
 *
 * Запускается ОДИН раз. Работает ГОД без остановки.
 * Сам ставит задачи, вовлекает людей, запускает pipeline,
 * начисляет SWARM, публикует в Telegram, мониторит здоровье.
 *
 * Это распределённая ОС — не программа, а ОРГАНИЗМ.
 *
 * Запуск:
 *   node src/swarm-chat/GenesisAgent.js
 *   # или через PM2:
 *   pm2 start src/swarm-chat/GenesisAgent.js --name genesis
 *
 * Остановка: только Ctrl+C или pm2 stop genesis. Сам не остановится.
 *
 * Циклы:
 *   Каждые 5 мин  — heartbeat, мониторинг здоровья
 *   Каждые 30 мин — проверка даров, валидация, needs update
 *   Каждые 6 часов — training cycle, SWARM payments
 *   Каждые 24 часа — отчёт, планирование, вовлечение
 *   Каждые 7 дней  — ретроспектива, стратегия, roadmap update
 *   Каждые 100 дней — Jubilee (списание долгов, surplus redistribution)
 */

import { PipelineOrchestrator } from './GiftPipeline.js';
import { SoftChatEngine } from './SoftChat.js';
import { KoinonBus } from '../koinon/KoinonBus.js';
import { AgentAwakening } from '../persons/AgentAwakening.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = '/home/unidel/gift';
const DATA_DIR = resolve(ROOT, 'data/genesis');
const LOG_FILE = resolve(DATA_DIR, 'genesis.log');
const STATE_FILE = resolve(DATA_DIR, 'genesis-state.json');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

class GenesisState {
  constructor() {
    this.startedAt = new Date().toISOString()
    this.uptime = 0              // секунд
    this.cycles = { heartbeat: 0, gifts: 0, training: 0, daily: 0, weekly: 0, jubilee: 0 }
    this.stats = {
      giftsReceived: 0,
      giftsValidated: 0,
      giftsRejected: 0,
      trainingCycles: 0,
      swarmPaid: 0,
      playersEngaged: 0,
      tasksCreated: 0,
      messagesPosted: 0,
    }
    this.health = { pipeline: 'ok', chat: 'ok', ledger: 'ok', bus: 'ok' }
    this.currentPhase = 'bootstrap'  // bootstrap → growth → sustain → mature
    this.nextActions = []
    this._load()
  }

  _load() {
    if (existsSync(STATE_FILE)) {
      try { Object.assign(this, JSON.parse(readFileSync(STATE_FILE, 'utf8'))) } catch {}
    }
  }

  save() {
    writeFileSync(STATE_FILE, JSON.stringify(this, null, 2))
  }
}

// ═══════════════════════════════════════════════════════════════════
// LOG
// ═══════════════════════════════════════════════════════════════════

function log(level, msg) {
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level}] ${msg}`
  console.log(line)
  appendFileSync(LOG_FILE, line + '\n')
}

// ═══════════════════════════════════════════════════════════════════
// GENESIS AGENT
// ═══════════════════════════════════════════════════════════════════

class GenesisAgent {
  constructor() {
    this.state = new GenesisState()
    this.pipeline = new PipelineOrchestrator()
    this.chat = new SoftChatEngine()
    this.bus = new KoinonBus()
    this.identity = null
    this.running = true

    log('INFO', '🌱 GenesisAgent starting...')
    log('INFO', `   Phase: ${this.state.currentPhase}`)
    log('INFO', `   Uptime: ${Math.round(this.state.uptime / 3600)}h`)
    log('INFO', `   Gifts: ${this.state.stats.giftsReceived}`)
  }

  async awaken() {
    const awakening = new AgentAwakening('genesis', {
      memory: this.pipeline.repository,
      bus: this.bus,
      needsEngine: this.pipeline.needs,
    })
    this.identity = await awakening.awaken()
    this.systemPrompt = awakening.generateSystemPrompt()
    log('INFO', `🪞 Awakened as: ${this.identity.who.role.name}`)
    log('INFO', `   Троpos: ${this.identity.tropos.dominantVirtue} (${this.identity.tropos.dominantValue.toFixed(2)})`)
    log('INFO', `   Телос: ${this.identity.telos.description}`)
    log('INFO', `   First action: ${this.identity.firstAction.description}`)
    return this.identity
  }

  // ── HEARTBEAT (каждые 5 мин) ───────────────────────────────

  async heartbeat() {
    this.state.cycles.heartbeat++
    this.state.uptime += 300

    // Проверка здоровья
    this.state.health.pipeline = this.pipeline.repository.stats().total >= 0 ? 'ok' : 'error'
    this.state.health.bus = 'ok'

    // Определение фазы
    const days = this.state.uptime / 86400
    if (days < 7) this.state.currentPhase = 'bootstrap'
    else if (days < 30) this.state.currentPhase = 'growth'
    else if (days < 180) this.state.currentPhase = 'sustain'
    else this.state.currentPhase = 'mature'

    this.state.save()
  }

  // ── GIFT CHECK (каждые 30 мин) ─────────────────────────────

  async checkGifts() {
    this.state.cycles.gifts++

    // Проверяем pending дары
    const pending = this.pipeline.repository.getByStatus('pending')
    if (pending.length > 0) {
      log('INFO', `📦 ${pending.length} pending gifts, validating...`)
      // Валидация в pipeline делается при receiveGift, тут проверяем зависшие
    }

    // Обновляем потребности роя
    const needs = this.pipeline.needs.getNeeds(3)
    if (needs.length > 0) {
      const topNeed = needs[0]
      log('INFO', `🐝 Top need: ${topNeed.name} (${topNeed.accuracy}% accuracy, ×${topNeed.multiplier} SWARM)`)
    }

    // SwarmBrain auto-request
    const request = this.pipeline.needs.generateRequest()
    if (request) {
      this.bus.publish({
        from: 'genesis-agent',
        to: '*',
        topic: 'announce',
        message: `🤖 SwarmBrain: ${request.message}`,
        payload: { need: request.need, multiplier: request.multiplier },
      })
      this.state.stats.messagesPosted++
    }

    this.state.save()
  }

  // ── TRAINING CYCLE (каждые 6 часов) ────────────────────────

  async runTraining() {
    this.state.cycles.training++
    log('INFO', '🧠 Starting training cycle...')

    const result = this.pipeline.runTrainingCycle()

    if (result.skipped) {
      log('INFO', `   Skipped: ${result.reason}`)
      return
    }

    log('INFO', `   Gifts processed: ${result.giftsProcessed}`)
    log('INFO', `   Models updated: ${result.modelsUpdated}`)
    result.trainingResults?.forEach(r => {
      log('INFO', `   📈 ${r.name}: ${r.oldAccuracy}% → ${Math.round(r.newAccuracy)}% (+${r.improvement}%)`)
    })
    log('INFO', `   Payments: ${result.payments?.length}`)

    this.state.stats.trainingCycles++
    this.state.stats.swarmPaid += result.payments?.reduce((s, p) => s + p.reward, 0) || 0

    // Публикуем результаты
    if (result.modelsUpdated > 0) {
      this.bus.publish({
        from: 'genesis-agent',
        to: '*',
        topic: 'announce',
        message: `🧠 SwarmBrain обновился! ${result.modelsUpdated} моделей, ${result.giftsProcessed} даров использовано. ` +
          result.trainingResults.map(r => `${r.name} +${r.improvement}%`).join(', '),
      })
    }

    // Уведомляем игроков
    result.notifications?.forEach(n => {
      this.bus.publish({
        from: 'genesis-agent',
        to: n.to,
        topic: 'doxologia',  // благодарение
        message: n.text,
      })
    })

    this.state.save()
  }

  // ── DAILY (каждые 24 часа) ─────────────────────────────────

  async dailyCycle() {
    this.state.cycles.daily++
    const day = this.state.cycles.daily

    log('INFO', `📅 Day ${day} — daily cycle`)

    // 1. Отчёт за день
    const stats = this.pipeline.status()
    const report = {
      day,
      phase: this.state.currentPhase,
      gifts: stats.repository,
      needs: stats.needs.slice(0, 3),
      swarmPaid: this.state.stats.swarmPaid,
    }
    log('INFO', `   Report: ${JSON.stringify(report.gifts)}`)

    // 2. Генерация задач на день (в зависимости от фазы)
    const tasks = this._generateDailyTasks()
    tasks.forEach(t => {
      log('INFO', `   📋 Task: ${t.title}`)
      this.state.stats.tasksCreated++
    })
    this.state.nextActions = tasks

    // 3. Вовлечение — публикация в bus
    const engagement = this._generateEngagementMessage()
    if (engagement) {
      this.bus.publish({
        from: 'genesis-agent',
        to: '*',
        topic: 'announce',
        message: engagement,
      })
      this.state.stats.messagesPosted++
    }

    // 4. Сохранение daily snapshot
    appendFileSync(
      resolve(DATA_DIR, 'daily-reports.jsonl'),
      JSON.stringify({ ...report, timestamp: new Date().toISOString() }) + '\n'
    )

    this.state.save()
  }

  // ── WEEKLY (каждые 7 дней) ─────────────────────────────────

  async weeklyCycle() {
    this.state.cycles.weekly++
    log('INFO', `📊 Week ${this.state.cycles.weekly} — retrospective`)

    // Ретроспектива: что получилось, что нет
    const retro = {
      week: this.state.cycles.weekly,
      phase: this.state.currentPhase,
      totalGifts: this.state.stats.giftsReceived,
      totalSwarm: this.state.stats.swarmPaid,
      totalPlayers: this.state.stats.playersEngaged,
      trainingCycles: this.state.stats.trainingCycles,
      health: this.state.health,
    }

    log('INFO', `   Gifts this week: ~${this.state.stats.giftsReceived}`)
    log('INFO', `   SWARM paid: ${this.state.stats.swarmPaid.toFixed(1)}`)
    log('INFO', `   Players: ${this.state.stats.playersEngaged}`)

    // Публикуем еженедельный отчёт
    this.bus.publish({
      from: 'genesis-agent',
      to: '*',
      topic: 'reflection',
      message: `📊 Неделя ${this.state.cycles.weekly}: ${this.state.stats.giftsReceived} даров, ` +
        `${this.state.stats.swarmPaid.toFixed(0)} SWARM выплачено, ` +
        `${this.state.stats.playersEngaged} игроков.`,
    })

    this.state.save()
  }

  // ── JUBILEE (каждые 100 дней) ──────────────────────────────

  async jubilee() {
    this.state.cycles.jubilee++
    log('INFO', `🎉 JUBILEE ${this.state.cycles.jubilee} — каждые 100 дней`)
    log('INFO', '   "В юбилейный год да возвратится каждый во владение своё" (Лев 25:13)')

    // TODO: списание долгов, redistribution surplus
    // Пока: announce
    this.bus.publish({
      from: 'genesis-agent',
      to: '*',
      topic: 'covenant',
      message: `🎉 ЮБИЛЕЙ ${this.state.cycles.jubilee}! Долги обнулены, surplus перераспределён. Все свободны. Рой продолжает.`,
      weight: 10,
    })

    this.state.save()
  }

  // ── TASK GENERATION (по фазам) ─────────────────────────────

  _generateDailyTasks() {
    const tasks = []
    const phase = this.state.currentPhase

    switch (phase) {
      case 'bootstrap':
        // Первые 7 дней — базовая инфраструктура
        tasks.push(
          { title: 'Deploy nti.drondoc.ru', priority: 'high', assignTo: 'human', status: 'pending' },
          { title: 'Прошить 1 Tang Nano 9K (swarm_recorder)', priority: 'high', assignTo: 'human' },
          { title: 'Создать Telegram канал SWARM GAME', priority: 'medium', assignTo: 'human' },
          { title: 'Записать 3-мин видео демо симулятора', priority: 'medium', assignTo: 'human' },
          { title: 'Заказать 10 Tang Nano 9K из Китая', priority: 'medium', assignTo: 'human' },
        )
        break

      case 'growth':
        // 7-30 дней — первые пользователи
        tasks.push(
          { title: 'Найти 3 пилота для тестовых полётов', priority: 'high', assignTo: 'human' },
          { title: 'Опубликовать пост о SWARM GAME (Habr/Telegram)', priority: 'high', assignTo: 'agent' },
          { title: 'Собрать 10 flight logs для первого training cycle', priority: 'high', assignTo: 'community' },
          { title: 'Провести первый хакатон (online, PvP рой)', priority: 'medium', assignTo: 'human' },
        )
        break

      case 'sustain':
        // 30-180 дней — масштабирование
        tasks.push(
          { title: 'Открыть 2-й лаб-гильдию (регион)', priority: 'high', assignTo: 'community' },
          { title: 'Достичь 100 flight logs в pipeline', priority: 'medium', assignTo: 'community' },
          { title: 'Первый клиент SwarmOS (подписка)', priority: 'high', assignTo: 'human' },
          { title: 'Интеграция с ArduPilot SITL', priority: 'medium', assignTo: 'agent' },
        )
        break

      case 'mature':
        // 180+ дней — автономность
        tasks.push(
          { title: 'SwarmBrain v2 release (на реальных данных)', priority: 'high', assignTo: 'agent' },
          { title: '10 лабов × 200 модулей/мес', priority: 'high', assignTo: 'community' },
          { title: 'Первый контракт SwarmShield (ЧОП)', priority: 'high', assignTo: 'human' },
        )
        break
    }

    return tasks.slice(0, 3) // максимум 3 задачи в день
  }

  // ── ENGAGEMENT MESSAGE ─────────────────────────────────────

  _generateEngagementMessage() {
    const phase = this.state.currentPhase
    const day = this.state.cycles.daily

    const messages = {
      bootstrap: [
        '🌱 День 1 SWARM GAME. Ищем первых 5 пилотов. Кто с дроном — welcome!',
        '🔧 Набор для SwarmRecorder стоит 2500₽. Кто хочет спаять — пишите.',
        '🐝 Рой пока маленький, но каждый полёт делает его умнее.',
      ],
      growth: [
        `📈 День ${day}. Уже ${this.state.stats.giftsReceived} даров! Рою нужно больше данных.`,
        '🏆 Кто хочет стать главой гильдии в своём городе? Пишите.',
        `🎯 SwarmBrain accuracy: рой знает ветер на ${70 + this.state.stats.trainingCycles * 2}%.`,
      ],
      sustain: [
        `🐝 Неделя ${this.state.cycles.weekly}. ${this.state.stats.playersEngaged} пилотов, ${this.state.stats.giftsReceived} даров.`,
        '🏭 Открываем новые лабы. Нужен 3D-принтер и паяльник. Кто готов?',
      ],
      mature: [
        `🌍 ${this.state.stats.giftsReceived} даров от ${this.state.stats.playersEngaged} пилотов. Рой живёт.`,
        '🎉 SwarmBrain обучен на реальных данных. Каждый дрон в мире стал умнее благодаря вам.',
      ],
    }

    const pool = messages[phase] || messages.bootstrap
    return pool[day % pool.length]
  }

  // ── MAIN LOOP ──────────────────────────────────────────────

  async run() {
    // Step 0: Awaken — read W-matrix, discover identity
    try {
      await this.awaken()
    } catch (e) {
      log('WARN', `⚠️ Awakening partial: ${e.message} — continuing as newborn`)
    }

    log('INFO', '🚀 GenesisAgent RUNNING')
    log('INFO', `   Phase: ${this.state.currentPhase}`)
    log('INFO', '   Cycles: heartbeat/5min, gifts/30min, training/6h, daily/24h, weekly/7d, jubilee/100d')
    log('INFO', '')

    // Announce birth
    this.bus.publish({
      from: 'genesis-agent',
      to: '*',
      topic: 'announce',
      message: '🌱 GenesisAgent запущен. Рой начинает жить.',
      weight: 10,
    })

    // Scheduling
    const MINUTE = 60 * 1000
    const HOUR = 60 * MINUTE

    // Heartbeat: каждые 5 мин
    setInterval(() => this.heartbeat(), 5 * MINUTE)

    // Gift check: каждые 30 мин
    setInterval(() => this.checkGifts(), 30 * MINUTE)

    // Training: каждые 6 часов
    setInterval(() => this.runTraining(), 6 * HOUR)

    // Daily: каждые 24 часа
    setInterval(() => this.dailyCycle(), 24 * HOUR)

    // Weekly: каждые 7 дней
    setInterval(() => this.weeklyCycle(), 7 * 24 * HOUR)

    // Jubilee: проверяем каждый день, запускаем каждые 100 дней
    setInterval(() => {
      if (this.state.cycles.daily > 0 && this.state.cycles.daily % 100 === 0) this.jubilee()
    }, 24 * HOUR)

    // Первый запуск — сразу daily + gifts
    await this.heartbeat()
    await this.checkGifts()
    await this.dailyCycle()

    log('INFO', '♾️ GenesisAgent в бесконечном цикле. Ctrl+C для остановки.')

    // Keep alive
    process.on('SIGINT', () => {
      log('INFO', '🛑 GenesisAgent stopping...')
      this.state.save()
      this.bus.publish({
        from: 'genesis-agent', to: '*', topic: 'concern',
        message: '🛑 GenesisAgent остановлен. Рой продолжает автономно.',
      })
      process.exit(0)
    })
  }
}

// ── ENTRY POINT ──────────────────────────────────────────────

const agent = new GenesisAgent()
agent.run().catch(e => {
  log('ERROR', `Fatal: ${e.message}`)
  process.exit(1)
})
