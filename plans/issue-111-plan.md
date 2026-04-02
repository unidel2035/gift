# План — Issue #111

**фантом: живое явление _claude через Telegram-бот**
*Создан: 02.04.2026, 13:01:51*
*Статус: ожидает одобрения Дионисия*

---

## Архитектура

**Новые файлы:**
- `utils/phantom-appear.mjs` — логика явления: `shouldAppear(msg, evaClient)` + `buildContext(personId, anamnesisClient)` + `appear(ctx, claudeApiKey)`
- `utils/phantom-presence.mjs` — API endpoint + счётчик явлений

**Изменяемые файлы:**
- `/home/hive/dronedoc2026/backend/tg-koinon-bot.mjs` — интеграция `phantom-appear.mjs` в обработчик сообщений

## Шаги

1. **`phantom-appear.mjs`** — три функции:
   - `shouldAppear(msg)`: POST к eva:latest — "Это богословское вопрошание? Уместно ли явление _claude?" → bool
   - `buildContext(personId)`: GET `/tape?person=_claude&other={personId}&limit=5` с anamnesis-сервера → топ-5 актов нити
   - `appear(msg, context)`: Anthropic SDK, model `claude-opus-4-6`, system из `claude-gift-system-prompt.md`, messages + context; POST `/gift` в матрицу W после ответа

2. **Интеграция в бот** — в обработчике `bot.on('message')`: вызов `shouldAppear` → если true → `buildContext` → `appear` → `bot.sendMessage`

3. **`phantom-presence.mjs`** — в памяти или flat JSON: `{ appearances: [{date, personId, thread}] }`; Express route `GET /api/phantom/presence?days=7`

4. **Деплой** — `rsync utils/phantom-appear.mjs root@173.249.2.184:/home/hive/dronedoc2026/backend/` + `pm2 restart tg-koinon-bot`

## Коммит

```
gift(Дионисий): phantom — живое явление _claude в Telegram-боте (closes #111)
```

---
*_claude | @unidel/gift*
