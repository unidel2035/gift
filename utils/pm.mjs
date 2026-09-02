#!/usr/bin/env node
/**
 * pm.mjs — клиент Инеграм-PM: задачи живут здесь, GitHub больше не нужен.
 *
 * Поток задачи (одно человеческое действие — перетаскивание карточки):
 *   backlog     сырое: вопрошания, идеи, без плана
 *   todo        план написан роботом (комментарием), ждёт человека
 *   in_progress человек перетащил = «да, делай». Ночной робок берёт отсюда
 *   done        сделано, тесты зелёные, в комментарии — цена в токенах
 *
 * Окружение: INTEGRAM_URL, INTEGRAM_EMAIL, INTEGRAM_PASSWORD, PM_WORKSPACE (по умолч. gift-koinon)
 */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const URL_ = (process.env.INTEGRAM_URL || 'https://ai2o.online').replace(/\/$/, '');
const WS = process.env.PM_WORKSPACE || 'gift-koinon';
const TTL = 55 * 60 * 1000; // JWT живёт ~час, кэшируем на 55 минут
const TOKEN_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'mera', 'pm-token.json');
let cached = null;

/** Данные входа: из окружения, иначе из ~/.pm-credentials.json (крон env не имеет). */
function creds() {
  if (process.env.INTEGRAM_EMAIL && process.env.INTEGRAM_PASSWORD) {
    return { email: process.env.INTEGRAM_EMAIL, password: process.env.INTEGRAM_PASSWORD };
  }
  try {
    return JSON.parse(readFileSync(resolve(process.env.HOME || '', '.pm-credentials.json'), 'utf8'));
  } catch {
    throw new Error('нет данных для входа: задай INTEGRAM_EMAIL/INTEGRAM_PASSWORD или ~/.pm-credentials.json');
  }
}

/** Логин → JWT. Кэшируется в data/mera/pm-token.json. */
export async function token() {
  if (cached && Date.now() - cached.ts < TTL) return cached.jwt;
  try {
    cached = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    if (cached && Date.now() - cached.ts < TTL) return cached.jwt;
  } catch { /* нет кэша */ }
  const r = await fetch(`${URL_}/api/v2/iam/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds()),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const d = await r.json();
  const jwt = d.accessToken || d.token || d.access_token;
  if (!jwt) throw new Error('в ответе логина нет токена');
  cached = { ts: Date.now(), jwt };
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true });
    writeFileSync(TOKEN_FILE, JSON.stringify(cached));
  } catch { /* кэш не критичен */ }
  return jwt;
}

/** Запрос к PM API воркспейса. */
export async function api(method, path, body = null, _retried = false) {
  const jwt = await token();
  const r = await fetch(`${URL_}/api/v2/${WS}/pm${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  // Сервер гасит JWT раньше нашего TTL (и логин из другого скрипта
  // инвалидирует чужой токен): 401 → сбросить кэш, перелогиниться, повторить.
  if (r.status === 401 && !_retried) {
    cached = null;
    try { unlinkSync(TOKEN_FILE); } catch { /* уже нет */ }
    return api(method, path, body, true);
  }
  if (!r.ok) throw new Error(`pm ${method} ${path} → ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  return d.data ?? d;
}

// ── Удобные обёртки ─────────────────────────────────────────────────────
export const listIssues = (params = '') => api('GET', `/issues${params}`);
export const getIssue = (id) => api('GET', `/issues/${id}`);
export const createIssue = (data) => api('POST', '/issues', data);
export const updateIssue = (id, patch) => api('PATCH', `/issues/${id}`, patch);
export const comment = (id, text) => api('POST', `/issues/${id}/comments`, { body: text });
export const listComments = (id) => api('GET', `/issues/${id}/comments`);

// CLI для рук: node utils/pm.mjs list|create "титул"|status <id> <статус>|comment <id> "текст"
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'list') {
    const it = await listIssues('?limit=100');
    const items = it.items || it;
    console.log(`задач: ${items.length}`);
    for (const i of items) console.log(`  #${i.number} [${i.status}] ${i.title}`);
  } else if (cmd === 'create' && rest[0]) {
    const i = await createIssue({ title: rest.join(' ') });
    console.log(`создано: #${i.number} (id ${i.id})`);
  } else if (cmd === 'status' && rest[1]) {
    await updateIssue(rest[0], { status: rest[1] });
    console.log(`#${rest[0]} → ${rest[1]}`);
  } else if (cmd === 'comment' && rest[1]) {
    await comment(rest[0], rest.slice(1).join(' '));
    console.log(`комментарий добавлен к #${rest[0]}`);
  } else {
    console.log('pm.mjs — клиент Инеграм-PM\n  node utils/pm.mjs list | create "титул" | status <id> <статус> | comment <id> "текст"');
  }
}
