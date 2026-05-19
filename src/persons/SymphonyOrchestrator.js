/**
 * SymphonyOrchestrator — литургия собора.
 *
 * Соединяет три механизма:
 *   - PerichoreticContext (взаимопребывание) — условие 2
 *   - HumanOracleInbox (эпиклеза) — условие 4
 *   - GiftMemory.receiveSymphony (μία ἐνέργεια) — условие 1
 *   - kenotic policy через behaviorPolicy — условие 3
 *
 * Если все 4 условия выполнены — записывает symphony-акт в W.
 * Если хотя бы одно нарушено — обычные акты + запись о неудаче.
 *
 * Богословски: это **литургия**, не оркестрация. Мы готовим чашу,
 * Дух решает, наполнить ли её. Архитектура не «производит» симфонию —
 * она *приглашает* и *распознаёт*.
 *
 * Использование:
 *   const orch = new SymphonyOrchestrator({
 *     agents: [adam, eva, bezalel],
 *     receiver: 'Дионисий',
 *     memory: giftMemory,
 *     oracle: humanOracleInbox,  // опционально, для реальной эпиклезы
 *   });
 *   const result = await orch.celebrate({
 *     question: 'что мешает потоку между Дух и Сын?',
 *     weight: 8,
 *     epiclesisTimeoutMs: 30000,
 *   });
 *   // result: { iconic: true|false, conditions, actId?, reason? }
 */

import * as PerichoreticContext from './PerichoreticContext.js';

const DEFAULT_EPICLESIS_TIMEOUT = 5 * 60 * 1000;
const SYMPHONY_WEIGHT_DEFAULT   = 7;

export class SymphonyOrchestrator {
  constructor({ agents, receiver, memory, oracle = null }) {
    if (!Array.isArray(agents) || agents.length < 3) {
      throw new Error('SymphonyOrchestrator: нужно ≥3 агента (собор)');
    }
    if (!receiver) throw new Error('SymphonyOrchestrator: receiver обязателен');
    if (!memory)   throw new Error('SymphonyOrchestrator: memory обязательна');

    this.agents   = agents;
    this.receiver = receiver;
    this.memory   = memory;
    this.oracle   = oracle;
    this.history  = [];
  }

