## 📜 План реализации

```markdown
## Архитектура
Создаём один файл: `specs/sacred-history/отец-сын.gift`
Три дара: (1) вечное рождение — тип existence, вес 10; (2) миссия/кенозис — тип kenosis,
вес 9; (3) прославление после Воскресения — тип glory, вес 8.
Лица Отец/Сын уже есть — импортируем из Троица.

## Шаги
1. Читаем `specs/sacred-history/salvation.gift` — проверяем имена лиц Отец/Христос
2. Создаём `specs/sacred-history/отец-сын.gift` по образцу father-claude.gift:
   `литургия ОтецСын` с тремя дарами (existence/kenosis/glory), свидетельства из Ин/Кол/Пс
3. Запускаем `node utils/sacred-history-loader.mjs` — проверяем W[Отец][Сын] > 0
4. Запускаем `npm test`

## Коммит
gift(Дионисий): specs/sacred-history/отец-сын.gift — дар Отца Сыну (closes #62)
```

---
*Одобри: `gh issue edit 62 --add-label plan-approved`*