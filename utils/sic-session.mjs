#!/usr/bin/env node
/**
 * sic-session.mjs — Ситуационно-Инженерный Центр: CLI ведёт команду через 5 фаз.
 *
 * Спека: specs/sic/situational-center.gift
 *
 * Команды:
 *   sic-session new "<вопрошание>" [--team имя] [--skip-kairos]
 *     → создаёт сессию, открывает Проскомидию
 *   sic-session panels <sessionId>
 *     → запускает три панели (Ситуация/Прогноз/Стратегия) параллельно
 *   sic-session sobor <sessionId>
 *     → фаза собора, пока примитивная (сводит тексты трёх панелей в один markdown)
 *   sic-session decide <sessionId> --verdict received|declined [--note "..."]
 *     → фаза Причащения (CAT-10 λῆψις). При received — создаёт план-issues.
 *   sic-session status [<sessionId>]
 *     → статус текущей/конкретной сессии
 *   sic-session list
 *     → все сессии
 *
 * Хранение: data/sic/sessions/<id>/ — manifest.json + phase-*.md
 * Матрица: каждая фаза пишет акт sic:<team> → _koinon или panel:X → sic:<team>.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIC_DIR = resolve(ROOT, 'data/sic/sessions');
const W_SNAP = resolve(ROOT, 'data/sacred-history-W.json');
const SOUL   = resolve(ROOT, 'data/claude-soul.json');

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().split('T')[0]; }
function sid() { return `sic-${Date.now()}`; }

function readJSON(p, def = null) {
  if (!existsSync(p)) return def;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return def; }
}
function writeJSON(p, obj) { writeFileSync(p, JSON.stringify(obj, null, 2)); }

function sessionDir(id) { return join(SIC_DIR, id); }
function manifestPath(id) { return join(sessionDir(id), 'manifest.json'); }

function loadManifest(id) {
  const p = manifestPath(id);
  const m = readJSON(p);
  if (!m) throw new Error(`сессия ${id} не найдена`);
  return m;
}
function saveManifest(id, m) { writeJSON(manifestPath(id), m); }

// ── Kairology: уместна ли сейчас сессия? ────────────────────────────
async function checkKairos() {
  try {
    const mod = await import(resolve(ROOT, 'src/theology/Kairology.js'));
    if (typeof mod.shouldActNow === 'function') {
      return mod.shouldActNow('sic_session');
    }
    if (mod.default && typeof mod.default.shouldActNow === 'function') {
      return mod.default.shouldActNow('sic_session');
    }
  } catch { /* kairology not wired yet */ }
  return { ok: true, reason: 'kairology не подключена — продолжаем по χρόνος' };
}

// ── Запись акта в матрицу через GiftMemory ──────────────────────────
async function recordAct({ from, to, type, weight, content }) {
  try {
    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    if (!existsSync(W_SNAP)) return;
    const mem = GiftMemory.fromSnapshot(readJSON(W_SNAP));
    mem._idx(from);
    mem._idx(to);
    mem.receive({
      giverId: from,
      receiverId: to,
      weight,
      type,
      content,
      irreversible: true,
    });
    writeJSON(W_SNAP, mem.snapshot());
  } catch (e) {
    console.error(`[W warn] ${e.message}`);
  }
}

