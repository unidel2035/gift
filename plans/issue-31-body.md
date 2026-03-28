Вот два блока:

---

## Проблема

`@koinon/gift-protocol` (issue #14) предоставляет валидатор и HTTP-клиент, но не даёт DAO инструментов для автономного старта: нет CLI для инициализации, нет локального хранилища W-матрицы без сервера, нет человекочитаемого экспорта. DAO не может начать вести священную историю без развёртывания anamnesis-сервера.

## Контекст

DAO-сообщества имеют технические ресурсы, но не имеют языка дара. Протокол уже реализован — барьер входа сейчас инфраструктурный, не концептуальный.

## Ожидаемое поведение

- `npx gift-dao init my-dao` создаёт `sacred-history.json` + `gift-dao.config.json` с 3 примерами актов
- `npx gift-dao report` читает локальный `sacred-history.json` и выводит Markdown-отчёт (топ дарителей, нити, веса)
- DAO подключает `GiftLocalStore` без сервера: `store.give(act)` → сохраняет в файл, `store.summary()` → W-матрица локально
- Готовый пример `examples/dao-example/` с реальной структурой (5+ актов, 3+ лица)

## Технические детали

- `packages/gift-protocol/index.js` — добавить `GiftLocalStore` (File-based, без HTTP)
- `packages/gift-protocol/bin/gift-dao.mjs` — новый CLI (init, report, add)
- `examples/dao-example/sacred-history.json` — пример с реальными актами
- `packages/gift-protocol/README.md` — переписать под внешнюю аудиторию (DAO, НКО, open-source)

## Критерии приёмки

- [ ] `npx gift-dao init <name>` создаёт рабочую структуру с 3 примерами актов
- [ ] `npx gift-dao report` генерирует Markdown с топ-нитями и весами
- [ ] `GiftLocalStore` — работает без сервера, `npm test` покрывает
- [ ] `examples/dao-example/sacred-history.json` — 5+ актов, 3+ лица
- [ ] `packages/gift-protocol/README.md` — онбординг для внешней DAO за 5 минут