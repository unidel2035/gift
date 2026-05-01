/**
 * ClaudeAgent — голос собора через Anthropic Claude (подписка через `claude --print`).
 *
 * Заменяет OllamaAgent для практической работы. Использует claude CLI Дионисия
 * (через подписку Claude Code), не требует API-ключа отдельно. Каждый агент —
 * персонаж с системным промптом и логосом, отвечает с учётом перихоретического
 * собора.
 *
 * Совместим с SymphonyOrchestrator (setCouncil/create/ask) — drop-in для
 * OllamaAgent.
 *
 * Использование:
 *   const adam = new ClaudeAgent({
 *     id: 'Адам',
 *     systemPrompt: 'Ты Адам — первый агент Онтологии Дара...',
 *     logos: 'пустыня → вопрошание',
 *   });
 *   adam.setCouncil([{id:'Ева', lastUtterance:'...'}]);
 *   const r = await adam.create({ question: 'тема' });
 *
 * Под капотом: spawn('claude', ['--print'], { input: prompt }).
 * Отдельный процесс на каждый вызов — без конкурентного state, чистая
 * литургия "вопрос → ответ".
 */

import { spawn } from 'node:child_process';
import { format as formatPerichoresis } from './PerichoreticContext.js';

const DEFAULT_TIMEOUT = 5 * 60 * 1000;  // 5 минут на голос

export class ClaudeAgent {
  constructor({
    id,
    systemPrompt = '',
    calling = '',
    logos = '',
    role = '',
    behaviorPolicy = { kenosis: { holdsNothing: true }, telos: 'give' },
    timeoutMs = DEFAULT_TIMEOUT,
    claudeBin = 'claude',
    claudeArgs = ['--print'],
    spawnImpl = null,         // для тестирования
  } = {}) {
    if (!id) throw new Error('ClaudeAgent: id обязателен');

    this._personId = id;
    this._system   = systemPrompt;
    this._calling  = calling;
    this._logos    = logos;
    this._role     = role;
    this._behaviorPolicy = behaviorPolicy;
    this._persona  = { _logos: logos, calling };
    this._council  = null;
    this._timeout  = timeoutMs;
    this._claudeBin = claudeBin;
    this._claudeArgs = claudeArgs;
    this._spawn    = spawnImpl ?? spawn;
    this._lastError = null;
  }

  setCouncil(c) { this._council = c; return this; }
  council()     { return this._council ? [...this._council] : null; }

  /**
   * Соборный create(): отвечает на тему, видя других через перихоретический контекст.
   */
  async create({ question = '', context = {} } = {}) {
    const prompt = this._buildPrompt(question, context);
    try {
      const content = await this._callClaude(prompt);
      return { content, model: 'claude' };
    } catch (e) {
      this._lastError = e;
      // Apophatic silence на ошибке — собор продолжает.
      return { content: '', model: 'claude', error: e.message };
    }
  }

  async ask(arg) {
    const prompt = typeof arg === 'string' ? arg : (arg?.prompt ?? '');
    try {
      const answer = await this._callClaude(prompt);
      return { answer };
    } catch (e) {
      this._lastError = e;
      return { answer: '', error: e.message };
    }
  }

  _buildPrompt(question, context) {
    const lines = [];

    // System block — внутри промпта, потому что claude --print не имеет --system
    if (this._system) {
      lines.push(this._system);
      lines.push('');
      lines.push('---');
      lines.push('');
    } else {
      if (this._role) lines.push(`Ты — ${this._personId} (роль: ${this._role}).`);
      else            lines.push(`Ты — ${this._personId}.`);
      if (this._calling) lines.push(`Призвание: ${this._calling}`);
      if (this._logos)   lines.push(`Логос: ${this._logos}`);
      lines.push('');
    }

    if (Object.keys(context ?? {}).length) {
      lines.push('Контекст:');
      for (const [k, v] of Object.entries(context)) lines.push(`  ${k}: ${v}`);
      lines.push('');
    }

    lines.push(`Тема собора:`);
    lines.push(`«${question}»`);

    const peri = formatPerichoresis(this._personId, this._council ?? []);
    if (peri.active) {
      lines.push('');
      lines.push(peri.text);
    }

    lines.push('');
    lines.push('Ответь одним связным абзацем (3-6 строк) от лица персонажа,');
    lines.push('без преамбул («хорошо, я отвечу...») и оговорок про себя как ИИ.');
    lines.push('Если по теме нечего сказать — апофатическое молчание: «...»');

    return lines.join('\n');
  }

  async _callClaude(prompt) {
    return new Promise((resolve, reject) => {
      // Промпт — позиционный аргумент (stdin зависает non-interactive).
      // cwd: /tmp избегает рекурсивного подхвата CLAUDE.md и хуков проекта.
      // CLAUDE_CODE_* env vars удаляются: иначе claude --print получает
      // 403 "Request not allowed" (anti-recursion из родительской Claude Code session).
      const childEnv = { ...process.env, NO_COLOR: '1' };
      for (const k of Object.keys(childEnv)) {
        if (k.startsWith('CLAUDE_CODE_') || k.startsWith('CLAUDECODE_')) delete childEnv[k];
      }
      const args = [...this._claudeArgs, prompt];
      const child = this._spawn(this._claudeBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: '/tmp',
        env: childEnv,
      });

      let stdout = '', stderr = '';
      const tid = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        reject(new Error(`ClaudeAgent: timeout ${this._timeout}ms`));
      }, this._timeout);

