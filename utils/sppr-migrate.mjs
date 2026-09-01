#!/usr/bin/env node
/**
 * sppr-migrate.mjs — перенос воркспейса sppr-demo с drondoc.online на ai2o.online.
 *
 * Данные — EAV-дерево: типы → объекты (value+parentId) → реквизиты (колонки,
 * ссылки — на id объектов). Id типов/колонок/объектов на серверах РАЗНЫЕ,
 * всё мапится по именам: типы по имени, колонки по имени внутри типа,
 * объекты по (путь родителя + value).
 *
 * Фазы:
 *   node utils/sppr-migrate.mjs plan   — полный диф, ничего не меняет
 *   node utils/sppr-migrate.mjs copy   — перенос (только добавление, ничего не удаляет)
 *
 * Безопасность: конфиг портала цели перед перезаписью сохраняется в data/mera/.
 */
const SRC = process.env.SRC_HOST || 'https://drondoc.online';
const DST = process.env.DST_HOST || 'https://ai2o.online';
const WS = 'sppr-demo';
const PHASE = process.argv[2] || 'plan';

import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** данные входа: окружение или ~/.pm-credentials.json (пароль в код не кладём) */
function creds() {
  if (process.env.INTEGRAM_EMAIL && process.env.INTEGRAM_PASSWORD) {
    return { email: process.env.INTEGRAM_EMAIL, password: process.env.INTEGRAM_PASSWORD };
  }
  return JSON.parse(readFileSync(resolve(process.env.HOME || '', '.pm-credentials.json'), 'utf8'));
}

const log = (s) => { console.log(s); try { mkdirSync('data/mera', { recursive: true }); appendFileSync('data/mera/sppr-migrate.log', s + '\n'); } catch {} };

