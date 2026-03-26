/**
 * SQLiteVectorStore — локальное векторное хранилище на better-sqlite3
 *
 * Векторы хранятся как BLOB (Float32Array). Косинусный поиск — в чистом JS.
 * Никаких внешних вызовов, никакой утечки данных.
 *
 * Схема:
 *   vectors(id TEXT PK, embedding BLOB, cat TEXT, path TEXT, preview TEXT, updated_at INT)
 *
 * «За краем»: поиск усиливается весами матрицы W — спецификации, связанные
 * с активными лицами, получают буст.
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DB = resolve(ROOT, 'data', 'spec-vectors.db');

class SQLiteVectorStore {
  constructor(dbPath = DEFAULT_DB) {
    this._dbPath = dbPath;
    this._db = null;
  }

  _open() {
    if (this._db) return this._db;
    mkdirSync(resolve(ROOT, 'data'), { recursive: true });
    this._db = new Database(this._dbPath);
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id         TEXT PRIMARY KEY,
        embedding  BLOB NOT NULL,
        cat        TEXT,
        path       TEXT,
        preview    TEXT,
        updated_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_cat ON vectors(cat);
    `);
    return this._db;
  }

  // ── Хранить или обновить вектор ──────────────────────────────────────────
  store(id, embedding, metadata = {}) {
    const db   = this._open();
    const blob = Buffer.from(new Float32Array(embedding).buffer);
    db.prepare(`
      INSERT INTO vectors (id, embedding, cat, path, preview, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        embedding  = excluded.embedding,
        cat        = excluded.cat,
        path       = excluded.path,
        preview    = excluded.preview,
        updated_at = unixepoch()
    `).run(id, blob, metadata.cat ?? null, metadata.path ?? null, metadata.preview ?? null);
  }

  // ── Косинусный поиск в памяти ────────────────────────────────────────────
  // topK — сколько вернуть; wBoost — карта {cat: multiplier} из матрицы W
  search(queryEmbedding, topK = 5, wBoost = {}) {
    const db   = this._open();
    const rows = db.prepare('SELECT id, embedding, cat, path, preview FROM vectors').all();
    if (!rows.length) return [];

    const qArr = new Float32Array(queryEmbedding);

    const scored = rows.map(row => {
      const vArr = new Float32Array(row.embedding.buffer,
                                    row.embedding.byteOffset,
                                    row.embedding.byteLength / 4);
      const sim   = cosine(qArr, vArr);
      const boost = wBoost[row.cat] ?? wBoost['*'] ?? 1.0;
      return { id: row.id, cat: row.cat, path: row.path, preview: row.preview,
               similarity: sim, score: sim * boost };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  delete(id) {
    this._open().prepare('DELETE FROM vectors WHERE id = ?').run(id);
  }

  count() {
    return this._open().prepare('SELECT COUNT(*) as n FROM vectors').get().n;
  }

  isAvailable() {
    try { this._open(); return true; } catch { return false; }
  }

  close() {
    if (this._db) { this._db.close(); this._db = null; }
  }
}

// ── Косинусное расстояние (Float32Array) ─────────────────────────────────
function cosine(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d < 1e-10 ? 0 : dot / d;
}

// ── Синглтон ─────────────────────────────────────────────────────────────
let _instance = null;
export function getSQLiteVectorStore(dbPath) {
  if (!_instance) _instance = new SQLiteVectorStore(dbPath);
  return _instance;
}
export default SQLiteVectorStore;
