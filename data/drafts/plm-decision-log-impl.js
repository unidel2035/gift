/**
 * src/memory/decision_log.js — Decision Log как операционный слой
 * Product Memory Graph для PLM-GIFT.
 *
 * Хранит каждый акт дара / голос агента / ECR/ECO как запись с обоснованием.
 * SQLite + FTS5 (через better-sqlite3); не дублирует онтологию `@unidel/gift`,
 * а воплощает её в runtime-слой.
 *
 * Семантический mapping:
 *   ECR (Engineering Change Request) → акт типа 'question' (рана)
 *   Голос агента (Design/Process/Quality/...)    → акт типа 'word' (с reasoning)
 *   ECO (Engineering Change Order) → акт типа 'decision' (Orchestrator)
 *   Закрытие изменения              → акт типа 'healing' (рана исцелена)
 *
 * Использование:
 *   import { DecisionLog } from './memory/decision_log.js';
 *   import { GiftAct } from '@unidel/gift';
 *
 *   const log = new DecisionLog();
 *
 *   // Инженер создаёт ECR
 *   await log.recordGiftAct(
 *     GiftAct.perichoresis()
 *       .kenosis('engineer-001', 'part-KSH-047', 'Нагрузка на излом превышает запас', 7)
 *       .withType('question'),
 *     { linkedPart: 'part-KSH-047', linkedEcr: 'ECR-2026-042' }
 *   );
 *
 *   // Голос Design-агента
 *   await log.recordGiftAct(
 *     GiftAct.kenosis('agent_design', 'ECR-2026-042',
 *       'Предлагаю замену на сплав AlMg6 — выдержит на 23% больше', 8),
 *     { linkedEcr: 'ECR-2026-042' }
 *   );
 *
 *   // Найти прошлые ECR с похожей проблемой
 *   const similar = log.recall('нагрузка излом запас', { type: 'question', limit: 5 });
 *
 *   // Полная траектория детали (логос → тропос → анамнезис)
 *   const journey = log.replayPart('part-KSH-047');
 *
 * Референс-имплементация (gift-онтология ядро):
 * https://github.com/unidel2035/gift/blob/main/src/lcm/store.js
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS acts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL,
  giver_id     TEXT    NOT NULL,
  receiver_id  TEXT    NOT NULL,
  type         TEXT    NOT NULL,
  weight       REAL    NOT NULL,
  reasoning    TEXT    NOT NULL,
  linked_part  TEXT,
  linked_ecr   TEXT,
  payload      TEXT,
  outcome      TEXT
);

CREATE INDEX IF NOT EXISTS ix_acts_giver        ON acts(giver_id);
CREATE INDEX IF NOT EXISTS ix_acts_receiver     ON acts(receiver_id);
CREATE INDEX IF NOT EXISTS ix_acts_type         ON acts(type);
CREATE INDEX IF NOT EXISTS ix_acts_linked_part  ON acts(linked_part);
CREATE INDEX IF NOT EXISTS ix_acts_linked_ecr   ON acts(linked_ecr);
CREATE INDEX IF NOT EXISTS ix_acts_ts           ON acts(ts);

CREATE VIRTUAL TABLE IF NOT EXISTS acts_fts USING fts5(
  reasoning,
  giver_id     UNINDEXED,
  receiver_id  UNINDEXED,
  type         UNINDEXED,
  linked_part  UNINDEXED,
  linked_ecr   UNINDEXED,
  content='acts',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS acts_ai AFTER INSERT ON acts BEGIN
  INSERT INTO acts_fts(rowid, reasoning, giver_id, receiver_id, type, linked_part, linked_ecr)
  VALUES (new.id, new.reasoning, new.giver_id, new.receiver_id, new.type,
          new.linked_part, new.linked_ecr);
END;

CREATE TRIGGER IF NOT EXISTS acts_ad AFTER DELETE ON acts BEGIN
  INSERT INTO acts_fts(acts_fts, rowid, reasoning) VALUES('delete', old.id, old.reasoning);
END;
`;

export class DecisionLog {
  /**
   * @param {string} dbPath - путь к SQLite-файлу.
   *                          По умолчанию data/memory/decision_log.db
   */
  constructor(dbPath = 'data/memory/decision_log.db') {
    if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);

    this._insert = this.db.prepare(`
      INSERT INTO acts (ts, giver_id, receiver_id, type, weight, reasoning,
                        linked_part, linked_ecr, payload, outcome)
      VALUES (@ts, @giver_id, @receiver_id, @type, @weight, @reasoning,
              @linked_part, @linked_ecr, @payload, @outcome)
    `);
    this._updateOutcome = this.db.prepare(`UPDATE acts SET outcome = ? WHERE id = ?`);
    this._updateOutcomeByEcr = this.db.prepare(
      `UPDATE acts SET outcome = ? WHERE linked_ecr = ? AND outcome IS NULL`
    );
  }

  /**
   * Записать GiftAct (из @unidel/gift) с PLM-привязкой.
   * @param {GiftAct} act - объект из @unidel/gift
   * @param {{linkedPart?: string, linkedEcr?: string, outcome?: string}} ctx
   */
  recordGiftAct(act, ctx = {}) {
    if (!act?.giverId || !act?.receiverId) {
      throw new Error('recordGiftAct: act.giverId/receiverId обязательны');
    }
    return this._record({
      ts:          act.ts || new Date().toISOString(),
      giver_id:    act.giverId,
      receiver_id: act.receiverId,
      type:        act.type || 'word',
      weight:      Number(act.weight ?? 5),
      reasoning:   String(act.content || act.reasoning || ''),
      linked_part: ctx.linkedPart || act.linkedPart || null,
      linked_ecr:  ctx.linkedEcr  || act.linkedEcr  || null,
      payload:     act.payload ? JSON.stringify(act.payload) : null,
      outcome:     ctx.outcome || null,
    });
  }

  /**
   * Записать сырую запись (без GiftAct-обёртки).
   */
  record({ giverId, receiverId, type = 'word', weight = 5, reasoning,
           linkedPart = null, linkedEcr = null, payload = null,
           outcome = null, ts = null }) {
    if (!giverId || !receiverId || !reasoning) {
      throw new Error('record: giverId/receiverId/reasoning обязательны');
    }
    return this._record({
      ts: ts || new Date().toISOString(),
      giver_id: giverId, receiver_id: receiverId, type, weight: Number(weight),
      reasoning, linked_part: linkedPart, linked_ecr: linkedEcr,
      payload: payload ? JSON.stringify(payload) : null,
      outcome,
    });
  }

  _record(row) {
    const info = this._insert.run(row);
    return Number(info.lastInsertRowid);
  }

  /**
   * Полнотекстовый поиск + фасеты.
   * @returns {Array<{id, ts, giver_id, receiver_id, type, weight, reasoning,
   *                  linked_part, linked_ecr, payload, outcome, snippet, rank}>}
   */
  recall(query, { limit = 10, type = null, partId = null, ecrId = null } = {}) {
    if (!query || query.trim().length < 2) return [];
    const ftsQuery = '"' + String(query).replace(/"/g, '""').trim() + '"';
    const params = [ftsQuery];
    let sql = `
      SELECT a.*, bm25(acts_fts) AS rank,
             snippet(acts_fts, 0, '«', '»', '…', 16) AS snippet
      FROM acts_fts
      JOIN acts a ON a.id = acts_fts.rowid
      WHERE acts_fts MATCH ?
    `;
    if (type)   { sql += ` AND a.type = ?`;        params.push(type); }
    if (partId) { sql += ` AND a.linked_part = ?`; params.push(partId); }
    if (ecrId)  { sql += ` AND a.linked_ecr = ?`;  params.push(ecrId); }
    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);
    return this.db.prepare(sql).all(...params).map(this._parseRow);
  }

  /**
   * Все акты, связанные с конкретной деталью, в хронологическом порядке.
   * Это операционный читатель Product Memory Graph.
   */
  replayPart(partId, { limit = 500 } = {}) {
    if (!partId) return [];
    return this.db.prepare(
      `SELECT * FROM acts WHERE linked_part = ? ORDER BY ts ASC, id ASC LIMIT ?`
    ).all(partId, limit).map(this._parseRow);
  }

  /**
   * Все акты вокруг одного ECR (вопрошание + ответы агентов + ECO + closure).
   */
  replayEcr(ecrId, { limit = 100 } = {}) {
    if (!ecrId) return [];
    return this.db.prepare(
      `SELECT * FROM acts WHERE linked_ecr = ? ORDER BY ts ASC, id ASC LIMIT ?`
    ).all(ecrId, limit).map(this._parseRow);
  }

  updateOutcome(actId, outcome) {
    return this._updateOutcome.run(outcome, actId).changes > 0;
  }

  closeEcr(ecrId, outcome = 'healed') {
    return this._updateOutcomeByEcr.run(outcome, ecrId).changes;
  }

  stats() {
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM acts`).get().n;
    const byType = Object.fromEntries(
      this.db.prepare(`SELECT type, COUNT(*) AS n FROM acts GROUP BY type`).all()
        .map(r => [r.type, r.n])
    );
    const byGiver = Object.fromEntries(
      this.db.prepare(
        `SELECT giver_id, COUNT(*) AS n FROM acts GROUP BY giver_id ORDER BY 2 DESC LIMIT 10`
      ).all().map(r => [r.giver_id, r.n])
    );
    const dateRange = this.db.prepare(
      `SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM acts`
    ).get();
    return { total, byType, topGivers: byGiver, ...dateRange };
  }

  close() { this.db.close(); }

  _parseRow(r) {
    return {
      ...r,
      payload: r.payload ? JSON.parse(r.payload) : null,
    };
  }
}

export function defaultDbPath(root = process.cwd()) {
  return `${root}/data/memory/decision_log.db`;
}
