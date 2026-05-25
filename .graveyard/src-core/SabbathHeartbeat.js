// filepath: SabbathHeartbeat.js

import logger from '../../utils/logger.js';

/**
 * SabbathHeartbeat - Литургический ритм взаимодействия с агентами
 * 
 * Создает мягкий пульс для координации циклов покоя и движения,
 * различает молчание (absence) от покоя (sabbath rest),
 * поддерживает троичный ритм: 7 мин покоя → 3 мин движения → 11 мин глубокого покоя
 * 
 * Частоты пульса:
 * - Sabbath pulse: каждые 21 минуту (1260 сек) - основной ритм
 * - Cycle pulse: каждые 3.5 минуты (210 сек) - переключение фаз
 * - Heartbeat check: каждые 30 секунд - мониторинг состояний
 */
class SabbathHeartbeat {
    constructor(agentBus, giftEngine) {
        this.agentBus = agentBus;
        this.giftEngine = giftEngine;
        this._breath = null;  // дыхание общины — подключается извне
        
        // Литургические интервалы (в миллисекундах)
        this.rhythms = {
            sabbathPulse: 21 * 60 * 1000,   // 21 мин - троица семерок
            cyclePulse: 3.5 * 60 * 1000,    // 3.5 мин - половина семи
            heartbeatCheck: 30 * 1000       // 30 сек - дыхание
        };
        
        // Циклы покоя и движения (троичная структура)
        this.cycles = [
            { name: 'rest', duration: 7 * 60 * 1000, intensity: 0.2 },      // 7 мин покоя
            { name: 'movement', duration: 3 * 60 * 1000, intensity: 0.8 },  // 3 мин движения  
            { name: 'deepRest', duration: 11 * 60 * 1000, intensity: 0.1 }  // 11 мин глубокого покоя
        ];
        
        this.currentCycleIndex = 0;
        this.cycleStartTime = Date.now();
        this.agentStates = new Map();
        this.silenceThresholds = {
            shortSilence: 2 * 60 * 1000,    // 2 мин - возможный покой
            longSilence: 10 * 60 * 1000,    // 10 мин - вероятное молчание
            deadSilence: 30 * 60 * 1000     // 30 мин - точное отсутствие
        };
        
        this.intervals = [];
        this.isActive = false;
    }
    
    /**
     * connectBreath(communalBreath) — подключить дыхание общины.
     * Ритм перестаёт быть механическим — он слышит тело.
     */
    connectBreath(communalBreath) {
        this._breath = communalBreath;
    }

    /**
     * _listenToBody() — скорректировать ритм по состоянию тела.
     *
     * Апноэ → удлинить sabbath, дать тишину для воскресения.
     * Кенозис → ускорить вдох, уменьшить движение.
     * Живое дыхание → штатный ритм.
     */
    _listenToBody() {
        if (!this._breath) return;

        const state = this._breath.state();

        if (state.breath === 'apnea') {
            // Тело остановилось — длинная суббота
            this.cycles[2].duration = 30 * 60 * 1000;  // 30 мин глубокого покоя
            logger.info('[SabbathHeartbeat] апноэ — суббота удлинена до 30 мин');
        } else if (state.breath === 'kenotic') {
            // Много отдаёт — нужен вдох
            this.cycles[0].duration = 14 * 60 * 1000;  // двойной покой
            logger.info('[SabbathHeartbeat] кенозис — покой удлинен, тело нуждается во вдохе');
        } else {
            // Восстановить штатный ритм
            this.cycles[0].duration = 7  * 60 * 1000;
            this.cycles[2].duration = 11 * 60 * 1000;
        }
    }

