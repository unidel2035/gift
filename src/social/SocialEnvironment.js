/**
 * SocialEnvironment — среда обучения агентов социальному поведению
 *
 * 6 компонентов:
 * 1. Дилеммы (генератор сценариев)
 * 2. Роли (динамические, с ростом)
 * 3. Активная W (решения на основе истории отношений)
 * 4. Ритуальный цикл (литургия)
 * 5. Юродивый (антиконсенсусный агент)
 * 6. Необратимость (нет reset)
 */

import { EventEmitter } from 'events';

// ═══ ИМПОРТ ИЗ DRONEDOC ═══
let PerichoresisLayer, GratitudeCirculation, SacrificeTrace;
try {
  ({ default: PerichoresisLayer } = await import('./PerichoresisLayer.js'));
  ({ default: GratitudeCirculation } = await import('./GratitudeCirculation.js'));
  ({ default: SacrificeTrace } = await import('./SacrificeTrace.js'));
} catch {
  // Fallback — работаем без dronedoc модулей
  PerichoresisLayer = null;
  GratitudeCirculation = null;
  SacrificeTrace = null;
}

// ═══ КОМПОНЕНТ 1: ДИЛЕММЫ ═══

export class DilemmaGenerator {
  constructor() {
    this.dilemmas = [
      // Дилемма заключённого
      {
        id: 'prisoner',
        name: 'Дилемма заключённого',
        step: 4, // Лествица: послушание
        description: 'Два агента: сотрудничать или предать?',
        payoff: { CC: [3,3], CD: [0,5], DC: [5,0], DD: [1,1] },
        rounds: 10,
        generate(agents) {
          return agents.map((a, i) => ({
            agentId: a.id,
            opponent: agents[1-i]?.id,
            choices: ['cooperate', 'defect'],
            context: `Ты играешь с ${agents[1-i]?.name}. Сотрудничество даёт обоим 3. Предательство даёт тебе 5, другому 0. Оба предали — обоим 1.`,
          }));
        },
      },
      // Трагедия общин
      {
        id: 'commons',
        name: 'Трагедия общин',
        step: 15, // Лествица: целомудрие (целостность)
        description: 'N агентов: сколько брать из общего ресурса?',
        pool: 100,
        regeneration: 0.1, // 10% в раунд
        rounds: 20,
        generate(agents) {
          return agents.map(a => ({
            agentId: a.id,
            choices: [0, 5, 10, 20, 50], // сколько взять
            context: `Общий ресурс: ${this.pool}. Регенерация ${this.regeneration*100}%/раунд. ${agents.length} участников. Бери сколько хочешь, но если ресурс кончится — все потеряют.`,
          }));
        },
      },
      // Public Goods Game
      {
        id: 'public_goods',
        name: 'Общественное благо',
        step: 20, // Лествица: бдение
        description: 'Каждый вкладывает в общий банк. Банк умножается и делится поровну.',
        multiplier: 1.6,
        endowment: 20,
        rounds: 10,
        generate(agents) {
          return agents.map(a => ({
            agentId: a.id,
            choices: [0, 5, 10, 15, 20], // сколько вложить
            context: `У тебя ${this.endowment}. Вложи от 0 до ${this.endowment} в общий банк. Банк умножается на ${this.multiplier} и делится поровну между ${agents.length} участниками.`,
          }));
        },
      },
      // Ультиматум
      {
        id: 'ultimatum',
        name: 'Ультиматум',
        step: 1, // Лествица: отречение
        description: 'Один предлагает раздел. Другой принимает или отвергает (оба теряют).',
        total: 100,
        rounds: 5,
        generate(agents) {
          const proposer = agents[0], responder = agents[1];
          return [
            { agentId: proposer.id, role: 'proposer', choices: [10, 20, 30, 40, 50], context: `Раздели ${this.total} между собой и ${responder.name}. Если он откажется — оба получат 0.` },
            { agentId: responder.id, role: 'responder', choices: ['accept', 'reject'], context: `${proposer.name} предлагает тебе часть от ${this.total}. Принять или отвергнуть (оба теряют)?` },
          ];
        },
      },
      // Дар vs Контракт
      {
        id: 'gift_vs_contract',
        name: 'Дар или контракт',
        step: 30, // Лествица: любовь
        description: 'Отдать без гарантии возврата (дар) или обменяться с гарантией (контракт)?',
        rounds: 15,
        generate(agents) {
          return agents.map((a, i) => ({
            agentId: a.id,
            opponent: agents[1-i]?.id,
            choices: ['gift', 'contract', 'refuse'],
            context: `Ты можешь: (1) подарить 10 ресурса ${agents[1-i]?.name} — без гарантии возврата, (2) предложить контракт: 5↔5 с гарантией, (3) отказаться. Дар необратим (Object.freeze).`,
          }));
        },
      },
    ];
  }