async function connect(host) {
  const r = await fetch(`${host}/api/v2/iam/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds()),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${host} login ${r.status}`);
  const d = await r.json();
  const jwt = d.accessToken || d.token || d.access_token;
  const H = { 'content-type': 'application/json', authorization: `Bearer ${jwt}` };
  return async (method, path, body) => {
    const res = await fetch(`${host}/api/v2/${WS}${path}`, {
      method, headers: H, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    let d2 = null; try { d2 = JSON.parse(t); } catch {}
    if (!res.ok) throw new Error(`${host}${path} → ${res.status}: ${t.slice(0, 140)}`);
    return d2?.data ?? d2;
  };
}

const src = await connect(SRC);
const dst = await connect(DST);

// connect() уже разворачивает {ok,data} → массивы приходят как есть
const arr = (x) => Array.isArray(x) ? x : (x?.items || x || []);

// ── 1. Типы ─────────────────────────────────────────────────────────────────
const srcTypes = arr(await src('GET', '/schema?limit=500'));
const dstTypes = arr(await dst('GET', '/schema?limit=500'));
const byName = (arr) => new Map(arr.map(t => [t.name, t]));
const dstByName = byName(dstTypes);
const typeMap = new Map(); // srcId → dstId (для существующих)

const missingTypes = [];
for (const t of srcTypes) {
  const d = dstByName.get(t.name);
  if (d) typeMap.set(t.id, d.id);
  else missingTypes.push(t);
}

// ── 2. Колонки типов ────────────────────────────────────────────────────────
const colsBatch = async (api, types) => {
  const ids = types.map(t => t.id).join(',');
  if (!ids) return {};
  const d = await api('GET', `/schema/columns/batch?typeIds=${ids}`);
  return d || {};
};
const srcCols = await colsBatch(src, srcTypes);
const dstCols = await colsBatch(dst, dstTypes);

// колонки сопоставляются по имени; карта srcColId → dstColId на тип
const colMaps = new Map(); // srcTypeId → Map(srcColId → dstColId)
const missingCols = [];
for (const t of srcTypes) {
  const dId = typeMap.get(t.id);
  if (!dId) continue;
  const sc = srcCols[String(t.id)] || [];
  const dc = dstCols[String(dId)] || [];
  const dcByName = new Map(dc.map(c => [c.name, c]));
  const m = new Map();
  for (const c of sc) {
    const d = dcByName.get(c.name);
    if (d) m.set(String(c.id), d); // ключи реквизитов приходят строками — храним строками
    else missingCols.push({ type: t.name, col: c.name, srcColId: c.id, isRef: c.isReference, refType: c.refTypeId });
  }
  colMaps.set(t.id, m);
}

// ── 3. Объекты: полная выгрузка обеих сторон ────────────────────────────────
async function fetchObjects(api, typeId) {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await api('GET', `/objects?typeId=${typeId}&page=${page}&pageSize=1000`);
    const items = d.items || d || [];
    out.push(...items);
    if (items.length < 1000) break;
  }
  // детали (реквизиты) тянуть лениво, только для переносимых
  return out;
}

const objCache = new Map(); // `${side}:${typeId}` → items
const getObjects = async (side, api, typeId) => {
  const k = `${side}:${typeId}`;
  if (!objCache.has(k)) objCache.set(k, await fetchObjects(api, typeId));
  return objCache.get(k);
};

// путь родителя (значения предков до корня) — устойчивый ключ сопоставления
const parentPath = (items, byId, id) => {
  const parts = [];
  let cur = byId.get(id)?.parentId;
  const seen = new Set();
  while (cur && cur !== 1 && !seen.has(cur)) {
    seen.add(cur);
    const p = byId.get(cur);
    if (!p) break;
    parts.unshift(p.value);
    cur = p.parentId;
  }
  return parts.join('/');
};
const keyOf = (items, byId, o) => parentPath(items, byId, o.id) + '' + (o.value || '');

const plan = PHASE === 'plan';
const objMap = new Map();   // srcObjId → dstObjId
const toCopy = [];          // { srcType, obj }
let copyTotal = 0, matchTotal = 0;
const perType = [];

for (const t of srcTypes) {
  const dId = typeMap.get(t.id);
  if (!dId) continue; // тип создаём, объекты переносим после
  const sItems = await getObjects('src', src, t.id);
  const dItems = await getObjects('dst', dst, dId);
  const sById = new Map(sItems.map(o => [o.id, o]));
  const dById = new Map(dItems.map(o => [o.id, o]));
  const dKeyMap = new Map(dItems.map(o => [keyOf(dItems, dById, o), o.id]));
  let c = 0;
  // сначала родители (по глубине), потом дети
  const depth = (o) => { let d = 0, cur = o.parentId; while (cur && cur !== 1 && sById.has(cur)) { d++; cur = sById.get(cur).parentId; } return d; };
  for (const o of [...sItems].sort((a, b) => depth(a) - depth(b) || (a.order || 0) - (b.order || 0))) {
    const k = keyOf(sItems, sById, o);
    const dstId = dKeyMap.get(k);
    if (dstId) { objMap.set(o.id, dstId); matchTotal++; }
    else { toCopy.push({ type: t, obj: o, parentSrcId: o.parentId }); c++; }
  }
  if (c) perType.push(`${t.name}: +${c}`);
  copyTotal += c;
}

// объекты типов, которых нет на цели — копировать целиком
for (const t of missingTypes) {
  const sItems = await getObjects('src', src, t.id);
  for (const o of sItems) toCopy.push({ type: t, obj: o, parentSrcId: o.parentId });
  perType.push(`${t.name}: +${sItems.length} (новый тип)`);
  copyTotal += sItems.length;
}

// ── 4. Портал ───────────────────────────────────────────────────────────────
let portalDiff = '';
try {
  const pc = await src('GET', '/portal/api/config');
  const srcCfg = pc?.config || pc;
  const dc = await dst('GET', '/portal/api/config').catch(() => null);
  const dstCfg = dc?.config || dc;
  // перемапка table:<srcTypeId> → table:<dstTypeId> в строках конфига
  let cfgStr = JSON.stringify(srcCfg);
  for (const [sId, dId] of typeMap) cfgStr = cfgStr.replaceAll(`table:${sId}`, `table:${dId}`);
  const remapped = JSON.parse(cfgStr);
  // сравниваем канонически — порядок ключей в JSON не различие
  const canon = (x) => JSON.stringify(x, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v));
  const changed = canon(remapped) !== canon(dstCfg);
  portalDiff = changed ? 'конфиги различаются — цель будет обновлена (бэкап сохранится)' : 'конфиги совпадают';
  if (PHASE === 'copy') {
    mkdirSync('data/mera', { recursive: true });
    writeFileSync('data/mera/sppr-portal-backup-ai2o.json', JSON.stringify(dstCfg, null, 2));
    await dst('POST', '/portal/api/config', { config: remapped, active: true });
    portalDiff += ' → записан';
  }
} catch (e) { portalDiff = '⚠ портал: ' + e.message.slice(0, 120); }

