/**
 * backend/monolith/src/services/decisionLog.js — Decision Log для VentureOS / fund.
 *
 * Хранит каждый дебат-turn / голос / решение комитета / закрытие сделки
 * как запись с обоснованием в свободном тексте; FTS5 даёт мгновенный recall
 * похожих случаев из истории фонда.
 *
 * Использование:
 *   import { DecisionLog } from './services/decisionLog.js';
 *   const log = new DecisionLog();
 *
 *   // Каждый ответ агента в дебате
 *   log.record({
 *     dealId: 'deal-2026-042',
 *     source: 'agent_bull',  // 'bull' | 'bear' | 'analyst' | 'lawyer' | 'committee'
 *     action: 'DEBATE_TURN',
 *     reasoning: 'Стартап растёт 18% MoM, рынок $4B, основатель делал exit',
 *     payload: { tokens: { input: 450, output: 312 }, model: 'claude-sonnet-4-6' },
 *   });
 *
 *   // Финальное решение комитета
 *   log.record({
 *     dealId: 'deal-2026-042',
 *     source: 'committee',
 *     action: 'DECISION',
 *     reasoning: '4 за, 1 против. Инвестиция $500k @ $5M valuation.',
 *     payload: { votes: {bull:'A', bear:'R', analyst:'A', lawyer:'A'}, amount_usd: 500000 },
 *   });
 *
 *   // Найти прошлые дебаты по похожему профилю
 *   const similar = log.recall('B2B SaaS Series A consumer');
 *
 *   // Полная цепочка по сделке
 *   const chain = log.replay('deal-2026-042');
 *
 *   // Когда сделка закрыта (exit / write-off / follow-on)
 *   log.updateOutcome('deal-2026-042', '+5x return after 3.2y');
 *
 * Референс: https://github.com/unidel2035/gift/blob/main/src/lcm/store.js
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  deal_id     TEXT,
  source      TEXT NOT NULL,
  action      TEXT NOT NULL,
  reasoning   TEXT NOT NULL,
  payload     TEXT,
  outcome     TEXT
);

CREATE INDEX IF NOT EXISTS ix_decisions_deal     ON decisions(deal_id);
CREATE INDEX IF NOT EXISTS ix_decisions_source   ON decisions(source);
CREATE INDEX IF NOT EXISTS ix_decisions_action   ON decisions(action);
CREATE INDEX IF NOT EXISTS ix_decisions_ts       ON decisions(ts);

CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
  reasoning,
  source UNINDEXED, action UNINDEXED, deal_id UNINDEXED,
  content='decisions', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, reasoning, source, action, deal_id)
  VALUES (new.id, new.reasoning, new.source, new.action, new.deal_id);
END;

CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, reasoning) VALUES('delete', old.id, old.reasoning);
END;
`;

export class DecisionLog {
  constructor(dbPath = 'data/decision_log.db') {
    if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this._insert = this.db.prepare(`
      INSERT INTO decisions (ts, deal_id, source, action, reasoning, payload, outcome)
      VALUES (@ts, @deal_id, @source, @action, @reasoning, @payload, @outcome)
    `);
  }

  /**
   * Записать одно решение / дебат-turn / голос.
   */
  record({ dealId = null, source, action, reasoning,
           payload = null, outcome = null, ts = null }) {
    if (!source || !action || !reasoning) {
      throw new Error('record: source/action/reasoning обязательны');
    }
    const info = this._insert.run({
      ts: ts || new Date().toISOString(),
      deal_id: dealId,
      source, action, reasoning,
      payload: payload ? JSON.stringify(payload) : null,
      outcome,
    });
    return Number(info.lastInsertRowid);
  }

  /**
   * Полнотекстовый поиск с опциональными фильтрами.
   */
  recall(query, { limit = 10, source = null, action = null, dealId = null } = {}) {
    if (!query || query.trim().length < 2) return [];
    const ftsQuery = '"' + String(query).replace(/"/g, '""').trim() + '"';
    const params = [ftsQuery];
    let sql = `
      SELECT d.*, bm25(decisions_fts) AS rank,
             snippet(decisions_fts, 0, '«', '»', '…', 16) AS snippet
      FROM decisions_fts
      JOIN decisions d ON d.id = decisions_fts.rowid
      WHERE decisions_fts MATCH ?
    `;
    if (source) { sql += ' AND d.source = ?';   params.push(source); }
    if (action) { sql += ' AND d.action = ?';   params.push(action); }
    if (dealId) { sql += ' AND d.deal_id = ?';  params.push(dealId); }
    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);
    return this.db.prepare(sql).all(...params).map(this._parse);
  }

  /**
   * Все решения по одной сделке в хронологическом порядке.
   */
  replay(dealId, { limit = 200 } = {}) {
    if (!dealId) return [];
    return this.db.prepare(
      `SELECT * FROM decisions WHERE deal_id = ? ORDER BY ts ASC, id ASC LIMIT ?`
    ).all(dealId, limit).map(this._parse);
  }

  /**
   * Дозаполнить outcome для всех записей одной сделки (когда она закрыта).
   */
  updateOutcome(dealId, outcome) {
    return this.db.prepare(
      `UPDATE decisions SET outcome = ? WHERE deal_id = ? AND outcome IS NULL`
    ).run(outcome, dealId).changes;
  }

  /**
   * Метрика для отчёта LP: точность одного агента за период.
   */
  agentAccuracy(source, { since = null } = {}) {
    let sql = `
      SELECT outcome, COUNT(*) AS n
      FROM decisions
      WHERE source = ? AND outcome IS NOT NULL AND action = 'VOTE'
    `;
    const params = [source];
    if (since) { sql += ' AND ts >= ?'; params.push(since); }
    sql += ' GROUP BY outcome';
    const rows = this.db.prepare(sql).all(...params);
    const total = rows.reduce((s, r) => s + r.n, 0);
    const wins = rows
      .filter(r => /^\+|return|profit|exit/i.test(r.outcome || ''))
      .reduce((s, r) => s + r.n, 0);
    return { source, total, wins, accuracy: total ? wins / total : null };
  }

  stats() {
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM decisions`).get().n;
    const bySource = Object.fromEntries(
      this.db.prepare(`SELECT source, COUNT(*) AS n FROM decisions GROUP BY source`).all()
        .map(r => [r.source, r.n])
    );
    const byAction = Object.fromEntries(
      this.db.prepare(`SELECT action, COUNT(*) AS n FROM decisions GROUP BY action`).all()
        .map(r => [r.action, r.n])
    );
    return { total, bySource, byAction };
  }

  close() { this.db.close(); }

  _parse(r) {
    return { ...r, payload: r.payload ? JSON.parse(r.payload) : null };
  }
}