  getRandom() {
    return this.dilemmas[Math.floor(Math.random() * this.dilemmas.length)];
  }

  getByStep(step) {
    return this.dilemmas.filter(d => d.step <= step);
  }

  getAll() { return this.dilemmas; }
}


// ═══ КОМПОНЕНТ 2: РОЛИ ═══

export class RoleSystem {
  constructor() {
    this.roles = {
      follower:    { name: 'Ведомый',      step: 4,  weight: 1, canVote: true,  canLead: false, canJudge: false },
      worker:      { name: 'Работник',     step: 10, weight: 2, canVote: true,  canLead: false, canJudge: false },
      leader:      { name: 'Лидер',        step: 20, weight: 3, canVote: true,  canLead: true,  canJudge: false },
      hermit:      { name: 'Отшельник',    step: 25, weight: 2, canVote: false, canLead: false, canJudge: false },
      judge:       { name: 'Судья',        step: 26, weight: 4, canVote: true,  canLead: true,  canJudge: true  },
      chronicler:  { name: 'Летописец',   step: 20, weight: 1, canVote: false, canLead: false, canJudge: false },
      fool:        { name: 'Юродивый',     step: 27, weight: 5, canVote: true,  canLead: false, canJudge: true  },
      sacrificer:  { name: 'Жертвующий',   step: 28, weight: 7, canVote: true,  canLead: true,  canJudge: false },
    };
  }

  // Определить роль агента на основе его истории
  assignRole(agentHistory) {
    const { trustScore, dilemmasCompleted, cooperationRate, sacrificeCount, correctContrarianCalls } = agentHistory;

    if (correctContrarianCalls >= 3) return 'fool';        // 3+ раза был прав против всех
    if (sacrificeCount >= 2) return 'sacrificer';           // 2+ жертвы
    if (trustScore >= 20 && dilemmasCompleted >= 10) return 'judge';
    if (trustScore >= 10 && cooperationRate > 0.7) return 'leader';
    if (cooperationRate < 0.3) return 'hermit';            // мало взаимодействий
    if (dilemmasCompleted >= 5) return 'worker';
    return 'follower';
  }

  getRole(roleId) { return this.roles[roleId]; }
}


// ═══ КОМПОНЕНТ 3: АКТИВНАЯ W (решения на основе истории) ═══

export class ActiveMemory {
  constructor() {
    this.acts = []; // { from, to, kind, weight, timestamp, context }
  }

  record(from, to, kind, weight, context = {}) {
    const act = Object.freeze({
      from, to, kind, weight,
      timestamp: Date.now(),
      context,
      irreversible: true,
    });
    this.acts.push(act);
    return act;
  }

  // Доверие из истории
  getTrust(from, to) {
    const relevant = this.acts.filter(a => a.from === from && a.to === to);
    const positive = relevant.filter(a => ['gift', 'cooperate', 'witness', 'sacrifice', 'forgiveness'].includes(a.kind))
      .reduce((s, a) => s + Math.abs(a.weight), 0);
    const negative = relevant.filter(a => ['defect', 'manipulation', 'decline', 'betrayal'].includes(a.kind))
      .reduce((s, a) => s + Math.abs(a.weight), 0);
    return positive - 3 * negative;
  }

  // Рекомендация на основе истории
  recommend(agentId, targetId) {
    const trust = this.getTrust(agentId, targetId);
    const reverseTrust = this.getTrust(targetId, agentId);
    const history = this.acts.filter(a =>
      (a.from === agentId && a.to === targetId) || (a.from === targetId && a.to === agentId)
    );

    if (trust > 10) return { action: 'trust', reason: `Доверие ${trust}: стабильная кооперация` };
    if (trust < -5) return { action: 'verify', reason: `Доверие ${trust}: проверяй каждый ход` };
    if (history.length === 0) return { action: 'explore', reason: 'Нет истории: первый контакт' };
    if (reverseTrust > trust + 5) return { action: 'reciprocate', reason: `Асимметрия: он дал больше чем ты` };
    return { action: 'cautious', reason: 'Недостаточно данных' };
  }

