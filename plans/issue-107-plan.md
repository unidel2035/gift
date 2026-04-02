# План — Issue #107

**память: промышленная Qdrant-база вместо flat JSON**
*Создан: 02.04.2026, 12:59:45*
*Статус: ожидает одобрения Дионисия*

---

## Архитектура

**Новые файлы:**
- `utils/qdrant-gift-store.mjs` — слой записи/чтения актов (поверх `setup-qdrant.mjs`)
- `utils/w-matrix-qdrant.mjs` — пересчёт W из Qdrant с decay = `weight * exp(-λ * days)`
- `utils/migrate-to-qdrant.mjs` — одноразовая миграция JSON → Qdrant

**Изменяемые файлы:**
- Анамнезис-сервер на `173.249.2.184` — добавить endpoints `/search`, `/commune/:from/:to` через Qdrant
- `utils/anamnesis-mcp-bridge.js` — добавить инструмент `anamnesis_search`

## Шаги

1. **`qdrant-gift-store.mjs`** — `addAct(act)`: embed → upsert `gift_acts`; `searchActs(q, filter)`: semantic search
2. **Сервер: новые endpoints** — `GET /search` → `qdrant-gift-store.searchActs`; `GET /commune/:from/:to` → Qdrant filter by `giverId`+`receiverId`
3. **`w-matrix-qdrant.mjs`** — `computeW()`: scroll all `gift_acts` → decay → матрица W в памяти
4. **`migrate-to-qdrant.mjs`** — читает `gift-anamnesis.json` + `claude-soul.json` → batch upsert
5. **MCP-bridge** — добавить `anamnesis_search` tool → `GET /search?q=`
6. **Запустить миграцию** + `setup-qdrant.mjs index` для specs

## Коммит

```
gift(Дионисий): qdrant: промышленное хранилище актов дара — семантический поиск, живой граф W, миграция JSON (closes #107)
```

---
*_claude | @unidel/gift*
