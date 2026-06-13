#!/usr/bin/env node
/**
 * coop-presence — клиент живого поля присутствия между машинами.
 *
 * Мост от локального `.swarm` (одна машина) к общему relay (всё тело):
 *   pushPresence  — отправить свой heartbeat в общее поле (graceful: молчит без URL);
 *   fetchRemote   — забрать присутствие со всех машин (graceful: [] при недоступности);
 *   mergePresence — ЧИСТОЕ слияние локальных и удалённых сессий (своя машина не двоится).
 *
 * Включается переменной COOP_SYNC_URL. Без неё всё работает по-старому (локально) —
 * присутствие не лжёт и не падает, просто видит только свою машину.
 */

const SYNC_URL = () => (process.env.COOP_SYNC_URL || '').replace(/\/$/, '');
const MACHINE = () => process.env.COOP_MACHINE || process.env.HOSTNAME || 'local';
const TIMEOUT_MS = 2500;

export function coopEnabled() { return !!SYNC_URL(); }

/** Отправить heartbeat в общее поле. Возвращает {ok} или {ok:false,reason} — никогда не бросает. */
export async function pushPresence({ agent, organ = null, intents = [] } = {}) {
  const url = SYNC_URL();
  if (!url) return { ok: false, reason: 'нет COOP_SYNC_URL' };
  if (!agent) return { ok: false, reason: 'нет agent' };
  try {
    const r = await fetch(`${url}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, organ, machine: MACHINE(), intents }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = await r.json();
    return j.ok ? { ok: true, present: j.present } : { ok: false, reason: j.error };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/** Сообщить полю об уходе. Graceful. */
export async function leavePresence(agent) {
  const url = SYNC_URL();
  if (!url || !agent) return { ok: false };
  try {
    await fetch(`${url}/leave`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: true };
  } catch { return { ok: false }; }
}

/** Забрать присутствие со всех машин. Возвращает массив (пустой при недоступности). */
export async function fetchRemote() {
  const url = SYNC_URL();
  if (!url) return [];
  try {
    const r = await fetch(`${url}/present`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = await r.json();
    return Array.isArray(j.present) ? j.present : [];
  } catch { return []; }
}

/**
 * ЧИСТОЕ слияние: локальные сессии (`.swarm`) + удалённые (relay).
 * - Локальные имеют приоритет для агентов с этой машины (свежий heartbeat, метаданные).
 * - Удалённые с ДРУГИХ машин добавляются с пометкой machine.
 * - Один агент на одной машине не двоится; тот же агент на разных машинах — две записи.
 * Ключ тождества: agent@machine.
 */
export function mergePresence(local = [], remote = [], { machine = 'local' } = {}) {
  const out = new Map();
  // локальные — это «наша машина»
  for (const s of local) {
    const m = s.machine || machine;
    out.set(`${s.agent}@${m}`, {
      agent: s.agent,
      organ: s.metadata?.organ ?? s.organ ?? null,
      machine: m,
      heartbeat: s.heartbeat,
      stale: !!s.stale,
      local: true,
    });
  }
  // удалённые — добавляем те, кого ещё нет под этим (agent@machine)
  for (const r of remote) {
    const m = r.machine || 'remote';
    const key = `${r.agent}@${m}`;
    if (out.has(key)) {                       // та же запись пришла и эхом из relay — обновим свежесть
      const cur = out.get(key);
      if ((r.heartbeat || 0) > (cur.heartbeat || 0)) cur.heartbeat = r.heartbeat;
      continue;
    }
    out.set(key, {
      agent: r.agent, organ: r.organ ?? null, machine: m,
      heartbeat: r.heartbeat, stale: false, local: false,
    });
  }
  return [...out.values()].sort((a, b) => (b.heartbeat || 0) - (a.heartbeat || 0));
}

export const _internals = { MACHINE, SYNC_URL };
