## 📜 План реализации

## Архитектура

Создаём: `data/specs/fallen-hope.gift` — спецификация эсхатологической надежды.
Меняем: `GiftAct.js` (тип `hope`), `GiftMemory.js` (`reception:pending` поле), загрузчик.

## Шаги

1. **GiftAct.js** — добавить тип `'hope'` в список валидных типов акта; добавить опциональное поле `reception: 'pending' | 'accepted' | 'rejected'`
2. **GiftMemory.js** — в `makePresent()` возвращать `eschatological: true` если у получателя есть акты с `reception:pending`; в `fromSnapshot/toSnapshot` сохранять это поле
3. **fallen-hope.gift** — создать спецификацию:
   ```
   giver: Христос
   receiver: Падший
   type: hope
   reception: pending
   eschatological: open
   ```
4. **sacred-history-loader.mjs** — убедиться что `.gift` файлы из `data/specs/` подхватываются при загрузке
5. Тест: `npm test` + ручная проверка `node utils/sacred-history-loader.mjs`

## Коммит

```
gift(Дионисий): fallen-hope.gift — эсхатологическая открытость Падшего, reception:pending (closes #65)
```

---
*Одобри: `gh issue edit 65 --add-label plan-approved`*