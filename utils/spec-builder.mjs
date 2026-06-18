#!/usr/bin/env node
/**
 * spec-builder.mjs — агент-конструктор исполняемых спецификаций.
 *
 * Принимает текст запроса (от предпринимателя / постановки задачи) и генерирует
 * черновик .spec.mjs файла с INVARIANTS + METRICS + genScenario.
 *
 * Использование:
 *   node utils/spec-builder.mjs "нужен дрон 40 мин полёта, GPS-denied, без оператора" --out specs/executable/my-group.spec.mjs
 *   node utils/spec-builder.mjs --file path/to/tz.txt --out specs/executable/group3.spec.mjs
 *   node utils/spec-builder.mjs --issue 42 --out specs/executable/issue-42.spec.mjs
 *
 * После генерации — сразу прогоняет spec-gate и показывает первый результат.
 *
 * Архитектура:
 *   Запрос → LLM-агент (claude --print) → черновик .spec.mjs → spec-runner → GREEN/RED
 *
 * Агент не "отвечает" — он конструирует код, который сам себя проверяет.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Шаблон спеки (агент заполняет конкретикой) ──────────────────────────────
const SPEC_TEMPLATE = `/**
 * {{TITLE}} — исполняемая спецификация
 * Сгенерировано: spec-builder на основе запроса
 * Группа: {{GROUP}}
 *
 * Запуск: node utils/spec-runner.mjs {{OUT_PATH}} --n 1000
 * gate:   gift spec-gate {{OUT_PATH}}
 */

export const META = {
  id: '{{ID}}',
  title: '{{TITLE}}',
  group: '{{GROUP}}',
  version: '1.0.0',
  challenge: '{{CHALLENGE}}',
};

// ── ГСЧ (детерминированный) ─────────────────────────────────────────────────
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// ── Генератор сценария ──────────────────────────────────────────────────────
export function genScenario(seed) {
  const r = rng(seed);
  // TODO: агент заполняет поля сценария согласно запросу
  return {
    seed,
    // example fields:
    // payload_kg: 0.1 + r() * 2.0,
    // battery_pct: 30 + r() * 70,
    // wind_ms: r() * 15,
  };
}

// ── Оценка метрик ────────────────────────────────────────────────────────────
export function evalScenario(scenario, params = {}) {
  // TODO: агент добавляет физику / расчёты
  return {
    // example metrics:
    // endurance_min: ...,
    // range_km: ...,
  };
}

// ── ИНВАРИАНТЫ ───────────────────────────────────────────────────────────────
export const INVARIANTS = [
  // TODO: агент заполняет предикаты из запроса
  // { id: 'NO-FLY-EMPTY', text: 'Нельзя ...', check: (sc, m) => ... ? { violation: '...', seed: sc.seed } : null },
];

// ── МЕТРИКИ (пороги ТЗ) ──────────────────────────────────────────────────────
export const METRICS = {
  // TODO: агент переводит требования в пороги
  // endurance_min: { '>=': 40 },
  // range_km: { '>=': 30 },
};
`;

// ── Промт для LLM-агента ────────────────────────────────────────────────────
function buildAgentPrompt(request, templatePath, existingSpecs) {
  return `Ты — конструктор исполняемых спецификаций для Мета-КБ беспилотных систем.

ЗАДАЧА: На основе запроса заказчика написать РАБОТАЮЩИЙ .spec.mjs файл.

ЗАПРОС ЗАКАЗЧИКА:
${request}

ФОРМАТ ФАЙЛА (строго соблюдать):
\`\`\`js
// Три обязательных экспорта:
export const META = { id, title, group, version, challenge }
export const INVARIANTS = [{ id, text, check(scenario, metrics) → violation|null }]
export const METRICS = { key: { ">=": val } }  // пороги ТЗ
export function genScenario(seed)  // детерминированный ГСЧ → сценарий
export function evalScenario(scenario, params)  // → метрики (числа)
\`\`\`

ПРАВИЛА:
1. genScenario ОБЯЗАН использовать seed через LCG-rng (функция внизу) → детерминизм
2. INVARIANTS — предикаты (check возвращает объект нарушения или null)
3. METRICS — числовые пороги из запроса заказчика (переведи текст → числа)
4. evalScenario — чистые функции, без сетевых вызовов, только math
5. Комментарии на русском

ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ (вставить в файл):
\`\`\`js
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
\`\`\`

ПРИМЕРЫ ГОТОВЫХ СПЕК ДЛЯ ОРИЕНТИРА:
${existingSpecs}

ВАЖНО: Верни ТОЛЬКО содержимое .mjs файла, без markdown-обёртки, без объяснений.
Файл должен быть синтаксически корректным JavaScript (ESM).`;
}

// ── Получить примеры из готовых спек ────────────────────────────────────────
function loadExampleSpecs() {
  const specFiles = [
    'specs/executable/drone-autonomy.spec.mjs',
    'specs/executable/drone-hw-sovereignty.spec.mjs',
  ];
  const examples = [];
  for (const sf of specFiles) {
    const p = resolve(ROOT, sf);
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf8');
      // берём META + INVARIANTS + METRICS (без evalScenario чтобы не перегружать контекст)
      const lines = content.split('\n');
      const short = lines.slice(0, 55).join('\n');
      examples.push(`--- ${sf} (первые 55 строк) ---\n${short}`);
    }
  }
  return examples.join('\n\n') || '(примеры не найдены)';
}

