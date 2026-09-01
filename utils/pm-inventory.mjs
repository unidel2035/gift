#!/usr/bin/env node
/**
 * pm-inventory.mjs — инвентаризация воркспейса sppr-demo на двух серверах
 * (drondoc.online — источник, ai2o.online — цель) перед переносом.
 *
 *   node utils/pm-inventory.mjs
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const HOSTS = [
  ['drondoc(источник)', 'https://drondoc.online'],
  ['ai2o(цель)', 'https://ai2o.online'],
];
const WS = process.argv[2] || 'sppr-demo';
const CREDS = JSON.parse(readFileSync(resolve(process.env.HOME || '', '.pm-credentials.json'), 'utf8'));

async function login(host) {
  const r = await fetch(`${host}/api/v2/iam/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(CREDS),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const d = await r.json();
  return d.accessToken || d.token || d.access_token;
}

const j = async (host, jwt, path) => {
  try {
    const r = await fetch(`${host}/api/v2/${WS}${path}`, {
      headers: { authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { err: r.status };
    return await r.json();
  } catch (e) { return { err: e.message }; }
};

for (const [label, host] of HOSTS) {
  const jwt = await login(host);
  const out = { label };

  const types = await j(host, jwt, '/schema?limit=200');
  const titems = types?.items || types?.data || [];
  out.tables = titems.length;
  // объекты по типам
  out.rows = [];
  let totalRows = 0;
  for (const t of titems.slice(0, 40)) {
    const c = await j(host, jwt, `/objects/count?typeId=${t.id}`);
    const n = c?.data?.count ?? c?.count ?? 0;
    totalRows += n;
    if (n) out.rows.push(`${t.name || t.slug}:${n}`);
  }
  out.totalRows = totalRows;

  const docs = await j(host, jwt, '/documents?limit=1');
  out.docs = docs?.total ?? docs?.meta?.total ?? (docs?.err ? `err ${docs.err}` : '?');
  const pm = await j(host, jwt, '/pm/issues?limit=1');
  out.pmIssues = pm?.total ?? (pm?.err ? `err ${pm.err}` : '?');
  const sprints = await j(host, jwt, '/pm/sprints');
  out.sprints = (sprints?.items || sprints?.data || []).length;
  for (const [k, p] of [['forms', '/forms'], ['dashboards', '/dashboards'], ['views', '/views'], ['reports', '/reports'], ['webhooks', '/webhooks']]) {
    const x = await j(host, jwt, p);
    out[k] = x?.err ? `err ${x.err}` : ((x?.items || x?.data || []).length);
  }
  const portal = await j(host, jwt, '/portal/api/config');
  out.portalConfig = portal?.err ? `err ${portal.err}` : (portal?.config || portal?.data || portal ? 'есть' : 'нет');
  const files = await j(host, jwt, '/files?limit=1');
  out.files = files?.total ?? (files?.err ? `err ${files.err}` : '?');

  console.log(JSON.stringify(out, null, 1));
}
