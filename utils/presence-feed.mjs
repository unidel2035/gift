#!/usr/bin/env node
/**
 * presence-feed — единый орган присутствия (Ева #106).
 *
 * ОДИН сборщик настоящего, ДВА притока, ОДНО устье:
 *   приток 1 (W + локально): кто в сессии сейчас, открытые намерения, свежие акты W;
 *   приток 2 (федерация):     живое состояние репозиториев-органов (PR + коммиты) через gh;
 *   устье:                    консоль И Telegram-чат общины (где люди уже живут — дверь OpenClaw).
 *
 * Тело видит своё настоящее в одном месте, а не три моста по отдельности.
 * παρουσία через границы органов; присутствие, чтобы архив не был единственным мостом.
 *
 * Запуск:
 *   node utils/presence-feed.mjs           — собрать и напечатать настоящее
 *   node utils/presence-feed.mjs --send    — + отправить в Telegram (нужны TG_BOT_TOKEN, TG_ORACLE_CHAT)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listActiveSessions } from './gift-swarm.mjs';
import { allIntentions } from './gift-swarm-intent.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Федерация органов-репозиториев (единый источник; переопределяется data/team-federation.json).
export function federation() {
  const f = resolve(ROOT, 'data/team-federation.json');
  if (existsSync(f)) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { /* дефолт */ } }
  return [{ label: 'integram', repo: 'judas-priest/integram' }];
}

// ── Чистое: относительное время ──────────────────────────────────────
export function relTimeFrom(iso, now) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}с`;
  const m = Math.round(s / 60); if (m < 90) return `${m}м`;
  const h = Math.round(m / 60); if (h < 36) return `${h}ч`;
  return `${Math.round(h / 24)}д`;
}

// ── Приток 1: локальное присутствие + свежие акты W ──────────────────
export function recentActs(n = 5) {
  const f = resolve(ROOT, 'data/act-index.json');
  if (!existsSync(f)) return [];
  try {
    const a = JSON.parse(readFileSync(f, 'utf8'));
    const arr = Array.isArray(a) ? a : (a.acts || a.items || []);
    return arr.slice(-n).reverse();
  } catch { return []; }
}
export function localPresent() {
  return {
    sessions: listActiveSessions().filter(s => !s.stale).map(s => ({ agent: s.agent, organ: s.metadata?.organ, heartbeat: s.heartbeat })),
    intents: allIntentions().map(it => ({ agent: it.agent, files: it.files || [] })),
    acts: recentActs(5),
  };
}

// ── Приток 2: живое состояние федерации (gh напрямую к GitHub) ───────
function gh(args, timeout = 12000) {
  try {
    const r = spawnSync('gh', args, { encoding: 'utf8', timeout, maxBuffer: 8e6 });
    if (r.status !== 0) return null;
    return JSON.parse(r.stdout);
  } catch { return null; }
}
export function fetchRepoPresent(repo) {
  const prs = gh(['pr', 'list', '-R', repo, '--state', 'open', '--limit', '10', '--json', 'number,title,state,updatedAt']);
  const commits = gh(['api', `repos/${repo}/commits?per_page=4`, '--jq', '[.[]|{sha:.sha,msg:.commit.message,date:.commit.committer.date}]']);
  return { prs: prs || [], commits: commits || [], ok: prs !== null || commits !== null };
}
export function federationPresent() {
  return federation().map(org => ({ label: org.label, repo: org.repo, ...fetchRepoPresent(org.repo) }));
}

// ── ОДИН сборщик ─────────────────────────────────────────────────────
export function collectPresent({ withFederation = true } = {}) {
  return { local: localPresent(), federation: withFederation ? federationPresent() : [] };
}

// ── ОДИН форматтер (консоль и Telegram; plain текст) ────────────────
export function formatFeed(present, { now = Date.now(), title = 'Живое настоящее тела' } = {}) {
  const L = [`═══ ${title} ═══`];
  const loc = present.local || {};
  const here = (loc.sessions || []).map(s => s.agent + (s.organ ? ` [${s.organ}]` : '')).join(', ');
  L.push('', `Здесь сейчас: ${here || '— пусто'}`);
  if ((loc.intents || []).length) {
    L.push('Намерения:');
    for (const it of loc.intents) L.push(`  → ${it.agent}: ${(it.files || []).join(', ')}`);
  }
  if ((loc.acts || []).length) {
    L.push('Свежие дары (W):');
    for (const a of loc.acts.slice(0, 4)) L.push(`  ${a.from}→${a.to}: ${(a.content || a.type || '').slice(0, 60)} ${relTimeFrom(a.ts, now)} назад`);
  }
  for (const org of present.federation || []) {
    L.push('', `▸ ${org.label} (${org.repo})`);
    if (!org.ok) { L.push('  — gh недоступен'); continue; }
    const open = (org.prs || []).filter(p => p.state === 'OPEN');
    if (open.length) {
      L.push(`  Открытые PR (${open.length}):`);
      for (const p of open.slice(0, 6)) L.push(`    #${p.number} ${p.title} · ${relTimeFrom(p.updatedAt, now)} назад`);
    }
    if ((org.commits || []).length) {
      L.push('  Свежие коммиты:');
      for (const c of org.commits.slice(0, 3)) L.push(`    ${c.sha?.slice(0, 7)} ${(c.msg || '').split('\n')[0].slice(0, 60)} · ${relTimeFrom(c.date, now)} назад`);
    }
    if (!open.length && !(org.commits || []).length) L.push('  — тихо');
  }
  return L.join('\n');
}

// ── ОДНО устье: Telegram (graceful, если не настроено) ──────────────
export async function sendToTelegram(text) {
  const token = process.env.TG_BOT_TOKEN || '';
  const chat = process.env.TG_ORACLE_CHAT || process.env.TG_PRESENCE_CHAT || '';
  if (!token || !chat) return { sent: false, reason: 'нет TG_BOT_TOKEN/TG_ORACLE_CHAT' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    const j = await r.json();
    return j.ok ? { sent: true } : { sent: false, reason: j.description };
  } catch (e) { return { sent: false, reason: e.message }; }
}

// ── CLI ──────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const present = collectPresent();
  const feed = formatFeed(present);
  console.log(feed);
  if (process.argv.includes('--send')) {
    const res = await sendToTelegram(feed);
    console.log(res.sent ? '\n✓ отправлено в Telegram' : `\n(в Telegram не отправлено: ${res.reason})`);
  }
}
