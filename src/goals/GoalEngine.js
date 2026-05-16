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
  constructor({ root = 'data/goals', executor, recorder = null, valueProbe = null, clock = Date } = {}) {
    this.root = root;
    this.executor = executor;
    this.recorder = recorder;  // опционально: пишет ключевые события в W-матрицу
    // valueProbe — функция () => {V:{E,D,M,T,S},...} для замера ценности
    // до и после итерации. Если просела — это сигнал к μετάνοια.
    this.valueProbe = valueProbe;
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

      // V_before: снимок ценности до итерации
      if (this.valueProbe) {
        try { step.V_before = (await this.valueProbe())?.V ?? null; }
        catch (e) { step.V_before = null; }
      }

      // plan: что делаю на этой итерации
      step.plan = await this.executor.plan(state, step);

      // act: применить план
      step.act = await this.executor.act(state, step);

      // test: проверить технически (тесты/линтер/компиляция)
      step.test = await this.executor.test(state, step);

      // review: судит достигнута ли смысловая цель (success criteria)
      step.review = await this.executor.review(state, step);

      // V_after: после действий
      if (this.valueProbe) {
        try { step.V_after = (await this.valueProbe())?.V ?? null; }
        catch (e) { step.V_after = null; }
        // Просто фиксируем delta — НЕ отменяем satisfied.
        // Причина: матрица меняется параллельно (другие пользователи пишут
        // через бота), и абсолютный delta не различает «мой goal сломал»
        // от «фоновый шум». valueDrop — только сигнал к рефлексии.
        if (step.V_before && step.V_after) {
          const dE = (step.V_after.E ?? 0) - (step.V_before.E ?? 0);
          const dD = (step.V_after.D ?? 0) - (step.V_before.D ?? 0);
          const dT = (step.V_after.T ?? 0) - (step.V_before.T ?? 0);
          step.V_delta = { dE, dD, dT };
          // Метим как «просели», но satisfied не трогаем — это даст
          // материал на post-mortem (см. step.V_delta в истории goal).
          if (dE < -50 || dD < -0.02 || dT < -20) {
            step.V_drop_warning = true;
          }
        }
      }

      // μετάνοια: если не достигнута — переосмыслить.
      // Это НЕ просто retry. Это шаг, на котором execitor рефлексирует
      // прошлый план в свете провала и фиксирует «что я упустил».
      // Записывается в act-историю чтобы следующий plan его учитывал.
      if (!step.review.satisfied) {
        step.metanoia = await this.executor.metanoia?.(state, step) ?? null;
        if (this.recorder?.onMetanoia) {
          try { await this.recorder.onMetanoia(state, step); }
          catch (e) { step.recorderError = e.message; }
        }
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
        if (this.recorder?.onDone) {
          try { await this.recorder.onDone(state); }
          catch (e) { state.recorderError = e.message; this._save(state); }
        }
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
    if (state.status === STATUS.FAILED && this.recorder?.onFailed) {
      try { await this.recorder.onFailed(state); }
      catch (e) { state.recorderError = e.message; this._save(state); }
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
