## Контекст

`FstCommittee.vue` сейчас даёт UI для дебатов специализированных агентов (бык / медведь / аналитик / юрист) — это AI-инвесткомитет, прямой аналог investment committee живого фонда. Решения голосуются и попадают в Integram (SQLite). 

**Чего недостаёт:** сами **обоснования** агентов (тексты дебата, аргументы, приведённые рынки/прецеденты) не остаются как первичный ресурс. После принятия решения остаётся итоговый verdict + payload, но не история **почему**:

- «Почему бык-агент в марте 2026 проголосовал за SaaS-стартап с 18% MoM growth?» — ответа нет, есть только VOTE: APPROVE.
- «Найди прошлые сделки, где медведь-агент был против, а исход оказался положительным» — нельзя сделать без ручного просмотра логов.
- «Какие рыночные паттерны мы видели в Series A B2B SaaS за последний год?» — обобщение возможно только агрегатами Ontology Engine, не нарративами.

Это типовая проблема multi-agent decision systems — state восстанавливается, аргументация теряется.

## Предложение

Добавить **`backend/monolith/src/services/decisionLog.js`** — обёртку над SQLite + FTS5 (Integram уже SQLite, FTS5 встроен в SQLite). Каждый дебат-turn / vote / commitment пишется как запись с `reasoning` в свободном тексте; FTS5 даёт мгновенный recall.

### Минимальное API

```js
// backend/monolith/src/services/decisionLog.js
import Database from 'better-sqlite3';

export class DecisionLog {
  constructor(dbPath = 'data/decision_log.db') { ... }

  record({ ts, source, action, reasoning, dealId, payload }) { ... }
  // source: 'agent_bull' | 'agent_bear' | 'analyst' | 'lawyer' | 'committee'
  // action: 'DEBATE_TURN' | 'VOTE' | 'DECISION' | 'EXIT' | 'PORTFOLIO_REVIEW'

  recall(query, { limit = 10, source = null } = {}) { ... }
  // полнотекстовый поиск по reasoning

  replay(dealId) { ... }
  // вся цепочка решений по конкретной сделке
}
```

### Схема (sqlite3 + FTS5)

```sql
CREATE TABLE decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  deal_id     TEXT,
  source      TEXT NOT NULL,
  action      TEXT NOT NULL,
  reasoning   TEXT NOT NULL,
  payload     TEXT,
  outcome     TEXT
);

CREATE VIRTUAL TABLE decisions_fts USING fts5(
  reasoning,
  source UNINDEXED, action UNINDEXED, deal_id UNINDEXED,
  content='decisions', content_rowid='id'
);

CREATE TRIGGER decisions_ai AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, reasoning, source, action, deal_id)
  VALUES (new.id, new.reasoning, new.source, new.action, new.deal_id);
END;
```

### Точки интеграции

1. **`POST /api/ai-tokens/chat`** в комитет-режиме — каждый ответ агента дополнительно пишется как `DEBATE_TURN`:
   ```js
   await decisionLog.record({
     ts: new Date().toISOString(),
     dealId: req.body.dealId,
     source: req.body.agentRole,  // 'bull' | 'bear' | ...
     action: 'DEBATE_TURN',
     reasoning: agentResponse.text,
     payload: { tokens: usage, model },
   });
   ```

2. **При финализации голосования** в `FstCommittee.vue`:
   ```js
   await api.post('/api/decisions/vote', {
     dealId, votes: [...], finalDecision, rationale,
   });
   // backend пишет VOTE-запись для каждого голосующего + DECISION для комитета
   ```

3. **При обновлении статуса сделки** (closed/exited):
   ```js
   await decisionLog.update_outcome(decisionId, outcome);
   // outcome = '+5x return' | 'write-off' | 'follow-on' | ...
   ```

4. **Подписка на Integram events** — если есть event_bus, decisionLog становится новым subscriber и пишет факты автоматически.

## Что это даёт

1. **Forensics**: `replay(dealId)` — вся цепочка дебатов, голосов и решений по конкретной сделке в хронологическом порядке. Сделка ушла в write-off через 18 месяцев — за минуту видно кто был против и что писал.

2. **Pattern recall**: `recall("B2B SaaS Series A consumer")` — все исторические дебаты по похожему профилю. Передаётся в контекст агентов перед новой сделкой как «уже видели это».

3. **Foundation для analyst-agent**: ночной cron читает `decision_log` за неделю + outcomes → отдаёт LLM с промптом «найди 3 урока недели». Сохраняет в `lessons.json` → инжектируется в system prompt агентов утром.

4. **Аналитика для LP**: «портфельный медведь-агент за 6 месяцев был прав в 67% случаев против быка» — конкретные цифры с примерами для отчёта инвесторам.

5. **Дью-дилидженс explainability**: для каждого portfolio-кейса видно **почему** комитет решил инвестировать — критично для compliance и при выходе.

## Стоимость

- ~200 LOC JS, использует уже подключённый `better-sqlite3` (FTS5 встроен в SQLite, дополнительные зависимости не нужны).
- На корпусе ~10k дебат-turn'ов: < 50MB на диске, recall < 30ms.
- Не ломает Integram persistence — это **дополнительный** слой, основное хранилище остаётся.

## Связь с экосистемой

Архитектура совпадает с `src/lcm/store.js` в `@unidel/gift` (≈150 LOC) — это нашего **шестой слой памяти** (θησαυρός / treasury). Тот же модуль предложен для алготрейдинг-проекта TRADERAGENT (issue alekseymavai/TRADERAGENT#424). Гарантирует консистентность подхода между проектами семьи: gift → fund → trader.

## Why — короткое обоснование

Текущая модель: AI-инвесткомитет дебатирует → принимает решение → дебат теряется → результат остаётся как verdict + payload. Через год аналитик портфеля **не может ответить** «почему мы зашли в эту сделку». Он видит цифры, но не **рассказ**.

Decision Log — это **корпус самого комитета**: его дебаты, аргументы, прецеденты. На таком корпусе можно строить:
- ретроспективы для квартальных отчётов LP без раскопки логов;
- explainability для compliance/due diligence;
- continuous learning для агентов (нарративные уроки поверх агрегатов Ontology Engine).

Готов прислать PR с минимальной имплементацией (~200 LOC + интеграционные хуки в FstCommittee API).
