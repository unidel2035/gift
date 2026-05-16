## Контекст

PLM-GIFT уже имеет:
- 5 AI-агентов: Design, Process, Quality, Knowledge, Orchestrator (статус — заглушки)
- Каноническая онтология `src/ontology/`: objects, links, actions, rollups, roles
- Нарративный слой `docs/philosophy/*.gift` (логос/тропос/анамнезис)
- Намерение: **Product Memory Graph** — заявлен, но не реализован
- Persistence: Integram + локальный JSON-storage (`src/integram/`)

Что не закрыто текущим стэком:
- **«Почему?»** для каждого ECR/ECO — заявлено в README как ключевая фича рынка («не просто история версий»), но операционного механизма нет.
- Когда 5 агентов будут реально голосовать по ECR — где **сами обоснования**? Голос Quality-агента «REJECT с указанием на риск усталости» исчезает после агрегации.
- Нет полнотекстового recall: «найди прошлые ECR, где Process-агент возражал, а изменение всё равно принимали — что вышло».

## Предложение

`src/memory/decision_log.js` — **операционная сторона Product Memory Graph**: SQLite + FTS5 (через `better-sqlite3`), хранит каждый акт дара / голос агента / ECR/ECO с обоснованием в свободном тексте. FTS5 даёт мгновенный recall.

Семантически это **прямой mapping на онтологию дара** (которая у вас уже есть как `@unidel/gift`):
- ECR (Engineering Change Request) = акт дара типа `question` от инженера к команде
- Голос агента = акт типа `word` (с reasoning внутри)
- ECO (Engineering Change Order) = акт типа `decision` от Orchestrator
- Завершение изменения = акт типа `healing` (рана исцелена)

### Минимальное API

```js
import { GiftAct } from '@unidel/gift';

class DecisionLog {
  recordGiftAct(act) {
    // GiftAct → запись в FTS-индексированной таблице
    // act.giverId, receiverId, type, weight, content, linkedObject
  }

  recall(query, { type = null, partId = null, limit = 10 }) { ... }
  // полнотекстовый поиск + фильтры по типу акта и по PLM-объекту

  replay(partId) { ... }
  // вся история актов вокруг конкретной детали (логос → тропос → анамнезис)
}
```

### Схема

```sql
CREATE TABLE acts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  giver_id     TEXT NOT NULL,        -- инженер | агент | команда
  receiver_id  TEXT NOT NULL,        -- деталь | команда | проект
  type         TEXT NOT NULL,        -- question | word | decision | healing | covenant
  weight       REAL NOT NULL,
  reasoning    TEXT NOT NULL,        -- свободный текст обоснования
  linked_part  TEXT,                 -- связь с PLM-объектом (deталь/сборка/чертёж)
  linked_ecr   TEXT,                 -- связь с ECR/ECO
  payload      TEXT,                 -- JSON
  outcome      TEXT
);

CREATE VIRTUAL TABLE acts_fts USING fts5(
  reasoning,
  giver_id UNINDEXED, receiver_id UNINDEXED, type UNINDEXED,
  linked_part UNINDEXED, linked_ecr UNINDEXED,
  content='acts', content_rowid='id'
);
```

### Точки интеграции

1. **`src/agents/orchestrator.js`** — каждый голос Design/Process/Quality/Knowledge:
   ```js
   const verdict = await designAgent.evaluate(ecr);
   await decisionLog.recordGiftAct(
     GiftAct.kenosis('agent_design', ecr.id, verdict.text, verdict.confidence * 10)
       .withAnamnesis(ecr.relatedActs)
       .eucharistia()
   );
   ```

2. **`src/core/changeOrder.js`** — при создании ECR/ECO:
   ```js
   await decisionLog.recordGiftAct(
     GiftAct.perichoresis()
       .kenosis(engineer.id, partId, ecr.text, 7)
       .withType('question')
       .linkedEcr(ecr.id)
   );
   ```

3. **При завершении изменения** (validated, deployed) — `outcome` обновляется. Это даёт через FTS recall полную траекторию решения от raны до исцеления.

## Что это даёт

1. **Product Memory Graph — операционализация**. Граф из `src/graph/` получает первичные данные не из обходов БД, а из real-time потока актов дара. Каждый узел графа знает свою историю.

2. **«Почему?» — прямой ответ**. На любом этапе жизненного цикла можно спросить: `decisionLog.replay(partId)` → траектория всех актов вокруг детали. Не «история версий» — **повествование о детали как о лице**.

3. **Foundation для Knowledge-агента**: ночная консолидация `recall(query, type='healing')` за период → LLM пишет «уроки этого месяца». Эти уроки инжектируются в system prompt всех 5 агентов следующим утром. Корпоративная память becomes self-reinforcing.

4. **ECR-детектор рецидивов**: новое ECR → `recall(ecr.description, type='question')` → если есть похожие в прошлом → показать оператору их исходы. «Эту проблему уже решали трижды, два раза успешно — вот как».

5. **Аудит и compliance**: для каждого критичного изменения видна вся цепочка решений с обоснованиями каждого голоса. Готовый артефакт для ISO/AS9100.

## Стоимость

- ~250 LOC JS, использует `better-sqlite3` (если ещё не подключён — добавить, FTS5 встроен).
- ~25k актов / месяц при активной разработке: ≈ 100MB/год, recall < 50ms.
- Прямая опора на уже существующий `@unidel/gift` — не дублирует онтологию, а воплощает её в runtime.

## Связь с экосистемой

Архитектура совпадает с `src/lcm/store.js` в `@unidel/gift` (≈150 LOC) — это **шестой слой памяти** (сокровищница) из gift-онтологии. Тот же подход предложен:
- TRADERAGENT (alekseymavai/TRADERAGENT#424) — для AI-инвесткомитета алготрейдера
- VentureOS / fund — для FstCommittee (AI-инвесткомитет фонда)

PLM получает **наибольшую** ценность из всех трёх, потому что только здесь есть прямой mapping ECR/ECO → акты дара (рана + исцеление). В фонде и трейдере это аналогия; в PLM — буквально.

## Why — короткое обоснование

В README заявлено: «**Product Memory Graph** — граф памяти продукта (не архив — живая память)». Decision Log — это **низший слой**, на котором стоит граф. Без него граф будет либо обходом структурной БД (= архив), либо синтетикой LLM (= галлюцинация). FTS5-корпус первичных актов — единственный путь к живой памяти, которая «знает почему».

Готов прислать PR с минимальной имплементацией (`src/memory/decision_log.js` + интеграция в Orchestrator-заглушку, ~250 LOC).
