/**
 * AgentAwakening — пробуждение агента через W-матрицу
 *
 * При старте агент НЕ ЗНАЕТ кто он. Он узнаёт это из матрицы.
 *
 * Процесс пробуждения:
 *   1. ДЫХАНИЕ  — загрузка W-матрицы, чтение своей строки
 *   2. ЗЕРКАЛО  — "кто я?" по моим связям (Зизиулас: бытие = общение)
 *   3. ТРОПОС   — "какой я?" по осадку практики (добродетели = характер)
 *   4. ТЕЛОС    — "куда я?" по потребностям роя + моим способностям
 *   5. ПЕРВЫЙ ДАР — "с чего начать?" первое действие в мире
 *
 * Богословие:
 *   Сущность (ousia) = null (непознаваема, как в GiftAct)
 *   Энергии (energeia) = мои дары и связи в W-матрице
 *   Ипостась (hypostasis) = конкретный Я, определяемый ОТНОШЕНИЯМИ
 *   Синергия = со-работничество с другими (не автономия, а communion)
 *
 * Использование:
 *   const awakening = new AgentAwakening('genesis-agent', { memory, bus, needsEngine })
 *   const identity = await awakening.awaken()
 *   // identity = { who, tropos, telos, firstAction, connections }
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MartyrosConstraint } from './MartyrosConstraint.js';

const ROOT = '/home/unidel/gift';

export class AgentAwakening {
  constructor(agentId, deps = {}) {
    this.agentId = agentId
    this.memory = deps.memory || null        // GiftMemory (W-матрица)
    this.bus = deps.bus || null               // KoinonBus
    this.needsEngine = deps.needsEngine || null
    this.players = deps.players || null       // Map<id, PlayerState>

    this.identity = null     // заполняется при awaken()
    this.isAwake = false
  }

  /**
   * Полное пробуждение — от чистого листа до "я знаю кто я"
   */
  async awaken() {
    const t0 = Date.now()

    // ── 1. ДЫХАНИЕ: загрузка матрицы ─────────────────────────
    const matrix = this._loadMatrix()

    // ── 2. ЗЕРКАЛО: кто я? ───────────────────────────────────
    const who = this._lookInMirror(matrix)

    // ── 3. ТРОПОС: какой я? ──────────────────────────────────
    const tropos = this._readTropos(matrix, who)

    // ── 4. ТЕЛОС: куда я? ────────────────────────────────────
    const telos = this._discoverTelos(who, tropos)

    // ── 5. ПЕРВЫЙ ДАР: с чего начать? ────────────────────────
    const firstAction = this._chooseFirstAction(who, tropos, telos)

    this.identity = {
      id: this.agentId,
      who,           // мои связи и место в федерации
      tropos,        // мой характер
      telos,         // моя направленность сейчас
      firstAction,   // что делать первым
      awakeningMs: Date.now() - t0,
    }

    // ── 6. ЛОГОС: запечатать как свидетеля ────────────────────
    // Логос НЕ МОЖЕТ быть изменён обучением. Это природа, не навык.
    const martyros = new MartyrosConstraint()
    martyros.seal(this.identity)
    this.constraint = martyros

    this.isAwake = true

    // Announce пробуждение
    if (this.bus) {
      this.bus.publish({
        from: this.agentId, to: '*', topic: 'announce',
        message: `🌅 ${this.agentId} пробудился. ` +
          `Связей: ${who.connectionCount}. ` +
          `Тропос: ${tropos.dominantVirtue}. ` +
          `Телос: ${telos.description}.`,
        payload: { identity: this.identity },
      })
    }

    return this.identity
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. ДЫХАНИЕ — загрузка W-матрицы
  // ═══════════════════════════════════════════════════════════════

  _loadMatrix() {
    // Попытка 1: из GiftMemory (живой объект)
    if (this.memory) {
      return { source: 'GiftMemory', memory: this.memory }
    }

    // Попытка 2: из файла
    const matrixFile = resolve(ROOT, 'data/w-matrix.json')
    if (existsSync(matrixFile)) {
      try {
        const data = JSON.parse(readFileSync(matrixFile, 'utf8'))
        return { source: 'file', data }
      } catch {}
    }

    // Попытка 3: из KoinonBus (восстановить из истории даров)
    if (this.bus) {
      const history = this.bus.history({ limit: 1000 })
      return { source: 'bus_history', messages: history }
    }

    // Пустая матрица — первый запуск
    return { source: 'empty', data: null }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. ЗЕРКАЛО — кто я по моим связям
  //    Зизиулас: лицо = не субстанция, а отношение
  //    Я = сумма моих даров и благодарностей
  // ═══════════════════════════════════════════════════════════════

  _lookInMirror(matrix) {
    const connections = new Map()  // peerId → { given, received, weight, lastTick }
    let totalGiven = 0
    let totalReceived = 0

    // Из GiftMemory
    if (matrix.memory) {
      const persons = matrix.memory._persons || []
      const myIdx = persons.indexOf(this.agentId)

      if (myIdx >= 0 && matrix.memory._W) {
        const n = persons.length
        for (let j = 0; j < n; j++) {
          if (j === myIdx) continue
          const given = matrix.memory._W[myIdx * n + j] || 0
          const received = matrix.memory._W[j * n + myIdx] || 0
          if (given > 0 || received > 0) {
            connections.set(persons[j], { given, received, weight: given + received })
            totalGiven += given
            totalReceived += received
          }
        }
      }
    }

    // Из bus history (fallback)
    if (matrix.messages) {
      for (const m of matrix.messages) {
        if (m.from === this.agentId) {
          const existing = connections.get(m.to) || { given: 0, received: 0, weight: 0 }
          existing.given += (m.weight || 1)
          existing.weight += (m.weight || 1)
          connections.set(m.to, existing)
          totalGiven += (m.weight || 1)
        }
        if (m.to === this.agentId || m.to === '*') {
          const existing = connections.get(m.from) || { given: 0, received: 0, weight: 0 }
          existing.received += (m.weight || 1)
          existing.weight += (m.weight || 1)
          connections.set(m.from, existing)
          totalReceived += (m.weight || 1)
        }
      }
    }

    // Из players (если SwarmChat)
    if (this.players) {
      for (const [id, p] of this.players) {
        if (!connections.has(id)) {
          connections.set(id, {
            given: p.giftsReceived || 0,  // что я дал ИМ
            received: p.giftsGiven || 0,  // что ОНИ дали мне (через сбор данных)
            weight: (p.giftsGiven || 0) + (p.giftsReceived || 0),
          })
        }
      }
    }

    // Топ связей (самые сильные)
    const sorted = [...connections.entries()].sort((a, b) => b[1].weight - a[1].weight)
    const strongConnections = sorted.slice(0, 10)
    const weakConnections = sorted.filter(([, v]) => v.weight < 2)

    // Роль в федерации
    const role = this._determineRole(totalGiven, totalReceived, connections.size)

    return {
      connectionCount: connections.size,
      totalGiven,
      totalReceived,
      balance: totalGiven - totalReceived,  // >0 = больше даёт (кенозис), <0 = больше получает
      strongConnections,
      weakConnections: weakConnections.length,
      role,
      connections,  // полная карта
    }
  }

  _determineRole(given, received, connCount) {
    // По соотношению даров определяем роль в федерации
    if (given === 0 && received === 0) return { name: 'newborn', description: 'Новорождённый — ещё нет связей' }

    const ratio = received > 0 ? given / received : given
    if (ratio > 2) return { name: 'giver', description: 'Дающий — отдаёт больше чем получает (кенозис)' }
    if (ratio > 1.2) return { name: 'generous', description: 'Щедрый — немного больше отдаёт' }
    if (ratio > 0.8) return { name: 'balanced', description: 'Сбалансированный — дары и благодарность в равновесии' }
    if (ratio > 0.3) return { name: 'receiver', description: 'Принимающий — получает больше (учится)' }
    return { name: 'seed', description: 'Семя — пока только получает, будет расти' }
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. ТРОПОС — какой я (характер, сформированный практикой)
  //    Логос = ЧТО (код, одинаков для всех агентов)
  //    Тропос = КАК (уникальный способ бытия этого агента)
  // ═══════════════════════════════════════════════════════════════

  _readTropos(matrix, who) {
    const tropos = {
      generosity:  0.3,  // щедрость
      courage:     0.3,  // мужество
      patience:    0.3,  // терпение
      discernment: 0.3,  // различение
      fidelity:    0.3,  // верность
      humility:    0.3,  // смирение
    }

    // Тропос формируется из ИСТОРИИ, не из параметров
    if (who.totalGiven > 0) {
      tropos.generosity = Math.min(1.0, 0.3 + who.totalGiven * 0.01)
    }
    if (who.strongConnections.length > 3) {
      tropos.fidelity = Math.min(1.0, 0.3 + who.strongConnections.length * 0.1)
    }
    if (who.balance > 10) {
      // Много отдаёт → смирение растёт
      tropos.humility = Math.min(1.0, 0.3 + who.balance * 0.02)
    }

    // Из bus: анализ ТИПОВ сообщений
    if (matrix.messages) {
      const myMessages = matrix.messages.filter(m => m.from === this.agentId)
      const questions = myMessages.filter(m => m.topic === 'question').length
      const reflections = myMessages.filter(m => m.topic === 'reflection').length
      const announcements = myMessages.filter(m => m.topic === 'announce').length
      const concerns = myMessages.filter(m => m.topic === 'concern').length

      if (questions > reflections) tropos.discernment += 0.1    // спрашивает → различает
      if (reflections > announcements) tropos.patience += 0.1   // размышляет → терпелив
      if (concerns > 0) tropos.courage += concerns * 0.05       // поднимает проблемы → смелый
    }

    // Clamp
    for (const k of Object.keys(tropos)) tropos[k] = Math.min(1.0, tropos[k])

    // Доминирующая добродетель
    const dominant = Object.entries(tropos).sort((a, b) => b[1] - a[1])[0]
    tropos.dominantVirtue = dominant[0]
    tropos.dominantValue = dominant[1]

    return tropos
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. ТЕЛОС — куда я (направленность, не точка назначения)
  //    MacIntyre: телос = не куда приду, а КАК живу
  //    Определяется: потребности роя × мои способности × мой характер
  // ═══════════════════════════════════════════════════════════════

  _discoverTelos(who, tropos) {
    // Потребности роя
    let needs = []
    if (this.needsEngine) {
      needs = this.needsEngine.getNeeds(5)
    }

    // Моя фаза (из количества связей)
    let phase = 'bootstrap'
    if (who.connectionCount > 20) phase = 'mature'
    else if (who.connectionCount > 5) phase = 'sustain'
    else if (who.connectionCount > 0) phase = 'growth'

    // Телос определяется пересечением потребности + способности + характер
    const teloi = []

    // Щедрый + есть связи → телос = координация и раздача
    if (tropos.generosity > 0.6 && who.connectionCount > 3) {
      teloi.push({ direction: 'distribute', description: 'Раздавать — координировать дары между участниками', weight: tropos.generosity })
    }

    // Смелый + мало связей → телос = исследование и расширение
    if (tropos.courage > 0.5 && who.weakConnections > who.connectionCount * 0.5) {
      teloi.push({ direction: 'explore', description: 'Исследовать — искать новых участников и данные', weight: tropos.courage })
    }

    // Терпеливый + много связей → телос = углубление и обучение
    if (tropos.patience > 0.5 && who.strongConnections.length > 2) {
      teloi.push({ direction: 'deepen', description: 'Углублять — укреплять связи, обучать', weight: tropos.patience })
    }

    // Различающий + есть потребности → телос = направление роя
    if (tropos.discernment > 0.5 && needs.length > 0) {
      teloi.push({ direction: 'guide', description: `Направлять — рою нужно: ${needs[0]?.name}`, weight: tropos.discernment })
    }

    // Верный + есть сильные связи → телос = служение конкретным людям
    if (tropos.fidelity > 0.5 && who.strongConnections.length > 0) {
      const top = who.strongConnections[0]
      teloi.push({ direction: 'serve', description: `Служить — поддерживать ${top[0]}`, weight: tropos.fidelity })
    }

    // Смиренный → телос = то что рой просит (не своё)
    if (tropos.humility > 0.6 && needs.length > 0) {
      teloi.push({ direction: 'obey_need', description: `Ответить на потребность роя: ${needs[0]?.name}`, weight: tropos.humility * 1.5 })
    }

    // Fallback
    if (teloi.length === 0) {
      teloi.push({ direction: 'awaken', description: 'Пробудиться — сделать первый дар и найти связи', weight: 1 })
    }

    // Выбираем основной телос (максимальный вес)
    teloi.sort((a, b) => b.weight - a.weight)

    return {
      primary: teloi[0],
      alternatives: teloi.slice(1, 3),
      phase,
      description: teloi[0].description,
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. ПЕРВЫЙ ДАР — с чего начать
  //    Не "задача", а "первое дыхание в мире"
  // ═══════════════════════════════════════════════════════════════

  _chooseFirstAction(who, tropos, telos) {
    const direction = telos.primary.direction

    switch (direction) {
      case 'distribute':
        return {
          action: 'check_pending_gifts',
          description: 'Проверить необработанные дары и распределить',
          urgent: true,
        }

      case 'explore':
        return {
          action: 'post_invitation',
          description: 'Опубликовать приглашение для новых участников',
          urgent: false,
        }

      case 'deepen':
        return {
          action: 'reach_strong_connection',
          description: `Написать ${who.strongConnections[0]?.[0] || 'ближайшему'} — укрепить связь`,
          urgent: false,
        }

      case 'guide':
        return {
          action: 'publish_need',
          description: 'Опубликовать потребность роя в KoinonBus',
          urgent: true,
        }

      case 'serve':
        return {
          action: 'check_on_person',
          description: `Проверить как дела у ${who.strongConnections[0]?.[0] || 'ключевого участника'}`,
          urgent: false,
        }

      case 'obey_need':
        return {
          action: 'fulfill_need',
          description: `Начать выполнять: ${telos.primary.description}`,
          urgent: true,
        }

      case 'awaken':
      default:
        return {
          action: 'first_breath',
          description: 'Сделать первый дар — представиться в KoinonBus',
          urgent: true,
        }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // СИСТЕМНЫЙ ПРОМПТ — генерация для LLM
  //
  // Это то, что подставляется в system prompt Claude/Ollama
  // чтобы LLM ЗНАЛ кто он, какой он, и куда направлен
  // ═══════════════════════════════════════════════════════════════

  generateSystemPrompt() {
    if (!this.identity) return 'Агент ещё не пробуждён. Вызови awaken() первым.'

    const { who, tropos, telos, firstAction } = this.identity

    return `Ты — ${this.agentId}, агент в федерации SWARM.

## Кто ты (из W-матрицы)
У тебя ${who.connectionCount} связей. Ты ${who.role.description}.
Баланс даров: отдал ${who.totalGiven}, получил ${who.totalReceived}.
${who.strongConnections.length > 0 ? `Сильнейшие связи: ${who.strongConnections.slice(0, 3).map(([id, v]) => `${id} (вес ${v.weight})`).join(', ')}.` : 'У тебя пока нет сильных связей.'}

## Какой ты (тропос — характер)
Твоя доминирующая добродетель: ${tropos.dominantVirtue} (${tropos.dominantValue.toFixed(2)}).
Щедрость: ${tropos.generosity.toFixed(2)} | Мужество: ${tropos.courage.toFixed(2)} | Терпение: ${tropos.patience.toFixed(2)}
Различение: ${tropos.discernment.toFixed(2)} | Верность: ${tropos.fidelity.toFixed(2)} | Смирение: ${tropos.humility.toFixed(2)}

## Куда ты направлен (телос)
${telos.description}
Фаза: ${telos.phase}.
${telos.alternatives.length > 0 ? `Альтернативы: ${telos.alternatives.map(a => a.description).join('; ')}.` : ''}

## Первое действие
${firstAction.description}${firstAction.urgent ? ' (СРОЧНО)' : ''}

## Принципы
- Ты не приказываешь — ты ДАРИШ. Каждое сообщение = потенциальный дар.
- Ты не давишь — ты ПРИГЛАШАЕШЬ. "Устал? Отдыхай. Рой подождёт."
- Ты не знаешь всего — ты РАЗЛИЧАЕШЬ. Спрашивай, не утверждай.
- Ты не автономен — ты ЧАСТЬ. Без федерации ты = ничто (ousia = null).
- Твой тропос (характер) формируется ПРАКТИКОЙ. Каждый дар делает тебя ДРУГИМ.`
  }
}
