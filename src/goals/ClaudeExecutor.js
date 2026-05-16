/**
 * ClaudeExecutor — реальный executor для GoalEngine.
 *
 * Каждая фаза итерации (plan/act/test/review/metanoia) — отдельный вызов
 * `claude --print`. Это медленнее, чем один большой промпт, но даёт:
 *   - чёткое разделение фаз (плановое лицо ≠ исполнитель ≠ судья);
 *   - возможность подменить любую фазу (например, test = `npm test`, а не LLM);
 *   - читаемые шаги в history (видно где сломалось).
 *
 * test() здесь — настоящий `npm test`, а не LLM-suggestion. Если у цели
 * другой стенд, передай {testCommand: 'npm run e2e'} в конструктор.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const DEFAULT_CLAUDE_BIN = process.env.CLAUDE_BIN
  || (existsSync('/home/new/.local/bin/claude') ? '/home/new/.local/bin/claude' : 'claude');

export class ClaudeExecutor {
  constructor({
    cwd = process.cwd(),
    claudeBin = DEFAULT_CLAUDE_BIN,
    testCommand = ['npm', 'test'],
    timeoutMs = 600_000,        // 10 минут на phase
    testTimeoutMs = 250_000,
    skipPermissions = true,
  } = {}) {
    this.cwd = cwd;
    this.claudeBin = claudeBin;
    this.testCommand = testCommand;
    this.timeoutMs = timeoutMs;
    this.testTimeoutMs = testTimeoutMs;
    this.skipPermissions = skipPermissions;
  }

  // ── plan ────────────────────────────────────────────────────────────────
  async plan(state, step) {
    const lastFail = this._lastFailureSummary(state);
    const prompt = [
      `Цель: ${state.objective}`,
      `Условие успеха: ${state.successCriteria}`,
      `Итерация ${step.n}/${state.maxIterations}`,
      lastFail ? `\nПрошлый провал:\n${lastFail}\n` : '',
      `Задача: напиши КРАТКИЙ план на эту итерацию (3-5 пунктов). Только план, не код.`,
    ].join('\n');
    const text = this._claude(prompt);
    return { text };
  }

  // ── act ─────────────────────────────────────────────────────────────────
  async act(state, step) {
    const prompt = [
      `Цель: ${state.objective}`,
      `Условие успеха: ${state.successCriteria}`,
      `План этой итерации:\n${step.plan.text}`,
      ``,
      `Задача: реализуй этот план в коде. Можешь читать/писать файлы и запускать команды.`,
      `Когда закончил — закоммить изменения в формате: gift(Дионисий): <описание>`,
    ].join('\n');
    const text = this._claude(prompt);
    return { text };
  }

  // ── test ────────────────────────────────────────────────────────────────
  async test(state, step) {
    const [bin, ...args] = this.testCommand;
    const r = spawnSync(bin, args, {
      cwd: this.cwd,
      timeout: this.testTimeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const passed = r.status === 0;
    const output = (r.stdout || '') + (r.stderr || '');
    return {
      passed,
      command: this.testCommand.join(' '),
      output: output.slice(-2000),  // последние 2k символов
    };
  }

  // ── review ──────────────────────────────────────────────────────────────
  async review(state, step) {
    // Если тесты упали — точно не satisfied, не зовём LLM
    if (!step.test?.passed) {
      return {
        satisfied: false,
        reason: `тесты не прошли: ${(step.test?.output || '').slice(-200)}`,
        verdict: 'NOT_YET',
      };
    }
    const prompt = [
      `Цель: ${state.objective}`,
      `Условие успеха: ${state.successCriteria}`,
      `Что было сделано на итерации ${step.n}:\n${(step.act?.text || '').slice(0, 2000)}`,
      `Тесты: прошли (${step.test.command})`,
      ``,
      `Задача: судить, выполнено ли условие успеха.`,
      `Ответь СТРОГО первой строкой:`,
      `  SATISFIED — если условие успеха выполнено целиком`,
      `  NOT_YET — если ещё нет`,
      `Затем 1-2 строки обоснования.`,
    ].join('\n');
    const text = this._claude(prompt);
    const firstLine = (text.split('\n')[0] || '').trim().toUpperCase();
    const satisfied = firstLine.startsWith('SATISFIED');
    return {
      satisfied,
      verdict: satisfied ? 'SATISFIED' : 'NOT_YET',
      reason: text.slice(0, 500),
    };
  }

  // ── μετάνοια ────────────────────────────────────────────────────────────
  // Не «retry с тем же планом». Это шаг рефлексии: что в моём прошлом плане
  // я не увидел? Результат пойдёт в lastFailureSummary для следующего plan().
  async metanoia(state, step) {
    const prompt = [
      `Цель: ${state.objective}`,
      `Условие успеха: ${state.successCriteria}`,
      `На итерации ${step.n}:`,
      `  План был: ${(step.plan?.text || '').slice(0, 600)}`,
      `  Проверка вернула: ${step.review.reason}`,
      ``,
      `μετάνοια (обращение ума): не оправдывайся, не повторяй план.`,
      `Напиши в 2-3 строках: ЧТО Я УПУСТИЛ. Что нужно увидеть иначе на следующем шаге.`,
    ].join('\n');
    const text = this._claude(prompt);
    return { text };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  _claude(prompt) {
    const args = ['--print'];
    if (this.skipPermissions) args.push('--dangerously-skip-permissions');
    const r = spawnSync(this.claudeBin, args, {
      input: prompt,
      cwd: this.cwd,
      timeout: this.timeoutMs,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.error) throw new Error(`claude: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`claude exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
    return r.stdout || '';
  }

  _lastFailureSummary(state) {
    for (let i = state.history.length - 1; i >= 0; i--) {
      const h = state.history[i];
      if (h.metanoia?.text) return h.metanoia.text;
      if (h.review && !h.review.satisfied) return h.review.reason;
    }
    return null;
  }
}