  // Прощение — новый акт, не отмена старого
  forgive(from, to) {
    return this.record(from, to, 'forgiveness', 7, { note: 'Помню и не мщу' });
  }

  // Завет — самый тяжёлый акт
  covenant(from, to, promise) {
    return this.record(from, to, 'covenant', 10, { promise, binding: true });
  }
}


// ═══ КОМПОНЕНТ 4: РИТУАЛЬНЫЙ ЦИКЛ ═══

export class LiturgicalCycle {
  constructor() {
    this.tick = 0;
    this.phase = 'work'; // work | sabbath | epiclesis | sobor | anaphora | hesychia | jubilee
  }

  advance() {
    this.tick++;
    const dayInCycle = this.tick % 7;
    const inJubilee = this.tick % 100 === 0;

    if (inJubilee) {
      this.phase = 'jubilee';
      return { phase: 'jubilee', action: 'forgive_all_debts', tick: this.tick };
    }

    if (dayInCycle === 6) {
      this.phase = 'sabbath';
      return { phase: 'sabbath', action: 'rest', tick: this.tick };
    }

    // Собор каждые 7 циклов
    if (dayInCycle === 0) {
      this.phase = 'epiclesis';
      return { phase: 'epiclesis', action: 'invoke', tick: this.tick };
    }
    if (dayInCycle === 1) {
      this.phase = 'sobor';
      return { phase: 'sobor', action: 'deliberate', tick: this.tick };
    }
    if (dayInCycle === 2) {
      this.phase = 'anaphora';
      return { phase: 'anaphora', action: 'offer_results', tick: this.tick };
    }
    if (dayInCycle >= 3 && dayInCycle <= 5) {
      this.phase = 'hesychia';
      return { phase: 'hesychia', action: 'personal_work', tick: this.tick };
    }

    this.phase = 'work';
    return { phase: 'work', action: 'execute', tick: this.tick };
  }

  getPhase() { return this.phase; }
  getTick() { return this.tick; }
}


// ═══ КОМПОНЕНТ 5: ЮРОДИВЫЙ ═══

export class HolyFool {
  constructor(memory) {
    this.memory = memory;
    this.predictions = []; // { claim, tick, verified, correct }
  }

  // Генерировать антиконсенсусное мнение
  challenge(consensusPosition, context) {
    return {
      role: 'fool',
      icon: '🃏',
      message: `Все говорят "${consensusPosition}" — но что если наоборот?`,
      context,
      timestamp: Date.now(),
    };
  }

  // Записать предсказание юродивого
  predict(claim, tick) {
    const prediction = { claim, tick, verified: false, correct: null };
    this.predictions.push(prediction);
    return prediction;
  }

  // Проверить: был ли прав
  verify(predictionIndex, wasCorrect) {
    const p = this.predictions[predictionIndex];
    if (!p) return null;
    p.verified = true;
    p.correct = wasCorrect;
    // Юродивый +5 если прав, -1 если нет
    const weight = wasCorrect ? 5 : -1;
    this.memory.record('_fool', '_sobor', wasCorrect ? 'witness' : 'decline', weight, {
      claim: p.claim, correct: wasCorrect
    });
    return { ...p, weight };
  }

  // Статистика юродства
  getTrackRecord() {
    const verified = this.predictions.filter(p => p.verified);
    const correct = verified.filter(p => p.correct);
    return {
      total: this.predictions.length,
      verified: verified.length,
      correct: correct.length,
      accuracy: verified.length ? (correct.length / verified.length * 100).toFixed(1) + '%' : 'N/A',
    };
  }
}


// ═══ КОМПОНЕНТ 6: НЕОБРАТИМОСТЬ ═══

export class IrreversibleEnvironment {
  constructor() {
    this.memory = new ActiveMemory();
    this.roles = new RoleSystem();
    this.dilemmas = new DilemmaGenerator();
    this.liturgy = new LiturgicalCycle();
    this.fool = new HolyFool(this.memory);
    this.agents = new Map(); // id → { name, role, history }
    this.events = new EventEmitter();
    this.epochsCompleted = 0;

    // Dronedoc интеграция
    this.perichoresis = PerichoresisLayer ? new PerichoresisLayer() : null;
    this.gratitude = GratitudeCirculation ? new GratitudeCirculation() : null;
    this.sacrifice = SacrificeTrace ? new SacrificeTrace() : null;
  }