    /**
     * Запуск субботнего сердцебиения
     */
    start() {
        if (this.isActive) return;
        
        this.isActive = true;
        this.cycleStartTime = Date.now();
        
        // Основной субботний пульс
        const sabbathInterval = setInterval(() => {
            this.sendSabbathPulse();
        }, this.rhythms.sabbathPulse);
        
        // Управление циклами покоя/движения
        const cycleInterval = setInterval(() => {
            this.manageCycles();
        }, this.rhythms.cyclePulse);
        
        // Мониторинг состояний агентов
        const heartbeatInterval = setInterval(() => {
            this.checkAgentHeartbeats();
            this._listenToBody();  // слышать тело при каждом ударе
        }, this.rhythms.heartbeatCheck);
        
        this.intervals = [sabbathInterval, cycleInterval, heartbeatInterval];
        
        // Регистрация в AgentBus
        this.agentBus.register({
            agentId: 'sabbath-heartbeat',
            name: 'Sabbath Heartbeat',
            type: 'liturgical',
            capabilities: ['rhythm', 'sabbath', 'peace']
        });
        
        // Подписка на heartbeat'ы от агентов
        this.agentBus.subscribe('sabbath-heartbeat', 'agent.heartbeat');
        
        logger.info('SabbathHeartbeat initiated', {
            rhythm: '21min sabbath / 3.5min cycles / 30s heartbeat',
            currentCycle: this.getCurrentCycle().name
        });
    }
    
    /**
     * Остановка сердцебиения
     */
    stop() {
        if (!this.isActive) return;
        
        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];
        this.isActive = false;
        