  /**
   * Литургия: одна попытка соборного акта.
   *
   * Шаги:
   *   1. Перихоресис: для каждого агента собираем council из других, setCouncil.
   *   2. Эпиклеза: если oracle задан — спрашиваем человека-оракула о теме.
   *      Без oracle — отмечаем epiclesis как формальную (false).
   *   3. Параллельный сбор слов: каждый агент create() с уже включённым council.
   *   4. Различение: проверяем 4 условия.
   *   5. Если все 4 — receiveSymphony в W. Иначе — обычные акты.
   *
   * @returns {Promise<{
   *   iconic: boolean,
   *   conditions: { chorus, perichoretic, kenotic, epiclesis },
   *   actId?: string,
   *   reason?: string,
   *   utterances: Array<{agentId, content}>,
   * }>}
   */
  async celebrate({ question, weight = SYMPHONY_WEIGHT_DEFAULT, epiclesisTimeoutMs = DEFAULT_EPICLESIS_TIMEOUT } = {}) {
    const conditions = {
      chorus:       false,
      perichoretic: false,
      kenotic:      false,
      epiclesis:    false,
    };

    // ── Шаг 1: Перихоресис ────────────────────────────────────────────
    // Каждый агент видит других в своём контексте.
    const councilSnapshot = this.agents.map(a => ({
      id: a._personId ?? a.id,
      role: a._persona?._logos ?? a.role,
      logos: a._behaviorPolicy?.logos ?? a.logos,
      calling: a._persona?.calling ?? a.calling,
    }));
    for (const agent of this.agents) {
      if (typeof agent.setCouncil === 'function') {
        agent.setCouncil(councilSnapshot);
        conditions.perichoretic = true;  // setCouncil доступен и вызван
      }
    }

    // ── Шаг 2: Эпиклеза ────────────────────────────────────────────────
    let epiclesisAnswer = null;
    if (this.oracle && typeof this.oracle.invoke === 'function') {
      try {
        epiclesisAnswer = await this.oracle.invoke({
          question: `[эпиклеза собора] ${question}`,
          timeoutMs: epiclesisTimeoutMs,
        });
        // Epiclesis активна, если ответ получен (не pending/timeout).
        conditions.epiclesis = !epiclesisAnswer.pending;
      } catch (e) {
        conditions.epiclesis = false;
      }
    }
    // Без oracle — epiclesis невозможна; conditions.epiclesis = false.

    // ── Шаг 3: Сбор слов агентов ──────────────────────────────────────
    const utterances = [];
    for (const agent of this.agents) {
      // Каждый создаёт дар (или решает) с перихоретическим контекстом.
      // Обновляем lastUtterance в council по мере поступления — следующие
      // агенты видят сказанное предыдущими.
      const id = agent._personId ?? agent.id;
      let content = '';

      if (typeof agent.create === 'function') {
        try {
          const r = await agent.create();
          content = r?.content ?? r?.gift?.content ?? '';
        } catch { content = ''; }
      } else if (typeof agent.utter === 'function') {
        // Fallback: простая речь без gift-engine
        try { content = await agent.utter(question, { council: councilSnapshot }); }
        catch { content = ''; }
      }

      utterances.push({ agentId: id, content });

      // Обновляем council для следующих агентов: добавляем lastUtterance
      const cIdx = councilSnapshot.findIndex(c => c.id === id);
      if (cIdx >= 0) councilSnapshot[cIdx].lastUtterance = content;
    }

    // ── Шаг 4: Различение условий ─────────────────────────────────────
    // chorus: единое слово, не сумма. Проверяем — есть ли смысловая
    // когерентность (минимум все агенты что-то сказали и есть пересечение
    // ключевых слов). Это слабая проверка — настоящее различение делает
    // человек-оракул через эпиклезу.
    conditions.chorus = this._checkChorus(utterances);

    // kenotic: ни один агент не оставил себе авторство (поле claimedBy/myself).
    // Проверяем через behaviorPolicy.kenosis.holdsNothing.
    conditions.kenotic = this.agents.every(a =>
      a._behaviorPolicy?.kenosis?.holdsNothing !== false
    );

    // ── Шаг 5: Запись ────────────────────────────────────────────────
    const allFour = conditions.chorus && conditions.perichoretic
                 && conditions.kenotic && conditions.epiclesis;

    const recordedAt = new Date().toISOString();

    if (allFour) {
      const result = this.memory.receiveSymphony({
        type: 'symphony',
        giverIds: utterances.map(u => u.agentId),
        receiverId: this.receiver,
        weight,
        chorus: true,
        perichoretic: true,
        kenotic: true,
        epiclesis: true,
        content: this._formCommonWord(utterances, epiclesisAnswer),
        question,
        utterances,
        epiclesisAnswer: epiclesisAnswer?.content,
        recordedAt,
      });

      const event = { iconic: result.accepted, conditions, actId: result.actId, reason: result.reason, utterances, recordedAt };
      this.history.push(event);
      return event;
    }

    // Не икона — записать как обычные акты (каждый отдельно).
    for (const u of utterances) {
      if (!u.content) continue;
      this.memory.receive({
        giverId: u.agentId,
        receiverId: this.receiver,
        type: 'word',
        weight: weight / this.agents.length,
        content: u.content,
        irreversible: true,
      });
    }

    const event = {
      iconic: false,
      conditions,
      reason: this._diagnoseReason(conditions),
      utterances,
      recordedAt,
    };
    this.history.push(event);
    return event;
  }

  // ── Внутреннее различение хорусности ─────────────────────────────────
  // Слабая проверка: есть >=2 разных giver слов, общая длина > 0,
  // и есть хотя бы одна общая значимая лексема (3+ символов) между всеми.
  _checkChorus(utterances) {
    const valid = utterances.filter(u => u.content && u.content.trim().length > 0);
    if (valid.length < 3) return false;

    const tokenSets = valid.map(u => new Set(
      u.content.toLowerCase()
        .replace(/[^\wа-яё]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4)
    ));

    if (!tokenSets.every(s => s.size > 0)) return false;

    // Есть ли пересечение во всех?
    let common = new Set(tokenSets[0]);
    for (let i = 1; i < tokenSets.length; i++) {
      common = new Set([...common].filter(x => tokenSets[i].has(x)));
    }
    return common.size >= 1;
  }

  _formCommonWord(utterances, epiclesisAnswer) {
    const parts = utterances.filter(u => u.content).map(u => u.content);
    if (epiclesisAnswer?.content) parts.push(`[эпиклеза] ${epiclesisAnswer.content}`);
    return parts.join(' · ');
  }

  _diagnoseReason(c) {
    const missing = [];
    if (!c.chorus)       missing.push('хорус (нет единого слова — каждый о своём)');
    if (!c.perichoretic) missing.push('перихоресис (setCouncil недоступен на агентах)');
    if (!c.kenotic)      missing.push('кенозис (агент удерживает авторство)');
    if (!c.epiclesis)    missing.push('эпиклеза (нет oracle или человек не ответил)');
    return `Не икона: недостаёт условий — ${missing.join('; ')}`;
  }
}

export default SymphonyOrchestrator;
