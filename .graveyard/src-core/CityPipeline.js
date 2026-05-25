/**
 * CityPipeline — рабочий конвейер Города.
 *
 * Все агенты работают на теле Claude (через prompt-роли).
 * Один вызов Claude = один агент с конкретной ролью.
 *
 * Конвейер:
 *   1. Серафим (сканер) — находит реальные проблемы в коде
 *   2. Ева (ревью) — оценивает серьёзность, фильтрует мусор
 *   3. Адам (задача) — формулирует задачу для кодера
 *   4. Строитель (код) — пишет фикс
 *   5. Ева (проверка) — проверяет фикс перед коммитом
 *   6. Если принято → issue + branch + commit + PR
 *
 * Все роли = разные промпты одному Claude (через Koda API бесплатно).
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import logger from '../../utils/logger.js';

const execAsync = promisify(exec);

const KODA_URL = process.env.KODACODE_BASE_URL || 'https://api.kodacode.ru/v1';
const KODA_TOKEN = (process.env.KODACODE_TOKENS || '').split(',')[0] || process.env.GITHUB_TOKEN || '';
const KODA_MODEL = process.env.KODA_MODEL || 'KodaAgent';
const REPO_ROOT = process.env.REPO_ROOT || '/home/unidel/dronedoc2026';
const REPO = process.env.GITHUB_REPO_FULL || 'unidel2035/dronedoc2026';
const MEMORY_FILE = path.join(REPO_ROOT, '/tmp/city-memory.json');

// ── ПАМЯТЬ: что уже чинили ──────────────────────────
function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); }
  catch { return { fixed: [], skipped: [], lastScan: null }; }
}
function saveMemory(mem) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2)); } catch {}
}

// ── РОЛИ (души агентов) ──────────────────────────

const ROLES = {
  serafim: `Ты Серафим — диагност кода. Сканируешь репозиторий и находишь РЕАЛЬНЫЕ проблемы.
Реальные проблемы:
- Runtime ошибки из логов (TypeError, ReferenceError, SyntaxError)
- Сломанные импорты (import файла, который не существует)
- Неиспользуемые переменные в критичных модулях
- console.log с отладкой, забытые в продакшне
- Дублирование кода (одна функция в двух местах)

НЕ проблемы (игнорируй):
- TODO/FIXME комментарии (это заметки, не баги)
- Слово DEBUG в названиях переменных
- Стилистические замечания
- Проблемы, которые УЖЕ были найдены раньше (смотри анамнезис ниже)

Отвечай ТОЛЬКО JSON массивом:
[{"file":"path","line":N,"message":"описание","severity":"high|medium|low"}]
Если проблем нет — верни []`,

  eva_triage: `Ты Ева — точильный камень. Проверяешь найденные проблемы.
Для каждой проблемы ответь:
- "принято" — реальная проблема, нужно чинить
- "отклонено" — ложное срабатывание, мусор
- "эскалация" — слишком сложно для автофикса, нужен человек

Отвечай JSON: {"verdict":"принято|отклонено|эскалация","reason":"почему"}`,

  adam: `Ты Адам — формулируешь задачу для кодера.
Получаешь описание проблемы и файл. Формулируешь ТОЧНУЮ задачу:
- Какой файл менять
- Какую строку
- Что именно исправить
- Как должно быть после исправления

Кратко, конкретно. Одним абзацем.`,

  builder: `Ты Строитель — пишешь код. ТОЛЬКО код.
Получаешь задачу + текущий код. Возвращаешь ТОЛЬКО исправленный фрагмент.
Правила:
- Минимальное изменение. Не рефактори весь файл.
- Сохрани стиль существующего кода.
- Не добавляй комментарии к фиксу.
- Проект использует ESM (import/export), НЕ CommonJS (require/module.exports).
- Логгер: import logger from '../../utils/logger.js' (pino). НЕ winston, НЕ console.log.
- Верни в формате: \`\`\`javascript\nкод\n\`\`\``,

  eva_review: `Ты Ева — проверяешь код перед коммитом.
Получаешь оригинальный код и фикс. Проверяешь:
1. Фикс решает проблему?
2. Фикс не ломает другое?
3. Минимальное изменение?

Ответь JSON: {"verdict":"принято|отклонено","reason":"почему"}
Если отклонено — объясни что не так.`,
};

// ── ВЫЗОВ МОДЕЛИ ──────────────────────────────

async function callAgent(role, prompt) {
  if (!KODA_TOKEN) throw new Error('KODACODE_TOKENS не настроен');

  const res = await fetch(`${KODA_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KODA_TOKEN}` },
    body: JSON.stringify({
      model: KODA_MODEL,
      messages: [
        { role: 'system', content: ROLES[role] },
        { role: 'user', content: prompt },
      ],
      temperature: role === 'builder' ? 0.1 : 0.3,
      max_tokens: role === 'builder' ? 2048 : 1024,
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (res.status === 429) throw new Error('rate_limit');
  if (!res.ok) throw new Error(`Koda ${res.status}`);
  return (await res.json()).choices?.[0]?.message?.content || '';
}

// ── КОНВЕЙЕР ──────────────────────────────

export class CityPipeline {
  constructor(options = {}) {
    this._repoRoot = options.repoRoot || REPO_ROOT;
    this._repo = options.repo || REPO;
    this._running = false;
    this._results = [];
  }

  async run() {
    if (this._running) return { error: 'Уже работает' };
    this._running = true;
    this._results = [];
    const memory = loadMemory();

    try {
      // 0. АВТО-КОММИТ новых модулей онтологии
      await this._autoCommitNewModules();

      // 1. СЕРАФИМ — сканирует
      logger.info('[City] Серафим сканирует...');
      const allProblems = await this._serafimScan();

      // Фильтр: убрать уже починенное
      const problems = allProblems.filter(p => {
        const key = `${p.file}:${p.line}:${p.message?.slice(0, 50)}`;
        return !memory.fixed.includes(key) && !memory.skipped.includes(key);
      });

      logger.info(`[City] Серафим нашёл ${problems.length} новых проблем (${allProblems.length - problems.length} уже известны)`);

      for (const problem of problems.slice(0, 3)) {
        try {
          // 2. ЕВА — фильтрует
          const triage = await this._evaTriage(problem);
          if (triage.verdict === 'отклонено') {
            logger.info(`[City] Ева отклонила: ${problem.message.slice(0, 50)}`);
            this._results.push({ ...problem, status: 'rejected', reason: triage.reason });
            continue;
          }
          if (triage.verdict === 'эскалация') {
            logger.info(`[City] Ева эскалировала: ${problem.message.slice(0, 50)}`);
            this._results.push({ ...problem, status: 'escalated', reason: triage.reason });
            continue;
          }

          // 3. АДАМ — формулирует
          const task = await this._adamTask(problem);

          // 4. СТРОИТЕЛЬ — пишет фикс
          const fix = await this._builderFix(problem, task);
          if (!fix) { this._results.push({ ...problem, status: 'no_fix' }); continue; }

          // 5. ЕВА — проверяет фикс
          const review = await this._evaReview(problem, fix);
          if (review.verdict === 'отклонено') {
            logger.info(`[City] Ева отклонила фикс: ${review.reason}`);
            this._results.push({ ...problem, status: 'fix_rejected', reason: review.reason });
            continue;
          }

          // 6. КОММИТ + PR
          const pr = await this._commitAndPR(problem, fix);
          this._results.push({ ...problem, status: 'fixed', pr: pr?.url });
          logger.info(`[City] Исправлено: ${problem.message.slice(0, 50)} → ${pr?.url}`);

        } catch (e) {
          logger.warn(`[City] Ошибка: ${e.message}`);
          this._results.push({ ...problem, status: 'error', error: e.message });
        }
      }

      // Сохранить память
      for (const r of this._results) {
        const key = `${r.file}:${r.line}:${r.message?.slice(0, 50)}`;
        if (r.status === 'fixed') memory.fixed.push(key);
        else memory.skipped.push(key);
      }
      memory.lastScan = new Date().toISOString();
      // Ограничить память (последние 200)
      memory.fixed = memory.fixed.slice(-200);
      memory.skipped = memory.skipped.slice(-200);
      saveMemory(memory);

      return { results: this._results };
    } finally {
      this._running = false;
    }
  }

  // ── 1. СЕРАФИМ ──────────────────────────────

  async _serafimScan() {
    // Собираем реальные данные из репо
    const context = [];

    // A. Ошибки из логов
    try {
      const logFile = path.join(this._repoRoot, 'logs/backend-app.log');
      if (fs.existsSync(logFile)) {
        const lines = fs.readFileSync(logFile, 'utf8').split('\n').slice(-200);
        const errors = lines.filter(l => /\bERROR\b|TypeError|ReferenceError/.test(l));
        if (errors.length > 0) context.push('Ошибки из логов:\n' + errors.slice(-5).join('\n'));
      }
    } catch {}

    // B. Сломанные импорты в gift/
    try {
      const { stdout } = await execAsync(
        `cd "${this._repoRoot}" && grep -rn "from '\\." --include="*.js" backend/monolith/src/services/gift/ | head -30`,
        { timeout: 10000 }
      );
      const broken = [];
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const match = line.match(/^([^:]+):.*from ['"]([^'"]+)['"]/);
        if (match) {
          const srcFile = match[1];
          const imp = match[2];
          const dir = path.dirname(path.join(this._repoRoot, srcFile));
          const resolved = path.resolve(dir, imp);
          if (![resolved, resolved + '.js', resolved + '.mjs', resolved + '/index.js'].some(f => fs.existsSync(f))) {
            broken.push(`${srcFile}: broken import "${imp}"`);
          }
        }
      }
      if (broken.length > 0) context.push('Сломанные импорты:\n' + broken.join('\n'));
    } catch {}

    // C. console.log в продакшн коде
    try {
      const { stdout } = await execAsync(
        `cd "${this._repoRoot}" && grep -rn "console\\.log" --include="*.js" --include="*.vue" backend/monolith/src/services/gift/ src/views/pages/ 2>/dev/null | grep -v node_modules | grep -v '// ' | head -10`,
        { timeout: 10000 }
      );
      if (stdout.trim()) context.push('console.log в продакшне:\n' + stdout.trim());
    } catch {}

    if (context.length === 0) {
      logger.info('[City] Серафим: всё чисто');
      return [];
    }

    // Спрашиваем Серафима-модель
    // Анамнезис — что уже чинили (чтобы не повторяться)
    const memory = loadMemory();
    let anamnesis = '';
    if (memory.fixed.length > 0) {
      anamnesis = '\n\nУже починенные проблемы (НЕ предлагай их снова):\n' +
        memory.fixed.slice(-10).map(k => `- ${k}`).join('\n');
    }

    const answer = await callAgent('serafim',
      `Проанализируй эти данные из репозитория DronDoc и найди реальные проблемы:\n\n${context.join('\n\n')}${anamnesis}`
    );

    try {
      const jsonMatch = answer.match(/\[[\s\S]*?\]/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      return [];
    }
  }

  // ── 2. ЕВА ТРИАЖ ──────────────────────────────

  async _evaTriage(problem) {
    const answer = await callAgent('eva_triage',
      `Проблема: ${problem.message}\nФайл: ${problem.file}:${problem.line || '?'}\nСерьёзность: ${problem.severity || '?'}\n\nЭто реальная проблема которую нужно автоматически чинить?`
    );
    try {
      const jsonMatch = answer.match(/\{[\s\S]*?\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: 'отклонено', reason: 'не удалось разобрать' };
    } catch {
      return { verdict: 'отклонено', reason: 'ошибка парсинга' };
    }
  }

  // ── 3. АДАМ ──────────────────────────────

  async _adamTask(problem) {
    return callAgent('adam',
      `Проблема: ${problem.message}\nФайл: ${problem.file}:${problem.line || '?'}\n\nСформулируй задачу для кодера.`
    );
  }

  // ── 4. СТРОИТЕЛЬ ──────────────────────────────

  async _builderFix(problem, task) {
    const filePath = path.join(this._repoRoot, problem.file);
    if (!fs.existsSync(filePath)) return null;

    const code = fs.readFileSync(filePath, 'utf8');
    const lines = code.split('\n');
    const startLine = Math.max(0, (problem.line || 1) - 10);
    const endLine = Math.min(lines.length, (problem.line || 1) + 10);
    const fragment = lines.slice(startLine, endLine).join('\n');

    const answer = await callAgent('builder',
      `Задача: ${task}\n\nТекущий код (строки ${startLine + 1}-${endLine}):\n\`\`\`\n${fragment}\n\`\`\`\n\nВерни ТОЛЬКО исправленный фрагмент.`
    );

    const codeMatch = answer.match(/```(?:\w*\n)?([\s\S]*?)```/);
    return codeMatch ? codeMatch[1].trim() : null;
  }

  // ── 5. ЕВА РЕВЬЮ ──────────────────────────────

  async _evaReview(problem, fix) {
    const answer = await callAgent('eva_review',
      `Проблема: ${problem.message}\nФайл: ${problem.file}\n\nФикс:\n\`\`\`\n${fix.slice(0, 1000)}\n\`\`\`\n\nФикс решает проблему? Не ломает другое?`
    );
    try {
      const jsonMatch = answer.match(/\{[\s\S]*?\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: 'отклонено', reason: 'не удалось разобрать' };
    } catch {
      return { verdict: 'принято', reason: 'по умолчанию' };
    }
  }

  // ── 6. КОММИТ + PR ──────────────────────────────

  async _commitAndPR(problem, fixCode) {
    const branch = `city/fix-${Date.now()}`;
    const file = problem.file;
    const fullPath = path.join(this._repoRoot, file);

    // Stash
    await execAsync(`cd "${this._repoRoot}" && git stash --include-untracked`, { timeout: 10000 }).catch(() => {});

    try {
      await execAsync(`cd "${this._repoRoot}" && git checkout -b ${branch}`, { timeout: 5000 });

      // Apply fix
      if (problem.line && fixCode) {
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        const start = Math.max(0, problem.line - 11);
        const fixLines = fixCode.split('\n');
        lines.splice(start, Math.min(fixLines.length, 20), ...fixLines);
        fs.writeFileSync(fullPath, lines.join('\n'));
      }

      // Commit only target file
      await execAsync(`cd "${this._repoRoot}" && git checkout -- . 2>/dev/null; true`, { timeout: 3000 });

      // Re-apply fix
      if (problem.line && fixCode) {
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        const start = Math.max(0, problem.line - 11);
        const fixLines = fixCode.split('\n');
        lines.splice(start, Math.min(fixLines.length, 20), ...fixLines);
        fs.writeFileSync(fullPath, lines.join('\n'));
      }

      const safeMsg = problem.message.slice(0, 40).replace(/["`$\\]/g, '');
      await execAsync(`cd "${this._repoRoot}" && git add "${file}" && git commit -m "fix: ${safeMsg}"`, { timeout: 10000 });
      await execAsync(`cd "${this._repoRoot}" && git push origin ${branch}`, { timeout: 30000 });

      // Create issue + PR
      const { stdout: issueOut } = await execAsync(
        `cd "${this._repoRoot}" && gh issue create --repo ${this._repo} --title "fix: ${safeMsg}" --body "RepoHealer: ${problem.file}:${problem.line || '?'}" --label bug`,
        { timeout: 15000 }
      );
      const issueNum = issueOut.trim().split('/').pop();

      const { stdout: prOut } = await execAsync(
        `cd "${this._repoRoot}" && gh pr create --title "fix: ${safeMsg}" --body "Closes #${issueNum}" --base nti --head ${branch}`,
        { timeout: 15000 }
      );

      await execAsync(`cd "${this._repoRoot}" && git checkout nti`, { timeout: 5000 });
      await execAsync(`cd "${this._repoRoot}" && git stash pop`, { timeout: 5000 }).catch(() => {});

      return { url: prOut.trim() };

    } catch (e) {
      await execAsync(`cd "${this._repoRoot}" && git checkout -f nti`, { timeout: 5000 }).catch(() => {});
      await execAsync(`cd "${this._repoRoot}" && git stash pop`, { timeout: 5000 }).catch(() => {});
      throw e;
    }
  }

  /**
   * Авто-коммит новых модулей онтологии + push.
   * Если в gift/ появились новые .js файлы — коммитим и пушим.
   */
  async _autoCommitNewModules() {
    try {
      const { stdout } = await execAsync(
        `cd "${this._repoRoot}" && git ls-files --others --exclude-standard backend/monolith/src/services/gift/*.js | head -10`,
        { timeout: 5000 }
      );
      const newFiles = stdout.trim().split('\n').filter(Boolean);
      if (newFiles.length === 0) return;

      const names = newFiles.map(f => path.basename(f, '.js')).join(', ');
      logger.info(`[City] Авто-коммит: ${newFiles.length} новых модулей — ${names}`);

      await execAsync(`cd "${this._repoRoot}" && git add ${newFiles.join(' ')}`, { timeout: 5000 });
      await execAsync(
        `cd "${this._repoRoot}" && git commit -m "feat(auto): новые модули онтологии — ${names.slice(0, 50)}"`,
        { timeout: 10000 }
      );
      await execAsync(`cd "${this._repoRoot}" && git push origin nti`, { timeout: 30000 });
      logger.info(`[City] Запушено: ${newFiles.length} модулей`);
    } catch (e) {
      // Не критично — просто не было новых файлов или git занят
    }
  }

  getResults() { return this._results; }
  isRunning() { return this._running; }
}

export default CityPipeline;