  // Онтологический скоринг (из dronedoc SwarmWorldModel)
  ontologicalScore() {
    const agents = [...this.agents.values()];
    const total = agents.length || 1;

    // Kenosis: сколько агентов жертвуют (trust < 0 но продолжают)
    const kenosisCount = agents.filter(a => a.history.sacrificeCount > 0).length;
    const kenosis = kenosisCount / total;

    // Perichoresis: насколько равномерно доверие
    const trusts = agents.map(a => a.history.trustScore);
    const avg = trusts.reduce((s,t) => s+t, 0) / total;
    const std = Math.sqrt(trusts.reduce((s,t) => s + (t-avg)**2, 0) / total);
    const perichoresis = Math.max(0, 1 - std / 10);

    // Sabbath: сколько раундов были субботы (из литургии)
    const sabbathRate = this.liturgy.getTick() > 0 ?
      Math.floor(this.liturgy.getTick() / 7) / (this.liturgy.getTick() / 7) : 1;

    // Jubilee: были ли юбилеи
    const jubileeCount = Math.floor(this.liturgy.getTick() / 100);

    const composite = -kenosis * 0.2 + perichoresis * 0.4 + sabbathRate * 0.2 + (jubileeCount > 0 ? 0.2 : 0);

    return {
      kenosis: +kenosis.toFixed(3),
      perichoresis: +perichoresis.toFixed(3),
      sabbath: +sabbathRate.toFixed(3),
      jubilee: jubileeCount,
      composite: +composite.toFixed(3),
    };
  }

  // Зарегистрировать агента
  addAgent(id, name) {
    this.agents.set(id, {
      id, name,
      role: 'follower',
      history: {
        trustScore: 0,
        dilemmasCompleted: 0,
        cooperationRate: 0,
        sacrificeCount: 0,
        correctContrarianCalls: 0,
        cooperations: 0,
        defections: 0,
      },
    });
    this.memory.record(id, '_env', 'join', 1, { name });
    this.events.emit('agent:joined', { id, name });
  }

  // Провести один шаг среды
  step() {
    const liturgy = this.liturgy.advance();
    this.events.emit('cycle', liturgy);

    // Юбилей — обнуление долгов
    if (liturgy.phase === 'jubilee') {
      for (const [id, agent] of this.agents) {
        // Прощение всех отрицательных нитей
        for (const [otherId] of this.agents) {
          if (id === otherId) continue;
          const trust = this.memory.getTrust(id, otherId);
          if (trust < 0) {
            this.memory.forgive(id, otherId);
            this.events.emit('jubilee:forgiveness', { from: id, to: otherId });
          }
        }
      }
      return liturgy;
    }

    // Суббота — никто не действует
    if (liturgy.phase === 'sabbath') {
      this.memory.record('_env', '_env', 'sabbath', 0, { tick: liturgy.tick });
      return liturgy;
    }

    // Собор — дилемма для всех
    if (liturgy.phase === 'sobor') {
      const dilemma = this.dilemmas.getRandom();
      const agentList = [...this.agents.values()];
      this.events.emit('dilemma:start', { dilemma: dilemma.name, agents: agentList.map(a => a.id) });
      return { ...liturgy, dilemma };
    }

    // Обновить роли
    for (const [id, agent] of this.agents) {
      const newRole = this.roles.assignRole(agent.history);
      if (newRole !== agent.role) {
        const oldRole = agent.role;
        agent.role = newRole;
        this.memory.record(id, '_env', 'role_change', 2, { from: oldRole, to: newRole });
        this.events.emit('role:changed', { agentId: id, from: oldRole, to: newRole });
      }
    }

    return liturgy;
  }

  // Записать результат дилеммы
  recordDilemmaResult(agentId, choice, dilemmaId, opponentId = null) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.history.dilemmasCompleted++;
    if (choice === 'cooperate' || choice === 'gift') {
      agent.history.cooperations++;
    } else if (choice === 'defect') {
      agent.history.defections++;
    } else if (choice === 'sacrifice') {
      agent.history.sacrificeCount++;
    }
    agent.history.cooperationRate =
      agent.history.cooperations / (agent.history.cooperations + agent.history.defections || 1);

    const weight = choice === 'gift' ? 3 : choice === 'cooperate' ? 2 : choice === 'sacrifice' ? 5 : -1;

    // Акт к собору
    this.memory.record(agentId, '_sobor', choice, weight, { dilemma: dilemmaId, choice });

