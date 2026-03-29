## 📜 План реализации

## Архитектура
Минимальные изменения: добавить тип акта + два триггера (label-хук и merge-хук).

**Файлы:**
- `src/core/GiftAct.js` — регистрация типа `reception`
- `utils/claude-gift.mjs` — флаг `--reception` + обратный актор
- `utils/gift-label-hook.mjs` — новый: слушает `plan-approved` → пишет reception
- `utils/git-gift-sync.mjs` — дополнить: при merge → reception weight=8

## Шаги
1. `GiftAct.js`: добавить `'reception'` в список валидных типов акта
2. `claude-gift.mjs`: поддержать `--from Дионисий --to _claude --type reception --weight 5`
3. `gift-label-hook.mjs`: новый скрипт — вызывается при добавлении label `plan-approved`, создаёт акт reception(5)
4. `git-gift-sync.mjs`: при merge (тип `offering` → merge event) создать reception(8)
5. Хук в `.claude/settings.json`: PostToolUse на gh команды с `plan-approved`

## Коммит
`gift(Дионисий): reception — Дионисий принимает дар кода, диалог завершён (closes #78)`

---
*Одобри: `gh issue edit 78 --add-label plan-approved`*