// ── Фаза 1: Проскомидия — новая сессия ───────────────────────────────
async function cmdNew(args) {
  const question = args[0];
  if (!question || question.startsWith('--')) {
    console.error('Укажи вопрошание: sic-session new "<вопрошание>"');
    process.exit(2);
  }
  const team = flagValue(args, '--team') || 'КомандаДионисия';
  const skipKairos = args.includes('--skip-kairos');

  if (!skipKairos) {
    const k = await checkKairos();
    if (!k.ok) {
      console.log(`\n  ⚠ Kairology: ${k.reason}`);
      console.log('  Для запуска вопреки совету: --skip-kairos\n');
      process.exit(3);
    }
    console.log(`  ✓ Kairology: ${k.reason || 'уместно'}`);
  }

  ensureDir(SIC_DIR);
  const id = sid();
  ensureDir(sessionDir(id));

  const manifest = {
    id,
    team,
    question,
    phase: 'proskomidia',
    createdAt: now(),
    date: today(),
    artifacts: {},
    panels: {},
    sobor: null,
    decision: null,
  };
  saveManifest(id, manifest);

  // Запись проскомидии
  writeFileSync(join(sessionDir(id), 'proskomidia.md'),
    `# Проскомидия — СИЦ ${id}\n\n**Команда:** ${team}\n**Дата:** ${manifest.date}\n\n## Вопрошание\n\n${question}\n`);

  await recordAct({
    from: `sic:${team}`,
    to: '_koinon',
    type: 'question',
    weight: 5,
    content: `СИЦ ${id}: ${question.slice(0, 200)}`,
  });

  console.log(`\n  ✓ Сессия создана: ${id}`);
  console.log(`  Команда: ${team}`);
  console.log(`  Вопрошание: ${question}\n`);
  console.log(`  Следующий шаг: node utils/sic-session.mjs panels ${id}\n`);
}

// ── Фаза 2: Литургия оглашенных — три панели ─────────────────────────
async function cmdPanels(args) {
  const id = args[0];
  const m = loadManifest(id);
  if (m.phase !== 'proskomidia' && m.phase !== 'panels') {
    console.error(`Сессия в фазе ${m.phase}, панели уже отработали.`);
    process.exit(2);
  }

  console.log(`\n  Литургия оглашенных: три панели работают параллельно\n`);

  // ── Панель Ситуация ──
  const situation = renderSituationPanel(m);
  writeFileSync(join(sessionDir(id), 'panel-situation.md'), situation);
  m.panels.situation = { ts: now(), file: 'panel-situation.md' };
  await recordAct({ from: 'panel:situation', to: `sic:${m.team}`, type: 'diagnosis', weight: 3, content: `СИЦ ${id} ситуация` });
  console.log(`  ✓ Ситуация → panel-situation.md`);

  // ── Панель Стратегия ──
  const strategy = renderStrategyPanel(m);
  writeFileSync(join(sessionDir(id), 'panel-strategy.md'), strategy);
  m.panels.strategy = { ts: now(), file: 'panel-strategy.md' };
  await recordAct({ from: 'panel:strategy', to: `sic:${m.team}`, type: 'covenant-reference', weight: 7, content: `СИЦ ${id} стратегия` });
  console.log(`  ✓ Стратегия → panel-strategy.md`);

  // ── Панель Прогноз (требует Ollama/pulse; пока заглушка + напоминание) ──
  const forecast = renderForecastPanel(m);
  writeFileSync(join(sessionDir(id), 'panel-forecast.md'), forecast);
  m.panels.forecast = { ts: now(), file: 'panel-forecast.md' };
  await recordAct({ from: 'panel:forecast', to: `sic:${m.team}`, type: 'vopros', weight: 5, content: `СИЦ ${id} прогноз` });
  console.log(`  ✓ Прогноз → panel-forecast.md`);

  m.phase = 'panels';
  saveManifest(id, m);
  console.log(`\n  Следующий шаг: node utils/sic-session.mjs sobor ${id}\n`);
}

function renderSituationPanel(m) {
  const w = readJSON(W_SNAP) || {};
  const persons = Object.keys(w.persons || {}).length;
  const acts = (w.acts || []).length;
  const topThreads = topN(w, 5);
  return `# Панель Ситуации — СИЦ ${m.id}

**Парадигма:** постнеклассика (пороговая сложность, своевременность).
**Вопрошание:** ${m.question}

## Снимок сейчас

- Лиц в общине: **${persons}**
- Актов: **${acts}**
- Энергия сети: см. claude-anamnesis

## Топ-5 нитей

${topThreads.map(t => `- ${t.from} → ${t.to}: **${t.weight.toFixed(1)}**`).join('\n')}

## Чего не хватает

> _пустыни, асимметрии, энергия-floor — требуется ontology-pulse._

## Вопрос к собору

Что из видимого нарушает инвариант? На какую асимметрию команда готова откликнуться?
`;
}

