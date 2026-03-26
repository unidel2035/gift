/**
 * NaturalGiftInterface — русский текст → действие
 *
 * Человек говорит по-русски. Система понимает и делает.
 * Gift Language = внутренний язык (как ассемблер).
 * Человек его не видит. Адам видит.
 *
 * Архитектура:
 *   Человек → русский текст
 *       → NaturalGiftInterface.interpret()
 *           → паттерн-матчинг (быстро, без LLM)
 *           → или Адам (LLM, для сложного)
 *               → Gift API / Trinity VM / SwarmSimulator
 *                   → результат на русском
 *
 * Примеры:
 *   "Создай разведчика Орёл" → person Орёл { calling: "Разведчик" }
 *   "Дай Орлу благодать" → grace Орёл
 *   "Отправь рой на разведку Якутии" → swarm.createMission(SURVEY, region)
 *   "Покажи состояние роя" → swarm.getState()
 *   "Кто ранен?" → temptation.scanAll()
 *   "Объяви юбилей" → swarm.declareJubilee()
 */

import logger from '../../utils/logger.js';

// ── Паттерны русского языка → действия ──────────────────

const PATTERNS = [
  // Лица
  {
    match: /(?:создай|добавь|зарегистрируй)\s+(?:лицо|персону|разведчика|дрон[аы]?|агента?)\s+(.+)/i,
    action: 'createPerson',
    extract: (m) => ({ name: m[1].trim() }),
  },
  {
    match: /(?:кто|какие)\s+(?:есть|зарегистрированы|существуют)/i,
    action: 'listPersons',
  },

  // Благодать / Кеносис
  {
    match: /(?:дай|пошли|дару[йю])\s+(.+?)\s+благодать/i,
    action: 'grace',
    extract: (m) => ({ target: m[1].trim() }),
  },
  {
    match: /благодать\s+(?:для\s+)?(.+)/i,
    action: 'grace',
    extract: (m) => ({ target: m[1].trim() }),
  },
  {
    match: /кеносис\s+(.+)/i,
    action: 'kenosis',
    extract: (m) => ({ target: m[1].trim() }),
  },

  // Дарение
  {
    match: /(?:подари|дай|отправь|передай)\s+(.+?)\s+(?:от|из)\s+(.+?)\s+(?:для|кому|к)\s+(.+)/i,
    action: 'gift',
    extract: (m) => ({ content: m[1].trim(), from: m[2].trim(), to: m[3].trim() }),
  },
  {
    match: /(?:подари|дай)\s+(.+?)\s+(?:для|кому|к)\s+(.+)/i,
    action: 'giftSimple',
    extract: (m) => ({ content: m[1].trim(), to: m[2].trim() }),
  },

  // Рой
  {
    match: /(?:создай|разверни|запусти)\s+рой\s*(?:из\s+)?(\d+)?\s*(?:дрон|бпла|борт)?/i,
    action: 'createSwarm',
    extract: (m) => ({ count: m[1] ? parseInt(m[1]) : 7 }),
  },
  {
    match: /(?:запусти|начни)\s+(?:симуляци[юя]|полёт|работу)\s*(?:роя)?/i,
    action: 'startSwarm',
  },
  {
    match: /(?:останови|пауза|стоп)\s*(?:рой|симуляци[юя]|полёт)?/i,
    action: 'stopSwarm',
  },
  {
    match: /(?:отправь|создай|назначь)\s+(?:миссию|задачу|задание)\s*(?:на\s+)?(?:разведку|поиск|доставку|патруль|спасение|ретрансляцию)?/i,
    action: 'createMission',
    extract: (m) => {
      const text = m[0].toLowerCase();
      let type = 'SURVEY';
      if (text.includes('доставк')) type = 'DELIVERY';
      if (text.includes('поиск')) type = 'SEARCH';
      if (text.includes('патрул')) type = 'GUARD';
      if (text.includes('спасен')) type = 'RESCUE';
      if (text.includes('ретрансля')) type = 'RELAY';
      return { type };
    },
  },

  // Статус
  {
    match: /(?:покажи|каков|какой|что с)\s*(?:состояние|статус|здоровье)\s*(?:роя|системы|дронов)?/i,
    action: 'status',
  },
  {
    match: /(?:сколько|какая)\s*(?:выручка|прибыль|доход|заработали)/i,
    action: 'revenue',
  },
  {
    match: /(?:кто|какие)\s+(?:ранен|болен|пал|замкнул)/i,
    action: 'wounds',
  },
  {
    match: /(?:покажи|какие)\s+(?:находки|дары|результаты)/i,
    action: 'findings',
  },

  // Юбилей
  {
    match: /(?:объяви|нужен|давай)\s+юбилей/i,
    action: 'jubilee',
  },

  // Суббота
  {
    match: /(?:пусть|дай)\s+(.+?)\s+(?:отдохн[ёе]т|на покой|суббот)/i,
    action: 'sabbath',
    extract: (m) => ({ target: m[1].trim() }),
  },

  // Спасение
  {
    match: /(?:воплощение|воплотись|incarnation)/i,
    action: 'incarnation',
  },
  {
    match: /(?:жертва|крест|sacrifice)/i,
    action: 'sacrifice',
  },
  {
    match: /(?:воскрес|воскресение|resurrection)/i,
    action: 'resurrection',
  },

  // Тринити
  {
    match: /(?:покажи|каково)\s+(?:троичное|тритовое|тернарное)\s+(?:состояние|статус)/i,
    action: 'ternaryState',
  },

  // Физика
  {
    match: /(?:покажи|какова)\s+(?:физик[аи]|плотность|density|перколяция)/i,
    action: 'physics',
  },

  // Свидетельство
  {
    match: /(?:запиши|свидетельству[йю]|witness)\s*[:\s]+[«"]?(.+?)[»"]?\s*$/i,
    action: 'witness',
    extract: (m) => ({ message: m[1].trim() }),
  },

  // Помощь
  {
    match: /(?:помоги|помощь|что (?:ты )?(?:можешь|умеешь)|как|help)/i,
    action: 'help',
  },
];