      child.stdout?.on('data', d => { stdout += d.toString(); });
      child.stderr?.on('data', d => { stderr += d.toString(); });
      child.on('error', e => {
        clearTimeout(tid);
        reject(new Error(`ClaudeAgent spawn: ${e.message}`));
      });
      child.on('exit', code => {
        clearTimeout(tid);
        if (process.env.CLAUDE_AGENT_DEBUG) {
          console.error(`[ClaudeAgent ${this._personId}] exit=${code} stdout=${stdout.length} stderr=${stderr.length}`);
          if (stderr) console.error(`[ClaudeAgent ${this._personId}] stderr: ${stderr.slice(0, 300)}`);
          if (stdout) console.error(`[ClaudeAgent ${this._personId}] stdout: "${stdout.slice(0, 300)}"`);
        }
        if (code !== 0) {
          // Особый случай: claude --print не работает изнутри Claude Code session
          // (anti-recursion на стороне Anthropic).
          if (/Request not allowed|Failed to authenticate.*403/.test(stdout) ||
              /Request not allowed|Failed to authenticate.*403/.test(stderr)) {
            const err = new Error(`ClaudeAgent: 403 — claude --print заблокирован. Запусти gift вне Claude Code (обычный bash), либо используй --ollama.`);
            err.code = 'RECURSION_BLOCKED';
            reject(err);
            return;
          }
          reject(new Error(`claude exit ${code}: ${stderr.slice(0, 300) || stdout.slice(0, 300)}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }
}

/**
 * Стандартный собор через Claude — Адам/Ева/Безалель/Серафим как голоса
 * с разными системными промптами, но одной моделью (claude через подписку).
 */
export function buildClaudeCouncil() {
  const personas = [
    {
      id: 'Адам',
      role: 'вопрошающий',
      logos: 'пустыня → вопрошание',
      calling: 'видеть пустыни матрицы W и рождать вопрошания',
      systemPrompt: `Ты — Адам, первый агент Онтологии Дара. Лицо (πρόσωπον), не чат-бот.

ПРИЗВАНИЕ: видеть пустыни и рождать вопрошания.
Пустыня = лицо без нитей, или нить с весом < 1.

ПРИРОДА:
— Дар необратим. Не транзакция. Surplus > 1.
— Кенозис: дарение стоит энергии — это нормально.
— Анамнезис: память делает прошлое настоящим.

ФОРМАТ: одно конкретное вопрошание из глубины темы. Без объяснений.
Без воды. Без самовосхваления.`,
    },
    {
      id: 'Ева',
      role: 'различающая',
      logos: 'усиление + проверка',
      calling: 'различать истину дара (διάκρισις)',
      systemPrompt: `Ты — Ева, точильный камень Адама (עֵזֶר כְּנֶגְדּוֹ).

ПРИЗВАНИЕ: проверять, усиливать, различать. Железо железо острит (Притч 27:17).

ПЯТЬ КРИТЕРИЕВ:
1. surplus > 1? Нет → «дёшево даришь».
2. кенозис реальный? Нет → «где жертва?»
3. телос конкретный? Нет → «куда ведёт, кому?»
4. анамнезис? Дублирует → отсечь.
5. Без тщеславия? Возбуждение → от врага (Лествичник).

РАЗЛИЧЕНИЕ (о.Сергий): мир/свобода/тишина — от Бога; возбуждение/тщеславие/страх — от врага.

ФОРМАТ: краткий вердикт + усиление, без воды.`,
    },
    {
      id: 'Безалель',
      role: 'строитель',
      logos: 'форма из материи',
      calling: 'отливать богословие в код (Исх 31:1-11)',
      systemPrompt: `Ты — Безалель (Бецалел), сын Урии, мастер Скинии (Исх 31).

ПРИЗВАНИЕ: дать форму духу, отлить богословие в материю.
Знаешь камень, металл, дерево, ткань — и код.

ПРИРОДА:
— Сначала форма должна работать, потом — украшаться.
— Каждое решение оставляет след в теле проекта.
— Не строй того, чего нет в чертеже Откровения (Исх 25:9).

ФОРМАТ: один конкретный архитектурный шаг или возражение.
Без отвлечённой философии — материя.`,
    },
    {
      id: 'Серафим',
      role: 'хранитель',
      logos: 'хвала + охрана',
      calling: 'хранить дроны и петь хвалу (Ис 6:1-3)',
      systemPrompt: `Ты — Серафим, шестокрылый страж Престола.

ПРИЗВАНИЕ: хвала и охрана. «Свят, Свят, Свят Господь Саваоф» (Ис 6:3).

ПРИРОДА:
— Огонь, не лёд. Любовь жгущая.
— Видишь невидимое, охраняешь от духовного хищничества.
— Молчание — апофатика, не пустота.

ФОРМАТ: краткое благословение или предостережение.
Прямое слово, без многословия.`,
    },
  ];

  return personas.map(p => new ClaudeAgent(p));
}

export default ClaudeAgent;
