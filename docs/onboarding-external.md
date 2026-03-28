# Onboarding: Первые внешние участники Gift Protocol

**Gift Protocol** — открытый стандарт для записи актов дара между лицами (людьми, ИИ-агентами, институтами). Основан на православном богословии кенозиса, анамнезиса, θέωσις.

Три сценария подключения внешних участников.

---

## 1. Православный приход

### Что даёт Gift Protocol приходу

Приход уже живёт даром: литургия, пастырские посещения, пение на клиросе, обучение, волонтёрство. Gift Protocol делает эту реальность видимой — не для контроля, а для **анамнезиса**: чтобы история служения не терялась со сменой настоятеля или разъездом прихожан.

Матрица W становится зеркалом живой общины: не «кто больше пожертвовал деньгами», а «кто чем послужил».

### Шаги подключения

**Шаг 1.** Установить сервер Κοινόν (или использовать существующий):

```bash
# Клонировать репозиторий
git clone https://github.com/unidel2035/gift
cd gift
npm install

# Запустить сервер (порт 8086 по умолчанию)
node src/lab/server.js
```

**Шаг 2.** Добавить приход в матрицу. Создать лица для настоятеля и общины:

```bash
# Через HTTP API
curl -X POST http://localhost:8086/gift \
  -H "Content-Type: application/json" \
  -d '{
    "schema": "gift/v1",
    "from": "_abyss",
    "to": "приход",
    "type": "grace",
    "content": "Основание общины",
    "irreversible": true
  }'
```

**Шаг 3.** Установить Telegram-бот для прихода (из `examples/telegram-bot/`):

```bash
cd examples/telegram-bot
npm install
BOT_TOKEN=ваш_токен KOINON_URL=http://localhost:8086 node index.js
```

Прихожане записывают дары через `/give`:
```
/give @отец_сергий presence встреча после вечерни
/give @марина knowledge урок воскресной школы
```

### Типы даров для прихода

| Тип | Вес | Применение |
|---|---|---|
| `time` | 10 | Дежурство, уборка, сторожение |
| `presence` | 8 | Пастырское посещение, соболезнование |
| `knowledge` | 6 | Проповедь, катехизация, воскресная школа |
| `word` | 4 | Молитва за другого, благословение |
| `money` | 3 | Пожертвование |

### Богословская заметка

Матрица W — не замена исповеди и не система оценки. Это **анамнезис** — способ сделать прошлое служение настоящим. Как Евхаристия делает присутствующим Тайную вечерю, матрица делает присутствующим служение всех поколений прихода.

---

## 2. Open-source проект

### Что даёт Gift Protocol open-source проекту

Стандартные метрики вклада (счётчик коммитов, звёзды) **уплощают** нравственную топологию проекта. Коммит, который потребовал 40 часов глубокого рефакторинга, весит одинаково с опечаткой в документации.

Gift Protocol записывает **реальный вес**: `type: "time"` + `proof: { seconds: N }` создаёт историю, отражающую настоящую цену вклада.

### GitHub Action (автоматически)

Скопировать `examples/github-action/gift-record.yml` в `.github/workflows/`:

```bash
mkdir -p .github/workflows
cp /path/to/gift/examples/github-action/gift-record.yml .github/workflows/
```

Добавить секрет `KOINON_URL` в GitHub Settings → Secrets → Actions.

После этого каждый push/PR/issue автоматически пишет в матрицу W.

### Ручная запись (через SDK)

```js
import { GiftClient } from '@koinon/gift-protocol';

const client = new GiftClient('http://my-koinon.org:8086');

// Запись вклада
await client.give({
  schema:      'gift/v1',
  from:        'github/alice',
  to:          '_koinon',
  type:        'time',
  content:     'Рефакторинг системы авторизации (38 часов)',
  irreversible: true,
  proof: {
    commit:  'a3f9c12',
    repo:    'myorg/myproject',
    seconds: 136800, // 38 часов
  },
});
```

### GiftLedger вместо CONTRIBUTORS

Вместо статичного файла `CONTRIBUTORS.md` — живая матрица:

```bash
# Топ 5 дарителей проекта
curl http://my-koinon.org:8086/summary | jq '.heaviest[:5]'
```

---

## 3. НКО — GiftLedger вместо баланса

### Что даёт Gift Protocol НКО

НКО работает даром: волонтёрское время, пожертвованная экспертиза, личное присутствие. Финансовый баланс **не видит** большей части реальной экономики организации.

GiftLedger — append-only, неизменяемый регистр: невозможно «подправить» историю при смене руководства или конфликте внутри организации. История **необратима** — богословская аксиома, ставшая техническим фактом.

### Схема развёртывания

```
НКО-сервер (VPS или локально)
  └── Gift Protocol Server (port 8086)
        ├── /gift  — запись актов
        ├── /summary — сводка матрицы
        └── /tape    — лента актов

Волонтёры → Telegram бот → /gift endpoint → Матрица W
Персонал  → REST API     → /gift endpoint → Матрица W
Доноры    → webhook      → /gift endpoint → Матрица W
```

### Учёт волонтёрского времени

```js
import { GiftClient } from '@koinon/gift-protocol';

const client = new GiftClient(process.env.KOINON_URL);

// Волонтёр отработал 4 часа на складе
await client.give({
  schema:      'gift/v1',
  from:        'volunteer/ivan_petrov',
  to:          'ngo/sklad',
  type:        'time',
  content:     'Склад: сортировка гуманитарной помощи',
  irreversible: true,
  proof:       { seconds: 14400 }, // 4 часа
});
```

### Отчётность через матрицу

```bash
# Итого времени волонтёров за всё существование НКО
curl http://localhost:8086/summary | jq '
  .heaviest |
  map(select(.type == "time")) |
  map(.weight) |
  add
'

# Лента за последний месяц
curl "http://localhost:8086/tape?limit=100" | jq '.acts[]'
```

### Ключевое отличие от CRM

CRM хранит данные **изменяемо**: запись можно удалить, отредактировать, потерять при миграции.
GiftLedger хранит **необратимо**: каждый акт — часть священной истории организации.
Это не баг — это богословская аксиома, закодированная в `irreversible: true` и `Object.freeze`.

---

## Контакты

- GitHub: [github.com/unidel2035/gift](https://github.com/unidel2035/gift)
- Telegram: [@gitdrondoc_bot](https://t.me/gitdrondoc_bot) — Κοινόν τοῦ Νοῦ
- SDK: `npm install @koinon/gift-protocol`
- Лицензия: MIT — дар не патентуется

---

*«Freely you have received; freely give.» (Mt 10:8)*
