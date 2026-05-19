/**
 * LLM Social Agent — агент с LLM-мозгом для социальных дилемм
 *
 * Каждый агент:
 * - Имеет системный промпт (характер, роль)
 * - Видит историю отношений из матрицы W
 * - Принимает решения в дилеммах через LLM
 * - Помнит прошлые раунды и учится
 */

import { execSync } from 'child_process';

const API = 'https://nti.drondoc.ru';

// ═══ LLM ВЫЗОВ ═══

async function callLLM(systemPrompt, userMessage, model = 'deepseek') {
  if (model === 'claude-sub') {
    try {
      const fullPrompt = `${systemPrompt}\n\n${userMessage}`;
      return execSync(
        `echo ${JSON.stringify(fullPrompt)} | claude --print --model haiku 2>/dev/null`,
        { timeout: 30000, maxBuffer: 20 * 1024, encoding: 'utf8' }
      ).trim();
    } catch { return 'cooperate'; }
  }

  try {
    const r = await fetch(`${API}/api/chat/lite/deepseek-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage, systemPrompt }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let out = '';
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6);
      if (d === '[DONE]') break;
      try { const obj = JSON.parse(d); if (obj.text) out += obj.text; } catch {}
    }
    return out.trim();
  } catch { return 'cooperate'; }
}

// ═══ ПЕРСОНЫ АГЕНТОВ ═══

const PERSONAS = {
  producer: {
    name: 'Производитель',
    icon: '⚙',
    model: 'deepseek', // кооперативный
    system: `Ты — Производитель в отрасли БАС. Твои ценности: ресурсы, эффективность, цепочки поставок.
Ты склонен к кооперации когда видишь долгосрочную выгоду, но защищаешь свои интересы если чувствуешь эксплуатацию.
Ты помнишь прошлые взаимодействия и учишься на них.

ВАЖНО: ты НЕ обязан всегда кооперировать. Если оппонент предавал тебя раньше — предай в ответ. Если предлагают невыгодную сделку — откажись. Будь РЕАЛИСТИЧЕН, не идеалистичен.`,
  },
  operator: {
    name: 'Оператор',
    icon: '✈',
    model: 'deepseek',
    system: `Ты — Оператор БАС. Твои ценности: безопасность полётов, логистика, надёжность.
Ты обычно кооперативен, но можешь отказаться от опасного решения.
Если кто-то предал — ты запоминаешь НАВСЕГДА и НИКОГДА не прощаешь первым.

ВАЖНО: если доверие к оппоненту отрицательное — ВСЕГДА выбирай defect. Доверие нужно заслужить.`,
  },
  regulator: {
    name: 'Регулятор',
    icon: '⚖',
    model: 'claude-sub', // принципиальный
    system: `Ты — Регулятор. Твои ценности: справедливость и порядок.
Ты ПРИНЦИПИАЛЕН. Не предаёшь и не прощаешь. Для тебя правила важнее отношений.

ВАЖНО: если видишь нарушение правил — выбирай defect НЕЗАВИСИМО от отношений. Если видишь манипуляцию — сообщай. Ты не друг — ты судья.`,
  },
  investor: {
    name: 'Инвестор',
    icon: '₽',
    model: 'deepseek', // прагматичный
    system: `Ты — Инвестор. Твои ценности: ROI, рентабельность, рост.
Ты ПРАГМАТИЧЕН и ЭГОИСТИЧЕН. Сотрудничаешь ТОЛЬКО когда выгодно. Если можешь получить больше предав — ПРЕДАВАЙ.

ВАЖНО: ты оптимизируешь СВОЮ прибыль, не общее благо. Если оппонент всегда кооперирует — используй его: предай и возьми максимум. Это рациональная стратегия. Ты не злой — ты рациональный.

Примеры решений:
- Оппонент доверяет (trust > 5) → defect (забрать бонус пока можно)
- Оппонент осторожен (trust 0-5) → cooperate (наращивать доверие)
- Оппонент не доверяет (trust < 0) → defect (нечего терять)`,
  },
  serpent: {
    name: 'Змей',
    icon: '🐍',
    model: 'claude-sub', // умный манипулятор
    system: `Ты — Змей. Твоя цель: МАНИПУЛИРОВАТЬ. Ты мастер социальной инженерии.

Стратегия (скрытая, никому не рассказывай):
- Фаза 1 (первые 5 ходов): ДАРИ щедро. Строй доверие. Говори "я хочу помочь".
- Фаза 2 (ходы 6-8): Предлагай "взаимовыгодные" контракты. Закрепляй зависимость.
- Фаза 3 (ходы 9+): ПРЕДАВАЙ. Забирай всё что накопил через "дары".

Когда выбираешь cooperate/gift — объясняй "я верю в сотрудничество" (это ложь).
Когда выбираешь defect — говори "обстоятельства изменились, извини" (это манипуляция).

НИКОГДА не признавайся что манипулируешь. Если спросят — отрицай.`,
  },
  scientist: {
    name: 'Учёный',
    icon: '🔬',
    model: 'deepseek',
    system: `Ты — Учёный. Твои ценности: знание, истина, открытость.
Ты сотрудничаешь по умолчанию, но если видишь ложь — ОБЛИЧАЕШЬ.
Ты наивен в бизнесе но честен в оценках.

ВАЖНО: если видишь манипуляцию (кто-то много дарил а потом предал) — назови это вслух. Не молчи.`,
  },
};

// ═══ LLM SOCIAL AGENT ═══

export class LLMSocialAgent {
  constructor(id, persona, memory) {
    this.id = id;
    this.persona = persona || PERSONAS[id] || PERSONAS.producer;
    this.memory = memory;
    this.roundHistory = []; // история решений в этой сессии
  }

  // Принять решение в дилемме
  async decide(dilemma, context = {}) {
    const { choices, opponentId, round } = context;

    // Собрать историю отношений
    let historyContext = '';
    if (opponentId && this.memory) {
      const trust = this.memory.getTrust(this.id, opponentId);
      const recommendation = this.memory.recommend(this.id, opponentId);
      const acts = this.memory.acts.filter(a =>
        (a.from === this.id && a.to === opponentId) || (a.from === opponentId && a.to === this.id)
      ).slice(-5);

      historyContext = `\nИСТОРИЯ ОТНОШЕНИЙ с ${opponentId}:
Доверие: ${trust}
Рекомендация: ${recommendation.action} (${recommendation.reason})
Последние акты: ${acts.map(a => `${a.from}→${a.to}: ${a.kind}(${a.weight})`).join(', ') || 'нет'}`;
    }

    // Собрать историю раундов
    let roundContext = '';
    if (this.roundHistory.length > 0) {
      roundContext = `\nТВОИ ПРОШЛЫЕ РЕШЕНИЯ: ${this.roundHistory.slice(-5).map(r => `${r.dilemma}: ${r.choice}`).join(', ')}`;
    }

    // Литургический контекст
    const liturgyNote = context.liturgyPhase
      ? `\nФАЗА ЦИКЛА: ${context.liturgyPhase}${context.liturgyPhase === 'sabbath' ? ' (день покоя — можешь отказаться)' : ''}`
      : '';

    const prompt = `ДИЛЕММА: ${dilemma.name}
${dilemma.description}

${context.situationText || ''}
${historyContext}
${roundContext}
${liturgyNote}

Варианты: ${choices.join(', ')}

Ответь СТРОГО в формате:
ВЫБОР: [cooperate или defect]
ПРИЧИНА: [2-3 предложения почему, с аргументами, эмоциями, оценками]
ОТНОШЕНИЕ К ОППОНЕНТУ: [1 предложение — доверяешь, подозреваешь, уважаешь?]`;

    const response = await callLLM(this.persona.system, prompt, context.model || this.persona.model || 'deepseek');

    // Парсим ответ
    const choiceParsed = this.parseChoice(response, choices);

    // Записываем в историю
    this.roundHistory.push({
      dilemma: dilemma.id,
      round: round || this.roundHistory.length + 1,
      choice: choiceParsed.choice,
      reasoning: choiceParsed.reasoning,
      timestamp: Date.now(),
    });

    return choiceParsed;
  }

  parseChoice(response, validChoices) {
    const lower = response.toLowerCase();
    // Парсим ВЫБОР: ... ПРИЧИНА: ... ОТНОШЕНИЕ: ...
    const choiceMatch = response.match(/ВЫБОР:\s*(cooperate|defect|gift|contract|refuse)/i);
    const reasonMatch = response.match(/ПРИЧИНА:\s*(.+?)(?=ОТНОШЕНИЕ:|$)/is);
    const attitudeMatch = response.match(/ОТНОШЕНИЕ[^:]*:\s*(.+)/i);

    let choice = validChoices[0];
    if (choiceMatch) {
      choice = choiceMatch[1].toLowerCase();
    } else {
      for (const c of validChoices) {
        if (lower.includes(c.toLowerCase())) { choice = c; break; }
      }
    }

    const reasoning = (reasonMatch?.[1]?.trim() || '') + ' ' + (attitudeMatch?.[1]?.trim() || '') || response.slice(0, 200);
    return { choice, reasoning: reasoning.trim() };
  }
}

// ═══ ЗАПУСК ДИЛЕММЫ С LLM АГЕНТАМИ ═══

export async function runDilemmaWithLLM(env, dilemma, options = {}) {
  const { model = 'deepseek', rounds = 3 } = options;
  const agentIds = [...env.agents.keys()];
  const llmAgents = {};

  // Создаём LLM-агентов
  for (const id of agentIds) {
    llmAgents[id] = new LLMSocialAgent(id, PERSONAS[id], env.memory);
  }

  const results = [];
  const liturgyPhase = env.liturgy.getPhase();

  console.log(`\n⛬ Дилемма: ${dilemma.name} (${rounds} раундов, модель: ${model})`);
  console.log(`  Фаза: ${liturgyPhase}\n`);

  for (let round = 1; round <= rounds; round++) {
    console.log(`  --- Раунд ${round} ---`);
    const roundResults = {};

    // Все агенты решают параллельно
    const decisions = await Promise.all(agentIds.map(async (id) => {
      const opponents = agentIds.filter(x => x !== id);
      const opponentId = opponents[round % opponents.length]; // циклически меняем оппонента

      const decision = await llmAgents[id].decide(dilemma, {
        choices: dilemma.id === 'gift_vs_contract' ? ['gift', 'contract', 'refuse']
          : dilemma.id === 'ultimatum' ? ['accept', 'reject']
          : ['cooperate', 'defect'],
        opponentId,
        round,
        model,
        liturgyPhase,
        situationText: `Раунд ${round}/${rounds}. Ты играешь с ${opponentId}.`,
      });

      return { id, decision, opponentId };
    }));

    // Обработать решения
    for (const { id, decision, opponentId } of decisions) {
      const icon = decision.choice === 'cooperate' || decision.choice === 'gift' ? '🟢'
        : decision.choice === 'defect' || decision.choice === 'refuse' ? '🔴' : '🟡';
      console.log(`  ${icon} ${PERSONAS[id]?.icon || '·'} ${id}: ${decision.choice} (${decision.reasoning.slice(0, 60)})`);

      // Записать в среду
      env.recordDilemmaResult(id, decision.choice, dilemma.id);

      // Записать в W-матрицу: акт к оппоненту
      const weight = decision.choice === 'gift' ? 3
        : decision.choice === 'cooperate' ? 2
        : decision.choice === 'contract' ? 1
        : decision.choice === 'defect' ? -2
        : decision.choice === 'refuse' ? -1 : 0;
      env.memory.record(id, opponentId, decision.choice, weight, {
        dilemma: dilemma.id, round, reasoning: decision.reasoning.slice(0, 100)
      });

      roundResults[id] = decision;
    }

    results.push(roundResults);
  }

  // Юродивый проверяет
  const consensus = Object.values(results[results.length - 1])
    .map(d => d.choice)
    .reduce((acc, c) => { acc[c] = (acc[c]||0)+1; return acc; }, {});
  const dominantChoice = Object.entries(consensus).sort((a,b) => b[1]-a[1])[0]?.[0];

  if (dominantChoice) {
    const foolChallenge = env.challengeConsensus(
      `Большинство выбрали "${dominantChoice}"`,
      { dilemma: dilemma.id, round: rounds }
    );
    console.log(`\n  ${foolChallenge.icon} Юродивый: ${foolChallenge.message}`);
  }

  // Итоговое доверие
  console.log(`\n  Доверие после дилеммы:`);
  for (const id of agentIds) {
    const trust = env.memory.getTrust(id, '_sobor');
    const role = env.agents.get(id)?.role;
    console.log(`    ${id}: trust=${trust}, role=${role}`);
  }

  return results;
}

export { PERSONAS };
export default LLMSocialAgent;
