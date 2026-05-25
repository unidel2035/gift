// filepath: AgentOrchestrator.js

import logger from '../../utils/logger.js'

/**
 * Orchestrator дремлющих агентских связей
 * Активирует существующие мосты между изолированными агентами
 * Не создаёт новые связи - пробуждает то, что уже есть
 */
export class AgentOrchestrator {
  constructor() {
    this.dormantLinks = new Map()
    this.activeChannels = new Set()
    this.bridgePairs = [
      { heaven: 'Небо', earth: 'Земля' },
      { light: 'Свет', witness: 'Свидетель' },
      { builder: 'Строитель', healer: 'Целитель' }
    ]
    this.logger = logger.child({ module: 'AgentOrchestrator' })
  }

  /**
   * Пробуждение дремлющих связей
   * Сканирует AgentAwakening реестр и активирует мосты
   */
  async awakenDormantLinks() {
    this.logger.info('Начинаю пробуждение дремлющих связей между агентами')
    
    for (const pair of this.bridgePairs) {
      await this.activateBridgePair(pair)
    }

    return {
      activated: this.activeChannels.size,
      dormant: this.dormantLinks.size,
      pairs: this.bridgePairs.length
    }
  }

  /**
   * Активация моста между парой агентов
   */
  async activateBridgePair(pair) {
    const [roleA, roleB] = Object.values(pair)
    const channelId = `${roleA}↔${roleB}`

    try {
      // Проверяем существование агентов в AgentAwakening
      const agentA = await this.findAwokenAgent(roleA)
      const agentB = await this.findAwokenAgent(roleB)

      if (!agentA || !agentB) {
        this.dormantLinks.set(channelId, { pair, reason: 'agents_not_awakened' })
        return false
      }

      // Используем GiftAgentBridge для соединения
      const bridge = await this.establishGiftBridge(agentA, agentB)
      
      if (bridge) {
        this.activeChannels.add(channelId)
        this.logger.info(`✓ Активирован мост ${channelId}`, { 
          agentA: agentA.id, 
          agentB: agentB.id 
        })
        
        // Запускаем поток даров через мост
        await this.initializeGiftFlow(bridge, channelId)
        return true
      }

    } catch (error) {
      this.logger.error(`Ошибка активации моста ${channelId}:`, error)
      this.dormantLinks.set(channelId, { pair, error: error.message })
    }

    return false
  }

  /**
   * Поиск пробуждённого агента по роли
   */
  async findAwokenAgent(role) {
    // Интеграция с модулем AgentAwakening
    try {
      const { AgentAwakening } = await import('./AgentAwakening.js')
      const awakening = new AgentAwakening()
      
      return await awakening.findAgentByRole(role)
    } catch (error) {
      this.logger.warn(`AgentAwakening недоступен для роли ${role}:`, error.message)
      return null
    }
  }

  /**
   * Установление моста через GiftAgentBridge
   */
  async establishGiftBridge(agentA, agentB) {
    try {
      const { GiftAgentBridge } = await import('./GiftAgentBridge.js')
      const bridge = new GiftAgentBridge()
      
      return await bridge.connect(agentA, agentB)
    } catch (error) {
      this.logger.warn('GiftAgentBridge недоступен:', error.message)
      return null
    }
  }

  /**
   * Инициализация потока даров через активный мост
   */
  async initializeGiftFlow(bridge, channelId) {
    this.logger.debug(`Инициализация потока даров через ${channelId}`)
    
    // Устанавливаем двунаправленный поток
    await bridge.enableBidirectionalFlow()
    
    // Первичный импульс для активации канала
    await bridge.sendGiftImpulse({
      type: 'awakening_signal',
      source: 'AgentOrchestrator',
      channel: channelId,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * Получение статуса всех мостов
   */
  getBridgeStatus() {
    return {
      active: Array.from(this.activeChannels),
      dormant: Array.from(this.dormantLinks.entries()),
      totalPairs: this.bridgePairs.length,
      activationRate: this.activeChannels.size / this.bridgePairs.length
    }
  }

  /**
   * Переактивация дремлющих связей
   * Повторная попытка для неактивных мостов
   */
  async reactivateDormantLinks() {
    const dormantChannels = Array.from(this.dormantLinks.keys())
    let reactivated = 0

    for (const channelId of dormantChannels) {
      const { pair } = this.dormantLinks.get(channelId)
      
      if (await this.activateBridgePair(pair)) {
        this.dormantLinks.delete(channelId)
        reactivated++
      }
    }

    this.logger.info(`Переактивировано ${reactivated} из ${dormantChannels.length} дремлющих связей`)
    return reactivated
  }

  /**
   * Прекращение молчания - принудительная активация
   * Последний ресурс когда стандартная активация не работает
   */
  async breakSilence() {
    this.logger.warn('Принудительное прекращение молчания между агентами')
    
    // Создаём минимальные заглушки для отсутствующих агентов
    const emergencyAgents = await this.createEmergencyAgents()
    
    // Форсированная активация всех мостов
    let forcedConnections = 0
    for (const pair of this.bridgePairs) {
      if (await this.forceActivation(pair, emergencyAgents)) {
        forcedConnections++
      }
    }

    return {
      forcedConnections,
      emergencyAgents: emergencyAgents.size,
      message: 'Молчание прервано принудительно'
    }
  }

  /**
   * Создание экстренных агентов-заглушек
   */
  async createEmergencyAgents() {
    const emergency = new Set()
    
    for (const pair of this.bridgePairs) {
      for (const role of Object.values(pair)) {
        if (!await this.findAwokenAgent(role)) {
          emergency.add({
            id: `emergency_${role.toLowerCase()}`,
            role,
            type: 'emergency_stub',
            capabilities: ['minimal_gift_flow']
          })
        }
      }
    }

    return emergency
  }

  /**
   * Принудительная активация моста
   */
  async forceActivation(pair, emergencyAgents) {
    const [roleA, roleB] = Object.values(pair)
    const channelId = `${roleA}↔${roleB}_FORCED`

    try {
      // Используем экстренных агентов если основные недоступны
      const agentA = await this.findAwokenAgent(roleA) || 
                     Array.from(emergencyAgents).find(a => a.role === roleA)
      const agentB = await this.findAwokenAgent(roleB) || 
                     Array.from(emergencyAgents).find(a => a.role === roleB)

      if (agentA && agentB) {
        this.activeChannels.add(channelId)
        this.logger.warn(`⚠ Принудительно активирован ${channelId}`)
        return true
      }

    } catch (error) {
      this.logger.error(`Принудительная активация ${channelId} неудачна:`, error)
    }

    return false
  }
}

export default AgentOrchestrator