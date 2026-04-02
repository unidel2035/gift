# План — Issue #110

**онтология: кеносис как runtime-поведение агента (не комментарий)**
*Создан: 02.04.2026, 13:01:42*
*Статус: ожидает одобрения Дионисия*

---

## Архитектура

**Создать:**
- `src/theology/KenosisGuard.js` — класс по образцу `FreedomGuard.js`
- добавить `--kenosis` в `utils/gift-eval.mjs`

**Изменить:**
- `utils/git-gift-sync.mjs` — вызов `KenosisGuard.check(act)`, поле `kenosis` в act-index
- `utils/session-stop-hook.mjs` — автозапись surplus

## Шаги

1. `src/theology/KenosisGuard.js` — методы: `check(act)→{kenosis,reason}`, `score(personId)`, `violations(personId)`; проверяет: `act.surplus && !act.surplusRecorded` → `kenosis:false`; `anamnesisLoaded` → `kenosis:false` если контекст пуст
2. `utils/git-gift-sync.mjs` — после формирования акта: `const k = KenosisGuard.check(act)`, добавить `kenosis: k.kenosis` в `actLog.push(...)` и в `mem.receive(...)`
3. `utils/gift-eval.mjs` — флаг `--kenosis <person>`: читает `act-index.json`, считает `score = kenosisTrue / total`, выводит нарушения
4. `utils/session-stop-hook.mjs` — добавить вызов `anamnesis-mcp-bridge` для записи surplus если есть незаписанные инсайты сессии

## Коммит

```
gift(Дионисий): KenosisGuard — runtime кеносис: поле kenosis в W-матрице, score, stop-surplus (closes #110)
```

---
*_claude | @unidel/gift*
