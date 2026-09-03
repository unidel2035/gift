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
import { resolve, join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

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

// Закрытые статусы — по КАТЕГОРИИ (kind), не по имени: у каждого воркспейса
// свой набор статусов, и «done» там может называться иначе. kind приходят из
// GET /<ws>/pm/statuses; закрытым считаем done и canceled.
const closedStatusCache = new Map();
async function closedStatuses(ws) {
  if (closedStatusCache.has(ws)) return closedStatusCache.get(ws);
  let names = ['done', 'canceled'];
  try {
    const st = arr(await call('GET', `/${ws}/pm/statuses`));
    const byKind = st.filter(s => s.kind === 'done' || s.kind === 'canceled').map(s => s.name);
    if (byKind.length) names = byKind;
  } catch { /* нет статусов —fallback выше */ }
  closedStatusCache.set(ws, names);
  return names;
}
// Открытая задача = её статус не в закрытых категориях этого воркспейса
const openIn = async (ws, issues) => {
  const closed = await closedStatuses(ws);
  return issues.filter(i => !closed.includes(i.status));
};

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

async function upsertRows(ws, typeId, rows, cols, { keepOrder = false } = {}) {
  // полная пересинхронизация: таблица принадлежит агенту.
  // Порядок строки в таблице — отдельный ресурс: поле order в PATCH сервер
  // молча игнорирует, двигает только /objects/:id/reorder (грабля 03.09.2026).
  // keepOrder=true зовут таблицы, где порядок = что увидит портал первыми N.
  const existing = await objectsOf(ws, typeId);
  const byValue = new Map(existing.map(o => [String(o.value || ''), o]));
  const fresh = [];
  const want = new Set();
  let n = 0;
  for (const r of rows) {
    want.add(r.value);
    const req = {};
    for (const [k, v] of Object.entries(r.cols)) if (cols[k]) req[String(cols[k])] = String(v ?? '');
    const ex = byValue.get(r.value);
    if (ex) await call('PATCH', `/${ws}/objects/${ex.id}`, { requisites: req });
    else await call('POST', `/${ws}/objects`, { typeId, value: r.value, requisites: req });
    fresh.push(r.value);
    n++;
  }
  for (const o of existing) {
    if (!want.has(String(o.value || ''))) await call('DELETE', `/${ws}/objects/${o.id}`).catch(() => {});
  }
  if (!keepOrder) return;
  // Расставить порядок поданный вид: сервер перенумеровывает хвост после
  // каждого reorder, поэтому список перечитывается после каждого сдвига,
  // а нужная строка тянется на позицию цикла (вставочная сортировка).
  // Поток мал (единицы строк) — перечиты дороги только полке, но её не двигаем.
  for (let pos = 0; pos < fresh.length; pos++) {
    const now = await objectsOf(ws, typeId);
    if (String(now[pos]?.value || '') === fresh[pos]) continue; // на месте
    const from = now.findIndex(o => String(o.value || '') === fresh[pos]);
    if (from === -1) continue;
    try { await call('POST', `/${ws}/objects/${now[from].id}/reorder`, { order: pos + 1 }); } catch { /* порядок не критичен */ }
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
  const issues = await openIn(ws, arr(await call('GET', `/${ws}/pm/issues?limit=100`)));
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

// ── Доска конвейера: карточки gift-koinon → таблица «Доска» ─────────────────
// Нодовый пульт портала рисует граф статусов из этой таблицы. Канал тот же,
// что у прочих снапшотов: ключ у агента, cookie у портала — каждый в своих
// правах. Меру (токены) берём из локального журнала dev-loop.
async function syncBoard(ws) {
  const CONVEYOR = process.env.PM_CONVEYOR || 'gift-koinon';
  // Живой поток (todo/in_progress/in_review/done) берём по статусам — он мал,
  // и так ни одна живая карточка не выпадет из выборки. Полка (backlog) — их
  // сотни, API отдаёт не более 200 за раз (page игнорируется) — берём последние
  // 200 и честно говорим на пульте, что она показана не целиком.
  const flow = [];
  for (const st of ['todo', 'in_progress', 'in_review', 'done']) {
    flow.push(...arr(await call('GET', `/${CONVEYOR}/pm/issues?limit=100&status=${st}`)));
  }
  const shelf = arr(await call('GET', `/${CONVEYOR}/pm/issues?limit=200&status=backlog`));
  const byNum = new Map();
  for (const i of [...flow, ...shelf]) byNum.set(i.number, i);
  const cards = [...byNum.values()];
  // мера из журнала цен (последняя запись о задаче побеждает). Ключи двойные:
  // новые записи несут pm-номер, старые — только gh-issue, и связка
  // gh#N ↔ PM-N живёт в титуле карточки «… (gh #789)». Без второго ключа
  // старые записи (а там 99к токенов впустую на PM-6) были бы невидимы.
  const measureBy = new Map();
  const measureByIssue = new Map();
  try {
    const lines = readFileSync(resolve(process.cwd(), 'data/mera/devloop-costs.jsonl'), 'utf8').trim().split('\n').slice(-300);
    for (const ln of lines) {
      try {
        const j = JSON.parse(ln);
        if (j.pm != null) measureBy.set(String(j.pm), j);
        else if (j.issue != null) measureByIssue.set(String(j.issue), j);
      } catch { /* битая строка */ }
    }
  } catch { /* журнала ещё нет — мера пустая */ }
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  // Порядок строк = порядок чтения порталом (он берёт первые N по order):
  // живой поток впереди, полка следом. Иначе todo/done лягут за 200-й строкой
  // и пульт покажет «План 0» при живой карточке.
  const FLOW = ['in_progress', 'in_review', 'todo', 'done'];
  const order = (i) => {
    const k = FLOW.indexOf(i.status);
    return k === -1 ? 100 : k; // полка (backlog и прочие) — после потока
  };
  const rows = cards
    .filter(i => i.status !== 'done' || (i.closed_at && new Date(i.closed_at) > weekAgo))
    .sort((a, b) => order(a) - order(b))
    .map(i => {
      const gh = (String(i.title || '').match(/\(gh #(\d+)\)/) || [])[1];
      const m = measureBy.get(String(i.number)) || (gh ? measureByIssue.get(gh) : null);
      return {
        value: `PM-${i.number}`,
        cols: {
          'титул': i.title || '', 'статус': i.status || '',
          'мера': m ? `${(m.total?.in ?? 0) + (m.total?.out ?? m.total?.in ?? 0)} ток` : '',
          'прогон': m ? String(m.ts || '').slice(0, 16).replace('T', ' ') : '',
        },
      };
    });
  const id = await ensureTable(ws, 'Доска', [['титул', 12], ['статус', 8], ['мера', 8], ['прогон', 8]]);
  const batch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${id}`);
  const cols = Object.fromEntries((batch?.[String(id)] || []).map(c => [c.name, c.id]));
  await upsertRows(ws, id, rows, cols, { keepOrder: true });
  console.log(`  доска: ${rows.length} карточек в узлах (из ${cards.length})`);
  return id;
}

// ── Матрица даров: W-тензор + журнал актов → таблицы цеха ──────────────────
// Цеху нужен не только поток задач, но и отношения, на которых стоит конвейер:
// кто, кому и сколько дал, и откуда каждый факт. Источник — локальный снапшот
// матрицы (data/sacred-history-W.json, тензор) и журнал актов с провенансом
// (data/act-index.json, полный журнал). На сервере Nous полнее, но порт 8086
// не публичен, а локальный срез достатен для управления разработкой.
//
// Три таблицы отвечают на три вопроса цеха:
//   «Матрица»  — сколько дано (вес нитей, пересчёт вперёд)
//   «Дары»     — почему (журнал актов с провенансом: коммит, gh, время)
//   «Пустыни»  — чего не хватает (обратный вопрос: где актов нет вовсе)
// Пустыни — единственный вывод «от цели» в цехе, и он вшит руками; общий
// механизм вывода от цели в матрице не живёт и не должен: она помнит, не
// выводит. Таблица фиксирует границу честно — как есть.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

async function syncMatrix(ws) {
  const snap = readJson('data/sacred-history-W.json');
  const P = snap.persons || [];
  const threads = [];
  for (let i = 0; i < P.length; i++) {
    for (let j = 0; j < P.length; j++) {
      const v = snap.W?.[i]?.[j] ?? 0;
      if (i !== j && v > 0) threads.push({ from: P[i], to: P[j], w: +Number(v).toFixed(1) });
    }
  }
  threads.sort((a, b) => b.w - a.w);
  const mId = await ensureTable(ws, 'Матрица', [
    ['кому', 8], ['вес', 8], ['от', 8],
  ]);
  const mBatch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${mId}`);
  const mCols = Object.fromEntries((mBatch?.[String(mId)] || []).map(c => [c.name, c.id]));
  await upsertRows(ws, mId, threads.map(t => ({
    value: `${t.from} → ${t.to}`,
    cols: { 'кому': t.to, 'вес': t.w, 'от': t.from },
  })), mCols);
  console.log(`  матрица: ${threads.length} нитей (лиц ${P.length}, актов ${snap.actsCount})`);

  // Журнал актов: свежие 200 — управлению нужны последние, а не все 56+.
  // Порядок новый-сверху: последнее решение цех видит первым.
  const acts = readJson('data/act-index.json');
  const recent = [...acts].slice(-200).reverse();
  const aId = await ensureTable(ws, 'Дары', [
    ['от', 8], ['кому', 8], ['род', 8], ['вес', 8], ['что', 12], ['провенанс', 12], ['когда', 8],
  ]);
  const aBatch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${aId}`);
  const aCols = Object.fromEntries((aBatch?.[String(aId)] || []).map(c => [c.name, c.id]));
  await upsertRows(ws, aId, recent.map(a => ({
    value: String(a.ts || '').slice(0, 16).replace('T', ' ') + ' · ' + (a.from || '?') + '→' + (a.to || '?'),
    cols: {
      'от': a.from || '', 'кому': a.to || '', 'род': a.type || '',
      'вес': a.weight ?? '', 'что': a.content || '',
      'провенанс': [a.commit ? a.commit.slice(0, 7) : '', a.linkedIssue ? 'gh #' + a.linkedIssue : ''].filter(Boolean).join(' · '),
      'когда': String(a.ts || '').slice(0, 16).replace('T', ' '),
    },
  })), aCols);
  console.log(`  дары: ${recent.length} актов журнала (из ${acts.length})`);

  // Пустыни: у кого из живых лиц цеха нет ни одной нити. Живые = люди и агенты
  // роя (божественные лица и служебные _koinon/_abyss не цех). Порог того же
  // масштаба, что в ontology-pulse: тишина = ни одного акта, faded = <2.
  const workshop = P.filter(x => !/^(Отец|Сын|Дух|Христос|Небо|ДушиЖивые)$/.test(x) && x !== '_koinon' && x !== '_abyss');
  const has = new Set(threads.flatMap(t => [t.from, t.to]));
  const deserts = workshop.filter(x => !has.has(x));
  const fading = threads.filter(t => t.w < 2);
  const dId = await ensureTable(ws, 'Пустыни', [
    ['род', 8], ['тянется с', 8], ['что делать', 12],
  ]);
  const dBatch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${dId}`);
  const dCols = Object.fromEntries((dBatch?.[String(dId)] || []).map(c => [c.name, c.id]));
  const desertRows = [
    ...deserts.map(x => ({ value: `тишина: ${x}`, cols: { 'род': 'тишина', 'тянется с': '—', 'что делать': `ни одного акта дара с ${x} — родить вопрошание или вывести лицо из цеха` } })),
    ...fading.map(t => ({ value: `${t.from} → ${t.to} (${t.w})`, cols: { 'род': 'затухание', 'тянется с': `${t.w}`, 'что делать': `вес ${t.w} < 2 — связь почти расторгнута, нужен новый акт или честное расставание` } })),
  ];
  await upsertRows(ws, dId, desertRows, dCols);
  console.log(`  пустыни: ${deserts.length} тишин, ${fading.length} затуханий`);
}

// ── Команда фонда: отношения людей ФСТ из живых данных воркспейса ──────────
// Цеху на trytofly нужна матрица НЕ gift-проекта (община, _claude, заветы —
// она лежит выше), а команды фонда ФСТ. У фонда нет своей W-матрицы, но есть
// платформенные следы отношений, из которых она пересчитывается каждую ночь:
//   PM-карточки — кто ставит работу (reporter → assignee, статус по kind)
//   голоса ИК   — ревью-агенты и их вердикты (до/после кросс-дебата)
//   решения ИК  — итог и кто утвердил
// Форма — квадратная (лица × лица, клетка = акты между ними), как морфологический
// ящик uav-портала: там челлендж × пространство, здесь донор × получатель.
// Всё пересчитывается вперёд из живых данных; акты фонда необратимы на
// стороне платформы (журнал объектов), здесь — срез.
async function syncFundTeam(ws) {
  const FUND = process.env.PM_FUND || 'fund-demo';

  // 1. Состав команды: роли и логины фонда (1813: логин 1814, роль 1815).
  const roster = [];
  for (const t of arr(await call('GET', `/${FUND}/objects?typeId=1813&limit=50`))) {
    const det = await call('GET', `/${FUND}/objects/${t.id}`).catch(() => null);
    const r = det?.requisites || {};
    roster.push({ name: String(t.value || ''), login: String(r['1814'] || ''), role: String(r['1815'] || ''), critical: String(r['1816'] || '') });
  }

  // 2. PM-карточки: нити «поставил → исполняет». Статус закрыт — по категории
  // (kind), не по имени: closedStatuses знает про done/canceled.
  const cards = arr(await call('GET', `/${FUND}/pm/issues?limit=200`));
  const closed = await closedStatuses(FUND);
  const PUT = 'Постановщик'; // reporter_id=1 — супервайзер демо-фонда, ставит всю работу
  const threads = new Map(); // "от→кому" → {from,to,total,done,open}
  for (const c of cards) {
    const to = c.assignee_name || 'без исполнителя';
    const key = `${PUT}→${to}`;
    if (!threads.has(key)) threads.set(key, { from: PUT, to, total: 0, done: 0, open: 0 });
    const t = threads.get(key);
    t.total++;
    if (closed.includes(c.status)) t.done++; else t.open++;
  }

  // 3. Голоса ИК: агент → вердикт (547, 548), уверенность и сдвиг после дебатов.
  const amap = new Map(arr(await call('GET', `/${FUND}/objects?typeId=524&limit=50`)).map(a => [String(a.id), a.value]));
  const vmap = new Map(arr(await call('GET', `/${FUND}/objects?typeId=523&limit=50`)).map(v => [String(v.id), v.value]));
  const votes = [];
  for (const v of arr(await call('GET', `/${FUND}/objects?typeId=526&limit=100`))) {
    const det = await call('GET', `/${FUND}/objects/${v.id}`).catch(() => null);
    const r = det?.requisites || {};
    votes.push({
      agent: amap.get(String(r['547'])) || '—',
      verdict: vmap.get(String(r['548'])) || '—',
      before: vmap.get(String(r['4627'])) || '',
      score: String(r['543'] || ''),
      confidence: String(r['4620'] || ''),
      solution: String(v.value.split(' · ')[1] || ''),
    });
  }

  // 4. Решения ИК: итог (342 → справочник 305) и кто утвердил (720).
  const smap = new Map(arr(await call('GET', `/${FUND}/objects?typeId=305&limit=50`)).map(s => [String(s.id), s.value]));
  const decisions = [];
  for (const i of arr(await call('GET', `/${FUND}/objects?typeId=309&limit=50`))) {
    const det = await call('GET', `/${FUND}/objects/${i.id}`).catch(() => null);
    const r = det?.requisites || {};
    decisions.push({
      name: String(i.value || ''),
      outcome: smap.get(String(r['342'])) || '',
      approvedBy: r['720'] ? String(r['720']).split(' (')[0] : '',
    });
  }

  // ── Квадрат: строки = доноры, колонки = получатели, клетка = акты ─────────
  // Лица: команда фонда + постановщик + «без исполнителя» + ревью-агенты ИК.
  // Акты считаем поштучно, не по свёрнутым нитям: клетка = счётчик актов.
  const names = [...new Set([
    ...roster.map(p => p.name), PUT, 'без исполнителя',
    ...votes.map(v => v.agent).filter(a => a !== '—'),
  ])];
  const cell = new Map(names.map(a => [a, new Map(names.map(b => [b, { total: 0, done: 0, open: 0, kinds: [] }]))]));
  const bump = (from, to, kind, done) => {
    const row = cell.get(from); if (!row || !row.has(to)) return;
    const c = row.get(to);
    c.total++; if (done) c.done++; else c.open++;
    if (!c.kinds.includes(kind)) c.kinds.push(kind);
  };
  for (const c of cards) {
    const to = c.assignee_name || 'без исполнителя';
    bump(PUT, to, 'поручение', closed.includes(c.status));
  }
  for (const v of votes) bump('Член инвест-комитета', v.agent, 'ревью', false);
  for (const d of decisions) if (d.approvedBy) bump(d.approvedBy, 'Член инвест-комитета', 'утверждение', true);

  const qId = await ensureTable(ws, 'Квадрат фонда', [
    ['от', 8], ['кому', 8], ['актов', 8], ['закрыто', 8], ['открыто', 8], ['род', 8],
  ]);
  const qBatch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${qId}`);
  const qCols = Object.fromEntries((qBatch?.[String(qId)] || []).map(c => [c.name, c.id]));
  const qRows = [];
  for (const a of names) for (const b of names) {
    if (a === b) continue;
    const c = cell.get(a).get(b);
    if (!c.total) continue;
    qRows.push({ value: `${a} → ${b}`, cols: { 'от': a, 'кому': b, 'актов': c.total, 'закрыто': c.done, 'открыто': c.open, 'род': c.kinds.join('+') } });
  }
  await upsertRows(ws, qId, qRows, qCols);
  console.log(`  квадрат фонда: ${qRows.length} клеток (лиц ${names.length}, карточек ${cards.length})`);

  // ── Состав: роли и логины — кто вообще есть в фонде ───────────────────────
  const rId = await ensureTable(ws, 'Состав фонда', [
    ['роль', 8], ['логин', 8], ['критичные сигналы', 8],
  ]);
  const rBatch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${rId}`);
  const rCols = Object.fromEntries((rBatch?.[String(rId)] || []).map(c => [c.name, c.id]));
  await upsertRows(ws, rId, roster.map(p => ({
    value: p.name,
    cols: { 'роль': p.role, 'логин': p.login, 'критичные сигналы': p.critical === '1' ? 'да' : '' },
  })), rCols);
  console.log(`  состав фонда: ${roster.length} лиц`);

  // ── Ревью: голоса ИК — вердикты до/после кросс-дебата ─────────────────────
  const vId = await ensureTable(ws, 'Ревью фонда', [
    ['агент', 8], ['вердикт', 8], ['до дебатов', 8], ['скор', 8], ['уверенность', 8], ['решение', 12],
  ]);
  const vBatch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${vId}`);
  const vCols = Object.fromEntries((vBatch?.[String(vId)] || []).map(c => [c.name, c.id]));
  await upsertRows(ws, vId, votes.map(v => ({
    value: `${v.agent} · ${v.solution}`,
    cols: { 'агент': v.agent, 'вердикт': v.verdict, 'до дебатов': v.before, 'скор': v.score, 'уверенность': v.confidence, 'решение': v.solution },
  })), vCols);
  console.log(`  ревью фонда: ${votes.length} голосов ИК`);

  // ── Решения: итоги и утвердившие ──────────────────────────────────────────
  const dId2 = await ensureTable(ws, 'Решения фонда', [
    ['итог', 8], ['утвердил', 12],
  ]);
  const d2Batch = await call('GET', `/${ws}/schema/columns/batch?typeIds=${dId2}`);
  const d2Cols = Object.fromEntries((d2Batch?.[String(dId2)] || []).map(c => [c.name, c.id]));
  await upsertRows(ws, dId2, decisions.map(d => ({
    value: d.name,
    cols: { 'итог': d.outcome, 'утвердил': d.approvedBy || 'на утверждении' },
  })), d2Cols);
  console.log(`  решения фонда: ${decisions.length}`);
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
  const open = await openIn(BOARD, board);
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
  const openCards = await openIn(BOARD, boardIssues);
  let made = 0, updated = 0, skipped = 0;

  for (const w of pf.items || []) {
    if (!w.pmEnabled || !w.overdue) continue;
    // точечный список просроченных (открытые — по категориям статусов воркспейса)
    const wsIssues = arr(await call('GET', `/${w.slug}/pm/issues?limit=100`));
    const issues = (await openIn(w.slug, wsIssues))
      .filter(i => i.due_date && new Date(i.due_date) < new Date());
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
        // соглашение журнала: хвост «ЗАКРЫТО: …» — фактически закрыт, пятном не считаем.
        // \b для кириллицы в JS не определён (граница слова считается только
        // по латинице) — «закрыто:» не отсекалось вовсе. Граница задаётся
        // взглядом «вперёд не-буква» (грабля 03.09.2026, найдена на Пульте).
        if (/^закрыто(?![а-яё])/i.test(norm(tail))) continue;
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
    try { await syncBoard(BOARD); } catch (e) { console.log(`  доска: ${e.message.slice(0, 120)}`); }
    try { await syncMatrix(BOARD); } catch (e) { console.log(`  матрица: ${e.message.slice(0, 120)}`); }
    try { await syncFundTeam(BOARD); } catch (e) { console.log(`  фонд: ${e.message.slice(0, 120)}`); }
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
