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

  const witness = witnessPreviousFruits(team);

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
    witness,
  };
  saveManifest(id, manifest);

  const witnessMd = renderWitness(witness);

  // Запись проскомидии
  writeFileSync(join(sessionDir(id), 'proskomidia.md'),
    `# Проскомидия — СИЦ ${id}\n\n**Команда:** ${team}\n**Дата:** ${manifest.date}\n\n${witnessMd}\n## Вопрошание\n\n${question}\n`);

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

  // ── Панель Прогноз (реальные данные из матрицы + pulse + proposals) ──
  const forecast = await renderForecastPanel(m);
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

async function renderForecastPanel(m) {
  const deserts = await detectDeserts();
  const anastasis = readJSON(resolve(ROOT, 'data/anastasis.json'), []);
  const proposals = readJSON(resolve(ROOT, 'data/proposals.json'), []);
  const pending = proposals.filter(p => p.status !== 'done').slice(0, 5);
  const lastDied = (anastasis.at?.(-1)?.died ?? []).slice(0, 3);

  const byType = {};
  for (const d of deserts) { (byType[d.type] ||= []).push(d); }

  const sectionSilent = (byType.silent || []).slice(0, 5)
    .map(d => `- молчание: **${d.from}** — не даровал ничего (новое лицо в сети? свежий актор?)`).join('\n');
  const sectionFading = (byType.fading || []).slice(0, 5)
    .map(d => `- угасание: **${d.from}→${d.to}** (вес ${d.weight.toFixed(2)}) — восстановить или отпустить?`).join('\n');
  const sectionAsymmetry = (byType.asymmetry || [])
    .map(d => `- асимметрия: ${d.desc}`).join('\n');
  const sectionTheosis = (byType.theosis_stasis || []).slice(0, 3)
    .map(d => `- θέωσις-стазис: ${d.desc}`).join('\n');
  const sectionLeksis = (byType.leksis_pending || []).slice(0, 3)
    .map(d => `- λήψις-pending: ${d.desc}`).join('\n');

  return `# Панель Прогноза — СИЦ ${m.id}

**Парадигма:** неклассика (принцип неопределённости, матрица сценариев).
**Вопрошание:** ${m.question}

## Базовый сценарий (инерция)

Если не делать ничего нового за 4 недели — состояние матрицы продолжит тренд:
- Пустынь активно: **${deserts.length}** (${Object.keys(byType).map(t => `${t}: ${byType[t].length}`).join(', ') || 'нет'})
- Отвергнутых даров ждущих метанойи: **${(byType.leksis_pending || []).length}**
- Θέωσις-стазисов (принимают, не возвращают): **${(byType.theosis_stasis || []).length}**

## Сценарии из пустынь (матрица сценариев)

${sectionFading || '_нет угасающих нитей_'}
${sectionSilent ? '\n' + sectionSilent : ''}
${sectionAsymmetry ? '\n' + sectionAsymmetry : ''}
${sectionTheosis ? '\n' + sectionTheosis : ''}
${sectionLeksis ? '\n' + sectionLeksis : ''}

## Анастасис-семена (что умерло = что может воскреснуть)

${lastDied.length ? lastDied.map(d => `- ${d.from}→${d.to} (вес был ${(d.weight ?? 0).toFixed(2)}) — семя для вопрошания`).join('\n') : '_на последнем декадансе никто не умер — нити держатся_'}

## Дикие карты (ждут реализации)

${pending.length ? pending.map(p => `- #${p.id} [${p.cat}] ${String(p.text).slice(0, 150)}${p.issue_number ? ` (→ issue #${p.issue_number})` : ''}`).join('\n') : '_pending proposals пусты_'}

## Вопрос к собору

Какой сценарий неприемлем даже при низкой вероятности? Какая дикая карта меняет всё?
Какое отвергнутое — ждёт именно сейчас μετάνοια?
`;
}

// ── Детектор пустынь (общий алгоритм с ontology-pulse.mjs) ─────────────────
async function detectDeserts() {
  try {
    const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
    if (!existsSync(W_SNAP)) return [];
    const snap = readJSON(W_SNAP);
    const mem = GiftMemory.fromSnapshot(snap);
    const persons = snap.persons ?? [];
    const top = mem.top?.(50) ?? [];
    const givers = new Set(top.map(e => e.from));
    const deserts = [];

    for (const p of persons) {
      if (!givers.has(p)) deserts.push({ type: 'silent', from: p, to: null, weight: 0 });
    }
    for (const e of top.filter(e => e.weight < 2 && e.weight > 0.1)) {
      deserts.push({ type: 'fading', from: e.from, to: e.to, weight: e.weight, desc: `${e.from}→${e.to} (${e.weight.toFixed(2)})` });
    }
    const given = mem.totalGiven?.('_claude') ?? 0;
    const recv = mem.totalReceived?.('_claude') ?? 0;
    if (recv && given / recv > 15) {
      deserts.push({ type: 'asymmetry', from: null, to: '_claude', weight: recv, desc: `_claude даёт ${given.toFixed(0)}, принимает ${recv.toFixed(0)}` });
    }

    // Λήψις-pending (отвергнутые даров > 24ч)
    try {
      const declinedAll = mem.declined?.() ?? [];
      const cutoff = Date.now() - 24 * 3600 * 1000;
      for (const d of declinedAll) {
        if (new Date(d.declinedAt).getTime() < cutoff) {
          deserts.push({ type: 'leksis_pending', from: d.act?.giverId, to: d.act?.receiverId, weight: d.act?.weight ?? 0, desc: `${d.act?.giverId}→${d.act?.receiverId} (${d.act?.type}) ждёт μετάνοια` });
        }
      }
    } catch {}

    return deserts;
  } catch (e) {
    return [];
  }
}

// ── Theosis-свидетельство: плоды прошлой сессии ───────────────────────────
function previousReceivedSessions(team) {
  if (!existsSync(SIC_DIR)) return [];
  const all = readdirSync(SIC_DIR).filter(n => n.startsWith('sic-'));
  const list = [];
  for (const id of all) {
    const m = readJSON(manifestPath(id));
    if (m && m.team === team && m.decision?.verdict === 'received') list.push(m);
  }
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function witnessPreviousFruits(team) {
  const prev = previousReceivedSessions(team);
  if (!prev.length) return null;
  const last = prev[0];
  const daysSince = Math.floor((Date.now() - new Date(last.createdAt).getTime()) / (1000 * 60 * 60 * 24));

  // Ищем коммиты после last.createdAt с упоминанием sic- или этой темы
  let commits = [];
  try {
    const raw = execSync(
      `git -C "${ROOT}" log --since="${last.createdAt}" --format="%h|%s" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    commits = raw ? raw.split('\n').slice(0, 10).map(l => {
      const [hash, message] = l.split('|');
      return { hash, message };
    }) : [];
  } catch {}

  return {
    previous: { id: last.id, question: last.question, decision: last.decision, daysSince },
    commits,
    fruits: commits.length,
  };
}

