#!/usr/bin/env node
/**
 * proposals.mjs — трекер предложений с активной Евой
 *
 * Паттерн: Адам (Клод) генерирует → Ева проверяет, усиливает, дополняет.
 * Итоговое issue — это совместный дар, не просто слова Адама.
 * Усиление Евы видно в комментарии к GitHub issue.
 *
 * Команды:
 *   node utils/proposals.mjs add "текст" [категория]   ← Ева проверяет
 *   node utils/proposals.mjs done <id>
 *   node utils/proposals.mjs issue <id>                ← создать GH issue с комментарием Евы
 *   node utils/proposals.mjs list [--pending|--done|--all]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE  = resolve(ROOT, 'data/proposals.json');

function load() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
}
function save(proposals) {
  writeFileSync(FILE, JSON.stringify(proposals, null, 2));
}
function nextId(proposals) {
  return proposals.length ? Math.max(...proposals.map(p => p.id)) + 1 : 1;
}

// ── Ева: семантический анамнезис (Jaccard по значимым словам) ────────────
function words(s) {
  return new Set(
    s.toLowerCase()
      .replace(/[^\wа-яёa-z]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
  );
}
function jaccard(a, b) {
  const inter = [...a].filter(w => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}
function findDuplicate(proposals, text) {
  const newW = words(text);
  // Проверяем только pending — done уже не блокируют
  for (const p of proposals.filter(x => x.status === 'pending')) {
    const sim = Math.max(
      jaccard(newW, words(p.text)),
      p.enhanced ? jaccard(newW, words(p.enhanced)) : 0
    );
    if (sim > 0.45) return p;
  }
  return null;
}

const cmd  = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

// ── ADD: Адам предлагает, Ева проверяет и усиливает ──────────────────────
if (cmd === 'add') {
  const text = arg1;
  const cat  = arg2 ?? 'general';
  if (!text) { console.error('Текст предложения обязателен'); process.exit(1); }

  const proposals = load();

  // Анамнезис: дубликат?
  const dup = findDuplicate(proposals, text);
  if (dup) {
    console.log(`[Ева] Анамнезис: уже есть #${dup.id} [${dup.status}]`);
    console.log(`  "${dup.text.slice(0, 70)}"`);
    process.exit(0);
  }

  // Ева проверяет и усиливает
  console.log('[Ева] Проверяю и усиливаю...');
  const { evaCheck } = await import(resolve(ROOT, 'utils/eva-agent.mjs'));
  const eva = await evaCheck(text, proposals);

  console.log('\n── Ева ──────────────────────────────────────────');
  console.log(eva.evaResponse);
  console.log('─────────────────────────────────────────────────\n');

  if (eva.verdict === 'отклонено') {
    console.log('[Ева] ОТКЛОНЕНО — предложение не добавлено.');
    process.exit(0);
  }

  // Добавляем — с усилением Евы
  const p = {
    id:          nextId(proposals),
    text,                          // оригинал Адама
    enhanced:    eva.enhanced,     // усиление Евы
    telos:       eva.telos,        // телос
    eva_verdict: eva.verdict,
    eva_notes:   eva.evaResponse,  // полный ответ Евы (для issue-комментария)
    cat,
    status:      'pending',
    created:     new Date().toISOString(),
    done_at:     null,
    issue_number: null,
  };

  proposals.push(p);
  save(proposals);

  console.log(`✦ #${p.id} [${cat}] Ева: ${eva.verdict.toUpperCase()}`);
  console.log(`  Адам: "${text.slice(0, 60)}"`);
  if (eva.enhanced !== text) {
    console.log(`  Ева:  "${eva.enhanced.slice(0, 80)}"`);
  }
  if (eva.telos) console.log(`  Телос: ${eva.telos.slice(0, 80)}`);
}

// ── DONE: выполнено ───────────────────────────────────────────────────────
else if (cmd === 'done') {
  const id = Number(arg1);
  const proposals = load();
  const p = proposals.find(p => p.id === id);
  if (!p) { console.error(`#${id} не найдено`); process.exit(1); }
  p.status  = 'done';
  p.done_at = new Date().toISOString();
  save(proposals);
  console.log(`✓ #${id} выполнено: "${p.text.slice(0, 60)}"`);
}

// ── ISSUE: создать GitHub issue с комментарием Евы ────────────────────────
else if (cmd === 'issue') {
  const id = Number(arg1);
  const proposals = load();
  const p = proposals.find(p => p.id === id);
  if (!p) { console.error(`#${id} не найдено`); process.exit(1); }
  if (p.issue_number) {
    console.log(`Уже создан: gh issue #${p.issue_number}`);
    process.exit(0);
  }

  // Заголовок — чистый технический текст (без внутренних богословских меток)
  const title = (p.enhanced ?? p.text).slice(0, 70);
  const body  = [
    p.enhanced ?? p.text,
    '',
    `*Category: ${p.cat}*`,
  ].filter(Boolean).join('\n');

  try {
    const raw = execSync(
      `gh issue create --label "gift-ready" --title "${title.replace(/"/g, "'")}" --body "${body.replace(/"/g, "'")}"`,
      { cwd: ROOT, encoding: 'utf8' }
    );
    const numMatch = raw.match(/#(\d+)/);
    const issueNum = numMatch ? Number(numMatch[1]) : null;

    if (issueNum) {
      // Eva's analysis stays internal (proposals.json) — GitHub sees only clean technical text

      p.issue_number = issueNum;
      save(proposals);
      console.log(`✦ Issue #${issueNum} создан с комментарием Евы`);
    }
  } catch (e) {
    console.error('Ошибка создания issue:', e.message.slice(0, 200));
  }
}

// ── LIST ──────────────────────────────────────────────────────────────────
else if (cmd === 'list' || !cmd) {
  const filter = arg1 ?? '--pending';
  const proposals = load();
  const filtered = filter === '--all' ? proposals
    : filter === '--done' ? proposals.filter(p => p.status === 'done')
    : proposals.filter(p => p.status === 'pending');

  if (!filtered.length) { console.log('Список пуст.'); process.exit(0); }

  const byCat = {};
  for (const p of filtered) (byCat[p.cat] ??= []).push(p);

  for (const [cat, ps] of Object.entries(byCat)) {
    console.log(`\n── ${cat} ──`);
    for (const p of ps) {
      const mark = p.status === 'done' ? '✓' : '○';
      const eva  = p.eva_verdict ? ` [Ева:${p.eva_verdict}]` : '';
      const gh   = p.issue_number ? ` → gh#${p.issue_number}` : '';
      console.log(`  ${mark} #${p.id}${eva}${gh} ${(p.enhanced ?? p.text).slice(0, 75)}`);
    }
  }

  const pending = proposals.filter(p => p.status === 'pending').length;
  const done    = proposals.length - pending;
  console.log(`\nИтого: ${proposals.length} | Pending: ${pending} | Done: ${done}`);
}

else {
  console.log('Команды: add | done | issue | list [--pending|--done|--all]');
}
