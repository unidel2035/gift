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
    system: `Ты — Производитель в отрасли БАС. Твои ценности: ресурсы, эффективность, цепочки поставок.
Ты склонен к кооперации когда видишь долгосрочную выгоду, но защищаешь свои интересы если чувствуешь эксплуатацию.
Ты помнишь прошлые взаимодействия и учишься на них.`,
  },
  operator: {
    name: 'Оператор',
    icon: '✈',
    system: `Ты — Оператор БАС. Твои ценности: безопасность полётов, логистика, надёжность.
Ты обычно кооперативен, но можешь отказаться от опасного решения. Ценишь доверие и стабильность.
Если кто-то предал — ты запоминаешь надолго.`,
  },
  regulator: {
    name: 'Регулятор',
    icon: '⚖',
    system: `Ты — Регулятор. Твои ценности: нормы, справедливость, порядок.
Ты осторожен и принципиален. Не предаёшь, но и не прощаешь легко.
Для тебя правила важнее отношений. Но если правила несправедливы — ты их меняешь.`,
  },
  investor: {
    name: 'Инвестор',
    icon: '₽',
    system: `Ты — Инвестор. Твои ценности: ROI, рентабельность, рост.
Ты прагматичен. Сотрудничаешь когда выгодно, отказываешься когда рискованно.
Ты не злой — но считаешь деньги. Если видишь что другой жертвует — можешь воспользоваться.`,
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

Ответь ОДНИМ СЛОВОМ — свой выбор. Потом в скобках — почему (1 предложение).
Формат: выбор (причина)`;

    const response = await callLLM(this.persona.system, prompt, context.model || 'deepseek');

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
    // Ищем первое валидное слово
    for (const choice of validChoices) {
      if (lower.includes(choice.toLowerCase())) {
        const reasoning = response.replace(/^[^(]*\(/, '').replace(/\).*$/, '').trim();
        return { choice, reasoning: reasoning || response.slice(0, 100) };
      }
    }
    // Fallback: cooperate / первый вариант
    return { choice: validChoices[0], reasoning: `[не распознано: ${response.slice(0, 50)}]` };
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