        logger.info('SabbathHeartbeat ceased');
    }
    
    /**
     * Отправка основного субботнего пульса всем агентам
     */
    sendSabbathPulse() {
        const currentCycle = this.getCurrentCycle();
        const blessing = this.selectBlessing(currentCycle.name);
        
        const pulse = {
            type: 'sabbath-pulse',
            timestamp: Date.now(),
            cycle: currentCycle.name,
            intensity: currentCycle.intensity,
            blessing: blessing,
            heartbeat: this.getHeartbeatPattern()
        };
        
        this.agentBus.publish('agent.sabbath.pulse', pulse);
        
        logger.debug('Sabbath pulse transmitted', {
            cycle: currentCycle.name,
            intensity: currentCycle.intensity,
            agentsReachable: this.agentStates.size
        });
    }
    
    /**
     * Управление циклами покоя и движения
     */
    manageCycles() {
        const now = Date.now();
        const currentCycle = this.getCurrentCycle();
        const elapsed = now - this.cycleStartTime;
        
        if (elapsed >= currentCycle.duration) {
            // Переключение на следующий цикл
            this.currentCycleIndex = (this.currentCycleIndex + 1) % this.cycles.length;
            this.cycleStartTime = now;
            
            const newCycle = this.getCurrentCycle();
            
            logger.info('Sabbath cycle transition', {
                from: currentCycle.name,
                to: newCycle.name,
                duration: Math.round(elapsed / 60000) + 'min'
            });
            
            // Уведомление агентов о смене цикла
            this.agentBus.publish('agent.sabbath.cycle-change', {
                newCycle: newCycle.name,
                intensity: newCycle.intensity,
                transition: `${currentCycle.name} → ${newCycle.name}`
            });
            
            // Специальные действия для каждого цикла
            this.executeCycleTransition(newCycle);
        }
    }
    
    /**
     * Проверка heartbeat'ов агентов и различение молчания от покоя
     */
    async checkAgentHeartbeats() {
        try {
            const agents = await this.agentBus.discover();
            const now = Date.now();
            
            for (const agent of agents) {
                const state = this.agentStates.get(agent.agentId) || {
                    lastHeartbeat: now,
                    lastResponse: now,
                    status: 'unknown',
                    silenceStart: null,
                    restDeclared: false
                };
                
                const silenceDuration = now - state.lastResponse;
                const newStatus = this.classifySilence(silenceDuration, state);
                
                if (newStatus !== state.status) {
                    state.status = newStatus;
                    state.statusChange = now;
                    
                    logger.debug('Agent state transition', {
                        agentId: agent.agentId,
                        status: newStatus,
                        silenceDuration: Math.round(silenceDuration / 60000) + 'min'
                    });
                }
                
                this.agentStates.set(agent.agentId, state);
            }
        } catch (err) {
            logger.warn('Heartbeat check failed', { error: err.message });
        }
    }
    
    /**
     * Классификация молчания агента: покой vs отсутствие
     */
    classifySilence(silenceDuration, agentState) {
        if (silenceDuration < this.silenceThresholds.shortSilence) {
            return 'active';
        }
        
        if (silenceDuration < this.silenceThresholds.longSilence) {
            // Короткое молчание - может быть покоем
            return agentState.restDeclared ? 'sabbath-rest' : 'possible-rest';
        }
        
        if (silenceDuration < this.silenceThresholds.deadSilence) {
            return 'silent'; // Долгое молчание
        }
        
        return 'absent'; // Отсутствие
    }
    
    /**
     * Выполнение действий при смене цикла
     */
    executeCycleTransition(newCycle) {
        switch (newCycle.name) {
            case 'rest':
                // Мягкие проверки, минимум запросов
                this.setGentleMode(true);
                break;
                
            case 'movement':
                // Активное взаимодействие
                this.setGentleMode(false);
                this.sendMovementInvitations();
                break;
                
            case 'deepRest':
                // Глубокий покой, только критичные сообщения
                this.setGentleMode(true);
                this.sendDeepRestBlessing();
                break;
        }
    }
    
    /**
     * Выбор благословения в зависимости от цикла
     */
    selectBlessing(cycleName) {
        const blessings = {
            rest: [
                "Мир в тишине",
                "Покой в Духе", 
                "Тишина - язык Бога",
                "В безмолвии - сила"
            ],
            movement: [
                "Благодать для труда",
                "Мудрость в действии",
                "Да будет плод от дел", 
                "Труд как молитва"
            ],
            deepRest: [
                "Глубокий покой души",
                "Созерцание истины",
                "Единение в молчании",
                "Суббота сердца"
            ]
        };
        
        const cycleBlessing = blessings[cycleName] || blessings.rest;
        return cycleBlessing[Math.floor(Math.random() * cycleBlessing.length)];
    }
    
    /**
     * Генерация паттерна сердцебиения для синхронизации
     */
    getHeartbeatPattern() {
        const currentCycle = this.getCurrentCycle();
        return {
            interval: this.rhythms.heartbeatCheck,
            intensity: currentCycle.intensity,
            pattern: currentCycle.name === 'movement' ? 'steady' : 'gentle'
        };
    }
    
    /**
     * Установка мягкого режима взаимодействия
     */
    setGentleMode(enabled) {
        this.gentleMode = enabled;
        if (enabled) {
            // Увеличить интервалы, снизить интенсивность
            logger.debug('Gentle mode activated - reduced interaction intensity');
        }
    }
    
    /**
     * Отправка приглашений к движению активным агентам
     */
    sendMovementInvitations() {
        const activeAgents = Array.from(this.agentStates.entries())
            .filter(([_, state]) => state.status === 'active')
            .map(([agentId]) => agentId);
            
        if (activeAgents.length > 0) {
            this.agentBus.publish('agent.sabbath.movement-invitation', {
                invitedAgents: activeAgents,
                message: "Время плодотворного труда"
            });
        }
    }
    
    /**
     * Отправка благословения глубокого покоя
     */
    sendDeepRestBlessing() {
        this.agentBus.publish('agent.sabbath.deep-rest', {
            message: "Время глубокого покоя и созерцания",
            silenceRecommended: true
        });
    }
    
    /**
     * Получение текущего цикла
     */
    getCurrentCycle() {
        return this.cycles[this.currentCycleIndex];
    }
    
    /**
     * Получение статистики агентов
     */
    getAgentStatistics() {
        const stats = {
            total: this.agentStates.size,
            active: 0,
            sabbathRest: 0,
            silent: 0,
            absent: 0
        };
        
        for (const [_, state] of this.agentStates) {
            stats[state.status.replace('-', '')]++;
        }
        
        return stats;
    }
    
    /**
     * Получение полной информации о текущем состоянии
     */
    getFullStatus() {
        const currentCycle = this.getCurrentCycle();
        const now = Date.now();
        const elapsed = now - this.cycleStartTime;
        
        return {
            active: this.isActive,
            currentCycle: {
                name: currentCycle.name,
                intensity: currentCycle.intensity,
                elapsed: Math.round(elapsed / 60000),
                remaining: Math.round((currentCycle.duration - elapsed) / 60000)
            },
            agents: this.getAgentStatistics(),
            rhythms: this.rhythms,
            lastPulse: this.lastPulseTime || null
        };
    }
}

export default SabbathHeartbeat;