// ── 5. Код портала (codespace) ──────────────────────────────────────────────
let csDiff = '';
try {
  const sRepos = await src('GET', '/codespace');
  const dRepos = await dst('GET', '/codespace').catch(() => []);
  const sList = arr(sRepos);
  const dList = arr(dRepos);
  const dSlugs = new Set(dList.map(r => r.slug || r.name));
  const need = sList.filter(r => !dSlugs.has(r.slug || r.name));
  csDiff = need.length ? `репозитории кода: перенести ${need.map(r => r.slug || r.name).join(', ')}` : 'репозитории кода совпадают';
  // (файлы репозиториев переносит copy-фаза ниже)
  if (!plan && need.length) csDiff += ' → перенесено';
} catch (e) { csDiff = '⚠ codespace: ' + e.message.slice(0, 120); }

// ── 6. Документы ────────────────────────────────────────────────────────────
let docsDiff = '';
try {
  const sDocs = arr(await src('GET', '/documents?limit=100'));
  const dDocs = arr(await dst('GET', '/documents?limit=100'));
  const dTitles = new Set(dDocs.map(d => d.title));
  const need = sDocs.filter(d => !dTitles.has(d.title));
  docsDiff = need.length ? `документов перенести: ${need.length}` : 'документы совпадают';
  if (PHASE === 'copy' && need.length) {
    for (const d of need) await dst('POST', '/documents', { title: d.title });
    docsDiff += ' → перенесены (черновики без блоков)';
  }
} catch (e) { docsDiff = '⚠ документы: ' + e.message.slice(0, 120); }

// ── Отчёт plan ──────────────────────────────────────────────────────────────
if (plan) {
  log(`═══ ПЛАН переноса ${SRC} → ${DST}`);
  log(`типы: совпадают ${typeMap.size}, отсутствуют на цели: ${missingTypes.map(t => t.name).join(', ') || '—'}`);
  log(`колонки без пары: ${missingCols.length ? missingCols.map(c => `${c.type}.${c.col}`).join(', ') : '—'}`);
  log(`объекты: на месте ${matchTotal}, перенести ${copyTotal} (${perType.join('; ') || '—'})`);
  log(`портал: ${portalDiff}`);
  log(`код портала: ${csDiff}`);
  log(`документы: ${docsDiff}`);
  log('ничего не изменено. Запуск переноса: node utils/sppr-migrate.mjs copy');
  process.exit(0);
}

// ── Фаза cols: создать на цели колонки, которых не хватает ─────────────────
if (PHASE === 'cols') {
  log(`═══ КОЛОНКИ ${SRC} → ${DST}`);
  let made = 0, have = 0;
  for (const t of srcTypes) {
    const dId = typeMap.get(t.id);
    if (!dId) continue;
    const sc = srcCols[String(t.id)] || [];
    const dc = dstCols[String(dId)] || [];
    // сколько раз каждое имя уже есть на цели (бывают одноимённые «Строка»)
    const dstCount = new Map();
    for (const c of dc) dstCount.set(c.name, (dstCount.get(c.name) || 0) + 1);
    const dstSeen = new Map();
    for (const c of sc) {
      const need = c.isReference ? typeMap.get(c.refTypeId) : c.type; // ссылки: id типа на цели
      if (!need) { log(`  ⚠ ${t.name}.${c.name}: нет типа для ссылки (${c.refTypeId})`); continue; }
      const seen = dstSeen.get(c.name) || 0;
      dstSeen.set(c.name, seen + 1);
      if (seen < (dstCount.get(c.name) || 0)) { have++; continue; } // такая уже есть
      try {
        await dst('POST', `/schema/${dId}/columns`, {
          type: need, alias: c.name, required: !!c.required, multi: !!c.multi,
        });
        made++;
      } catch (e) { log(`  ✗ ${t.name}.${c.name}: ${e.message.slice(0, 90)}`); }
    }
  }
  log(`колонки: создано ${made}, уже были ${have}`);
  log('далее: node utils/sppr-migrate.mjs reqs — зальёт значения');
  process.exit(0);
}

