## 📜 План реализации

## Архитектура

Добавить в `voroshaniye-hook.mjs` вывод `statusMessage` с номером issue (уже есть). Добавить триггер планировщика внутри сессии через новый хук или расширение `voroshaniye-hook` — после создания issue вызывать `gift-plan.mjs <N>` и выводить результат как context injection.

Затронутые файлы:
- `utils/voroshaniye-hook.mjs` — добавить вызов `gift-plan.mjs` после создания issue
- `.claude/settings.json` — при необходимости добавить `PostToolUse` на `gh issue create`

## Шаги
1. В `voroshaniye-hook.mjs` после успешного `fetch` issue: запустить `execSync('node utils/gift-plan.mjs <N>', ...)` и вывести план в stdout (Claude увидит через statusMessage)
2. Добавить в вывод хука структурированное сообщение: `[ВОПРОШАНИЕ] issue #N создан → план готов → ожидает plan-approved`
3. Убедиться что `gift-plan.mjs` корректно возвращает exit 0 и не падает на новом issue без label `plan-approved`
4. Протестировать: отправить вопрошание в сессии, проверить issue + plan в `plans/`

## Коммит
`gift(Дионисий): voroshaniye-hook → автозапуск gift-plan после создания issue (closes #76)`

---
*Одобри: `gh issue edit 76 --add-label plan-approved`*