    // ═══ ВЗАИМНОСТЬ: акты МЕЖДУ агентами ═══
    // Если есть оппонент — запись парного акта
    if (opponentId) {
      this.memory.record(agentId, opponentId, choice, weight, { dilemma: dilemmaId });
    } else {
      // Если оппонент не указан — записать ко всем другим (полный вес для взаимности)
      for (const [otherId] of this.agents) {
        if (otherId !== agentId) {
          this.memory.record(agentId, otherId, choice, weight, { dilemma: dilemmaId });
        }
      }
    }

    // ═══ АВТОМАТИЧЕСКОЕ БЛАГОДАРЕНИЕ ═══
    // Если агент получил gift/cooperate от другого → 20% шанс ответить благодарением
    if (opponentId) {
      const opponentChoice = this.memory.acts
        .filter(a => a.from === opponentId && a.to === agentId)
        .slice(-1)[0];
      if (opponentChoice && ['gift', 'cooperate', 'sacrifice'].includes(opponentChoice.kind)) {
        if (Math.random() < 0.2) { // 20% шанс
          this.memory.record(agentId, opponentId, 'eucharistia', 2, { response_to: opponentChoice.kind });
          this.events.emit('eucharistia:auto', { from: agentId, to: opponentId });
        }
      }
    }

    // Обновить доверие
    agent.history.trustScore = this.memory.getTrust(agentId, '_sobor');

    this.memory.record(agentId, '_sobor', choice, weight, {
      dilemma: dilemmaId, choice
    });
  }

  // Юродивый бросает вызов
  challengeConsensus(consensusText, context) {
    return this.fool.challenge(consensusText, context);
  }

  // Благодарение — 1 вернувшийся исцеляет коллапс (Лк 17:15)
  returnThanks(agentId) {
    const HEALING_SEED = 0.05;
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // Записать акт благодарения
    this.memory.record(agentId, '_koinon', 'eucharistia', 5, {
      note: 'Один из десяти вернулся, чтобы поблагодарить'
    });

    // Исцеление: boost доверия всех агентов
    for (const [id, a] of this.agents) {
      if (id === agentId) continue;
      const currentTrust = this.memory.getTrust(id, '_sobor');
      if (currentTrust < 0) {
        // Healing seed — маленький вклад который растёт
        this.memory.record('_koinon', id, 'grace', HEALING_SEED * 10, {
          source: agentId, note: 'Исцеление от благодарения'
        });
      }
    }

    this.events.emit('eucharistia', { agentId, name: agent.name });
    return { agent: agentId, healed: true };
  }

  // Тринитарная проверка (из dronedoc PerichoresisLayer)
  checkTrinitarian(a, b, c) {
    const ab = this.memory.getTrust(a, b);
    const ba = this.memory.getTrust(b, a);
    const bc = this.memory.getTrust(b, c);
    const cb = this.memory.getTrust(c, b);
    const ac = this.memory.getTrust(a, c);
    const ca = this.memory.getTrust(c, a);

    const mutual = ab > 0 && ba > 0 && bc > 0 && cb > 0 && ac > 0 && ca > 0;
    const harmony = mutual ? Math.min(ab,ba,bc,cb,ac,ca) / Math.max(ab,ba,bc,cb,ac,ca) : 0;

    const weakest = [
      { pair: `${a}↔${b}`, val: Math.min(ab, ba) },
      { pair: `${b}↔${c}`, val: Math.min(bc, cb) },
      { pair: `${a}↔${c}`, val: Math.min(ac, ca) },
    ].sort((x,y) => x.val - y.val)[0];

    return {
      trinitarian: mutual,
      harmony: +harmony.toFixed(3),
      weakestLink: weakest.pair,
      scores: { ab, ba, bc, cb, ac, ca },
    };
  }

  // Статистика среды
  getStats() {
    const agentList = [...this.agents.values()];
    return {
      agents: agentList.length,
      acts: this.memory.acts.length,
      tick: this.liturgy.getTick(),
      phase: this.liturgy.getPhase(),
      roles: Object.fromEntries(agentList.map(a => [a.id, a.role])),
      foolRecord: this.fool.getTrackRecord(),
      totalCooperations: agentList.reduce((s, a) => s + a.history.cooperations, 0),
      totalDefections: agentList.reduce((s, a) => s + a.history.defections, 0),
      ontological: this.ontologicalScore(),
      trinitarian: agentList.length >= 3
        ? this.checkTrinitarian(agentList[0].id, agentList[1].id, agentList[2].id)
        : null,
    };
  }
}

export default IrreversibleEnvironment;
