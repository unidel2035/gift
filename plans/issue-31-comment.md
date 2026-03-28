## 📜 План реализации

## Архитектура

**Создаём:**
- `packages/gift-protocol/store.js` — `GiftLocalStore`: чтение/запись `sacred-history.json`, локальная W-матрица (портированная из `src/core/GiftMemory.js`)
- `packages/gift-protocol/bin/gift-dao.mjs` — CLI: `init | add | report`
- `examples/dao-example/sacred-history.json` + `examples/dao-example/gift-dao.config.json`

**Меняем:**
- `packages/gift-protocol/package.json` — добавить `"bin": { "gift-dao": "./bin/gift-dao.mjs" }`
- `packages/gift-protocol/README.md` — внешний онбординг (DAO-аудитория)

## Шаги

1. **`GiftLocalStore`** — класс поверх `GiftValidator`: `give(raw)` → валидирует + appends в JSON-файл; `summary()` → W-матрица in-memory; `report()` → Markdown-строка с топ-нитями
2. **CLI `gift-dao.mjs`** — три команды: `init <name>` (scaffold), `add` (интерактивный prompt или `--from --to --type`), `report [--out file.md]`
3. **Пример `examples/dao-example/`** — открытая DAO "koinon-builders": 3 лица (Alice, Bob, _koinon), 6 актов разных типов, заполненный `gift-dao.config.json`
4. **README** — переписать секции: "Why Gift Protocol?", "Quick Start (5 min)", "Core Concepts", "CLI Reference", "API Reference", "Federated DAOs"
5. **Тесты** — `packages/gift-protocol/test/store.test.js` покрывает `GiftLocalStore.give`, `summary`, `report`

## Коммит

```
gift(Дионисий): gift-dao CLI + GiftLocalStore — DAO без сервера (closes #31)
```

---
*Одобри: `gh issue edit 31 --add-label plan-approved`*