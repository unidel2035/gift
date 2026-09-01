#!/usr/bin/env node
/**
 * sppr-codespace-sync.mjs — синхронизация кода портала (codespace-репозиторий)
 * воркспейса sppr-demo: drondoc.online → ai2o.online.
 *
 * Сравнивает деревья ветки main пофайлово (path+sha). На цель дописываются
 * файлы, которых нет или чей sha отличается. Файлы, существующие только на
 * цели, НЕ удаляются (перенос — только добавление, как в sppr-migrate).
 *
 *   node utils/sppr-codespace-sync.mjs          — диф + перенос
 *   node utils/sppr-codespace-sync.mjs plan     — только диф
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = 'https://drondoc.online';
const DST = 'https://ai2o.online';
const WS = 'sppr-demo';
const REPO = 'portal';
const BRANCH = 'main';
const PLAN = process.argv[2] === 'plan';

const creds = () => JSON.parse(readFileSync(resolve(process.env.HOME || '', '.pm-credentials.json'), 'utf8'));

async function connect(host) {
  const r = await fetch(`${host}/api/v2/iam/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds()), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${host} login ${r.status}`);
  const d = await r.json();
  const H = { 'content-type': 'application/json', authorization: `Bearer ${d.accessToken || d.token}` };
  return async (method, path, body) => {
    const res = await fetch(`${host}/api/v2/${WS}${path}`, {
      method, headers: H, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`${host}${path} → ${res.status}: ${t.slice(0, 140)}`);
    let j; try { j = JSON.parse(t); } catch { return t; }
    return j.data ?? j;
  };
}

const arr = (x) => Array.isArray(x) ? x : (x?.items || x?.entries || x || []);

const src = await connect(SRC);
const dst = await connect(DST);

// дерево: если приходят поддеревья (type:tree) — углубляемся
async function tree(api, dir = '') {
  const out = new Map();
  const walk = async (d) => {
    const entries = arr(await api('GET', `/codespace/${REPO}/tree/${BRANCH}/${d}`));
    for (const e of entries) {
      if (e.type === 'tree') { await walk(e.path ? `${e.path}/` : `${d}${e.name}/`); continue; }
      const p = e.path || `${d}${e.name}`;
      out.set(p, e);
    }
  };
  await walk(dir);
  return out;
}

const sTree = await tree(src);
const dTree = await tree(dst);
console.log(`файлов: источник ${sTree.size}, цель ${dTree.size}`);

const toSync = [];
let same = 0;
for (const [p, e] of sTree) {
  const d = dTree.get(p);
  if (d && d.sha === e.sha) { same++; continue; }
  toSync.push({ path: p, reason: d ? 'изменился' : 'нет на цели' });
}
const onlyDst = [...dTree.keys()].filter(p => !sTree.has(p));

console.log(`совпадают: ${same}; перенести: ${toSync.length}; только на цели (не трогаем): ${onlyDst.length}`);
for (const f of toSync) console.log(`  ← ${f.path} (${f.reason})`);
if (PLAN || !toSync.length) process.exit(0);

// содержимое источника: blob отдаёт base64 или текст
const files = [];
for (const { path } of toSync) {
  const b = await src('GET', `/codespace/${REPO}/blob/${BRANCH}/${path}`);
  const content = b.content !== undefined
    ? (b.encoding === 'base64' ? Buffer.from(b.content, 'base64').toString('utf8') : b.content)
    : (typeof b === 'string' ? b : b.text ?? b.data ?? '');
  files.push({ filePath: path, content });
}
console.log(`содержимое прочитано: ${files.length} файлов (${files.reduce((a, f) => a + f.content.length, 0)} байт)`);

// commit-multi: атомарно, до 100 файлов за раз
for (let i = 0; i < files.length; i += 100) {
  const chunk = files.slice(i, i + 100);
  const r = await dst('POST', `/codespace/${REPO}/commit-multi`, {
    branch: BRANCH,
    files: chunk,
    message: `sync from drondoc.online: ${chunk.length} file(s) (${chunk[0].filePath}${chunk.length > 1 ? '…' : ''})`,
  });
  console.log(`  ✓ коммит ${Math.floor(i / 100) + 1}: ${chunk.length} файлов → ${r?.sha?.slice(0, 8) || r?.commitSha?.slice(0, 8) || 'ок'}`);
}

// сверка: повторное дерево цели
const dTree2 = await tree(dst);
let left = 0;
for (const [p, e] of sTree) {
  const d = dTree2.get(p);
  if (!d || d.sha !== e.sha) { left++; console.log(`  ✗ не сошёлся: ${p}`); }
}
console.log(left === 0 ? '✓ деревья сошлись — цель синхронна источнику' : `⚠ не сошлось файлов: ${left}`);
