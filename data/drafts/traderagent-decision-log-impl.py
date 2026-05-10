"""
bot/memory/decision_log.py — Decision Log с полнотекстовым recall (sqlite3 + FTS5).

Шестой слой памяти TRADERAGENT поверх существующего persistence/feedback_tracker.
Хранит каждое решение / голос / открытие / закрытие как запись с обоснованием
в свободном тексте; FTS5 даёт мгновенный recall похожих ситуаций.

Зависимости: только Python stdlib (sqlite3 + dataclasses).

Использование:

    from bot.memory.decision_log import DecisionLog, Decision

    log = DecisionLog()  # data/agent_state/decision_log.db по умолчанию

    log.record(Decision(
        ts="2026-04-23T14:23:00Z",
        source="risk_expert",
        action="VOTE",
        reasoning="Цена в зоне распределения H1 (FVG не закрыт), ATR/range=0.4 — низкая волатильность.",
        pair="DOGE",
        position_id="pos_12345",
        payload={"vote": "REJECT", "confidence": 0.78},
    ))

    # Найти похожие случаи перед новым решением
    similar = log.recall("DCA SOL drawdown safety", limit=5)

    # Reconstruct полную цепочку решений по позиции
    chain = log.replay("pos_12345")

    # Дозаполнить outcome когда позиция закрыта
    log.update_outcome_for_position("pos_12345", outcome="LOSS:-1.8%")

Референс-имплементация (JS, gift-онтология):
https://github.com/unidel2035/gift/blob/main/src/lcm/store.js
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

__all__ = ["Decision", "DecisionLog"]


_SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT    NOT NULL,
    pair         TEXT,
    strategy     TEXT,
    source       TEXT    NOT NULL,
    action       TEXT    NOT NULL,
    reasoning    TEXT    NOT NULL,
    payload      TEXT,
    position_id  TEXT,
    outcome      TEXT
);

CREATE INDEX IF NOT EXISTS ix_decisions_pair        ON decisions(pair);
CREATE INDEX IF NOT EXISTS ix_decisions_position    ON decisions(position_id);
CREATE INDEX IF NOT EXISTS ix_decisions_ts          ON decisions(ts);
CREATE INDEX IF NOT EXISTS ix_decisions_source      ON decisions(source);

CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
    reasoning,
    pair        UNINDEXED,
    strategy    UNINDEXED,
    source      UNINDEXED,
    action      UNINDEXED,
    position_id UNINDEXED,
    content='decisions',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
    INSERT INTO decisions_fts(rowid, reasoning, pair, strategy, source, action, position_id)
    VALUES (new.id, new.reasoning, new.pair, new.strategy, new.source, new.action, new.position_id);
END;

CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
    INSERT INTO decisions_fts(decisions_fts, rowid, reasoning) VALUES('delete', old.id, old.reasoning);
END;
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fts_safe(query: str) -> str:
    """FTS5 syntax: одинарная двойная кавычка экранируется как "".
    Обернём всю фразу — поиск ищет последовательность токенов, не операторы FTS.
    Это безопасный режим: пользователь не может случайно сломать запрос."""
    cleaned = (query or "").replace('"', '""').strip()
    return f'"{cleaned}"' if cleaned else ""


@dataclass
class Decision:
    """Один акт принятия решения / голос / открытие / закрытие.

    Главное поле — `reasoning` (свободный текст). На нём построен FTS-индекс.
    Остальные поля — фасетные (для фильтрации).
    """

    source: str                 # 'committee' / 'risk_expert' / executor name / ...
    action: str                 # 'VOTE' / 'DECISION' / 'OPEN' / 'CLOSE' / 'PAUSE'
    reasoning: str              # обоснование в свободном тексте — главное
    ts: str = field(default_factory=_now_iso)
    pair: str | None = None
    strategy: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    position_id: str | None = None
    outcome: str | None = None
    id: int | None = None       # заполняется при insert


class DecisionLog:
    """Полнотекстовый decision log поверх SQLite + FTS5."""

    def __init__(self, db_path: str | Path = "data/agent_state/decision_log.db") -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.execute("PRAGMA journal_mode = WAL")

    # ── write ─────────────────────────────────────────────────────────

    def record(self, d: Decision) -> int:
        """Insert. Возвращает id вставленной записи. Обновляет d.id."""
        if not d.source or not d.action or not d.reasoning:
            raise ValueError("Decision: source/action/reasoning обязательны")
        cur = self._conn.execute(
            """
            INSERT INTO decisions
              (ts, pair, strategy, source, action, reasoning, payload, position_id, outcome)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                d.ts,
                d.pair,
                d.strategy,
                d.source,
                d.action,
                d.reasoning,
                json.dumps(d.payload, ensure_ascii=False) if d.payload else None,
                d.position_id,
                d.outcome,
            ),
        )
        self._conn.commit()
        d.id = int(cur.lastrowid)
        return d.id

    def record_batch(self, decisions: Iterable[Decision]) -> int:
        """Batch insert в одной транзакции. Возвращает количество записей."""
        n = 0
        with self._conn:
            for d in decisions:
                self.record(d)
                n += 1
        return n

    def update_outcome(self, decision_id: int, outcome: str) -> bool:
        """Обновить outcome у конкретной записи."""
        cur = self._conn.execute(
            "UPDATE decisions SET outcome = ? WHERE id = ?",
            (outcome, decision_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def update_outcome_for_position(self, position_id: str, outcome: str) -> int:
        """Дозаполнить outcome для всех записей одной позиции (когда она закрыта)."""
        cur = self._conn.execute(
            "UPDATE decisions SET outcome = ? WHERE position_id = ? AND outcome IS NULL",
            (outcome, position_id),
        )
        self._conn.commit()
        return cur.rowcount

    # ── read ──────────────────────────────────────────────────────────

    def recall(
        self,
        query: str,
        *,
        limit: int = 10,
        source: str | None = None,
        action: str | None = None,
        pair: str | None = None,
    ) -> list[Decision]:
        """Полнотекстовый поиск по reasoning. Возвращает топ-N с фасетными фильтрами."""
        if not query or len(query.strip()) < 2:
            return []
        params: list[Any] = [_fts_safe(query)]
        sql = """
            SELECT d.*, bm25(decisions_fts) AS rank,
                   snippet(decisions_fts, 0, '«', '»', '…', 16) AS snippet
            FROM decisions_fts
            JOIN decisions d ON d.id = decisions_fts.rowid
            WHERE decisions_fts MATCH ?
        """
        if source:
            sql += " AND d.source = ?"
            params.append(source)
        if action:
            sql += " AND d.action = ?"
            params.append(action)
        if pair:
            sql += " AND d.pair = ?"
            params.append(pair)
        sql += " ORDER BY rank LIMIT ?"
        params.append(limit)
        rows = self._conn.execute(sql, params).fetchall()
        return [self._row_to_decision(r) for r in rows]

    def replay(self, position_id: str, *, limit: int = 200) -> list[Decision]:
        """Все записи по одной позиции в хронологическом порядке."""
        if not position_id:
            return []
        rows = self._conn.execute(
            "SELECT * FROM decisions WHERE position_id = ? ORDER BY ts ASC, id ASC LIMIT ?",
            (position_id, limit),
        ).fetchall()
        return [self._row_to_decision(r) for r in rows]

    def by_source(
        self, source: str, *, since: str | None = None, limit: int = 100
    ) -> list[Decision]:
        """Все записи одного эксперта, опционально с фильтром по времени."""
        params: list[Any] = [source]
        sql = "SELECT * FROM decisions WHERE source = ?"
        if since:
            sql += " AND ts >= ?"
            params.append(since)
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(limit)
        rows = self._conn.execute(sql, params).fetchall()
        return [self._row_to_decision(r) for r in rows]

    def stats(self) -> dict[str, Any]:
        """Сводка: всего / по source / по action / диапазон дат."""
        total = self._conn.execute("SELECT COUNT(*) AS n FROM decisions").fetchone()["n"]
        by_source = {
            r["source"]: r["n"]
            for r in self._conn.execute(
                "SELECT source, COUNT(*) AS n FROM decisions GROUP BY source"
            )
        }
        by_action = {
            r["action"]: r["n"]
            for r in self._conn.execute(
                "SELECT action, COUNT(*) AS n FROM decisions GROUP BY action"
            )
        }
        date_range = self._conn.execute(
            "SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM decisions"
        ).fetchone()
        return {
            "total": total,
            "by_source": by_source,
            "by_action": by_action,
            "first_ts": date_range["first_ts"],
            "last_ts": date_range["last_ts"],
        }

    # ── lifecycle ─────────────────────────────────────────────────────

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "DecisionLog":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ── helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _row_to_decision(r: sqlite3.Row) -> Decision:
        payload_str = r["payload"]
        d = Decision(
            id=int(r["id"]),
            ts=r["ts"],
            pair=r["pair"],
            strategy=r["strategy"],
            source=r["source"],
            action=r["action"],
            reasoning=r["reasoning"],
            payload=json.loads(payload_str) if payload_str else {},
            position_id=r["position_id"],
            outcome=r["outcome"],
        )
        # snippet/rank доступны только при recall — кладём в payload как side-channel
        if "snippet" in r.keys():
            d.payload = {**d.payload, "_snippet": r["snippet"], "_rank": r["rank"]}
        return d


# ──────────────────────────────────────────────────────────────────────
# Минимальный smoke-test (запустить как модуль: python -m bot.memory.decision_log)
# Полные unit-тесты — в tests/memory/test_decision_log.py (отдельно).
# ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":  # pragma: no cover
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "test.db"
        log = DecisionLog(db_path=db)

        log.record(Decision(
            source="risk_expert",
            action="VOTE",
            reasoning="Цена в зоне распределения H1, ATR/range=0.4 — низкая волатильность.",
            pair="DOGE",
            position_id="pos_001",
            payload={"vote": "REJECT", "confidence": 0.78},
        ))
        log.record(Decision(
            source="smc_expert",
            action="VOTE",
            reasoning="OB в зоне H1 закрыт, FVG активен. Сетап на лонг valid.",
            pair="DOGE",
            position_id="pos_001",
            payload={"vote": "APPROVE", "confidence": 0.65},
        ))
        log.record(Decision(
            source="committee",
            action="DECISION",
            reasoning="Большинство против. REJECT.",
            pair="DOGE",
            position_id="pos_001",
        ))

        print("stats:", json.dumps(log.stats(), indent=2, ensure_ascii=False))
        print("\nrecall 'волатильность':")
        for d in log.recall("волатильность"):
            print(f"  [{d.source}] {d.payload.get('_snippet', '')}")

        print("\nreplay pos_001:")
        for d in log.replay("pos_001"):
            print(f"  {d.ts} [{d.source}] {d.action}: {d.reasoning[:60]}")
