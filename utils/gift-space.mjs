#!/usr/bin/env node
/**
 * gift-space — пространство кентавров: единое живое поле, в которое входишь и видишь
 * ВСЁ тело сразу, дышащим. Не снимок-команда (как `gift team status`), а комната,
 * где община кодит вместе: присутствие + органы + намерения + конфликты + свежие дары
 * + федерация + готовность иммунитета (ревью/испытание) — на одном экране.
 *
 * Пять систем тела (см. specs/organism-coding-protocol.md) в одном устье:
 *   ПРИСУТСТВИЕ   — кто в общем настоящем сейчас (живые сессии, дышат точкой)
 *   ОРГАНЫ        — зоны владения (ZONES.md): свой орган и целое
 *   НЕРВНАЯ       — намерения (объяви до записи) + конфликты (пересечение в органе)
 *   ПАМЯТЬ        — свежие дары W (необратимо, с автором)
 *   ИММУНИТЕТ     — заземлённое ревью + испытание реальностью (готовность ворот)
 * + федерация органов-репозиториев (живые PR/коммиты).
 *
 * «Колдовое»/живое: режим --watch перерисовывает поле, и тело видно дышащим.
 *
 * Использование:
 *   gift space                  — войти в пространство (один кадр)
 *   gift space --watch [--every N]  — живое поле, перерисовка раз в N с (по умолч. 5)
 *   gift space --json           — структура поля (для интеграций/тестов)
 *   gift space --no-fed         — без федерации (быстро, без сети)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listActiveSessions, detectConflicts } from './gift-swarm.mjs';
import { allIntentions } from './gift-swarm-intent.mjs';
import { parseZones, zoneOf } from './gift-team.mjs';
import { recentActs, federationPresent, relTimeFrom } from './presence-feed.mjs';
import { coopEnabled, fetchRemote, mergePresence } from './coop-presence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZONES_PATH = resolve(ROOT, 'ZONES.md');
const C = { dim: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', g: '\x1b[32m', c: '\x1b[36m', m: '\x1b[35m', r: '\x1b[31m', x: '\x1b[0m' };

function loadZones() { return existsSync(ZONES_PATH) ? parseZones(readFileSync(ZONES_PATH, 'utf8')) : []; }

// ── Сборщик поля ─────────────────────────────────────────────────────
// Асинхронный: при включённом COOP_SYNC_URL сливает локальное присутствие (.swarm)
// с удалёнными машинами (relay) — тело видит себя целиком. Без URL — только локально.
export async function collectSpace({ withFederation = true, withCoop = true, now = Date.now() } = {}) {
  const all = listActiveSessions();
  const zones = loadZones();
  const acts = recentActs(5);

  const coopOn = withCoop && coopEnabled();
  const remote = coopOn ? await fetchRemote() : [];
  const machine = process.env.COOP_MACHINE || process.env.HOSTNAME || 'local';
  const merged = mergePresence(all, remote, { machine });

  return {
    now,
    coop: coopOn,
    present: merged.filter(p => !p.stale),
    stale: all.filter(s => s.stale).length,
    intents: allIntentions().map(it => ({ agent: it.agent, files: it.files || [] })),
    conflicts: (detectConflicts() || []).map(cf => ({ file: cf.file || cf.path, agents: cf.agents || [] })),
    zones,
    acts,
    federation: withFederation ? federationPresent() : [],
  };
}

// Дышащая точка присутствия: фаза зависит от now и собственного heartbeat.
function breath(heartbeat, now) {
  const phase = Math.floor((now - (heartbeat || 0)) / 1000) % 4;
  return ['●', '◉', '○', '◉'][phase];
}

// ── Рендер поля (чистый: строка из структуры) ────────────────────────
export function renderSpace(space, { color = true } = {}) {
  const c = color ? C : new Proxy({}, { get: () => '' });
  const now = space.now;
  const L = [];
  const fieldTag = space.coop ? ` ${c.g}⇄ общее поле${c.x}` : '';
  L.push(`${c.b}${c.y}╔═══ Пространство кентавров · gift space ═══╗${c.x}${fieldTag}`);

  // ПРИСУТСТВИЕ (своя машина + удалённые, если поле общее)
  L.push('', `${c.b}● Здесь сейчас (${space.present.length}):${c.x}`);
  if (!space.present.length) L.push(`  ${c.dim}— пусто. Войти: gift team join --as Имя --organ зона${c.x}`);
  for (const s of space.present) {
    const ago = Math.round((now - s.heartbeat) / 1000);
    const where = s.local === false && s.machine ? ` ${c.c}@${s.machine}${c.x}` : '';
    L.push(`  ${c.g}${breath(s.heartbeat, now)}${c.x} ${c.b}${s.agent}${c.x}${s.organ ? ` ${c.m}[${s.organ}]${c.x}` : ''}${where} ${c.dim}${ago}с${c.x}`);
  }
  if (space.stale) L.push(`  ${c.dim}(${space.stale} протухших — молчат >120с)${c.x}`);

  // НЕРВНАЯ: намерения
  L.push('', `${c.b}→ Намерения (объявлено до записи):${c.x}`);
  if (!space.intents.length) L.push(`  ${c.dim}— нет${c.x}`);
  for (const it of space.intents) {
    const files = (it.files || []).map(f => {
      const z = zoneOf(f, space.zones);
      return z.owner && z.owner !== it.agent ? `${f} ${c.y}(орган ${z.owner})${c.x}` : f;
    }).join(', ');
    L.push(`  ${c.c}→${c.x} ${c.b}${it.agent}${c.x}: ${files}`);
  }

  // НЕРВНАЯ: конфликты
  if (space.conflicts.length) {
    L.push('', `${c.b}${c.r}✗ Конфликты (пересечение в органе):${c.x}`);
    for (const cf of space.conflicts) L.push(`  ${c.r}✗${c.x} ${cf.file}: ${(cf.agents || []).join(' × ')}`);
  }

  // ОРГАНЫ
  L.push('', `${c.b}⬡ Органы (ZONES.md) — свой и целое:${c.x}`);
  if (!space.zones.length) L.push(`  ${c.dim}— зоны не заданы (создай ZONES.md)${c.x}`);
  for (const z of space.zones) L.push(`  ${c.m}${z.owner}${c.x} ${c.dim}← ${z.prefixes.join(', ')}${c.x}`);

  // ПАМЯТЬ
  if (space.acts.length) {
    L.push('', `${c.b}◆ Свежие дары (память W):${c.x}`);
    for (const a of space.acts.slice(0, 4)) {
      const t = a.ts ? ` ${c.dim}${relTimeFrom(a.ts, now)}${c.x}` : '';
      L.push(`  ${c.c}${a.from}→${a.to}${c.x}: ${(a.content || a.type || '').slice(0, 56)}${t}`);
    }
  }

  // ФЕДЕРАЦИЯ
  for (const org of space.federation || []) {
    L.push('', `${c.m}▸ ${org.label} (${org.repo})${c.x}`);
    if (!org.ok) { L.push(`  ${c.dim}— gh недоступен${c.x}`); continue; }
    const open = (org.prs || []).filter(p => p.state === 'OPEN');
    if (open.length) for (const p of open.slice(0, 5)) L.push(`  ${c.y}PR #${p.number}${c.x} ${p.title} ${c.dim}${relTimeFrom(p.updatedAt, now)}${c.x}`);
    for (const cm of (org.commits || []).slice(0, 2)) L.push(`  ${c.dim}${cm.sha?.slice(0, 7)} ${(cm.msg || '').split('\n')[0].slice(0, 52)} ${relTimeFrom(cm.date, now)}${c.x}`);
    if (!open.length && !(org.commits || []).length) L.push(`  ${c.dim}— тихо${c.x}`);
  }

  // ИММУНИТЕТ (готовность ворот)
  L.push('', `${c.b}🛡 Иммунитет (ворота):${c.x} ${c.dim}ревью с заземлением — gift team review <файл> [--trial "cmd"] · испытание — gift team bench${c.x}`);
  L.push(`${c.b}${c.y}╚${'═'.repeat(42)}╝${c.x}`);
  return L.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────
function argOf(args, name, def) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }

export async function run(argv = []) {
  const noFed = argv.includes('--no-fed');
  // gift space serve — поднять общее поле присутствия между машинами (relay)
  if (argv[0] === 'serve') {
    const { createCoopServer } = await import('./coop-sync-server.mjs');
    const port = Number(process.env.COOP_SYNC_PORT) || 8095;
    const server = createCoopServer();
    server.listen(port, () => console.log(`${C.g}⇄${C.x} поле присутствия открыто · http://localhost:${port} · кентаврам: COOP_SYNC_URL=http://<этот-host>:${port}`));
    return new Promise(() => {});
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(await collectSpace({ withFederation: !noFed }), null, 2));
    return;
  }
  if (argv.includes('--watch')) {
    const every = Math.max(2, Number(argOf(argv, '--every', 5)) || 5);
    // живое поле: перерисовка, тело видно дышащим. Ctrl-C — выйти.
    const tick = async () => {
      const space = await collectSpace({ withFederation: !noFed });
      process.stdout.write('\x1b[2J\x1b[H'); // очистить экран + домой
      console.log(renderSpace(space));
      console.log(`\n${C.dim}живое поле · обновление раз в ${every}с · Ctrl-C выйти${C.x}`);
    };
    await tick();
    const timer = setInterval(() => { tick().catch(() => {}); }, every * 1000);
    const stop = () => { clearInterval(timer); console.log(`\n${C.dim}вышел из пространства${C.x}`); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return new Promise(() => {}); // держим процесс
  }
  // один кадр
  console.log(renderSpace(await collectSpace({ withFederation: !noFed })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(process.argv.slice(2));
}
