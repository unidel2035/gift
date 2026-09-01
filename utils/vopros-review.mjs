#!/usr/bin/env node
/**
 * vopros-review.mjs — медленный контур авто-вопрошаний.
 *
 * Проблема: пульс порождает вопросы быстрее, чем конвейер их ест (200+ issues),
 * и машина сжигает токены над задачами, которые задачами не являются.
 * Решение (ДОТУ): приток ограничен мерой. Dev-loop вопрошания НЕ ест —
 * они копятся здесь. Раз в неделю человек просматривает пачку:
 *
 *   gift vopros list          — пачка на просмотр (по пустыням)
 *   gift vopros promote N     — «это задача» → метка chosen, конвейер берёт
 *   gift vopros discard N     — «это не задача» → закрыть, вопрос учтён
 *   gift vopros promote N -m "комментарий" — с пометкой почему
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// GITHUB_TOKEN из env может быть сломан (CI-токен без прав) — сбрасываем, gh берёт из keyring
const GH_ENV = { ...process.env, GITHUB_TOKEN: '' };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const [cmd, n, ...rest] = process.argv.slice(2);

// То же правило, что в gift-dev-loop: vopros-метка ИЛИ авто-заголовок; chosen = выведено человеком
const AUTO_VOPROS = /пустын|восстановить нить/i;
const isAutoQuestion = (i) => !i.labels?.some(l => l.name === 'chosen') &&
  (i.labels?.some(l => l.name === 'vopros') || AUTO_VOPROS.test(i.title || ''));

function list() {
  const fetch = (label) => JSON.parse(execSync(
    `gh issue list --label ${label} --state open --json number,title,labels --limit 300`,
    { cwd: ROOT, env: GH_ENV }
  ).toString());
  // vopros-метка + plan-approved-пустыни (у ранних генераций метки vopros не было)
  const byNumber = {};
  for (const label of ['vopros', 'plan-approved']) {
    for (const i of fetch(label)) byNumber[i.number] = i;
  }
  const issues = Object.values(byNumber).filter(isAutoQuestion)
    .sort((a, b) => a.number - b.number);

  console.log(`\nАвто-вопрошаний в медленном контуре: ${issues.length}\n${'═'.repeat(62)}`);

  const byDesert = {};
  for (const i of issues) {
    const m = i.title.match(/пустыня\s+([\wА-Яа-яЁё]+[→<-][\wА-Яа-яЁё]+)/i)
           || i.title.match(/в пустыне\s*[—–-]\s*([^:]+)/i);
    const key = m ? m[1] : 'прочее';
    (byDesert[key] = byDesert[key] || []).push(i);
  }
  for (const [desert, arr] of Object.entries(byDesert).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${desert} (${arr.length}):`);
    for (const i of arr.slice(0, 5)) {
      const title = i.title.length > 90 ? i.title.slice(0, 90) + '…' : i.title;
      console.log(`    #${i.number}  ${title}`);
    }
    if (arr.length > 5) console.log(`    … и ещё ${arr.length - 5}`);
  }
  console.log(`\nРазобрать: gift vopros promote <N> | gift vopros discard <N>\n`);
}

function ghRun(cmdLine) {
  execSync(cmdLine, { cwd: ROOT, env: GH_ENV, stdio: 'pipe' });
}

if (cmd === 'list') {
  list();
} else if ((cmd === 'promote' || cmd === 'discard') && n) {
  const comment = rest.includes('-m') ? rest[rest.indexOf('-m') + 1] : null;
  if (cmd === 'promote') {
    ghRun(`gh issue edit ${n} --add-label chosen`);
    try { ghRun(`gh issue edit ${n} --add-label gift-ready`); } catch {}
    ghRun(`gh issue comment ${n} --body "Выведено из медленного контура Дионисием — это задача. Возвращена в конвейер.${comment ? ' Пометка: ' + comment : ''}"`);
    console.log(`#${n} возвращена в конвейер (метка chosen — конвейер её возьмёт)`);
  } else {
    ghRun(`gh issue comment ${n} --body "Закрыто Дионисием: приглашение учтено, задачей не стало.${comment ? ' ' + comment : ''}"`);
    ghRun(`gh issue close ${n}`);
    console.log(`#${n} закрыта`);
  }
} else {
  console.log(`vopros-review — медленный контур авто-вопрошаний

  gift vopros list              пачка на просмотр (по пустыням)
  gift vopros promote <N>       это задача → в конвейер [-m "пометка"]
  gift vopros discard <N>       это не задача → закрыть [-m "пометка"]`);
}
