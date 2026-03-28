# Gift Protocol v0.1 — Draft Specification

**Status:** Draft (superseded by [gift-protocol-v1.md](./gift-protocol-v1.md))
**Date:** 2026-03-27
**Repository:** https://github.com/unidel2035/gift

---

## Цель

Дар как открытый стандарт. Любая система — бот, CI, человек — может подарить акт в матрицу W
одним HTTP-запросом. Gift Protocol v0.1 — минимальный рабочий стандарт для этого.

---

## JSON Schema акта дара

Схема хранится в `src/types/gift-act.schema.json`. Идентификатор: `gift/v1`.

```json
{
  "schema": "gift/v1",
  "from": "_claude",
  "to": "Дионисий",
  "type": "code",
  "weight": 5.0,
  "content": "реализован Gift Protocol v0.1",
  "irreversible": true,
  "timestamp": "2026-03-27T12:00:00Z",
  "proof": {
    "commit": "abc1234",
    "repo": "unidel2035/gift"
  }
}
```

### Обязательные поля

| Поле | Тип | Описание |
|---|---|---|
| `schema` | `"gift/v1"` | Версия протокола. Единственное допустимое значение. |
| `from` | string | personId дарителя. Анонимный дар: `"_abyss"`. |
| `to` | string | personId получателя. Вся община: `"_koinon"`. |
| `type` | enum | Тип дара (см. ниже). |

### Необязательные поля

| Поле | Тип | Описание |
|---|---|---|
| `weight` | number 0.1–10 | Нравственный вес. Если не задан — вычисляется по типу. |
| `content` | string ≤500 | Краткое описание содержания. |
| `irreversible` | `true` | Если передано — обязательно `true`. Дар нельзя отозвать. |
| `timestamp` | ISO 8601 | Время дара. Сервер ставит текущее если не задано. |
| `proof` | object | Внешнее свидетельство акта (см. ниже). |

---

## Типы даров и веса

**Богословская аксиома:** время тяжелее денег. Время невозобновляемо; деньги восполняемы.

| Тип | Вес | Значение |
|---|---|---|
| `time` | **10** | Время, отданное другому. Самый тяжёлый дар. |
| `presence` | 8 | Присутствие — физическое или устойчивое внимание. |
| `knowledge` | 6 | Знание, объяснение, обучение. |
| `grace` | 6 | Прощение, благодать, незаслуженная милость. |
| `code` | 5 | Код, системы, инфраструктура. |
| `offering` | 5 | Формальное подношение (merge PR, публикация). |
| `word` | 4 | Слово — наставление, ободрение, совет. |
| `question` | 4 | Вопрос — открывает пространство для другого. |
| `money` | 3 | Материальная поддержка. |
| `data` | 3 | Данные, записи, исследование. |
| `memory` | 2 | Память, анамнезис, поминовение. |

---

## Типы доказательств (proof)

`proof` — необязательный внешний свидетель акта. Одна из четырёх форм:

### Git-коммит
```json
{ "commit": "922b3b5abc", "repo": "owner/repo" }
```
SHA не менее 7 символов. Используется для даров кода.

### Telegram-сообщение
```json
{ "tg_message_id": 12345, "chat_id": -100123456789 }
```
Используется для даров слова из Telegram-сообщества.

### GitHub Issue
```json
{ "issue": 11, "repo": "unidel2035/gift" }
```
Используется для даров вопрошания или задачи, связанных с issue/PR.

### Время
```json
{ "seconds": 3600 }
```
Используется для даров присутствия и времени. 1 час = 3600 секунд.

---

## HTTP-эндпоинт: POST /api/gift

Сервер принимает акт дара, валидирует по JSON Schema и записывает в W-матрицу.

**Запрос:**
```http
POST /api/gift
Content-Type: application/json

{
  "schema": "gift/v1",
  "from": "gh/alice",
  "to": "_koinon",
  "type": "code",
  "content": "исправлен баг аутентификации",
  "proof": { "commit": "a1b2c3d", "repo": "owner/repo" }
}
```

**Успешный ответ (200):**
```json
{
  "ok": true,
  "act": {
    "schema": "gift/v1",
    "from": "gh/alice",
    "to": "_koinon",
    "type": "code",
    "weight": 5,
    "content": "исправлен баг аутентификации",
    "irreversible": true,
    "timestamp": "2026-03-27T12:00:00.000Z",
    "proof": { "commit": "a1b2c3d", "repo": "owner/repo" }
  },
  "memoryAct": {
    "giverId": "gh/alice",
    "receiverId": "_koinon",
    "type": "code",
    "weight": 5,
    "content": "исправлен баг аутентификации",
    "timestamp": "2026-03-27T12:00:00.000Z"
  }
}
```

**Ошибка валидации (200 с ok:false):**
```json
{
  "ok": false,
  "errors": [
    "type: unknown \"donation\". Valid: time, presence, knowledge, code, word, money, data, memory, question, offering, grace"
  ]
}
```

---

## Автоматическое обновление W-матрицы

После валидации сервер вызывает `GiftMemory.receive(memoryAct)`:

```
GiftAct (gift/v1) → GiftValidator.validate() → GiftValidator.toMemoryAct()
    → GiftMemory.receive() → W[from][to] += weight
```

W-матрица — тензор NxN (TensorFlow.js). Ячейка `W[i][j]` = суммарный вес всех даров от
лица `i` к лицу `j`. Добавление необратимо: вес только растёт.

---

## Валидатор: GiftValidator

`src/core/GiftValidator.js` — нет внешних зависимостей, работает в любой среде.

```js
import { GiftValidator } from './src/core/GiftValidator.js';

const result = GiftValidator.validate({
  schema: 'gift/v1',
  from: '_claude',
  to: 'Дионисий',
  type: 'code',
});

if (result.ok) {
  console.log(result.act.weight); // → 5
  const memAct = GiftValidator.toMemoryAct(result.act);
  // memAct → { giverId, receiverId, type, weight, content, timestamp }
}
```

---

## Богословские аксиомы в коде

1. **Дар необратим** — `irreversible: true` не опция, а аксиома. Нельзя передать `false`.
2. **Время тяжелее денег** — вес `time=10` vs `money=3` закодирован в `WEIGHT_BY_TYPE`.
3. **Без лица нет дара** — `from` и `to` обязательны. Анонимный дар → `_abyss`, не `null`.

Эти ограничения — не технические решения. Это богословские аксиомы,
сделанные исполняемыми через валидатор и матрицу W.

---

## JSON Schema (файл)

Полная схема: `src/types/gift-act.schema.json`

Сервер отдаёт её через:
```http
GET /gift/schema
```

---

*«Freely you have received; freely give.» (Mt 10:8)*
