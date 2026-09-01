#!/usr/bin/env node
/**
 * org-backoffice.mjs — бэкофис организации поверх Инеграм-org API.
 *
 * Воркспейс-журнал (trytofly) прикрепляется к организации и ведёт её работу:
 *
 *   status   — портфель org + полка бэкофиса + пустыни журнала
 *   pulse    — белые пятна сами озадачиваются: просроченные задачи воркспейсов
 *              org и хвосты сессий ложатся черновыми карточками в бэкофис-доску.
 *              Ничего не делает сам — только кладёт на полку.
 *   plan     — план-агент: на карточки todo без плана пишет план в комментарий
 *              (claude --print). Человек читает и решает.
 *   scribe   — писарь: текст сессии из файла → таблицы журнала
 *              (Сессии + Решения, с незакрытыми хвостами)
 *
 *   node utils/org-backoffice.mjs nightcall status
 *   node utils/org-backoffice.mjs nightcall pulse --apply
 *   node utils/org-backoffice.mjs nightcall plan  --apply
 *   node utils/org-backoffice.mjs nightcall scribe --file data/mera/session-01.09.md
 *
 * Доска бэкофиса: --board <slug> (по умолчанию trytofly).
 * Доступ: INTEGRAM_URL/EMAIL/PASSWORD из окружения или ~/.pm-credentials.json.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

const HOST = (process.env.INTEGRAM_URL || 'https://ai2o.online').replace(/\/$/, '');
const ORG = process.argv[2];
const CMD = process.argv[3];
const APPLY = process.argv.includes('--apply');
const BOARD = process.argv.includes('--board')
  ? process.argv[process.argv.indexOf('--board') + 1]
  : 'trytofly';

if (!ORG || !CMD || !['status', 'pulse', 'plan', 'scribe'].includes(CMD)) {
  console.log('用法: node utils/org-backoffice.mjs <org> <status|pulse|plan|scribe> [--apply] [--board <slug>] [--file <md>]');
  process.exit(1);
}

function creds() {
  if (process.env.INTEGRAM_EMAIL && process.env.INTEGRAM_PASSWORD) {
    return { email: process.env.INTEGRAM_EMAIL, password: process.env.INTEGRAM_PASSWORD };
  }
  return JSON.parse(readFileSync(resolve(process.env.HOME || '', '.pm-credentials.json'), 'utf8'));
}

const jwt = await (async () => {
  const r = await fetch(`${HOST}/api/v2/iam/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds()), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const d = await r.json();
  return d.accessToken || d.token || d.access_token;
})();

async function call(method, path, body) {
  const res = await fetch(`${HOST}/api/v2${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${t.slice(0, 140)}`);
  try { const j = JSON.parse(t); return j.data ?? j; } catch { return t; }
}
const arr = (x) => Array.isArray(x) ? x : (x?.items || x || []);
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();

// ── Журнал: таблицы и колонки по именам (id у стендов разные) ───────────────
async function journalSchema(ws) {
  const types = arr(await call('GET', `/${ws}/schema?limit=500`));
  const byName = new Map(types.map(t => [t.name, t]));
  const batch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${types.map(t => t.id).join(',')}`);
  const colsOf = (typeName) => new Map(((batch?.[String(byName.get(typeName)?.id)] || [])) .map(c => [c.name, c.id]));
  return { byName, colsOf };
}

async function objectsOf(ws, typeId) {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await call('GET', `/${ws}/objects?typeId=${typeId}&page=${page}&pageSize=1000`);
    const items = arr(d);
    out.push(...items);
    if (items.length < 1000) break;
  }
  return out;
}

// ── Снапшот для портала: таблицы «Портфель» и «Полка» ───────────────────────
// Страница «Бэкофис» читает таблицы через bindings (cookie портала не проходит
// на /api/v2 с Bearer). Пульс/статус обновляют строки снапшота.

async function ensureTable(ws, name, cols) {
  const types = arr(await call('GET', `/${ws}/schema?limit=500`));
  let t = types.find(x => x.name === name);
  if (!t) {
    const d = await call('POST', `/${ws}/schema`, { name, baseType: 3 });
    t = { id: d.id ?? d.typeId };
    for (const [cname, ctype] of cols) {
      await call('POST', `/${ws}/schema/${t.id}/columns`, { type: ctype, alias: cname });
    }
    console.log(`  + таблица «${name}» (${t.id})`);
  }
  return t.id;
}

async function upsertRows(ws, typeId, rows, cols) {
  // полная пересинхронизация: таблица принадлежит агенту
  const existing = await objectsOf(ws, typeId);
  const byValue = new Map(existing.map(o => [String(o.value || ''), o]));
  const want = new Set();
  for (const r of rows) {
    want.add(r.value);
    const req = {};
    for (const [k, v] of Object.entries(r.cols)) if (cols[k]) req[String(cols[k])] = String(v ?? '');
    const ex = byValue.get(r.value);
    if (ex) await call('PATCH', `/${ws}/objects/${ex.id}`, { requisites: req });
    else await call('POST', `/${ws}/objects`, { typeId, value: r.value, requisites: req });
  }
  for (const o of existing) {
    if (!want.has(String(o.value || ''))) await call('DELETE', `/${ws}/objects/${o.id}`).catch(() => {});
  }
}

async function syncSnapshot(ws) {
  const pf = await call('GET', `/orgs/${ORG}/pm/portfolio`);
  const pfId = await ensureTable(ws, 'Портфель', [
    ['воркспейс', 8], ['всего', 8], ['готово', 8], ['в работе', 8],
    ['просрочено', 8], ['прогресс', 8], ['спринт', 8],
  ]);
  const batch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${pfId}`);
  const pfCols = Object.fromEntries((batch?.[String(pfId)] || []).map(c => [c.name, c.id]));
  await upsertRows(ws, pfId, (pf.items || []).map(w => ({
    value: w.name,
    cols: {
      'воркспейс': w.slug, 'всего': w.pmEnabled ? w.total : '—',
      'готово': w.pmEnabled ? w.done : '—', 'в работе': w.pmEnabled ? w.active : '—',
      'просрочено': w.pmEnabled ? (w.overdue || '') : '', 'прогресс': w.pmEnabled ? `${w.progress}%` : 'PM не включён',
      'спринт': w.activeSprint?.name || '',
    },
  })), pfCols);

  const shelfId = await ensureTable(ws, 'Полка', [['статус', 8], ['ярлыки', 8], ['описание', 12]]);
  const batch2 = await call('GET', `/${ws}/schema/columns/batch?typeIds=${shelfId}`);
  const shelfCols = Object.fromEntries((batch2?.[String(shelfId)] || []).map(c => [c.name, c.id]));
  const issues = arr(await call('GET', `/${ws}/pm/issues?limit=100`)).filter(i => i.status !== 'done');
  await upsertRows(ws, shelfId, issues.map(i => ({
    value: i.title,
    cols: { 'статус': i.status, 'ярлыки': (i.labels || []).join(', '), 'описание': String(i.description || '').slice(0, 500) },
  })), shelfCols);
  // люди: кто сколько держит (org pm/people)
  try {
    const ppl = await call('GET', `/orgs/${ORG}/pm/people`);
    const pplId = await ensureTable(ws, 'Люди', [['открыто', 8], ['просрочено', 8], ['точки', 8]]);
    const batch3 = await call('GET', `/${ws}/schema/columns/batch?typeIds=${pplId}`);
    const pplCols = Object.fromEntries((batch3?.[String(pplId)] || []).map(c => [c.name, c.id]));
    await upsertRows(ws, pplId, (ppl.items || []).map(u => ({
      value: u.name || `user ${u.userId}`,
      cols: { 'открыто': u.active, 'просрочено': u.overdue || '', 'точки': u.totalPoints ?? '' },
    })), pplCols);
    console.log(`  снапшот: портфель ${pf.items?.length || 0}, полка ${issues.length}, люди ${(ppl.items || []).length}`);
  } catch (e) { console.log(`  снапшот люди: ${e.message.slice(0, 100)}`); }
}

// ── status ──────────────────────────────────────────────────────────────────
if (CMD === 'status') {
  const pf = await call('GET', `/orgs/${ORG}/pm/portfolio`);
  console.log(`═══ ${ORG}: портфель (${pf.items?.length ?? 0} воркспейсов)`);
  for (const w of pf.items || []) {
    if (!w.pmEnabled) { console.log(`  ${w.name}: PM не включён`); continue; }
    const marks = [`${w.total} задач`, `✓${w.done}`, `в работе ${w.active}`, w.overdue ? `⚠ просрочено ${w.overdue}` : null].filter(Boolean);
    console.log(`  ${w.name} [${w.slug}]: ${marks.join(' · ')} · прогресс ${w.progress}%${w.activeSprint ? ` · спринт «${w.activeSprint.name}»` : ''}`);
  }
  const board = arr(await call('GET', `/${BOARD}/pm/issues?limit=100`));
  const open = board.filter(i => i.status !== 'done');
  console.log(`\n═══ полка бэкофиса [${BOARD}]: открыто ${open.length}`);
  for (const i of open) console.log(`  #${i.number} [${i.status}] ${i.title}`);
  try {
    const { byName, colsOf } = await journalSchema(BOARD);
    const sesT = byName.get('Сессии');
    if (sesT) {
      const objs = await objectsOf(BOARD, sesT.id);
      const cols = colsOf('Сессии');
      const tails = [];
      for (const o of objs.slice(-30)) {
        const det = await call('GET', `/${BOARD}/objects/${o.id}`).catch(() => null);
        const req = det?.requisites || {};
        const open2 = req[String(cols.get('не закрыто'))];
        if (open2 && String(open2).trim()) tails.push({ title: o.value, open: String(open2).slice(0, 80) });
      }
      console.log(`\n═══ журнальные хвосты (Сессии с «не закрыто»): ${tails.length}`);
      for (const t of tails.slice(-8)) console.log(`  «${t.title}» → ${t.open}…`);
    }
  } catch (e) { console.log(`журнал: ${e.message.slice(0, 100)}`); }
  process.exit(0);
}

// ── pulse: белые пятна → черновые карточки ──────────────────────────────────
if (CMD === 'pulse') {
  const pf = await call('GET', `/orgs/${ORG}/pm/portfolio`);
  const boardIssues = arr(await call('GET', `/${BOARD}/pm/issues?limit=200`));
  const openCards = boardIssues.filter(i => i.status !== 'done');
  let made = 0, updated = 0, skipped = 0;

  for (const w of pf.items || []) {
    if (!w.pmEnabled || !w.overdue) continue;
    // точечный список просроченных
    const issues = arr(await call('GET', `/${w.slug}/pm/issues?limit=100`))
      .filter(i => i.status !== 'done' && i.due_date && new Date(i.due_date) < new Date());
    if (!issues.length) continue;
    const title = `белое пятно: ${w.name} — просрочено`;
    const desc = ['Просроченные задачи (собрано пульсом бэкофиса):', '',
      ...issues.map(i => `  #${i.number} ${i.title}${i.due_date ? ` (до ${String(i.due_date).slice(0, 10)})` : ''}`),
      '', 'Человек берёт задачу со своим агентом. Разбор — на доске ' + w.slug + '.'].join('\n');
    const exists = openCards.find(i => i.title === title);
    if (exists) {
      if (APPLY) { await call('PATCH', `/${BOARD}/pm/issues/${exists.id}`, { description: desc }); updated++; }
      console.log(`  ⟳ ${title} (${issues.length} шт.) — обновлено`);
    } else {
      if (APPLY) {
        await call('POST', `/${BOARD}/pm/issues`, { title, description: desc, type: 'task', status: 'backlog', priority: 'high', labels: ['белое-пятно'] });
        made++;
      }
      console.log(`  + ${title} (${issues.length} шт.)`);
    }
  }

  // журнальные хвосты: сессии с «не закрыто»
  try {
    const { byName, colsOf } = await journalSchema(BOARD);
    const sesT = byName.get('Сессии');
    if (sesT) {
      const cols = colsOf('Сессии');
      const objs = await objectsOf(BOARD, sesT.id);
      for (const o of objs) {
        const det = await call('GET', `/${BOARD}/objects/${o.id}`).catch(() => null);
        const req = det?.requisites || {};
        const tail = String(req[String(cols.get('не закрыто'))] || '').trim();
        const date = String(req[String(cols.get('дата'))] || '').slice(0, 10);
        if (!tail) continue;
        // соглашение журнала: хвост «ЗАКРЫТО: …» — фактически закрыт, пятном не считаем
        if (/^закрыто\b/i.test(norm(tail))) continue;
        // хвост старше 14 дней — пятно
        const age = (Date.now() - new Date(date).getTime()) / 86400000;
        if (!(age > 14)) continue;
        const title = `белое пятно: хвост сессии «${String(o.value || '').slice(0, 50)}»`;
        const desc = `На сессии от ${date} осталось незакрытое:\n\n${tail}\n\nПятно старше 14 дней. Закрой хвост или отложи осознанно — отредактируй сессию в журнале.`;
        const exists = openCards.find(i => i.title === title);
        if (exists) { skipped++; continue; }
        if (APPLY) { await call('POST', `/${BOARD}/pm/issues`, { title, description: desc, type: 'task', status: 'backlog', priority: 'medium', labels: ['белое-пятно'] }); made++; }
        console.log(`  + ${title}`);
      }
    }
  } catch (e) { console.log(`  хвосты: ${e.message.slice(0, 100)}`); }

  // события журнала: инциденты без лечения, решения вне сессий
  try {
    const { byName, colsOf } = await journalSchema(BOARD);
    const incT = byName.get('Инциденты'), decT = byName.get('Решения');
    if (incT) {
      const cols = colsOf('Инциденты');
      for (const o of await objectsOf(BOARD, incT.id)) {
        const det = await call('GET', `/${BOARD}/objects/${o.id}`).catch(() => null);
        const req = det?.requisites || {};
        if (String(req[String(cols.get('лечение'))] || '').trim()) continue;
        const title = `инцидент без лечения: ${String(o.value || '').slice(0, 60)}`;
        if (openCards.some(i => i.title === title)) continue;
        if (APPLY) await call('POST', `/${BOARD}/pm/issues`, { title, description: `Инцидент «${o.value}» без лечения в журнале.${req[String(cols.get('симптом'))] ? `\nСимптом: ${req[String(cols.get('симптом'))]}` : ''}\n\nЛибо лечим, либо осознанно закрываем инцидент в журнале.`, type: 'task', status: 'backlog', priority: 'high', labels: ['белое-пятно'] });
        console.log(`  + ${title}`);
        made++;
      }
    }
    if (decT) {
      const cols = colsOf('Решения');
      for (const o of await objectsOf(BOARD, decT.id)) {
        const det = await call('GET', `/${BOARD}/objects/${o.id}`).catch(() => null);
        const req = det?.requisites || {};
        if (req[String(cols.get('сессия'))]) continue;
        const title = `решение вне сессии: ${String(o.value || '').slice(0, 60)}`;
        if (openCards.some(i => i.title === title)) continue;
        if (APPLY) await call('POST', `/${BOARD}/pm/issues`, { title, description: `Решение «${o.value}» не привязано к сессии — оно не вырастет в летописи. Привяжи в журнале или удали.`, type: 'task', status: 'backlog', priority: 'low', labels: ['белое-пятно'] });
        console.log(`  + ${title}`);
        made++;
      }
    }
  } catch (e) { console.log(`  события: ${e.message.slice(0, 100)}`); }

  if (APPLY) {
    try { await syncSnapshot(BOARD); } catch (e) { console.log(`  снапшот: ${e.message.slice(0, 120)}`); }
  }
  console.log(APPLY ? `\nпульс: создано ${made}, обновлено ${updated}, уже были ${skipped}` : '\nсухой прогон — ничего не записано. Запиши: --apply');
  process.exit(0);
}

// ── plan: план-агент на todo-карточки ───────────────────────────────────────
if (CMD === 'plan') {
  const todos = arr(await call('GET', `/${BOARD}/pm/issues?limit=100`)).filter(i => i.status === 'todo');
  console.log(`карточек todo: ${todos.length}`);
  for (const i of todos) {
    const comments = arr(await call('GET', `/${BOARD}/pm/issues/${i.id}/comments`).catch(() => []));
    if (comments.some(c => String(c.body || '').includes('⟨план⟩'))) { console.log(`  #${i.number} — план уже есть`); continue; }
    console.log(`  #${i.number} ${i.title} — думаю…`);
    const prompt = `Задача: ${i.title}\n${i.description ? `\nОписание: ${i.description}` : ''}\n\nНапиши план реализации: 3-6 шагов, каждый строкой. Кратко, без вступлений. Русский язык.`;
    const r = spawnSync('claude', ['--print', '--output-format', 'json'], {
      input: prompt, encoding: 'utf8', timeout: 180_000,
    });
    let plan = '';
    try { plan = String(JSON.parse(r.stdout)?.result || '').trim(); } catch { plan = String(r.stdout || '').trim(); }
    if (!plan) { console.log(`    ⚠ агент молчит (${r.error?.message || r.status})`); continue; }
    if (APPLY) await call('POST', `/${BOARD}/pm/issues/${i.id}/comments`, { body: `⟨план⟩\n${plan}` });
    console.log(plan.split('\n').slice(0, 4).map(l => '    ' + l).join('\n'));
  }
  console.log(APPLY ? 'план-агент: готово' : 'сухой прогон. Записать: --apply');
  process.exit(0);
}

// ── scribe: сессия текстом → журнал ─────────────────────────────────────────
if (CMD === 'scribe') {
  const fi = process.argv.indexOf('--file');
  const file = fi > 0 ? process.argv[fi + 1] : null;
  if (!file || !existsSync(file)) { console.error('укажи --file <файл сессии .md>'); process.exit(1); }
  const md = readFileSync(file, 'utf8');

  // формат: «# титул», ключи: тип/дата/итог/не закрыто; «## имя решения» + вопрос/решение/обоснование
  const lines = md.split('\n');
  const head = { тип: 'разбор', дата: new Date().toISOString().slice(0, 10), 'итог': '', 'не закрыто': '' };
  head['итог'] = ''; head['не закрыто'] = '';
  let title = '';
  const decisions = [];
  let cur = null;
  let mode = 'head'; let key = null;
  const setVal = (obj, k, v) => { obj[k] = obj[k] ? obj[k] + '\n' + v : v; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('# ') && !title) { title = line.slice(2).trim(); continue; }
    if (line.startsWith('## ')) {
      cur = { имя: line.slice(3).trim(), вопрос: '', решение: '', обоснование: '' };
      decisions.push(cur); mode = 'dec'; key = null; continue;
    }
    const m = line.match(/^(тип|дата|итог|не закрыто|вопрос|решение|обоснование):\s*(.*)$/);
    if (m && (mode === 'head' || (mode === 'dec' && cur))) {
      key = m[1]; const val = m[2];
      if (mode === 'head') head[key] = val !== '' ? val : head[key];
      else if (val !== '') setVal(cur, key, val);
      continue;
    }
    if (!line.trim()) { key = null; continue; }
    if (key && mode === 'head') setVal(head, key, line.trim());
    else if (key && cur) setVal(cur, key, line.trim());
  }
  if (!title) { console.error('в файле нет «# титул сессии»'); process.exit(1); }

  const { byName, colsOf } = await journalSchema(BOARD);
  const sesT = byName.get('Сессии'), decT = byName.get('Решения'), prjT = byName.get('Проекты');
  if (!sesT) { console.error(`в ${BOARD} нет таблицы «Сессии» — сначала bootstrap`); process.exit(1); }
  const sesCols = colsOf('Сессии');

  // проект: первый объект Проектов (или по --project)
  let projectId = null;
  if (prjT) {
    const pi = process.argv.indexOf('--project');
    const want = pi > 0 ? process.argv[pi + 1] : null;
    const objs = await objectsOf(BOARD, prjT.id);
    const p = want ? objs.find(o => norm(o.value).includes(norm(want))) : objs[objs.length - 1];
    projectId = p?.id ?? null;
  }
  // parentId — как у существующих сессий
  const sample = (await objectsOf(BOARD, sesT.id)).slice(-1)[0];
  const parentId = sample?.parentId ?? 1;

  const ses = await call('POST', `/${BOARD}/objects`, { typeId: sesT.id, parentId, value: title });
  const sesId = ses.id ?? ses.objectId;
  const sesReq = {};
  for (const [k, colName] of [['дата', 'дата'], ['тип', 'тип'], ['итог', 'итог'], ['не закрыто', 'не закрыто']]) {
    if (head[k] && sesCols.get(colName)) sesReq[String(sesCols.get(colName))] = head[k];
  }
  if (projectId && sesCols.get('проект')) sesReq[String(sesCols.get('проект'))] = projectId;
  if (Object.keys(sesReq).length) await call('PATCH', `/${BOARD}/objects/${sesId}`, { requisites: sesReq });
  console.log(`✓ Сессия «${title}» (id ${sesId})`);

  const decCols = colsOf('Решения');
  for (const d of decisions) {
    if (!decT) break;
    const obj = await call('POST', `/${BOARD}/objects`, { typeId: decT.id, parentId, value: d.имя || (d.вопрос || '').slice(0, 60) });
    const oid = obj.id ?? obj.objectId;
    const req = {};
    for (const [k, colName] of [['вопрос', 'вопрос'], ['решение', 'решение'], ['обоснование', 'обоснование']]) {
      if (d[k] && decCols.get(colName)) req[String(decCols.get(colName))] = d[k];
    }
    if (decCols.get('сессия')) req[String(decCols.get('сессия'))] = sesId;
    if (projectId && decCols.get('проект')) req[String(decCols.get('проект'))] = projectId;
    if (Object.keys(req).length) await call('PATCH', `/${BOARD}/objects/${oid}`, { requisites: req });
    console.log(`  ✓ Решение «${d.имя}» (id ${oid})`);
  }
  console.log(`готово: сессия + ${decisions.length} решений в журнале ${BOARD}`);
  process.exit(0);
}
