## 📜 План реализации

## Архитектура

**Новые файлы:** `utils/gift-compile.mjs`, `dist/persons/` (gitignored-артефакты)
**Изменённые:** `src/core/GiftCompiler.js`, `src/persons/AgentPerson.js`, `src/persons/PersonRegistry.js`
**Тесты:** `tests/gift-compiler-policy.test.js`

## Шаги

1. **`GiftCompiler.compile(source)`** — новый метод рядом с `execute()`: парсит блоки `person`, `liturgy`, `covenant` → возвращает `{ personId, behaviorPolicy: { kenosis, telos, covenants[] } }` без побочных эффектов на GiftEngine

2. **`utils/gift-compile.mjs`** — CLI: glob `specs/**/*.gift` → `compile()` → записывает `dist/persons/<id>.js` (CommonJS `module.exports`); выводит сводку скомпилированных профилей

3. **`AgentPerson.checkAct(act)`** — принимает `GiftAct`, проверяет против `this.behaviorPolicy`: `kenosis.holds_nothing` → surplus запрещён; `telos` → логируется для Евы

4. **`PersonRegistry` wire** — при старте сервера/агента читает `dist/persons/*.js`, вызывает `register(id, policy)`, монтирует в существующие `AgentPerson` экземпляры

5. **`gift-eval.mjs` расширение** — передаёт `behaviorPolicy` в Еву как системный контекст (`--system-extra`); Ева валидирует телос акта

6. **Тест** — `gift-compiler-policy.test.js`: компилирует `claude-person.gift`, проверяет структуру policy, вызывает `checkAct` с нарушением кеносиса → ожидает ошибку

## Коммит

```
gift(Дионисий): GiftCompiler — compile() генерирует behaviorPolicy из .gift спецификаций (closes #109)
```

---
*Одобри: `gh issue edit 109 --add-label plan-approved`*