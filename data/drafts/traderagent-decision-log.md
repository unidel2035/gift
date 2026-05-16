# Draft Issue для alekseymavai/TRADERAGENT

**Title:**
`Шестой слой памяти: Decision Log с полнотекстовым recall (sqlite3 + FTS5)`

**Labels:** enhancement

---

## Контекст

Память агентов сейчас живёт в `bot/agents/persistence.py` — пять JSON-файлов (weights / feedback / regime_profiles / patterns / metadata) + `feedback_tracker.py` со scorecards. Это даёт **state**, но не нарративную память.

**Что недоступно:**
- «Почему risk_expert проголосовал REJECT по DOGE 23.04 в 14:23?» — `Verdict.reasoning` уходит после агрегации в weights.
- «Найди ситуации, похожие на текущую (drawdown −3% после 2 неудачных safety orders)» — нет full-text recall.
- «Какой урок из апрельских убытков на ZIL?» — есть числа, нет рассказа.

Это типичная для multi-agent систем проблема «забывания»: state восстанавливается из persistence, обоснования теряются. `weight_calibrator` сглаживает это в один скаляр на эксперта — корпус самого эксперта не сохраняется.

## Предложение

Добавить **шестой слой памяти**: `bot/memory/decision_log.py` — обёртка над SQLite FTS5 (стандартная библиотека Python 3.12, без новых зависимостей). Каждое решение / голос / открытие / закрытие пишется как запись с обоснованием в свободном тексте; индекс FTS5 даёт мгновенный recall.

### Минимальное API

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

@dataclass
class Decision:
    ts: str
    source: str        # expert name / 'committee' / 'risk_manager' / executor
    action: str        # 'VOTE' / 'DECISION' / 'OPEN' / 'CLOSE' / 'PAUSE'
    reasoning: str     # свободный текст — главное поле
    pair: str | None = None
    strategy: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    position_id: str | None = None
    outcome: str | None = None

class DecisionLog:
    def record(self, d: Decision) -> int: ...
    def recall(self, query: str, limit: int = 10) -> list[Decision]: ...
    def replay(self, position_id: str) -> list[Decision]: ...
    def update_outcome(self, decision_id: int, outcome: str) -> None: ...
```

### Схема (sqlite3 + FTS5)

```sql
CREATE TABLE decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  pair        TEXT, strategy TEXT,
  source      TEXT NOT NULL,
  action      TEXT NOT NULL,
  reasoning   TEXT NOT NULL,
  payload     TEXT,
  position_id TEXT,
  outcome     TEXT
);

CREATE VIRTUAL TABLE decisions_fts USING fts5(
  reasoning,
  pair UNINDEXED, strategy UNINDEXED, source UNINDEXED, action UNINDEXED,
  content='decisions', content_rowid='id'
);

CREATE TRIGGER decisions_ai AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, reasoning, pair, strategy, source, action)
  VALUES (new.id, new.reasoning, new.pair, new.strategy, new.source, new.action);
END;
```

### Интеграция — минимум хуков

В `committee.py` после `make_decision()`:

```python
self.decision_log.record(Decision(
    ts=datetime.utcnow().isoformat(),
    source='committee',
    action='DECISION',
    reasoning=decision.rationale,
    pair=ctx.pair, strategy=ctx.strategy,
    payload={'verdicts': [v.to_dict() for v in decision.verdicts]},
    position_id=ctx.position_id,
))
```

В `base_expert.py.vote()`:

```python
self.log.record(Decision(
    ts=now_iso(), source=self.name, action='VOTE',
    reasoning=verdict.reasoning,
    pair=ctx.pair, position_id=ctx.position_id,
    payload={'vote': verdict.vote, 'confidence': verdict.confidence},
))
```

В executor'ах при OPEN/CLOSE — аналогично. Подписка на `event_bus` тоже работает: `decision_log` становится новым subscriber и пишет факты автоматически.

## Что это даёт

1. **Forensics**: `log.replay('pos_12345')` — вся цепочка решений по позиции в хронологическом порядке. Закрыли в минус — за минуту видно кто голосовал, кто принял, что писал в reasoning.
2. **Pattern recall**: `log.recall('DCA SOL drawdown safety')` — все исторические случаи похожих ситуаций с обоснованиями. Можно показать эксперту перед следующим решением.
3. **Foundation для consolidator**: ночной cron читает за сутки + closed positions → отдаёт LLM с промптом «найди 3 урока». Сохраняет в `lessons.json` → инжектируется в system prompt экспертов утром.
4. **Pulse / morning digest**: `SELECT source, COUNT(*) WHERE action='VOTE' AND outcome='LOSS' GROUP BY source` за неделю → «contrarian промахнулся 3 раза подряд на trending up».

## Стоимость

- ~150-200 LOC Python, без новых зависимостей (`sqlite3` + `dataclasses` стандартные).
- На корпусе ~50k записей: < 100MB на диске, FTS recall < 50ms.
- Не ломает `persistence.py` — это **дополнительный** слой; weights/scorecards остаются как есть.

## Референс-имплементация

Та же архитектура работает в проекте Gift Ontology (JS, 117 документов корпуса, миллисекундный отклик):

- ядро: https://github.com/unidel2035/gift/blob/main/src/lcm/store.js (~150 LOC)
- bulk-ingest из существующих логов: https://github.com/unidel2035/gift/blob/main/src/lcm/ingest.js
- CLI: https://github.com/unidel2035/gift/blob/main/utils/lcm-cli.mjs

Перенос в Python через `sqlite3` тривиален — схема и triggers идентичны.

## Why — короткое обоснование

Текущий `feedback_tracker` хранит **что** случилось (`accuracy: 0.65`), но не **почему**. Эксперты получают новые веса, но не помнят конкретные ошибки — это аналог адаптации без памяти. Полнотекстовый decision log — это **корпус самого эксперта**: его прошлые мнения, обоснования, исходы. На таком корпусе можно строить ретроспективы без раскопки логов, explainability без аппроксимаций, и нарративные уроки поверх агрегатов.

Готов прислать PR с минимальной имплементацией (~200 LOC + интеграционные хуки) если идея интересна.
