#!/usr/bin/env node
/**
 * backoffice-bootstrap.mjs — разворачивает бэкофис (журнал организации)
 * в воркспейсе Инеграма: таблицы, связи, проект, портал.
 *
 *   node utils/backoffice-bootstrap.mjs <ws-slug> [--dry]
 *
 * Референс структуры — trytofly на INTEGRAM_URL. Портал-код берётся из
 * его codespace-репозитория (trytofly-journal) и коммитится в репо
 * «journal» целевого воркспейса. Потом воркспейс прикрепляется к org
 * (POST /orgs/<org>/workspaces) — и службы org-backoffice.mjs им управляют.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const HOST = (process.env.INTEGRAM_URL || 'https://ai2o.online').replace(/\/$/, '');
const SRC_WS = process.env.SRC_WS || 'trytofly';
const WS = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!WS) { console.log('用法: node utils/backoffice-bootstrap.mjs <ws-slug> [--dry]'); process.exit(1); }

function creds() {
  if (process.env.INTEGRAM_EMAIL && process.env.INTEGRAM_PASSWORD) {
    return { email: process.env.INTEGRAM_EMAIL, password: process.env.INTEGRAM_PASSWORD };
  }
  return JSON.parse(readFileSync(resolve(process.env.HOME || '', '.pm-credentials.json'), 'utf8'));
}
const jwt = await (async () => {
  const r = await fetch(`${HOST}/api/v2/iam/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(creds()) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const d = await r.json();
  return d.accessToken || d.token || d.access_token;
})();
const call = async (ws, method, path, body) => {
  if (DRY && method !== 'GET') { console.log(`  [dry] ${method} ${path}`); return {}; }
  const res = await fetch(`${HOST}/api/v2/${ws}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${ws}${path} → ${res.status}: ${t.slice(0, 140)}`);
  try { const j = JSON.parse(t); return j.data ?? j; } catch { return t; }
};
const callRoot = async (method, path, body) => {
  if (DRY) { console.log(`  [dry] ${method} ${path}`); return {}; }
  const res = await fetch(`${HOST}/api/v2${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${t.slice(0, 140)}`);
  try { const j = JSON.parse(t); return j.data ?? j; } catch { return t; }
};
const arr = (x) => Array.isArray(x) ? x : (x?.items || x || []);

// ── 1. референс: таблицы/колонки/портал источника ───────────────────────────
const TYPES = ['Проекты', 'Сессии', 'Решения', 'Инциденты', 'Грабли платформы', 'Участники', 'Портфель', 'Полка', 'Люди'];
const srcTypes = arr(await call(SRC_WS, 'GET', '/schema?limit=500')).filter(t => TYPES.includes(t.name));
const srcBatch = await call(SRC_WS, 'GET', `/schema/columns/batch?typeIds=${srcTypes.map(t => t.id).join(',')}`);
const srcPortal = await call(SRC_WS, 'GET', '/portal/api/config');
const srcCfg = srcPortal?.config || srcPortal;

// ── 2. таблицы в целевом воркспейсе ─────────────────────────────────────────
const dstTypes = arr(await call(WS, 'GET', '/schema?limit=500'));
const dstByName = new Map(dstTypes.map(t => [t.name, t]));
const typeId = {};   // имя → id в цели
for (const name of TYPES) {
  if (dstByName.get(name)) { typeId[name] = dstByName.get(name).id; console.log(`  таблица «${name}» уже есть (${typeId[name]})`); continue; }
  const st = srcTypes.find(t => t.name === name);
  const d = DRY ? { id: 900000 + Object.keys(typeId).length } : await call(WS, 'POST', '/schema', { name, baseType: st?.baseType ?? 3 });
  typeId[name] = d.id ?? d.typeId;
  console.log(`  + таблица «${name}» (${typeId[name]}${DRY ? ', фиктивный id' : ''})`);
}
// ── 3. колонки (ссылки — на свежесозданные таблицы) ────────────────────────
for (const st of srcTypes) {
  const cols = srcBatch[String(st.id)] || [];
  const dstBatch = await call(WS, 'GET', `/schema/columns/batch?typeIds=${typeId[st.name]}`);
  const have = new Set((dstBatch[String(typeId[st.name])] || []).map(c => c.name));
  for (const c of cols) {
    if (c.name === '_value' || have.has(c.name)) continue;
    const srcTypeName = new Map(srcTypes.map(t => [t.id, t.name])).get(c.refTypeId);
    const type = c.isReference ? typeId[srcTypeName] : c.type;
    if (type == null) { console.log(`  ⚠ ${st.name}.${c.name}: ссылка на таблицу вне набора — пропущена`); continue; }
    await call(WS, 'POST', `/schema/${typeId[st.name]}/columns`, { type, alias: c.name, required: !!c.required, multi: !!c.multi });
  }
  console.log(`  колонки «${st.name}»: готово`);
}
// ── 4. первый проект ────────────────────────────────────────────────────────
const prjObjs = DRY ? [] : arr(await call(WS, 'GET', `/objects?typeId=${typeId['Проекты']}&pageSize=1`));
if (!prjObjs.length) {
  await call(WS, 'POST', '/objects', { typeId: typeId['Проекты'], value: process.env.BOOTSTRAP_PROJECT || 'Основной проект' });
  console.log('  + объект «Основной проект»');
}
// ── 5. портал: репо + страницы ──────────────────────────────────────────────
const REPO = 'journal';
const repos = DRY ? [] : arr(await call(WS, 'GET', '/codespace').catch(() => []));
if (!repos.some(r => (r.slug || r.name) === REPO)) {
  await call(WS, 'POST', '/codespace', { slug: REPO, name: 'Журнал бэкофиса' });
  console.log(`  + codespace-репо «${REPO}»`);
}
const FILES = ['Journal.vue', 'Sessions.vue', 'Decisions.vue', 'Incidents.vue', 'Rakes.vue', 'Nav.vue', 'Backoffice.vue'];
for (const f of (DRY ? [] : FILES)) {
  const b = await call(SRC_WS, 'GET', `/codespace/${SRC_WS === 'trytofly' ? 'trytofly-journal' : 'journal'}/blob/main/${f}`);
  const content = b.encoding === 'base64' ? Buffer.from(b.content, 'base64').toString('utf8') : (b.content ?? '');
  await call(WS, 'POST', `/codespace/${REPO}/commit-multi`, { branch: 'main', files: [{ filePath: f, content }], message: `bootstrap: ${f}` });
}
console.log(`  файлы портала: ${FILES.length} закоммичено`);
const tableIdByName = {};
for (const [n, id] of Object.entries(typeId)) tableIdByName[n] = id;
const pages = [];
for (const p of srcCfg.pages || []) {
  if (p.type === 'auth') { pages.push(p); continue; }
  const mod = (p.modules || []).find(m => m.type === 'custom_code');
  if (!mod) continue;
  const bindings = {};
  for (const [k, v] of Object.entries(mod.config?.bindings || {})) {
    const m = String(v).match(/^table:(\d+)$/);
    if (m) {
      const st = srcTypes.find(t => t.id === Number(m[1]));
      bindings[k] = st ? `table:${typeId[st.name]}` : v;
    } else bindings[k] = v;
  }
  pages.push({ type: p.type, title: p.title, modules: [{ type: 'custom_code', config: { ...mod.config, repo: REPO, bindings, styleIsolation: 'scope' } }] });
}
await call(WS, 'POST', '/portal/api/config', { config: { ...srcCfg, pages }, active: true });
console.log(`  портал: ${pages.length} страниц → ${HOST}/${WS}/portal`);
console.log(DRY ? 'сухой прогон — таблицы не созданы' : `✓ бэкофис развёрнут в ${WS}. Прикрепить к org: POST /api/v2/orgs/<org>/workspaces {"workspaceSlug":"${WS}"}`);
