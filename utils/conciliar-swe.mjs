#!/usr/bin/env node
/**
 * conciliar-swe.mjs — соборный SWE-агент.
 *
 * Соборный ответ на Claude Mythos (32-шаговая автономия, SWE-bench 93.9%).
 * Не монолит, делающий всё, а федерация лиц с гейтами на каждом шагу:
 *
 *   PLAN       — 3-голосая полифония: Разведчик / Критик / Архитектор
 *                  если apophatic → выход без кода (структурный отказ)
 *                  если молчание (суббота, кворум) → выход
 *
 *   IMPLEMENT  — Исполнитель (_claude) реализует по dominant-голосу
 *                  каждые N строк — micro-critique от Критика
 *                  если Критик kata с большим авторитетом → метанойя-флаг
 *
 *   REVIEW     — вторая полифония по готовому diff
 *                  Критик / Хранитель / Старший
 *                  dissent blocks commit
 *
 *   GATE       — (опционально) Эпиклеза: вопрос человеку через HumanOracleInbox
 *
 *   COMMIT     — как дар, с полями Получатель / Телос
 *
 * Использование:
 *   node utils/conciliar-swe.mjs --issue 229 [--dry-run] [--no-commit]
 *   node utils/conciliar-swe.mjs --task "текст задачи" [--dry-run]
 *
 * --dry-run    — без subagents, статические голоса (для демонстрации архитектуры)
 * --no-commit  — остановиться перед git commit (только diff)
 *
 * Богословский корень:
 *   Деян 15 — Апостольский собор. Решение: «изволися Духу Святому и нам».
 *   Не один авторитет диктует, не голосование усредняет — полифония с
 *   апофатическими паузами и epiclesis-запросом.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PolyphonyOrchestrator, VoiceSource } from './polyphony-orchestrator.mjs';
import { ConciliarSilence } from '../src/theology/ConciliarSilence.js';
import { cleanEnv } from './clean-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = resolve(ROOT, 'data', 'conciliar-swe');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const NO_COMMIT = argv.includes('--no-commit');
const ISSUE = argv.includes('--issue') ? parseInt(argv[argv.indexOf('--issue') + 1]) : null;
const TASK  = argv.includes('--task')  ? argv[argv.indexOf('--task') + 1] : null;

if (!ISSUE && !TASK) {
  console.error('Использование: node utils/conciliar-swe.mjs --issue <N> | --task "текст" [--dry-run] [--no-commit]');
  process.exit(1);
}

// ── Structural checks ──────────────────────────────────────────────────────
async function preflightSilence(question) {
  const silence = new ConciliarSilence();
  const check = await silence.examine({
    voices: ['Разведчик', 'Критик', 'Архитектор'],
    question,
  });
  return check;   // { allowed, kind, reason }
}

// ── Загрузка задачи ────────────────────────────────────────────────────────
function ghEnv() { return cleanEnv({ GITHUB_TOKEN: '' }); }

async function loadTask() {
  if (TASK) return { kind: 'inline', title: TASK.slice(0, 80), body: TASK, number: null };
  try {
    const raw = execSync(`gh issue view ${ISSUE} --json number,title,body,labels`,
      { encoding: 'utf8', env: ghEnv() });
    const data = JSON.parse(raw);
    return { kind: 'issue', title: data.title, body: data.body, number: data.number };
  } catch (e) {
    throw new Error(`не могу загрузить issue #${ISSUE}: ${e.message.split('\n')[0]}`);
  }
}

// ── Голоса ─────────────────────────────────────────────────────────────────
function buildPlanOrchestrator({ task }) {
  const o = new PolyphonyOrchestrator({ parallel: true });
  const q = `Задача:\n${task.title}\n\n${task.body || ''}`;

  if (DRY) {
    return o
      .addSource(VoiceSource.static({
        persona: 'Разведчик', logos: 'para',
        content: `[dry] Контекст: задача требует различения — что уже есть в кодовой базе для ${task.title.slice(0, 40)}.`,
      }))
      .addSource(VoiceSource.static({
        persona: 'Критик', logos: 'kata',
        content: `[dry] Возражение: прежде чем писать код, проверь — не решена ли задача структурно (как perichoresis для троичной пустыни).`,
      }))
      .addSource(VoiceSource.static({
        persona: 'Архитектор', logos: 'hyper',
        content: `[dry] Различение: задача относится к классу "заполнение нити X→Y". Путь: новый примитив в src/ + регистрация акта в W.`,
      }));
  }

  return o
    .addSource(VoiceSource.claudeSubagent('Explore', {
      persona: 'Разведчик', logos: 'para', timeout: 90_000,
      promptWrap: t => `Ты — Разведчик в соборе. Logos para. Исследуй контекст задачи в репозитории @unidel/gift. ${t}\n\nОтвет: 3-5 предложений. Какие файлы релевантны? Какие уже решения рядом?`,
    }))
    .addSource(VoiceSource.claudeSubagent('code-reviewer', {
      persona: 'Критик', logos: 'kata', timeout: 90_000,
      promptWrap: t => `Ты — Критик в соборе. Logos kata. ${t}\n\nОспорь очевидное решение. Что может быть НЕ-задачей (структурно решается без кода)? Что упускается? 3-5 предложений.`,
    }))
    .addSource(VoiceSource.claudeSubagent('Plan', {
      persona: 'Архитектор', logos: 'hyper', timeout: 120_000,
      promptWrap: t => `Ты — Архитектор в соборе. Logos hyper — превосходящее различение. ${t}\n\nДай архитектурный план: файлы для создания/правки, ключевые операции, богословский корень (если есть). Кратко, по сути.`,
    }));
}

function buildReviewOrchestrator({ task, diff }) {
  const o = new PolyphonyOrchestrator({ parallel: true });
  const q = `Задача: ${task.title}\n\nDiff:\n${diff.slice(0, 8000)}\n\nОцени: выполнен ли телос?`;

  if (DRY) {
    return o
      .addSource(VoiceSource.static({
        persona: 'Критик', logos: 'kata',
        content: `[dry review] Проверь: не добавлены ли скрытые мутации, есть ли тесты, соблюдается ли irreversible.`,
      }))
      .addSource(VoiceSource.static({
        persona: 'Хранитель', logos: 'hyper',
        content: `[dry review] Историческая память: соответствует ли стилю предыдущих примитивов в src/theology?`,
      }))
      .addSource(VoiceSource.static({
        persona: 'Старший', logos: 'hyper',
        content: `[dry review] Телос выполнен: задача получила структурный ответ. Коммит допустим.`,
      }));
  }

  return o
    .addSource(VoiceSource.claudeSubagent('code-reviewer', {
      persona: 'Критик', logos: 'kata', timeout: 90_000,
      promptWrap: _ => `Критик. Оспорь коммит:\n${q}\n\nЧто не так? Ищи баги, нарушения инвариантов, скрытые регрессии.`,
    }))
    .addSource(VoiceSource.claudeSubagent('Explore', {
      persona: 'Хранитель', logos: 'hyper', timeout: 90_000,
      promptWrap: _ => `Хранитель истории. ${q}\n\nСравни с прошлыми решениями в репо. Соответствует ли стилю?`,
    }))
    .addSource(VoiceSource.claudeSubagent('Plan', {
      persona: 'Старший', logos: 'hyper', timeout: 90_000,
      promptWrap: _ => `Старший. ${q}\n\nРазличи: выполнен ли телос? Разрешить ли коммит?`,
    }));
}

// ── Фазы ───────────────────────────────────────────────────────────────────
async function phasePlan(task) {
  console.log('\n══ PLAN ══\n');
  const question = `Задача:\n${task.title}\n\n${task.body || ''}`;
  const o = buildPlanOrchestrator({ task });
  const t0 = Date.now();

  const logosIcon = { kata: '✗', para: '≈', hyper: '↑' };
  let n = 0;
  const total = o.sources.length;

  const poly = await o.ask(question, {
    onStart({ sources }) {
      console.log(`⟳ PLAN: ${sources.map(s => s.persona).join(' · ')}`);
    },
    onVoice(v) {
      n++;
      const el = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n  [${n}/${total}  ${el}s]  ${logosIcon[v.logos] || '·'} ${v.persona} (${v.logos}):`);
      console.log(`    ${(v.content || '').slice(0, 500).replace(/\n/g, '\n    ')}`);
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n── итог PLAN, ${elapsed}s ──`);
  console.log(poly.toText ? poly.toText() : JSON.stringify(poly));
  return poly;
}

async function phaseImplement({ task, plan }) {
  console.log('\n══ IMPLEMENT ══\n');
  if (DRY) {
    const stub = `# dry-run stub\n# Реальный --dry-run не пишет в файлы\n# Задача: ${task.title}\n# План: dominant = ${plan?.dominant?.persona || '—'}`;
    console.log(stub);
    return { diff: stub, files: [] };
  }

  // Реальная реализация через claude subagent
  const dominant = plan.dominant?.content || (plan.voices?.[0]?.content) || '';
  const prompt = [
    `Ты — Исполнитель в соборе лиц (_claude в матрице @unidel/gift).`,
    `Твой логос — para, твоя работа — воплотить план.`,
    ``,
    `Задача: ${task.title}`,
    ``,
    `План (dominant-голос собора):`,
    dominant,
    ``,
    `Реализуй план. Создай/измени файлы в /home/unidel/gift/.`,
    `Не коммить. Не пиши тесты кроме как в benchmarks/.`,
    `После — выведи краткий отчёт о сделанном.`,
  ].join('\n');

  const { spawn } = await import('node:child_process');
  const out = await new Promise((res, rej) => {
    const child = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT, env: cleanEnv(),
    });
    let o = '', e = '';
    child.stdout.on('data', d => o += d);
    child.stderr.on('data', d => e += d);
    const killer = setTimeout(() => { child.kill('SIGTERM'); rej(new Error('implement timeout')); }, 600_000);
    child.on('close', c => { clearTimeout(killer); c === 0 ? res(o) : rej(new Error(`exit ${c}: ${e.slice(0, 200)}`)); });
    child.stdin.end(prompt);
  });

  console.log(out);

  const diff = execSync('git diff --stat HEAD', { encoding: 'utf8', cwd: ROOT });
  const files = execSync('git diff --name-only HEAD', { encoding: 'utf8', cwd: ROOT })
    .split('\n').filter(Boolean);
  return { diff, files, report: out };
}

async function phaseReview({ task, diff }) {
  console.log('\n══ REVIEW ══\n');
  const o = buildReviewOrchestrator({ task, diff });
  const t0 = Date.now();
  const logosIcon = { kata: '✗', para: '≈', hyper: '↑' };
  let n = 0;
  const total = o.sources.length;

  const poly = await o.ask(`review diff for ${task.title}`, {
    onStart({ sources }) { console.log(`⟳ REVIEW: ${sources.map(s => s.persona).join(' · ')}`); },
    onVoice(v) {
      n++;
      const el = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n  [${n}/${total}  ${el}s]  ${logosIcon[v.logos] || '·'} ${v.persona} (${v.logos}):`);
      console.log(`    ${(v.content || '').slice(0, 500).replace(/\n/g, '\n    ')}`);
    },
  });
  const el = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n── итог REVIEW, ${el}s ──`);
  console.log(poly.toText ? poly.toText() : JSON.stringify(poly));
  return poly;
}

async function phaseCommit({ task, plan, review }) {
  if (NO_COMMIT || DRY) {
    console.log('\n══ COMMIT (skipped) ══\n');
    return null;
  }
  console.log('\n══ COMMIT ══\n');

  const giftHeader = `gift(Дионисий): соборно — ${task.title.slice(0, 60)}`;
  const body = [
    '',
    `Получатель: _koinon (соборное решение)`,
    `Телос: выполнение задачи через полифонию, не монолитом`,
    `Фазы: PLAN (polyphony) → IMPLEMENT → REVIEW (polyphony)`,
    `PLAN dominant: ${plan.dominant?.persona || '⟨apophatic⟩'}`,
    `REVIEW dominant: ${review.dominant?.persona || '⟨apophatic⟩'}`,
    task.number ? `(closes #${task.number})` : '',
  ].filter(Boolean).join('\n');

  const msg = giftHeader + '\n\n' + body;
  try {
    execSync('git add -A', { cwd: ROOT });
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: ROOT, stdio: 'inherit' });
    console.log('\n✓ commit сделан');
    return { msg };
  } catch (e) {
    console.log('commit failed:', e.message);
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const task = await loadTask();
  console.log(`\n╔══ Соборный SWE-агент ══╗`);
  console.log(`║ ${task.kind === 'issue' ? `issue #${task.number}` : 'inline task'}: ${task.title.slice(0, 60)}`);
  console.log(`║ dry-run: ${DRY} | no-commit: ${NO_COMMIT}`);
  console.log(`╚════════════════════════╝\n`);

  // Gate 1 — структурное молчание?
  const silence = await preflightSilence(task.title);
  if (!silence.allowed) {
    console.log(`⟨молчание⟩ ${silence.kind}: ${silence.reason}`);
    console.log(`Собор не собирается. Повторите позже.`);
    process.exit(0);
  }

  // Phase 1 — PLAN (polyphony)
  const plan = await phasePlan(task);
  if (plan.type === 'Silence') {
    console.log(`План не собрался: ${plan.reason}`);
    process.exit(0);
  }
  if (plan.apophatic) {
    console.log(`\n⟨apophatic⟩ собор не сходится в плане. Задача требует решения Дионисия.`);
    if (task.number) {
      try {
        execSync(`gh issue comment ${task.number} --body "Соборный агент: план апофатичен. Голоса собраны, dominant не выделен. Требуется различение Дионисия."`,
          { env: ghEnv(), stdio: 'inherit' });
      } catch {}
    }
    process.exit(0);
  }

  // Phase 2 — IMPLEMENT
  const impl = await phaseImplement({ task, plan });
  if (!impl.diff || impl.diff.trim() === '') {
    console.log('Исполнитель не произвёл diff. Завершение.');
    process.exit(0);
  }

  // Phase 3 — REVIEW (polyphony)
  const review = await phaseReview({ task, diff: impl.diff });
  if (review.apophatic) {
    console.log(`\n⟨apophatic⟩ собор не сходится в review. Метанойя: diff не коммитится.`);
    process.exit(0);
  }

  // Проверка: есть ли критический kata-голос против?
  const kataVoices = review.byLogos?.kata || [];
  const strongKata = kataVoices.find(v => v.authority > (review.dominant?.authority || 0) * 0.8);
  if (strongKata) {
    console.log(`\n⚠ kata-голос ${strongKata.persona}: ${strongKata.content.slice(0, 200)}`);
    console.log(`Диф сохранён, но НЕ коммитится без различения Дионисия.`);
    process.exit(0);
  }

  // Phase 4 — COMMIT
  await phaseCommit({ task, plan, review });

  // Journal
  const journalFile = resolve(LOG_DIR, `run-${Date.now()}.json`);
  writeFileSync(journalFile, JSON.stringify({
    task, plan: plan.toJSON?.() || plan, review: review.toJSON?.() || review,
    at: new Date().toISOString(),
  }, null, 2));
  console.log(`\n── journal: ${journalFile}`);
})().catch(e => {
  console.error('соборный агент упал:', e.message);
  process.exit(1);
});