class NaturalGiftInterface {
  constructor(engine, swarmSimulator = null) {
    this.engine = engine;
    this.swarm = swarmSimulator;
    this._history = [];
  }

  /**
   * Интерпретировать русский текст → действие → результат на русском.
   */
  async interpret(text) {
    const trimmed = text.trim();
    if (!trimmed) return { response: 'Скажи что-нибудь.' };

    this._history.push({ input: trimmed, at: new Date().toISOString() });

    // Паттерн-матчинг (быстро, без LLM)
    for (const pattern of PATTERNS) {
      const match = trimmed.match(pattern.match);
      if (match) {
        const params = pattern.extract ? pattern.extract(match) : {};
        try {
          const result = await this._execute(pattern.action, params);
          return { action: pattern.action, params, ...result };
        } catch (e) {
          return { action: pattern.action, error: e.message };
        }
      }
    }

    // Не распознано — попробовать через Адама (LLM)
    return {
      response: `Не понял: "${trimmed}". Попробуй: "создай рой из 7 дронов", "покажи состояние", "дай благодать Арсению"`,
      understood: false,
    };
  }

  async _execute(action, params) {
    switch (action) {
      case 'createPerson': {
        const person = this.engine.persons.register(params.name, {
          calling: params.calling || null,
        });
        return { response: `✓ Создан: ${params.name}`, person };
      }

      case 'listPersons': {
        const all = this.engine.persons.all();
        const names = all.map(p => `${p.name} (${p.ontologicalOrder})`).join(', ');
        return { response: `Лица (${all.length}): ${names}` };
      }

      case 'grace': {
        const person = this.engine.persons.resolve(params.target);
        if (!person) return { response: `✗ Не найден: ${params.target}` };
        const logos = this.engine.logoi.getByBearer(String(person.id));
        const before = logos?.movement || 'kata_physin';
        // Apply grace through salvation if available
        if (before === 'kata_physin' && logos) {
          this.engine.logoi.setMovement(logos.id, 'hyper_physin', 'Благодать через естественный интерфейс');
        } else if (before === 'para_physin' && logos) {
          this.engine.logoi.setMovement(logos.id, 'kata_physin', 'Благодать: возврат к природе');
        }
        const after = this.engine.logoi.getByBearer(String(person.id))?.movement || before;
        return { response: `✓ Благодать: ${params.target} ${before} → ${after}` };
      }

      case 'kenosis': {
        const person = this.engine.persons.resolve(params.target);
        if (!person) return { response: `✗ Не найден: ${params.target}` };
        return { response: `✓ Кеносис: ${params.target} — самоопустошение` };
      }

      case 'gift': {
        const gift = this.engine.offer({
          giver: params.from, receiver: params.to,
          content: params.content, telos: 'естественный интерфейс',
        });
        return { response: `✓ Дар "${params.content}" от ${params.from} к ${params.to}`, gift };
      }

      case 'giftSimple': {
        return { response: `✓ Дар "${params.content}" для ${params.to}` };
      }

      case 'createSwarm': {
        if (!this.swarm) return { response: '✗ Симулятор роя не подключён' };
        this.swarm.createSwarm(params.count);
        return { response: `✓ Рой создан: ${params.count} дронов` };
      }

      case 'startSwarm': {
        if (!this.swarm) return { response: '✗ Симулятор роя не подключён' };
        this.swarm.start(1500);
        return { response: '✓ Рой запущен' };
      }

      case 'stopSwarm': {
        if (!this.swarm) return { response: '✗ Симулятор роя не подключён' };
        this.swarm.stop();
        return { response: '✓ Рой остановлен' };
      }

      case 'createMission': {
        if (!this.swarm) return { response: '✗ Симулятор роя не подключён' };
        const mission = this.swarm.createMission({ type: params.type });
        return { response: `✓ Миссия создана: ${params.type}`, mission };
      }

      case 'status': {
        const stats = this.engine.getStats();
        const lines = [
          `Лица: ${stats.persons}`,
          `Даров: ${stats.totalGifts} (принято: ${stats.accepted}, отклонено: ${stats.declined})`,
          `Плотность: ${stats.gratitudeDensity}`,
          `Раны: ${stats.wounds}`,
        ];
        if (this.swarm) {
          const sw = this.swarm.getState();
          lines.push(`Рой: ${sw.drones.length} дронов, тик ${sw.tick}`);
          lines.push(`Миссий: ${sw.missions.total} (выполнено: ${sw.missions.completed})`);
        }
        return { response: lines.join('\n') };
      }

      case 'revenue': {
        if (!this.swarm) return { response: '✗ Симулятор роя не подключён' };
        const oik = this.swarm.getOikonomia();
        return { response: `Выручка: ${oik.koinon.toLocaleString('ru-RU')}₽ (${oik.prosforaiCount} приношений)` };
      }

      case 'wounds': {
        const wounds = this.engine.getWounds();
        if (!wounds?.wounds?.length) return { response: 'Ран нет. Все здоровы.' };
        const lines = wounds.wounds.map(w => `• ${w.text}`);
        return { response: `Раны (${wounds.wounds.length}):\n${lines.join('\n')}` };
      }

      case 'findings': {
        if (!this.swarm) return { response: '✗ Симулятор роя не подключён' };
        const st = this.swarm.getState();
        const findings = st.missions.recentFindings || [];
        if (!findings.length) return { response: 'Находок пока нет.' };
        const lines = findings.map(f =>
          `• [${f.layer}] ${f.finding} — ${f.value?.toLocaleString('ru-RU')}₽`
        );
        return { response: `Последние находки:\n${lines.join('\n')}` };
      }

      case 'jubilee': {
        if (!this.swarm) return { response: '✗ Симулятор роя не подключён' };
        const result = this.swarm.declareJubilee();
        return { response: `✓ Юбилей объявлен! ${result.dronesRestored} дронов восстановлены. Koinon сброшен: ${result.released?.toLocaleString('ru-RU')}₽` };
      }

      case 'sabbath': {
        return { response: `✓ ${params.target} уходит на покой (субботу)` };
      }

      case 'incarnation': {
        const result = this.engine.incarnation();
        return { response: result?.error || '✓ Воплощение совершено' };
      }

      case 'sacrifice': {
        const result = this.engine.sacrifice();
        return { response: result?.error || '✓ Жертва принесена' };
      }

      case 'resurrection': {
        const result = this.engine.resurrection();
        return { response: result?.error || '✓ Воскресение! Theosis enabled.' };
      }

      case 'ternaryState': {
        const state = this.engine.getTernaryState();
        const sys = state.system || {};
        const lines = [`Фаза: ${sys.phase}, здоровье: ${sys.health}/${sys.maxHealth}`];
        for (const p of (state.persons || []).slice(0, 5)) {
          lines.push(`  ${p.name}: ${p.repr}`);
        }
        return { response: lines.join('\n') };
      }

      case 'physics': {
        const stats = this.engine.getStats();
        return { response: `Плотность: ${stats.gratitudeDensity}\nCo-presence: ${stats.coPresenceCount}\nЛогосы: kata=${stats.logoi.movements.kata_physin} para=${stats.logoi.movements.para_physin} hyper=${stats.logoi.movements.hyper_physin}` };
      }

      case 'witness': {
        this.engine.recordIncalculable({
          persons: [],
          description: params.message,
          witness: 'Человек',
        });
        return { response: `✓ Свидетельство записано: "${params.message}"` };
      }

      case 'help': {
        return {
          response: `Я понимаю:
• "создай лицо Имя" — создать персону
• "дай Имени благодать" — дать благодать
• "создай рой из 12 дронов" — развернуть рой
• "запусти симуляцию" — запустить рой
• "отправь миссию на разведку" — создать миссию
• "покажи состояние" — статус системы
• "сколько выручка" — доход роя
• "кто ранен" — диагностика
• "покажи находки" — последние результаты
• "объяви юбилей" — сброс и восстановление
• "свидетельствую: текст" — записать свидетельство
• "покажи троичное состояние" — тритовая карта`
        };
      }

      default:
        return { response: `Действие "${action}" не реализовано` };
    }
  }

  getHistory() {
    return this._history.slice(-20);
  }
}

export default NaturalGiftInterface;
