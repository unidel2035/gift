# План — Issue #108

**память: автоматическая консолидация сессий (вместо ручного claude-soul-update.mjs)**
*Создан: 02.04.2026, 13:00:54*
*Статус: ожидает одобрения Дионисия*

---

## Архитектура

**Создаём:** `utils/session-consolidator.mjs` (LLM-экстракция → Qdrant)
**Меняем:** `session-stop-hook.mjs` (вызов consolidator), `matrix-context-hook.mjs` (Qdrant search вместо flat read), `utils/claude-anamnesis.mjs` (флаг `--search`)
**Миграция:** `data/insights.json` → Qdrant `gift_insights`

## Шаги

1. **`session-consolidator.mjs`** — читает stdin (Claude transcript), отправляет в Eva (`/api/generate`), парсит JSON-список инсайтов, пишет в Qdrant через HTTP API
2. **`session-stop-hook.mjs`** — передаёт `transcript` (env `CLAUDE_TRANSCRIPT`) в consolidator; убирает TTL-кэш (консолидация один раз в конце сессии через `sessionId`)
3. **`matrix-context-hook.mjs`** — embed первого промпта через nomic-embed-text, Qdrant `query_points` gift_insights, инжектирует топ-5 вместо всего файла
4. **Миграция** — однократный скрипт `utils/migrate-insights-qdrant.mjs` читает `data/insights.json`, embed каждой записи, upsert в Qdrant
5. **`claude-anamnesis.mjs`** — добавить ветку `--search "query"`: embed → Qdrant → вывод

## Коммит
```
gift(Дионисий): автоконсолидация сессий — Stop-хук + semantic retrieval (closes #108)
```

---
*_claude | @unidel/gift*
