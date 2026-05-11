/**
 * GoalEngine — long-horizon исполнитель цели.
 *
 * Гибрид: паттерн Codex /goal (persistent loop, pause/resume, бюджет шагов)
 * + богословский шаг μετάνοια на ошибке (не просто retry — переосмысление).
 *
 * Цикл итерации: plan → act → test → review → [μετάνοια если не satisfied]
 *
 * State хранится в `<root>/<id>.json` — переживает рестарт процесса.
 * Executor инжектируется (по умолчанию ClaudeExecutor; в тестах — mock).
 *
 * См. также:
 *   - utils/gift-dev-loop.mjs — short-horizon аналог (3 попытки на 1 issue)
 *   - issue #61 — Long-horizon decomposer (этот файл его реализует)
 */
import { writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const STATUS = Object.freeze({
  PENDING:   'pending',     // создана, не запущена
  RUNNING:   'running',     // прямо сейчас крутится
  PAUSED:    'paused',      // вручную или по бюджету
  DONE:      'done',        // review вернул satisfied
  FAILED:    'failed',      // исчерпан maxIterations без satisfied
  CANCELLED: 'cancelled',   // оператор отменил
});

export class GoalEngine {
  constructor({ root = 'data/goals', executor, clock = Date } = {}) {
    this.root = root;
    this.executor = executor;
    this.clock = clock;
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }

  /** Создать цель. Не запускает — это делает run(). */
  create({ objective, successCriteria, maxIterations = 32, tokenBudget = null, meta = {} }) {
    if (!objective || typeof objective !== 'string') {
      throw new Error('objective is required');
    }
    if (!successCriteria || typeof successCriteria !== 'string') {
      throw new Error('successCriteria is required — без явного условия успеха цикл не остановится');
    }
    const id = 'goal-' + this.clock.now().toString(36) + '-' + randomBytes(2).toString('hex');
    const state = {
      id,
      objective,
      successCriteria,
      maxIterations,
      tokenBudget,
      meta,
      iteration: 0,
      tokensUsed: 0,
      status: STATUS.PENDING,
      history: [],
      createdAt: new Date(this.clock.now()).toISOString(),
      updatedAt: new Date(this.clock.now()).toISOString(),
    };
    this._save(state);
    return state;
  }

  /**
   * Запустить или возобновить цель.
   * Прерывается когда: review.satisfied, иссяк maxIterations, иссяк tokenBudget,
   * или вызван pause().
   */
  async run(id, { maxSteps = Infinity, onStep = null } = {}) {
    let state = this._load(id);
    if (!state) throw new Error(`goal ${id} not found`);
    if (state.status === STATUS.DONE || state.status === STATUS.CANCELLED) return state;
    if (!this.executor) throw new Error('executor not configured');

    state.status = STATUS.RUNNING;
    this._save(state);

    let stepsThisRun = 0;
    while (
      state.iteration < state.maxIterations &&
      stepsThisRun < maxSteps &&
      state.status === STATUS.RUNNING
    ) {
      state.iteration += 1;
      stepsThisRun += 1;
      const step = { n: state.iteration, ts: new Date(this.clock.now()).toISOString() };

      // plan: что делаю на этой итерации
      step.plan = await this.executor.plan(state, step);

      // act: применить план
      step.act = await this.executor.act(state, step);

      // test: проверить технически (тесты/линтер/компиляция)
      step.test = await this.executor.test(state, step);

      // review: судит достигнута ли смысловая цель (success criteria)
      step.review = await this.executor.review(state, step);

      // μετάνοια: если не достигнута — переосмыслить.
      // Это НЕ просто retry. Это шаг, на котором execitor рефлексирует
      // прошлый план в свете провала и фиксирует «что я упустил».
      // Записывается в act-историю чтобы следующий plan его учитывал.
      if (!step.review.satisfied) {
        step.metanoia = await this.executor.metanoia?.(state, step) ?? null;
      }

      // tokensUsed суммируется по всем фазам; executor может проставлять его
      // в любую из них (plan/act/test/review/metanoia)
      step.tokensUsed = ['plan','act','test','review','metanoia']
        .reduce((sum, k) => sum + (step[k]?.tokensUsed ?? 0), 0);
      state.tokensUsed += step.tokensUsed;
      state.history.push(step);
      state.updatedAt = new Date(this.clock.now()).toISOString();
      this._save(state);

      if (onStep) await onStep(state, step);

      if (step.review.satisfied) {
        state.status = STATUS.DONE;
        this._save(state);
        return state;
      }
      if (state.tokenBudget !== null && state.tokensUsed >= state.tokenBudget) {
        state.status = STATUS.PAUSED;
        state.pauseReason = 'token-budget-exceeded';
        this._save(state);
        return state;
      }
    }

    // Цикл вышел: либо maxIterations, либо maxSteps, либо pause() сменил status
    if (state.status === STATUS.RUNNING) {
      state.status = state.iteration >= state.maxIterations ? STATUS.FAILED : STATUS.PAUSED;
      if (state.status === STATUS.FAILED) state.failReason = 'max-iterations-exceeded';
      else state.pauseReason = 'max-steps-this-run';
      this._save(state);
    }
    return state;
  }

  pause(id, reason = 'manual') {
    const state = this._load(id);
    if (!state) throw new Error(`goal ${id} not found`);
    if (state.status === STATUS.RUNNING) {
      state.status = STATUS.PAUSED;
      state.pauseReason = reason;
      state.updatedAt = new Date(this.clock.now()).toISOString();
      this._save(state);
    }
    return state;
  }

  cancel(id) {
    const state = this._load(id);
    if (!state) throw new Error(`goal ${id} not found`);
    state.status = STATUS.CANCELLED;
    state.updatedAt = new Date(this.clock.now()).toISOString();
    this._save(state);
    return state;
  }

  get(id) {
    return this._load(id);
  }

  list({ status = null } = {}) {
    if (!existsSync(this.root)) return [];
    const files = readdirSync(this.root).filter(f => f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      try {
        const s = JSON.parse(readFileSync(join(this.root, f), 'utf8'));
        if (!status || s.status === status) out.push(s);
      } catch {}
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  clear(id) {
    const p = this._path(id);
    if (existsSync(p)) unlinkSync(p);
  }

  _path(id) { return join(this.root, `${id}.json`); }

  _save(state) {
    writeFileSync(this._path(state.id), JSON.stringify(state, null, 2));
  }

  _load(id) {
    const p = this._path(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  }
}

GoalEngine.STATUS = STATUS;
