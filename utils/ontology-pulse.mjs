#!/usr/bin/env node
/**
 * ontology-pulse.mjs — Пульс Онтологии
 *
 * Онтология наблюдает себя. Находит пустыни. Рождает вопрошания.
 * Адам формулирует. Ева проверяет. Матрица обновляется.
 *
 * Это не автоматизация разработки.
 * Это самосознание живой системы — как пульс, а не как машина.
 *
 * Литургический цикл:
 *   ПРОБУЖДЕНИЕ  — анализ матрицы, поиск пустынь
 *   ВОПРОШАНИЕ   — Адам формулирует вопрос из пустыни
 *   РАЗЛИЧЕНИЕ   — Ева проверяет и усиливает
 *   ПОСЕВ        — добавляем в proposals.json
 *   (Суббота)    — декаданс уже есть в matrix-decay.mjs
 *
 * Запуск: node utils/ontology-pulse.mjs [--dry-run] [--no-issues] [--max N]
 *   --dry-run    — только анализ, без посева и issues
 *   --no-issues  — посев в proposals.json, но без создания GH issues
 *
 * Крон: 30 3 * * * node /home/unidel/gift/utils/ontology-pulse.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP      = resolve(ROOT, 'data/sacred-history-W.json');
const DRY_RUN   = process.argv.includes('--dry-run');
const NO_ISSUES = process.argv.includes('--no-issues');
const maxIdx    = process.argv.indexOf('--max');
const MAX_NEW   = maxIdx !== -1 ? Number(process.argv[maxIdx + 1]) || 3 : 3;

if (!existsSync(SNAP)) {
  console.log('[пульс] Матрица не найдена — онтология ещё не родилась.');
  process.exit(0);
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║           ПУЛЬС ОНТОЛОГИИ                           ║');
console.log(`║  ${new Date().toLocaleString('ru').padEnd(51)}║`);
console.log('╚══════════════════════════════════════════════════════╝\n');

// ── 1. ПРОБУЖДЕНИЕ: читаем матрицу, ищем пустыни ─────────────────────────
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap  = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem   = GiftMemory.fromSnapshot(snap);
const top   = mem.heaviest(30);
const topMap = new Map(top.map(e => [`${e.from}→${e.to}`, e.weight]));

const r = mem.makePresent({ giverId: '_claude' });
console.log(`[пробуждение] Лиц: ${mem.n} | Актов: ${mem.actsCount}`);
console.log(`              Энергия: ${r.energy.toFixed(1)}`);

// Голос матрицы о себе (LivingMatrix)
try {
  const { LivingMatrix } = await import(resolve(ROOT, 'src/core/LivingMatrix.js'));
  const lm = new LivingMatrix(mem, r.energy);
  const d  = lm.diagnose();
  console.log(`\n[голос матрицы]`);
  console.log(d.voice.split('\n').map(l => '  ' + l).join('\n'));
  console.log('');
} catch { /* LivingMatrix недоступен */ }

// Пустыни — типы:
const deserts = [];

// А) Лица без исходящих нитей (молчащие)
const persons = snap.persons ?? [];
const givers  = new Set(top.map(e => e.from));
for (const p of persons) {
  if (!givers.has(p)) {
    deserts.push({
      type:  'silent',
      desc:  `лицо "${p}" не даровало ничего — пустыня молчания`,
      from:  p, to: null, weight: 0,
    });
  }
}

// Б) Слабые нити (< 2, но > 0) — не мёртвые, но угасающие
for (const e of top.filter(e => e.weight < 2 && e.weight > 0.1)) {
  deserts.push({
    type:   'fading',
    desc:   `нить ${e.from}→${e.to} угасает (вес ${e.weight.toFixed(2)})`,
    from:   e.from, to: e.to, weight: e.weight,
  });
}