// ── Вызов claude --print (с fallback на gift agent) ─────────────────────────
function callClaude(prompt) {
  // Сначала пробуем claude --print (работает если авторизован)
  const r1 = spawnSync('claude', ['--print', '--dangerously-skip-permissions', prompt], {
    encoding: 'utf8', timeout: 120_000, env: { ...process.env }, cwd: ROOT,
  });
  if (!r1.error && r1.status === 0 && r1.stdout.trim()) return r1.stdout.trim();

  // Fallback: gift agent (использует подписку через node SDK)
  const giftAgent = resolve(ROOT, 'bin/gift-agent');
  if (existsSync(giftAgent)) {
    const r2 = spawnSync('node', [giftAgent, prompt], {
      encoding: 'utf8', timeout: 120_000, env: { ...process.env }, cwd: ROOT,
    });
    if (!r2.error && r2.status === 0 && r2.stdout.trim()) return r2.stdout.trim();
  }

  console.warn('⚠️  claude недоступен — возвращаю шаблон для ручного заполнения');
  return null;
}

// ── Извлечь JS-код из ответа (убрать markdown если есть) ────────────────────
function extractCode(text) {
  if (!text) return null;
  // Убрать ```js ... ``` обёртку
  const match = text.match(/```(?:js|javascript|mjs)?\n([\s\S]+?)```/);
  if (match) return match[1].trim();
  // Если нет markdown — весь текст
  if (text.includes('export const META') || text.includes('export function genScenario')) {
    return text.trim();
  }
  return null;
}

// ── Прогнать spec-gate на сгенерированной спеке ─────────────────────────────
async function quickGate(specPath) {
  const { runSpec, formatReport } = await import(resolve(ROOT, 'utils/spec-runner.mjs'));
  try {
    const r = await runSpec(specPath, { N: 200 });
    return formatReport(r);
  } catch (e) {
    return `⚠️  spec-runner ошибка: ${e.message}`;
  }
}

// ── Основная функция ─────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // Парсим аргументы
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const fileIdx = args.indexOf('--file');
  const filePath = fileIdx >= 0 ? args[fileIdx + 1] : null;
  const issueIdx = args.indexOf('--issue');
  const issueNum = issueIdx >= 0 ? args[issueIdx + 1] : null;
  const dryRun = args.includes('--dry-run');
  const noGate = args.includes('--no-gate');

  // Получить запрос
  const skipIdxs = new Set([
    ...(outIdx >= 0 ? [outIdx, outIdx + 1] : []),
    ...(fileIdx >= 0 ? [fileIdx, fileIdx + 1] : []),
    ...(issueIdx >= 0 ? [issueIdx, issueIdx + 1] : []),
  ]);
  let request = args
    .filter((a, i) => !a.startsWith('--') && !skipIdxs.has(i))
    .join(' ');

  if (filePath) {
    request = readFileSync(resolve(process.cwd(), filePath), 'utf8');
  } else if (issueNum) {
    try {
      const raw = execFileSync('gh', ['issue', 'view', issueNum, '--json', 'title,body'], { encoding: 'utf8', cwd: ROOT });
      const issue = JSON.parse(raw);
      request = `${issue.title}\n\n${issue.body}`;
    } catch (e) {
      console.error(`Не удалось загрузить issue #${issueNum}: ${e.message}`);
      process.exit(1);
    }
  }

  if (!request.trim()) {
    console.error(`Использование:
  node utils/spec-builder.mjs "запрос" --out specs/executable/my.spec.mjs
  node utils/spec-builder.mjs --file tz.txt --out specs/executable/my.spec.mjs
  node utils/spec-builder.mjs --issue 42 --out specs/executable/issue-42.spec.mjs
  node utils/spec-builder.mjs "запрос" --dry-run   (не сохранять)
  node utils/spec-builder.mjs "запрос" --no-gate   (не прогонять gate после)`);
    process.exit(1);
  }

  // Загрузить примеры
  const existingSpecs = loadExampleSpecs();

  // Построить промт
  const prompt = buildAgentPrompt(request, SPEC_TEMPLATE, existingSpecs);

  console.log(`\n🔨 Конструирую спецификацию по запросу:\n   "${request.slice(0, 120)}..."\n`);

  // Вызвать claude
  const raw = callClaude(prompt);
  const code = raw ? extractCode(raw) : null;

  let finalCode;
  if (code) {
    finalCode = code;
    console.log('✓ Спека сгенерирована агентом');
  } else {
    finalCode = SPEC_TEMPLATE
      .replace(/{{TITLE}}/g, request.slice(0, 60))
      .replace(/{{GROUP}}/g, 'Группа_?_Архипелаг')
      .replace(/{{ID}}/g, 'spec-' + Date.now())
      .replace(/{{CHALLENGE}}/g, 'custom')
      .replace(/{{OUT_PATH}}/g, outPath || 'specs/executable/?.spec.mjs');
    console.log('⚠️  Шаблон для ручного заполнения (claude недоступен)');
  }

  // Вывести или сохранить
  if (dryRun || !outPath) {
    console.log('\n─── Сгенерированная спека ───────────────────────────────');
    console.log(finalCode);
    console.log('─────────────────────────────────────────────────────────\n');
    if (!outPath) console.log('Передайте --out <path> чтобы сохранить и запустить gate.');
    return;
  }

  const absOut = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath);
  writeFileSync(absOut, finalCode, 'utf8');
  console.log(`✓ Записано: ${absOut}`);

  // Прогнать gate
  if (!noGate) {
    console.log('\n─── Первый прогон spec-gate (N=200) ─────────────────────');
    const gateResult = await quickGate(absOut);
    console.log(gateResult);
    console.log('─────────────────────────────────────────────────────────');
    console.log('\nДальше:');
    console.log(`  gift spec-gate ${outPath} --n 2000        # полный прогон`);
    console.log(`  gift spec-gate ${outPath} --json          # машиночитаемо`);
    console.log(`  # Правь METRICS и INVARIANTS пока не GREEN`);
  }
}

main().catch(e => { console.error('spec-builder error:', e.message); process.exit(1); });