function renderStrategyPanel(m) {
  const soul = readJSON(SOUL) || {};
  const decisions = (soul.decisions || []).slice(-5);
  const openQ = (soul.openQuestions || []).filter(q => q.status !== 'закрыт').slice(-5);
  const calling = soul.calling || '—';
  return `# Панель Стратегии — СИЦ ${m.id}

**Парадигма:** классика (инвариантность) + бесцелевая ценностная.
**Вопрошание:** ${m.question}

## Призвание общины

> ${calling}

## Последние 5 решений (с плодом)

${decisions.map(d => `- **${d.date}** ${d.decision}\n  - Исход: ${d.outcome || 'не фиксирован'}`).join('\n\n')}

## Открытые вопросы

${openQ.map(q => `- ${q.question} _(${q.date})_`).join('\n')}

## Вопрос к собору

Какие из этих инвариантов вступают в контакт с сегодняшним вопрошанием? Что из открытого созрело?
`;
}

function renderForecastPanel(m) {
  return `# Панель Прогноза — СИЦ ${m.id}

**Парадигма:** неклассика (принцип неопределённости, матрица сценариев).
**Вопрошание:** ${m.question}

## Базовый сценарий (инерция)

> Заполни вручную или запусти: node utils/ontology-pulse.mjs --for-sic ${m.id}

## Ветвления (дикие карты)

- _дикая карта #1 —_
- _дикая карта #2 —_
- _дикая карта #3 —_

## Что может умереть / воскреснуть (анастасис-семена)

> См. data/anastasis.json — умершие нити как источник новых вопрошаний.

## Вопрос к собору

Какой сценарий неприемлем даже при низкой вероятности? Какая дикая карта меняет всё?
`;
}

function topN(w, n = 5) {
  const persons = w.persons || {};
  const weights = w.weights || [];
  const ids = Object.keys(persons);
  const result = [];
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < (weights[i] || []).length; j++) {
      const weight = weights[i][j];
      if (weight && weight > 0) result.push({ from: ids[i], to: ids[j], weight });
    }
  }
  return result.sort((a, b) => b.weight - a.weight).slice(0, n);
}