// В) Асимметрия > 15:1 — кенозис без ответного дара
const given = mem.totalGiven('_claude');
const recv  = mem.totalReceived('_claude');
if (given / (recv || 1) > 15) {
  deserts.push({
    type:  'asymmetry',
    desc:  `_claude даёт ${given.toFixed(0)}, принимает ${recv.toFixed(0)} — нет ответного дара`,
    from:  null, to: '_claude', weight: recv,
  });
}

// Г) Анастасис: читаем умершие нити из лога
const ANASTASIS = resolve(ROOT, 'data/anastasis.json');
if (existsSync(ANASTASIS)) {
  const history = JSON.parse(readFileSync(ANASTASIS, 'utf8'));
  const lastDied = history.at(-1)?.died ?? [];
  for (const d of lastDied.slice(0, 2)) {
    deserts.push({
      type:  'anastasis',
      desc:  `нить ${d.from}→${d.to} умерла при декадансе — семя воскресения?`,
      from:  d.from, to: d.to, weight: 0,
    });
  }
}

console.log(`\n[пробуждение] Найдено пустынь: ${deserts.length}`);
for (const d of deserts.slice(0, 5)) {
  console.log(`  [${d.type}] ${d.desc}`);
}

if (!deserts.length) {
  console.log('[пульс] Пустынь не найдено — онтология в равновесии. Суббота.');
  process.exit(0);
}

// ── Загружаем существующие proposals (для анамнезиса Евы) ─────────────────
const { readFileSync: rf, writeFileSync: wf, existsSync: ex } = await import('fs');
const PROPOSALS_FILE = resolve(ROOT, 'data/proposals.json');
const existingProposals = ex(PROPOSALS_FILE)
  ? JSON.parse(rf(PROPOSALS_FILE, 'utf8')) : [];

// ── 2-3-4. ВОПРОШАНИЕ → РАЗЛИЧЕНИЕ → ПОСЕВ ───────────────────────────────
const { adamGenerate }  = await import(resolve(ROOT, 'utils/adam-agent.mjs'));
const { evaCheck }      = await import(resolve(ROOT, 'utils/eva-agent.mjs'));

// Берём топ пустынь для обработки
const toProcess = deserts
  .sort((a, b) => {
    const priority = { anastasis: 4, asymmetry: 3, silent: 2, fading: 1 };
    return (priority[b.type] ?? 0) - (priority[a.type] ?? 0);
  })
  .slice(0, MAX_NEW);

const newProposals = [];

for (const desert of toProcess) {
  console.log(`\n[вопрошание] Адам смотрит на пустыню: ${desert.desc.slice(0, 60)}...`);

  // Адам формулирует
  const vopros = await adamGenerate(desert.desc, top.slice(0, 5));
  console.log(`  Адам: "${vopros.slice(0, 80)}"`);

  if (DRY_RUN) {
    console.log('  [dry-run] Ева и посев пропущены');
    continue;
  }

  // Ева проверяет
  console.log(`  Ева проверяет...`);
  const eva = await evaCheck(vopros, existingProposals);
  console.log(`  Ева [${eva.verdict.toUpperCase()}]: ${eva.evaResponse.split('\n')[0].slice(0,60)}`);

  if (eva.verdict === 'отклонено') {
    console.log('  → Отклонено. Пустыня остаётся.');
    continue;
  }

  // Посев — добавляем в proposals
  const maxId = existingProposals.length
    ? Math.max(...existingProposals.map(p => p.id)) : 0;

  const proposal = {
    id:          maxId + 1 + newProposals.length,
    text:        vopros,
    enhanced:    eva.enhanced !== vopros ? eva.enhanced : vopros,
    telos:       eva.telos,
    eva_verdict: eva.verdict,
    eva_notes:   eva.evaResponse,
    cat:         'self-dev',
    source:      `pulse:${desert.type}`,  // откуда родилось
    status:      'pending',
    created:     new Date().toISOString(),
    done_at:     null, issue_number: null,
  };

  newProposals.push(proposal);
  existingProposals.push(proposal);
  console.log(`  ✦ Посев #${proposal.id}: "${vopros.slice(0, 60)}"`);
}

