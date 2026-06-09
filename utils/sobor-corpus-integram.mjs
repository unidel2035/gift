#!/usr/bin/env node
/**
 * sobor-corpus-integram — корпус заземления из живой мета-КБ integram.
 *
 * Co-Scientist-собор заземляет кандидатов не на локальные файлы, а на реальные
 * знания компании: решения (decisions) рабочей области integram. Тогда смысл
 * ранжируется против настоящего корпуса завода/проекта, а не риторики.
 *
 * Env:
 *   INTEGRAM_URL    — напр. https://ai2o.online
 *   INTEGRAM_DB     — workspace, напр. gift-koinon
 *   INTEGRAM_TOKEN  — готовый JWT (тогда логин пропускается), ИЛИ
 *   INTEGRAM_EMAIL + INTEGRAM_PASSWORD — логин через iam/login
 *
 * Использование как корпус: sobor-ground-judge.loadCorpus() сам подхватит,
 * если задан INTEGRAM_URL и INTEGRAM_DB (см. CORPUS_INTEGRAM).
 *
 * CLI:
 *   node utils/sobor-corpus-integram.mjs        — показать, что в корпусе
 */
import { spawnSync } from 'node:child_process';

const URL_ = (process.env.INTEGRAM_URL || '').replace(/\/$/, '');
const DB = process.env.INTEGRAM_DB || '';

function curlJSON(method, path, { token, body } = {}) {
  const args = ['-s', '--max-time', '15', '-X', method, `${URL_}${path}`, '-H', 'Content-Type: application/json'];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  if (body) args.push('-d', JSON.stringify(body));
  const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 8e6 });
  try { return JSON.parse(r.stdout); } catch { return null; }
}

export function login() {
  if (process.env.INTEGRAM_TOKEN) return process.env.INTEGRAM_TOKEN;
  const email = process.env.INTEGRAM_EMAIL, password = process.env.INTEGRAM_PASSWORD;
  if (!email || !password) return null;
  const d = curlJSON('POST', '/api/v2/iam/login', { body: { email, password } });
  return d && d.accessToken ? d.accessToken : null;
}

/** Решения рабочей области как корпус [{id, text, source}]. */
export function fetchCorpus({ token = login() } = {}) {
  if (!URL_ || !DB || !token) return [];
  const d = curlJSON('GET', `/api/v2/${DB}/decisions?limit=200`, { token });
  const arr = d?.data || d?.decisions || (Array.isArray(d) ? d : []);
  return arr.map(x => ({
    id: `decision:${x.id ?? '?'}`,
    text: [x.title, x.description].filter(Boolean).join('. '),
    source: 'integram',
  })).filter(c => c.text);
}

/** Полные объекты решений (id, verdict, title, description, ...). */
export function fetchDecisions({ token = login() } = {}) {
  if (!URL_ || !DB || !token) return [];
  const d = curlJSON('GET', `/api/v2/${DB}/decisions?limit=200`, { token });
  return d?.data || d?.decisions || (Array.isArray(d) ? d : []);
}

/** Изменить поля решения (напр. verdict). */
export function patchDecision(id, fields, { token = login() } = {}) {
  if (!URL_ || !DB || !token) return { ok: false, error: 'нет URL/DB/token' };
  const d = curlJSON('PATCH', `/api/v2/${DB}/decisions/${id}`, { token, body: fields });
  return d && d.ok ? { ok: true } : { ok: false, error: JSON.stringify(d).slice(0, 160) };
}

/** Записать новое решение обратно в мета-КБ (замыкание смыслового контура). */
export function postDecision(decision, { token = login() } = {}) {
  if (!URL_ || !DB || !token) return { ok: false, error: 'нет URL/DB/token' };
  const body = {
    title: String(decision.title).slice(0, 500),
    domain: decision.domain || 'Смыслотворение',
    verdict: decision.verdict || 'proposed',
    description: decision.description || '',
    weight: decision.weight ?? 0,
    metadata: { ...(decision.metadata || {}), source: 'coscientist' },
  };
  const d = curlJSON('POST', `/api/v2/${DB}/decisions`, { token, body });
  return d && d.ok ? { ok: true, id: d.id ?? d.data?.id, data: d } : { ok: false, error: JSON.stringify(d).slice(0, 200) };
}

export const available = () => !!(URL_ && DB && (process.env.INTEGRAM_TOKEN || (process.env.INTEGRAM_EMAIL && process.env.INTEGRAM_PASSWORD)));

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!available()) { console.log('Задай INTEGRAM_URL, INTEGRAM_DB и токен/логин.'); process.exit(0); }
  const corpus = fetchCorpus();
  console.log(`Корпус из мета-КБ ${URL_}/${DB}: ${corpus.length} фрагментов`);
  for (const c of corpus.slice(0, 10)) console.log(`  ${c.id}: ${c.text.slice(0, 80)}`);
}