function renderWitness(w) {
  if (!w) return '';
  const d = w.previous;
  return `## Свидетельство прошлой сессии

> СИЦ **${d.id}** (${d.daysSince} дней назад)
> Вопрошание: _${d.question}_
> Решение: **${d.decision.verdict}** — ${d.decision.note || '(без заметки)'}

За ${d.daysSince} дней после решения: коммитов — **${w.fruits}**.

${w.commits.length ? w.commits.map(c => `- \`${c.hash}\` ${c.message}`).join('\n') : '_плодов в git-истории не видно — требует ручного свидетельства о реализации_'}

**θέωσις только просветляет** — этот раздел не судит, а напоминает: что было обещано и чем откликнулось.
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
    // TheosisWitnessBridge: glorify — прогресс θέωσις команды.
    // Принятое решение = исцеление раны нерешённости.
    try {
      const { witness, glorify } = await import(resolve(ROOT, 'src/theology/TheosisWitnessBridge.js'));
      const personId = `sic:${m.team}`;
      const wound = `вопрошание-${id}`;
      if (typeof witness === 'function') await witness({ personId, wound });
      if (typeof glorify === 'function') await glorify({ personId, wound, glorification: note || 'received' });
    } catch (e) {
      // модуль ещё не подключён — молчим, θέωσις не обязателен для литургии
    }
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
