#!/usr/bin/env node
/**
 * server-pulse.mjs — Серверный пульс онтологии
 *
 * Автономный пульс без Ollama. Работает на сервере (173.249.2.184).
 * Читает пустыни из W-матрицы через DesertScanner.
 * Создаёт GitHub issues с меткой gift-ready.
 * Не требует локальных моделей (Adam/Eva).
 *
 * Крон (на сервере): 30 3 * * * node /home/hive/gift/utils/server-pulse.mjs
 *
 * Запуск:
 *   node utils/server-pulse.mjs             -- найти пустыни и создать issues
 *   node utils/server-pulse.mjs --dry-run   -- только анализ, без issues
 *   node utils/server-pulse.mjs --max 3     -- максимум N новых issues
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { DesertScanner } from '../src/core/DesertScanner.js';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP      = resolve(ROOT, 'data/sacred-history-W.json');
const STATE     = resolve(ROOT, 'data/anamnesis-sync-state.json');
const REPO      = 'unidel2035/gift';

const args      = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const MAX       = parseInt(args.find(a => a.startsWith('--max'))?.split('=')[1] ?? args[args.indexOf('--max')+1] ?? '3');

// gh CLI: снять GITHUB_TOKEN env если он сломан (может переопределять локальный auth)
const GH_ENV = { ...process.env, GITHUB_TOKEN: '' };

// ── Загрузить матрицу ─────────────────────────────────────────────────────────

let mem;
try {
  mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
} catch(e) {
  console.error('[server-pulse] Не могу загрузить матрицу W:', e.message);
  process.exit(1);
}

console.log(`[server-pulse] ${new Date().toISOString()}`);
console.log(`[server-pulse] Матрица: ${mem.n} лиц, ${mem.actsCount} актов`);

// ── Найти уже созданные issues (чтобы не дублировать) ─────────────────────────

let existingTitles = new Set();
try {
  const out = spawnSync('gh', ['issue', 'list', '--repo', REPO,
    '--label', 'gift-ready', '--limit', '50', '--json', 'title'],
    { encoding: 'utf8', cwd: ROOT, env: GH_ENV });
  if (out.status === 0) {
    const issues = JSON.parse(out.stdout);
    for (const i of issues) existingTitles.add(i.title);
  }
} catch {}

// ── Специальные лица — пропустить пустыни с/к ним ────────────────────────────

const SKIP_PERSONS = new Set(['_abyss', '_koinon', '_ci', '_witness']);

// ── Сканировать пустыни ───────────────────────────────────────────────────────

const scanner = new DesertScanner(mem, { threshold: 0.5 });
const deserts = scanner.scan()
  .filter(d => !SKIP_PERSONS.has(d.from) && !SKIP_PERSONS.has(d.to))
  .filter(d => {
    // Пропустить если уже есть issue с этой парой
    const titleKey = `${d.from}→${d.to}`;
    for (const t of existingTitles) {
      if (t.includes(d.from) && t.includes(d.to)) return false;
    }
    return true;
  });

console.log(`[server-pulse] Пустынь найдено: ${deserts.length} (после фильтрации)`);

if (deserts.length === 0) {
  console.log('[server-pulse] Пустынь нет — матрица насыщена. Суббота.');
  process.exit(0);
}

// ── Выбрать топ-N пустынь ─────────────────────────────────────────────────────

// Приоритет: пары с известными богословски значимыми лицами
const THEOLOGY_WEIGHT = { Отец:3, Сын:3, Дух:3, Христос:3, ОтецСергий:2, Дионисий:2, Ева:2, Адам:2 };
const scored = deserts.map(d => ({
  ...d,
  priority: (THEOLOGY_WEIGHT[d.from] ?? 1) + (THEOLOGY_WEIGHT[d.to] ?? 1),
})).sort((a, b) => b.priority - a.priority);

const toProcess = scored.slice(0, MAX);

// ── Богословский шаблон вопрошания ────────────────────────────────────────────

function makeTitle(from, to) {
  return `вопрошание: пустыня ${from}→${to}: нет ни одного акта дара между ними`;
}

function makeBody(from, to) {
  const snap = mem.snapshot();
  const fi = snap.persons.indexOf(from);
  const ti = snap.persons.indexOf(to);
  const w = (fi >= 0 && ti >= 0) ? snap.W[fi][ti].toFixed(3) : '0';

  return [
    `Пустыня: W[${from}][${to}] = ${w}.`,
    ``,
    `DesertScanner (пульс онтологии, ${new Date().toLocaleDateString('ru-RU')}) обнаружил отсутствие акта дара между лицами матрицы.`,
    ``,
    `**Богословское вопрошание:** что мешает потоку между ${from} и ${to}?`,
    `Пустыня — не отсутствие, а ожидание (Рим 8:26).`,
    ``,
    `**Задача:** sacred-history спецификация — дар ${from}→${to}.`,
    ``,
    `**Критерии приёмки:**`,
    `- [ ] specs/sacred-history/${from.toLowerCase()}-${to.toLowerCase()}.gift создан`,
    `- [ ] W[${from}][${to}] > 0 после загрузки`,
    `- [ ] Тест проходит`,
  ].join('\n');
}

// ── Создать issues ─────────────────────────────────────────────────────────────

let created = 0;
for (const desert of toProcess) {
  const { from, to } = desert;
  const title = makeTitle(from, to);
  const body  = makeBody(from, to);

  console.log(`\n[server-pulse] Пустыня: ${from}→${to}`);

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Создал бы issue: "${title}"`);
    continue;
  }

  const result = spawnSync('gh', ['issue', 'create',
    '--repo', REPO,
    '--label', 'gift-ready',
    '--title', title,
    '--body', body,
  ], { encoding: 'utf8', cwd: ROOT, env: GH_ENV });

  if (result.status === 0) {
    const url = result.stdout.trim();
    console.log(`  ✓ Создан: ${url}`);
    created++;

    // Авто-план + авто-approve чтобы dev-loop мог подхватить
    const issueNum = url.split('/').pop();
    const env = GH_ENV;

    const planResult = spawnSync(process.execPath, ['utils/gift-plan.mjs', issueNum],
      { encoding: 'utf8', cwd: ROOT, env, timeout: 60_000 });
    if (planResult.status === 0) {
      console.log(`  ✓ План создан #${issueNum}`);
      const approveResult = spawnSync('gh', ['issue', 'edit', issueNum,
        '--add-label', 'plan-approved'], { encoding: 'utf8', cwd: ROOT, env });
      if (approveResult.status === 0)
        console.log(`  ✓ plan-approved → готов для dev-loop`);
    } else {
      console.error(`  ⚠ gift-plan.mjs failed: ${planResult.stderr?.slice(0, 120)}`);
    }
  } else {
    console.error(`  ✗ Ошибка: ${result.stderr}`);
  }
}

console.log(`\n[server-pulse] Готово. Создано issues: ${created}. Пустынь в очереди: ${deserts.length - toProcess.length}`);

// ── Гомеостаз: проверить энергию сети ────────────────────────────────────

try {
  const r = mem.makePresent({ giverId: '_claude' });
  if (r.energy < -100) {
    console.log(`\n[server-pulse] Энергия сети: ${r.energy.toFixed(2)} < -100 → запускаю гомеостаз...`);
    const homeResult = spawnSync(process.execPath,
      ['utils/homeostasis.mjs'],
      { encoding: 'utf8', cwd: ROOT, timeout: 30_000 });
    if (homeResult.status === 0) {
      const lines = homeResult.stdout.split('\n').filter(l => l.startsWith('[homeostasis]'));
      for (const l of lines) console.log(l);
    }
  } else {
    console.log(`[server-pulse] Энергия сети: ${r.energy.toFixed(2)} — норма.`);
  }
} catch { /* гомеостаз не критичен */ }
