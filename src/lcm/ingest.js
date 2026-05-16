/**
 * lcm/ingest.js — загрузка существующего корпуса в θησαυρός.
 *
 * Источники:
 *   - data/chat-sessions/*.json    → source=chat-session, source_id=session.id
 *   - data/insights.json           → source=insight,      source_id=insight.id
 *   - data/sacred-history-W.json   → source=act,          source_id=act.id (тексты из act-index.json, если есть)
 *   - data/act-index.json          → source=act,          source_id=act.id (если содержит content)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function ingestChatSessions(store, root) {
  const dir = join(root, 'data', 'chat-sessions');
  if (!existsSync(dir)) return { files: 0, inserted: 0 };
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  let inserted = 0;
  const docs = [];
  for (const f of files) {
    const path = join(dir, f);
    let session;
    try { session = JSON.parse(readFileSync(path, 'utf8')); }
    catch { continue; }
    const sid = session.id || f.replace(/\.json$/, '');
    const turns = session.turns || session.messages || [];
    for (const t of turns) {
      const content = extractContent(t);
      if (!content) continue;
      docs.push({
        source: 'chat-session',
        sourceId: sid,
        role: t.role || (t.user ? 'user' : null),
        content,
        ts: t.at || t.ts || session.createdAt || new Date(0).toISOString(),
        meta: { title: session.title, mode: t.mode, dominant: t.dominant },
      });
    }
  }
  if (docs.length) inserted = store.addBatch(docs);
  return { files: files.length, inserted };
}

export function ingestInsights(store, root) {
  const path = join(root, 'data', 'insights.json');
  if (!existsSync(path)) return { inserted: 0 };
  let arr;
  try { arr = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return { inserted: 0 }; }
  if (!Array.isArray(arr)) return { inserted: 0 };
  const docs = arr.map(ins => ({
    source: 'insight',
    sourceId: String(ins.id ?? ins.uuid ?? hashOf(ins.text || ins.content || '')),
    role: ins.kind || ins.type || null,
    content: ins.text || ins.content || '',
    ts: ins.created || ins.ts || ins.at || new Date(0).toISOString(),
    meta: { weight: ins.weight, kind: ins.kind, source: ins.source },
  })).filter(d => d.content);
  return { inserted: store.addBatch(docs) };
}

export function ingestActs(store, root) {
  const path = join(root, 'data', 'act-index.json');
  if (!existsSync(path)) return { inserted: 0 };
  let arr;
  try { arr = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return { inserted: 0 }; }
  if (!Array.isArray(arr)) return { inserted: 0 };
  const docs = arr.map(act => ({
    source: 'act',
    sourceId: String(act.id ?? hashOf(`${act.giverId}-${act.receiverId}-${act.at}`)),
    role: act.type || null,
    content: act.content || '',
    ts: act.at || act.timestamp || new Date(0).toISOString(),
    meta: { giver: act.giverId, receiver: act.receiverId, weight: act.weight, type: act.type },
  })).filter(d => d.content);
  return { inserted: store.addBatch(docs) };
}

function extractContent(turn) {
  if (typeof turn === 'string') return turn;
  if (typeof turn?.content === 'string') return turn.content;
  if (typeof turn?.text === 'string') return turn.text;
  if (typeof turn?.user === 'string') return turn.user;
  if (Array.isArray(turn?.voices)) {
    return turn.voices.map(v => `${v.id || v.name || ''}: ${v.text || ''}`).join('\n').trim();
  }
  if (typeof turn?.content === 'object' && turn.content) {
    return JSON.stringify(turn.content);
  }
  return null;
}

function hashOf(s) {
  // Лёгкий стабильный хеш для случаев без id (FNV-1a 32-bit).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
