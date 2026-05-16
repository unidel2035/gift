/**
 * lcm/store.js — θησαυρός: полнотекстовый сосуд анамнезиса.
 *
 * SQLite FTS5 поверх корпуса сессий и актов. Не заменяет W (веса)
 * и soul (смысл) — добавляет полнотекстовый канал. Хозяин выносит
 * из сокровищницы новое и старое (Мф 13:52).
 *
 * Схема:
 *   documents      — обычная таблица: source/source_id/role/content/ts/meta
 *   documents_fts  — виртуальная FTS5, contentless (rowid=id)
 *
 * Источники (source):
 *   chat-session   — turn из data/chat-sessions/*.json
 *   insight        — запись из data/insights.json
 *   act            — текст акта из W
 *   manual         — ручная запись через CLI
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source    TEXT NOT NULL,
  source_id TEXT NOT NULL,
  role      TEXT,
  content   TEXT NOT NULL,
  ts        TEXT NOT NULL,
  meta      TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_source     ON documents(source);
CREATE INDEX IF NOT EXISTS idx_documents_source_id  ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_ts         ON documents(ts);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  content,
  source    UNINDEXED,
  source_id UNINDEXED,
  role      UNINDEXED,
  ts        UNINDEXED,
  content_rowid = 'id',
  content       = 'documents'
);

CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, content, source, source_id, role, ts)
  VALUES (new.id, new.content, new.source, new.source_id, new.role, new.ts);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
`;

export class LcmStore {
  constructor(dbPath) {
    if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);

    this._insert = this.db.prepare(
      `INSERT INTO documents(source, source_id, role, content, ts, meta)
       VALUES (@source, @source_id, @role, @content, @ts, @meta)`
    );
    this._exists = this.db.prepare(
      `SELECT 1 FROM documents WHERE source=? AND source_id=? AND ts=? AND content=? LIMIT 1`
    );
    this._expand = this.db.prepare(
      `SELECT source, source_id, role, content, ts, meta
       FROM documents WHERE source_id = ? ORDER BY ts ASC, id ASC LIMIT ?`
    );
    this._stats = this.db.prepare(
      `SELECT source, COUNT(*) AS n FROM documents GROUP BY source`
    );
  }

  // Идемпотентная вставка (одна и та же source_id+ts+content не дублируется).
  addDocument({ source, sourceId, role = null, content, ts, meta = null }) {
    if (!source || !sourceId || !content || !ts) {
      throw new Error('addDocument: source/sourceId/content/ts обязательны');
    }
    const dup = this._exists.get(source, sourceId, ts, content);
    if (dup) return { inserted: false };
    const info = this._insert.run({
      source, source_id: sourceId, role, content, ts,
      meta: meta ? JSON.stringify(meta) : null,
    });
    return { inserted: true, id: info.lastInsertRowid };
  }

  addBatch(docs) {
    const tx = this.db.transaction(items => {
      let n = 0;
      for (const d of items) {
        if (this.addDocument(d).inserted) n += 1;
      }
      return n;
    });
    return tx(docs);
  }

  // grep: top-N по FTS-ранку. Запрос — обычная фраза, экранируем кавычки.
  grep(query, { limit = 10, source = null } = {}) {
    if (!query || query.trim().length < 2) return [];
    const ftsQuery = sanitizeFts(query);
    const params = [ftsQuery];
    let sql = `
      SELECT
        d.id, d.source, d.source_id, d.role, d.ts,
        snippet(documents_fts, 0, '«', '»', '…', 12) AS snippet,
        bm25(documents_fts) AS rank
      FROM documents_fts
      JOIN documents d ON d.id = documents_fts.rowid
      WHERE documents_fts MATCH ?
    `;
    if (source) {
      sql += ` AND d.source = ?`;
      params.push(source);
    }
    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  // expand: все documents одного source_id в хронологическом порядке.
  expand(sourceId, { limit = 500 } = {}) {
    if (!sourceId) return [];
    return this._expand.all(sourceId, limit).map(r => ({
      ...r,
      meta: r.meta ? safeParse(r.meta) : null,
    }));
  }

  stats() {
    const rows = this._stats.all();
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM documents').get().n;
    return { total, bySource: Object.fromEntries(rows.map(r => [r.source, r.n])) };
  }

  close() { this.db.close(); }
}

// FTS5: одинарная двойная кавычка экранируется как "". Превращаем запрос в
// одну фразу: "...". Это безопасный режим — нет операторов FTS, но поиск ищет
// последовательность токенов, не отдельные слова. Для расширенного поиска
// нужен явный режим с операторами; v1 — минимум.
function sanitizeFts(q) {
  return '"' + String(q).replace(/"/g, '""').trim() + '"';
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export function defaultDbPath(root = process.cwd()) {
  return `${root}/data/lcm.db`;
}
