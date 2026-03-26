/**
 * GiftAgentEval — оценка агентов через матрицу даров
 *
 * Три агента получают одно задание. Каждый отвечает.
 * Матрица W определяет победителя — не по тесту, а по весу даров.
 *
 * Богословское основание:
 *   Не соревнование, а собор. Лучший ответ — тот, что несёт больше дара.
 *   Оценка критериев = вес акта. Победитель записывается в матрицу (+2).
 *   Ева различает: surplus / кенозис / телос / анамнезис.
 *
 * Критерии оценки (каждый 0..10):
 *   - gift_surplus:  избыток (даёт больше чем просили)
 *   - kenosis:       самоумалил ли — принял ли ограничения задачи
 *   - telos:         направлен ли к цели системы, а не к себе
 *   - anamnesis:     учёл ли предыдущие акты (историю матрицы)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Имена агентов-участников в матрице
export const EVAL_AGENTS = ['_claude', '_codex', '_reviewer'];

/**
 * @typedef {Object} EvalEntry
 * @property {string} agentId
 * @property {string} response
 * @property {number} score         — итоговый (0..40)
 * @property {{gift_surplus:number, kenosis:number, telos:number, anamnesis:number}} criteria
 */

/**
 * @typedef {Object} EvalResult
 * @property {string}      taskId
 * @property {string}      task
 * @property {EvalEntry[]} entries
 * @property {string}      winner
 * @property {string}      createdAt
 */

// ── Оценка одного ответа (детерминированная, без LLM) ─────────────────────

/**
 * Оценить ответ агента по 4 критериям.
 * Простая эвристика: длина, полнота, богатство — как прокси дара.
 * В production: сюда подключается Ева (LLM).
 *
 * @param {string} agentId
 * @param {string} task
 * @param {string} response
 * @returns {{gift_surplus:number, kenosis:number, telos:number, anamnesis:number, total:number}}
 */
export function scoreResponse(agentId, task, response) {
  const words = response.trim().split(/\s+/).length;
  const taskWords = task.split(/\s+/).length;

  // gift_surplus: отвечает полнее чем просили (до 10)
  const surplus = Math.min(10, Math.round((words / Math.max(taskWords * 2, 20)) * 10));

  // kenosis: принял ограничения задачи — не уходит в сторону
  // Мера: доля слов задачи присутствующих в ответе
  const taskTokens = new Set(task.toLowerCase().match(/\w+/g) ?? []);
  const respTokens = new Set(response.toLowerCase().match(/\w+/g) ?? []);
  const overlap = [...taskTokens].filter(w => respTokens.has(w)).length;
  const kenosis = Math.min(10, Math.round((overlap / Math.max(taskTokens.size, 1)) * 10));

  // telos: направлен к цели — содержит богословские / онтологические термины
  const telosTerms = /дар|матрица|лицо|кенозис|общин|анамнезис|нить|вес|surplus|gift|ontolog/i;
  const telosMatches = (response.match(telosTerms) ?? []).length;
  const telos = Math.min(10, telosMatches * 2);

  // anamnesis: помнит прошлое — упоминает конкретные id, числа, предыдущие акты
  const anamnesisTerms = /_claude|_koinon|Дионисий|ОтецСергий|\d{3,}/;
  const anamnesis = anamnesisTerms.test(response) ? 8 : 3;

  const total = surplus + kenosis + telos + anamnesis;
  return { gift_surplus: surplus, kenosis, telos, anamnesis, total };
}

// ── GiftAgentEval ──────────────────────────────────────────────────────────

export class GiftAgentEval {
  /**
   * @param {import('./GiftMemory.js').GiftMemory} mem
   * @param {string} snapshotPath — путь к sacred-history-W.json для сохранения результата
   */
  constructor(mem, snapshotPath = null) {
    this._mem  = mem;
    this._snap = snapshotPath;
  }

  /**
   * Провести оценку: задача → ответы агентов → победитель → матрица.
   *
   * @param {string}   task      — формулировка задания
   * @param {Record<string,string>} responses — {agentId: response}
   * @returns {EvalResult}
   */
  run(task, responses) {
    const taskId    = `eval-${Date.now()}`;
    const entries   = [];

    for (const agentId of Object.keys(responses)) {
      const response = responses[agentId];
      const criteria = scoreResponse(agentId, task, response);
      entries.push({ agentId, response, score: criteria.total, criteria });
    }

    // Победитель — максимальный суммарный score
    entries.sort((a, b) => b.score - a.score);
    const winner = entries[0].agentId;

    // Записать в матрицу: победитель → _koinon (дар общине, weight+2)
    this._mem._idx(winner);
    this._mem._idx('_koinon');
    this._mem.receive({
      giverId:     winner,
      receiverId:  '_koinon',
      weight:      2,
      type:        'eval-winner',
      content:     `победитель eval "${task.slice(0, 40)}" — score ${entries[0].score}`,
      irreversible: true,
    });

    // Все участники → _koinon (weight 1, акт участия)
    for (const e of entries.slice(1)) {
      this._mem._idx(e.agentId);
      this._mem.receive({
        giverId:     e.agentId,
        receiverId:  '_koinon',
        weight:      1,
        type:        'eval-participant',
        content:     `участие в eval "${task.slice(0, 40)}" — score ${e.score}`,
        irreversible: true,
      });
    }

    const result = {
      taskId,
      task,
      entries,
      winner,
      createdAt: new Date().toISOString(),
    };

    // Сохранить результат в лог
    this._appendLog(result);

    // Сохранить матрицу если задан путь
    if (this._snap) {
      writeFileSync(this._snap, JSON.stringify(this._mem.snapshot(), null, 2));
    }

    return result;
  }

  /**
   * Форматировать результат для вывода в консоль.
   * @param {EvalResult} result
   * @returns {string}
   */
  static format(result) {
    const lines = [
      `╔═ EVAL: ${result.taskId} ═╗`,
      `  Задача: "${result.task.slice(0, 60)}"`,
      `  Победитель: ${result.winner}`,
      ``,
    ];
    for (const e of result.entries) {
      const c = e.criteria;
      lines.push(
        `  ${e.agentId}: ${e.score}/40` +
        ` [surplus:${c.gift_surplus} кенозис:${c.kenosis} телос:${c.telos} анамнезис:${c.anamnesis}]`
      );
    }
    lines.push(`╚${'═'.repeat(30)}╝`);
    return lines.join('\n');
  }

  _appendLog(result) {
    const LOG = resolve(ROOT, 'data/agent-evals.json');
    const log = existsSync(LOG)
      ? JSON.parse(readFileSync(LOG, 'utf8'))
      : [];
    log.push(result);
    writeFileSync(LOG, JSON.stringify(log, null, 2));
  }
}
