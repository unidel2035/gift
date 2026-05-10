"""
tests/memory/test_decision_log.py — unit-тесты для bot/memory/decision_log.py

Запуск: python -m pytest tests/memory/test_decision_log.py -v
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from bot.memory.decision_log import Decision, DecisionLog


@pytest.fixture
def log(tmp_path: Path) -> DecisionLog:
    return DecisionLog(db_path=tmp_path / "test.db")


def test_record_and_replay(log: DecisionLog) -> None:
    log.record(Decision(source="risk", action="VOTE", reasoning="r1", position_id="p1", ts="2026-01-01T00:00:00Z"))
    log.record(Decision(source="smc",  action="VOTE", reasoning="r2", position_id="p1", ts="2026-01-01T00:01:00Z"))
    log.record(Decision(source="committee", action="DECISION", reasoning="r3", position_id="p1", ts="2026-01-01T00:02:00Z"))

    chain = log.replay("p1")
    assert len(chain) == 3
    assert [d.source for d in chain] == ["risk", "smc", "committee"]
    assert chain[0].id is not None


def test_recall_full_text(log: DecisionLog) -> None:
    log.record(Decision(source="risk", action="VOTE",
                        reasoning="Цена в зоне распределения, ATR низкий — высокая волатильность вероятна",
                        pair="DOGE", position_id="p1"))
    log.record(Decision(source="smc", action="VOTE",
                        reasoning="OB активен, FVG не закрыт",
                        pair="DOGE", position_id="p1"))

    hits = log.recall("волатильность")
    assert len(hits) == 1
    assert hits[0].source == "risk"
    assert "волатильность" in hits[0].reasoning


def test_recall_with_filters(log: DecisionLog) -> None:
    for source in ["risk", "smc", "trend"]:
        log.record(Decision(source=source, action="VOTE",
                            reasoning="общее обоснование с словом ATR",
                            pair="DOGE", position_id="p1"))

    hits_all = log.recall("ATR")
    assert len(hits_all) == 3

    hits_risk = log.recall("ATR", source="risk")
    assert len(hits_risk) == 1
    assert hits_risk[0].source == "risk"


def test_recall_empty_query_returns_empty(log: DecisionLog) -> None:
    log.record(Decision(source="risk", action="VOTE", reasoning="x"))
    assert log.recall("") == []
    assert log.recall("a") == []  # < 2 символов


def test_recall_quotes_dont_break_fts(log: DecisionLog) -> None:
    log.record(Decision(source="risk", action="VOTE",
                        reasoning='цена сказала: "стоп" — отказ на 23.04'))

    # Двойные кавычки в запросе не должны падать FTS
    hits = log.recall('"стоп"')
    assert isinstance(hits, list)


def test_update_outcome(log: DecisionLog) -> None:
    log.record(Decision(source="risk", action="VOTE", reasoning="r1", position_id="p1"))
    log.record(Decision(source="smc", action="VOTE", reasoning="r2", position_id="p1"))

    affected = log.update_outcome_for_position("p1", outcome="LOSS:-1.8%")
    assert affected == 2

    chain = log.replay("p1")
    assert all(d.outcome == "LOSS:-1.8%" for d in chain)


def test_stats(log: DecisionLog) -> None:
    log.record(Decision(source="risk", action="VOTE", reasoning="x", ts="2026-01-01T00:00:00Z"))
    log.record(Decision(source="risk", action="VOTE", reasoning="y", ts="2026-01-02T00:00:00Z"))
    log.record(Decision(source="committee", action="DECISION", reasoning="z", ts="2026-01-03T00:00:00Z"))

    s = log.stats()
    assert s["total"] == 3
    assert s["by_source"] == {"risk": 2, "committee": 1}
    assert s["by_action"] == {"VOTE": 2, "DECISION": 1}
    assert s["first_ts"] == "2026-01-01T00:00:00Z"
    assert s["last_ts"]  == "2026-01-03T00:00:00Z"


def test_payload_roundtrip(log: DecisionLog) -> None:
    log.record(Decision(
        source="risk", action="VOTE", reasoning="r",
        payload={"vote": "REJECT", "confidence": 0.78, "evidence": ["FVG_open", "low_atr"]},
    ))
    by_src = log.by_source("risk")
    assert by_src[0].payload["vote"] == "REJECT"
    assert by_src[0].payload["confidence"] == 0.78
    assert by_src[0].payload["evidence"] == ["FVG_open", "low_atr"]


def test_validation(log: DecisionLog) -> None:
    with pytest.raises(ValueError):
        log.record(Decision(source="", action="VOTE", reasoning="r"))
    with pytest.raises(ValueError):
        log.record(Decision(source="r", action="", reasoning="r"))
    with pytest.raises(ValueError):
        log.record(Decision(source="r", action="V", reasoning=""))


def test_context_manager(tmp_path: Path) -> None:
    with DecisionLog(db_path=tmp_path / "ctx.db") as log:
        log.record(Decision(source="r", action="V", reasoning="x"))
        assert log.stats()["total"] == 1
    # log.close() вызвался — подключение закрыто, повторный record должен упасть
    with pytest.raises(Exception):
        log.record(Decision(source="r", action="V", reasoning="y"))


def test_persistence_across_open(tmp_path: Path) -> None:
    db = tmp_path / "persist.db"
    log1 = DecisionLog(db_path=db)
    log1.record(Decision(source="r", action="V", reasoning="первая запись"))
    log1.close()

    log2 = DecisionLog(db_path=db)
    assert log2.stats()["total"] == 1
    hits = log2.recall("первая")
    assert len(hits) == 1
    log2.close()