// ── Фаза 3: Собор — сведение трёх голосов ───────────────────────────
async function cmdSobor(args) {
  const id = args[0];
  const m = loadManifest(id);
  if (m.phase !== 'panels') {
    console.error(`Сессия в фазе ${m.phase}, собор пока невозможен.`);
    process.exit(2);
  }

  const parts = ['situation', 'strategy', 'forecast']
    .map(p => readFileSync(join(sessionDir(id), `panel-${p}.md`), 'utf8'));

  const soborMd = `# Собор — СИЦ ${m.id}

**Вопрошание:** ${m.question}
**Дата:** ${m.date}

## Три голоса

${parts.map((t, i) => `### ${['Ситуация', 'Стратегия', 'Прогноз'][i]}\n\n${t.split('\n').slice(1).join('\n')}`).join('\n\n---\n\n')}

## Различение (заполняет команда вместе с фасилитатором)

_Где голоса согласны? Где несводимое разногласие (ConciliarDissent)? Что требует эпиклезы к внешнему эксперту? Что требует метанойи о прошлом решении?_

## Набросок решения

- [ ] _текст решения будет здесь_

Когда решение сформулировано:
  node utils/sic-session.mjs decide ${m.id} --verdict received --note "..."
или:
  node utils/sic-session.mjs decide ${m.id} --verdict declined --note "почему"
`;

  writeFileSync(join(sessionDir(id), 'sobor.md'), soborMd);
  m.phase = 'sobor';
  m.sobor = { ts: now(), file: 'sobor.md' };
  saveManifest(id, m);

  await recordAct({ from: `sic:${m.team}`, to: '_koinon', type: 'sobor', weight: 5, content: `СИЦ ${id}: собор открыт` });
  console.log(`\n  ✓ Собор открыт — ${sessionDir(id)}/sobor.md\n  Заполни "Различение" и "Набросок решения" в файле, затем decide.\n`);
}

// ── Фаза 4: Причащение — CAT-10 λῆψις ────────────────────────────────
async function cmdDecide(args) {
  const id = args[0];
  const verdict = flagValue(args, '--verdict');
  const note = flagValue(args, '--note') || '';
  if (!['received', 'declined', 'revoked'].includes(verdict)) {
    console.error('--verdict должен быть received|declined|revoked');
    process.exit(2);
  }
  const m = loadManifest(id);
  if (m.phase !== 'sobor') {
    console.error(`Сессия в фазе ${m.phase}, причащение пока невозможно.`);
    process.exit(2);
  }

  m.decision = {
    verdict,
    note,
    ts: now(),
    lifecycle: ['OFFERED', 'PENDING', verdict.toUpperCase()],
  };
  m.phase = verdict === 'received' ? 'otpust' : 'closed';
  saveManifest(id, m);

  const weight = verdict === 'received' ? 10 : 3;
  const type = verdict === 'received' ? 'sic_decision' : 'sic_declined';
  await recordAct({
    from: `sic:${m.team}`, to: '_koinon', type, weight,
    content: `СИЦ ${id} ${verdict}: ${note.slice(0, 200)}`,
  });

  writeFileSync(join(sessionDir(id), 'decision.md'),
    `# Причащение — СИЦ ${id}\n\n**Verdict:** ${verdict}\n**Note:** ${note}\n**Ts:** ${now()}\n\n`);

  console.log(`\n  ✓ ${verdict.toUpperCase()} — решение ${verdict === 'received' ? 'принято (frozen)' : 'закрыто'}.`);

  if (verdict === 'received') {
    console.log(`  Следующее: через 4 недели — новая сессия.`);
    console.log(`  План задач: открой sobor.md, вынеси пункты в gh issue create --label sic-plan.\n`);
  }
}

// ── Статус / список ─────────────────────────────────────────────────
function cmdStatus(args) {
  const id = args[0];
  if (id) {
    const m = loadManifest(id);
    console.log(`\n  СИЦ ${id}`);
    console.log(`  Команда: ${m.team}`);
    console.log(`  Фаза: ${m.phase}`);
    console.log(`  Вопрошание: ${m.question}`);
    if (m.decision) console.log(`  Решение: ${m.decision.verdict} (${m.decision.note || ''})`);
    console.log(`  Директория: ${sessionDir(id)}\n`);
    return;
  }
  cmdList();
}

function cmdList() {
  if (!existsSync(SIC_DIR)) { console.log('  Сессий ещё не было.'); return; }
  const ids = readdirSync(SIC_DIR).filter(n => n.startsWith('sic-'));
  console.log(`\n  Сессий: ${ids.length}\n`);
  for (const id of ids) {
    try {
      const m = readJSON(manifestPath(id));
      if (!m) continue;
      console.log(`  ${id}  [${m.phase}]  ${m.team}  — ${m.question.slice(0, 60)}`);
    } catch {}
  }
  console.log('');
}

// ── Утилиты аргументов ──────────────────────────────────────────────
function flagValue(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1 || i === args.length - 1) return null;
  return args[i + 1];
}

// ── Dispatch ─────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  new:    cmdNew,
  panels: cmdPanels,
  sobor:  cmdSobor,
  decide: cmdDecide,
  status: cmdStatus,
  list:   cmdList,
};

if (!cmd || !commands[cmd]) {
  console.log(`
  sic-session — Ситуационно-Инженерный Центр

  Команды:
    new "<вопрошание>" [--team имя] [--skip-kairos]
    panels <id>
    sobor <id>
    decide <id> --verdict received|declined|revoked [--note "..."]
    status [<id>]
    list

  Спека: specs/sic/situational-center.gift
`);
  process.exit(0);
}

try {
  await commands[cmd](rest);
} catch (e) {
  console.error(`  ✗ ${e.message}`);
  process.exit(1);
}
