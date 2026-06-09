#!/usr/bin/env node
/**
 * metakb/import — влить наши последние изменения в мета-КБ integram.
 *
 * Знания ложатся как решения (decisions) → из них integram выводит граф KAG.
 * Эндпоинт: POST {INTEGRAM_URL}/api/v2/{DB}/decisions  (Bearer JWT).
 *
 * Конфиг (env):
 *   INTEGRAM_URL    — база, напр. http://localhost:8081 или https://integram.<домен>
 *   INTEGRAM_DB     — workspace (рабочая база), напр. prompribor
 *   INTEGRAM_TOKEN  — JWT (из браузера: localStorage/cookie, или /auth)
 *
 * Запуск:
 *   node utils/metakb/import.mjs --dry-run         # показать payload'ы, без сети
 *   INTEGRAM_URL=... INTEGRAM_DB=... INTEGRAM_TOKEN=... node utils/metakb/import.mjs
 *
 * Идемпотентность: integram сам решает дубли; verdict 'accepted' — уже принятое.
 * Ничего не коммитим в чужой репозиторий: это наш отправитель в их API.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const HERE = dirname(fileURLToPath(import.meta.url));
const file = process.argv.find(a => a.endsWith('.json')) || join(HERE, 'changes.json');
const dryRun = process.argv.includes('--dry-run');

const URL_ = process.env.INTEGRAM_URL || '';
const DB = process.env.INTEGRAM_DB || '';
const TOKEN = process.env.INTEGRAM_TOKEN || '';

const { decisions } = JSON.parse(readFileSync(resolve(file), 'utf8'));
if (!Array.isArray(decisions) || !decisions.length) { console.error('Нет decisions в', file); process.exit(1); }

function post(path, body) {
  return new Promise((res) => {
    const u = new URL(path, URL_);
    const data = Buffer.from(JSON.stringify(body));
    const request = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request({
      method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: `Bearer ${TOKEN}` },
    }, (r) => { let b = ''; r.on('data', c => b += c); r.on('end', () => res({ status: r.statusCode, body: b })); });
    req.on('error', e => res({ status: 0, body: e.message }));
    req.write(data); req.end();
  });
}

const payload = d => ({
  title: d.title, domain: d.domain, verdict: d.verdict || 'proposed',
  description: d.description, weight: d.weight ?? 0,
  metadata: { ...(d.metadata || {}), imported_from: 'gift', imported_session: '2026-06-09' },
});

console.log(`Мета-КБ импорт · ${decisions.length} решений · ${dryRun ? 'DRY-RUN' : `→ ${URL_}/api/v2/${DB}/decisions`}\n`);

if (dryRun) {
  for (const d of decisions) {
    const p = payload(d);
    console.log(`• [${p.domain}] ${p.title}`);
    console.log(`  verdict=${p.verdict} weight=${p.weight} | ${(p.description || '').slice(0, 90)}…`);
  }
  console.log(`\nГотово (dry-run). Для реального импорта задай INTEGRAM_URL/INTEGRAM_DB/INTEGRAM_TOKEN и убери --dry-run.`);
  process.exit(0);
}

if (!URL_ || !DB || !TOKEN) {
  console.error('Нужны INTEGRAM_URL, INTEGRAM_DB, INTEGRAM_TOKEN (или запусти с --dry-run).');
  process.exit(1);
}

let ok = 0, fail = 0;
for (const d of decisions) {
  const r = await post(`/api/v2/${DB}/decisions`, payload(d));
  if (r.status >= 200 && r.status < 300) { ok++; console.log(`✓ ${d.title}`); }
  else { fail++; console.log(`✗ [${r.status}] ${d.title} — ${r.body.slice(0, 160)}`); }
}
console.log(`\nИтог: создано ${ok}, ошибок ${fail}.`);