// ── Фаза reqs: только долить реквизиты у уже спаренных объектов ─────────────
if (PHASE === 'reqs') {
  log(`═══ РЕКВИЗИТЫ ${SRC} → ${DST}`);
  let ok = 0, had = 0, skip = 0, fail = 0, noMap = 0, done = 0;

  // пачка параллельных запросов — однопоточно События идут часами
  const pool = async (items, n, fn) => {
    for (let i = 0; i < items.length; i += n) {
      await Promise.all(items.slice(i, i + n).map(fn));
      done += Math.min(n, items.length - i);
      if (done % 300 < n) log(`    … ${done}`);
    }
  };

  for (const t of srcTypes) {
    const dId = typeMap.get(t.id);
    const cm = colMaps.get(t.id);
    if (!dId || !cm || cm.size <= 1) continue; // нет пары типов или кроме _value колонок нет
    const sItems = await getObjects('src', src, t.id);
    const sIdSet = new Set(sItems.map(o => o.id));
    const pairs = [...objMap.entries()].filter(([s]) => sIdSet.has(s));
    log(`  тип «${t.name}»: пар ${pairs.length}, колонок ${cm.size}`);
    done = 0;
    await pool(pairs, 6, async ([sId, dId2]) => {
      try {
        // цель смотрим первой: если реквизиты уже есть — источник не читаем
        const dDet = await dst('GET', `/objects/${dId2}`).catch(() => null);
        if (dDet?.requisites && Object.keys(dDet.requisites).length) { had++; return; }
        const sDet = await src('GET', `/objects/${sId}`);
        const req = sDet?.requisites || {};
        if (!Object.keys(req).length) { skip++; return; }
        const out = {};
        for (const [colId, val] of Object.entries(req)) {
          const dcol = cm.get(String(colId));
          if (!dcol) continue;
          let v = val;
          if (dcol.isReference && v != null && v !== '') {
            const mapped = objMap.get(Number(v));
            if (mapped) v = mapped;
            else { noMap++; continue; }
          }
          out[dcol.id] = v;
        }
        if (!Object.keys(out).length) { skip++; return; }
        await dst('PATCH', `/objects/${dId2}`, { requisites: out });
        ok++;
      } catch (e) { fail++; if (fail <= 3) log(`  ⚠ «${sId}»: ${e.message.slice(0, 90)}`); }
    });
  }
  log(`реквизиты: долито ${ok}, уже были ${had}, пусто у источника ${skip}, нет пары ссылке ${noMap}, ошибок ${fail}`);
  process.exit(0);
}

// ── COPY ────────────────────────────────────────────────────────────────────
log(`═══ ПЕРЕНОС ${SRC} → ${DST}`);

// 1. типы
for (const t of missingTypes) {
  const d = await dst('POST', '/schema', { name: t.name, baseType: t.baseType, unique: !!t.unique, icon: t.icon ?? null });
  const newId = d.id ?? d.typeId;
  typeMap.set(t.id, newId);
  log(`  + тип «${t.name}» → id ${newId}`);
}

// 2. объекты: сначала все без реквизитов (чтобы ссылки имели куда указывать)
const createdNow = new Set();
for (const { type, obj, parentSrcId } of toCopy) {
  const dstTypeId = typeMap.get(type.id);
  const dstParent = objMap.get(parentSrcId) || (parentSrcId === 1 ? 1 : objMap.get(parentSrcId)) || 1;
  try {
    const d = await dst('POST', '/objects', { typeId: dstTypeId, parentId: dstParent, value: obj.value || '' });
    const newId = d.id ?? d.objectId;
    objMap.set(obj.id, newId);
    createdNow.add(obj.id);
  } catch (e) {
    log(`  ✗ объект «${(obj.value || '').slice(0, 40)}»: ${e.message.slice(0, 100)}`);
  }
}
log(`  объекты: создано ${createdNow.size} из ${toCopy.length}`);

// 3. реквизиты переносимых объектов (ссылки теперь можно перемапить)
let reqOk = 0, reqSkip = 0, reqFail = 0;
for (const { type, obj } of toCopy) {
  if (!createdNow.has(obj.id)) continue;
  const cm = colMaps.get(type.id);
  if (!cm || cm.size === 0) { reqSkip++; continue; }
  try {
    const det = await src('GET', `/objects/${obj.id}`);
    const req = det?.requisites || {};
    const out = {};
    for (const [colId, val] of Object.entries(req)) {
      const dcol = cm.get(String(colId));
      if (!dcol) continue;
      let v = val;
      if (dcol.isReference && v != null && v !== '') {
        const mapped = objMap.get(Number(v));
        if (mapped) v = mapped;
        else continue; // ссылка на объект, которого нет на цели — пропустить
      }
      out[dcol.id] = v;
    }
    if (!Object.keys(out).length) { reqSkip++; continue; }
    await dst('PATCH', `/objects/${objMap.get(obj.id)}`, { requisites: out });
    reqOk++;
  } catch (e) { reqFail++; if (reqFail <= 3) log(`  ⚠ реквизиты «${(obj.value || '').slice(0, 40)}»: ${e.message.slice(0, 90)}`); }
}
log(`  реквизиты: записано ${reqOk}, без реквизитов ${reqSkip}, ошибок ${reqFail}`);

log(`  портал: ${portalDiff}`);
log(`  код портала: ${csDiff}`);
log(`  документы: ${docsDiff}`);
log('═══ готово. Отчёт plan можно прогнать повторно для сверки.');
