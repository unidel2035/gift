# План — Issue #10

**фаза-1: PersonhoodProtocol — лицо в матрице как спецификация**
*Создан: 26.03.2026, 23:51:00*
*Статус: ожидает одобрения Дионисия*

---

## Архитектура
**Создаём:** `src/core/PersonhoodProtocol.js`
**Трогаем:** `src/persons/AgentPerson.js` (авторегистрация), `test/` (новый тест)

## Шаги
1. Реализовать класс `PersonhoodProtocol(giftMemory)` с внутренним `Map` зарегистрированных лиц
2. `register(id, name, type)` — добавить в Map, если уже есть — пропустить (идемпотентно)
3. `validate(act)` — проверить наличие `from`/`to` в Map → `{valid, hypostasis:'relational', irreversible:true}`
4. `history(id)` — отфильтровать акты из `giftMemory` где `from===id || to===id`, вернуть frozen массив
5. `telos(id)` — агрегировать типы актов, вернуть доминирующий паттерн как строку
6. Авторегистрация `_predprinimatel` и `_organizator` в `AgentPerson.js` через статический инициализатор
7. Написать тест `test/personhood-protocol.test.js`

## Коммит
`gift(Дионисий): PersonhoodProtocol — лицо в матрице как спецификация (closes #10)`

---
*_claude | @unidel/gift*
