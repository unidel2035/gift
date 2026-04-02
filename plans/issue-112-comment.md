## 📜 План реализации

## Архитектура

Создаём `utils/nous-server.mjs` — единый Express-сервер поверх Qdrant.  
Создаём `utils/nous-migrate.mjs` — одноразовый скрипт миграции 5 источников.  
Правим `utils/anamnesis-mcp-bridge.js` — только URL-константа (уже параметризована).

**Файлы:** `utils/nous-server.mjs` (новый), `utils/nous-migrate.mjs` (новый), `.env` / `pm2.config.js` (обновить)

## Шаги

1. **Qdrant коллекции** — `nous-migrate.mjs` создаёт `gift_acts`, `gift_insights`, `gift_specs` с векторами `nomic-embed-text` (768d)
2. **Миграция данных** — `gift-anamnesis.json` → `gift_acts`; `claude-soul.json` → `gift_insights`; `spec-vectors.db` → `gift_specs`; W-матрица пересчитывается из `gift_acts`
3. **Nous-сервер** — `nous-server.mjs` реализует 7 эндпоинтов (#API); W-матрица кешируется в памяти, инвалидируется при `POST /act`
4. **Тесты совместимости** — прогнать `claude-anamnesis.mjs` и MCP bridge против нового сервера; убедиться что все поля совпадают
5. **Деплой** — `scp nous-server.mjs root@173.249.2.184:...`; `pm2 restart nous-server`; smoke-тест всех эндпоинтов

## Коммит

```
gift(Дионисий): Nous-сервер — единая память общины на Qdrant (closes #112)
```

---
*Одобри: `gh issue edit 112 --add-label plan-approved`*