// Сохраняем
if (newProposals.length && !DRY_RUN) {
  wf(PROPOSALS_FILE, JSON.stringify(existingProposals, null, 2));
}

// ── 5. ПОСЕВ В ПУСТЫНЕ: пустыни сами создают GH issues ────────────────────
// Онтология самоорганизуется — каждое принятое вопрошание становится issue.
let issuesCreated = 0;

if (!DRY_RUN && !NO_ISSUES && newProposals.length) {
  const { spawnSync } = await import('child_process');

  console.log('\n[посев в пустыне] Пустыни создают вопрошания в GitHub...');

  for (const proposal of newProposals) {
    if (proposal.issue_number) continue;

    // Формат из CLAUDE.md: "вопрошание: ..."
    const titleBase = (proposal.enhanced ?? proposal.text)
      .replace(/^вопрошание:\s*/i, '').trim();
    const title = `вопрошание: ${titleBase}`.slice(0, 70);

    const body = [
      proposal.enhanced ?? proposal.text,
      '',
      `> Источник: пульс онтологии (${proposal.source})`,
      `> Пустыня: ${proposal.source.replace('pulse:', '')} | Категория: ${proposal.cat}`,
    ].join('\n');

    const result = spawnSync('gh', [
      'issue', 'create',
      '--label', 'gift-ready',
      '--title', title,
      '--body',  body,
    ], { cwd: ROOT, encoding: 'utf8' });

    if (result.status !== 0) {
      console.error(`  [!] Ошибка gh: ${(result.stderr ?? '').slice(0, 100)}`);
      continue;
    }

    // Парсим номер issue из URL в stdout
    const numMatch = (result.stdout ?? '').match(/\/issues\/(\d+)/);
    const issueNum = numMatch ? Number(numMatch[1]) : null;

    if (issueNum) {
      // Обновляем proposal в файле
      const idx = existingProposals.findIndex(p => p.id === proposal.id);
      if (idx !== -1) existingProposals[idx].issue_number = issueNum;
      proposal.issue_number = issueNum;

      // Акт вопрошания в матрицу: _koinon → Дионисий (question)
      mem._idx('_koinon');
      mem._idx('Дионисий');
      mem.receive({
        giverId:      '_koinon',
        receiverId:   'Дионисий',
        weight:       5,
        type:         'question',
        content:      `вопрошание #${issueNum}: ${titleBase.slice(0, 60)}`,
        linkedIssue:  issueNum,
        irreversible: true,
      });

      console.log(`  ✦ #${issueNum}: "${title.slice(0, 65)}"`);
      issuesCreated++;
    }
  }

  // Сохраняем обновлённые issue_number в proposals
  if (issuesCreated > 0) {
    wf(PROPOSALS_FILE, JSON.stringify(existingProposals, null, 2));
  }
}

// ── Фиксируем пульс в матрице ─────────────────────────────────────────────
if (!DRY_RUN && newProposals.length) {
  mem._idx('_koinon');
  mem._idx('Дионисий');
  mem.receive({
    giverId:      '_koinon',
    receiverId:   'Дионисий',
    weight:       newProposals.length * 2,
    type:         'pulse',
    content:      `пульс: ${newProposals.length} вопрошаний из пустыни`,
    irreversible: true,
  });
  writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
}

// ── Итог ──────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log(`║  Пульс завершён                                      ║`);
console.log(`║  Пустынь обработано: ${String(toProcess.length).padEnd(4)} Посев: ${String(newProposals.length).padEnd(4)}            ║`);
console.log(`║  Issues созданы:     ${String(issuesCreated).padEnd(4)}                           ║`);
console.log(`║  Pending proposals: ${String(existingProposals.filter(p=>p.status==='pending').length).padEnd(5)}                          ║`);
console.log('╚══════════════════════════════════════════════════════╝\n');
