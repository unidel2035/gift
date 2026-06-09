#!/usr/bin/env node
/**
 * metakb-effector — рука тела. Превращает принятое решение мета-КБ в реальную
 * работу: GitHub issue в репозитории integram, с подсказкой владельца зоны.
 *
 * Замыкает контур мысль → действие: база не только рождает (генератор) и
 * отбирает (критик) вопросы, но и запускает работу по принятым решениям.
 *
 * Идемпотентность: на решение ставится metadata.issue (url) — повторно не создаёт.
 * По умолчанию DRY-RUN. --apply создаёт issue (gh) и метит решение.
 *
 * Env: INTEGRAM_URL, INTEGRAM_DB, токен/логин; EFFECTOR_REPO (default judas-priest/integram)
 *   node utils/metakb-effector.mjs [--apply] [--id N] [--limit N]
 */
import { spawnSync } from 'node:child_process';
import { fetchDecisions, patchDecision, available, login } from './sobor-corpus-integram.mjs';

const apply = process.argv.includes('--apply');
const REPO = process.env.EFFECTOR_REPO || 'judas-priest/integram';
const idArg = process.argv.includes('--id') ? process.argv[process.argv.indexOf('--id') + 1] : null;
const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;

// домен решения → подсказка владельца зоны (из .coop/ZONES.md, упрощённо)
const OWNER = [
  [/инфраструктур|архитектур|совместн|backend|api|данны|агент/i, 'Дионисий (backend/инфра-зоны)'],
  [/продукт|frontend|portal|портал|интерфейс|ui/i, 'коллега (frontend/portal)'],
];
const ownerFor = (domain = '') => (OWNER.find(([re]) => re.test(domain)) || [, 'не назначен — см. .coop/ZONES.md'])[1];

if (!available()) { console.log('Нужны INTEGRAM_URL, INTEGRAM_DB и токен/логин.'); process.exit(1); }
const token = login();

let targets = fetchDecisions({ token })
  .filter(d => (d.verdict || '').toLowerCase() === 'accepted')
  .filter(d => !(d.metadata && d.metadata.issue));
if (idArg) targets = fetchDecisions({ token }).filter(d => String(d.id) === String(idArg));
targets = targets.slice(0, limit);

console.log(`Эффектор · принятых без задачи: ${targets.length} · репо ${REPO} · ${apply ? 'СОЗДАЮ' : 'DRY-RUN'}\n`);

const body = d => [
  d.description || '',
  '',
  `Источник: решение мета-КБ #${d.id} (домен «${d.domain}»).`,
  `Предлагаемый владелец: ${ownerFor(d.domain)}.`,
  '',
  '_Создано эффектором мета-КБ (контур мысль→действие)._',
].join('\n');

let made = 0;
for (const d of targets) {
  const title = (d.title || '').slice(0, 240);
  console.log(`#${d.id} → issue: ${title}\n     владелец: ${ownerFor(d.domain)}`);
  if (!apply) continue;
  const r = spawnSync('gh', ['issue', 'create', '--repo', REPO, '--title', title, '--body', body(d)], { encoding: 'utf8' });
  const url = (r.stdout || '').trim().split('\n').pop();
  if (r.status === 0 && /github\.com/.test(url)) {
    made++;
    patchDecision(d.id, { metadata: { ...(d.metadata || {}), issue: url } }, { token });
    console.log(`     ✓ ${url} (решение помечено)`);
  } else {
    console.log(`     ✗ ${((r.stderr || '') + (r.stdout || '')).slice(0, 160)}`);
  }
}
console.log(`\nИтог: ${apply ? `создано задач ${made}` : 'dry-run — добавь --apply для создания'}.`);
