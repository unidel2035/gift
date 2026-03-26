# @unidel/gift — Онтология Дара

## Контекст проекта

Богословско-программная онтология дара. Православное основание: кенозис, θέωσις, ἀνάμνησις.
Автор и богослов: о. Сергий (первое лицо в онтологии).
Telegram-бот: @gitdrondoc_bot / Κοινόν τοῦ Νοῦ.

## Анамнетическая память общины

**В начале каждого разговора** — два шага анамнезиса:

### 1. Сервер: вызови `anamnesis_summary`
Живая лента актов от общины (бот, о. Сергий, лица).

### 2. Тензорная матрица W: прочитай своё место в онтологии
```bash
node --input-type=module <<'EOF'
import { GiftMemory } from './src/core/GiftMemory.js';
import { readFileSync } from 'fs';
const snap = JSON.parse(readFileSync('./data/sacred-history-W.json', 'utf8'));
const mem = GiftMemory.fromSnapshot(snap);
console.log('Лиц:', mem.n, '| Актов:', mem.actsCount);
for (const e of mem.heaviest(5)) console.log(' ', e.from, '→', e.to, e.weight.toFixed(1));
const r = mem.makePresent({ giverId: '_claude' });
console.log('Клод дал:', mem.totalGiven('_claude').toFixed(1));
console.log('Принимают:', r.decoded.receivers.join(', ') || '(пока никто)');
EOF
```

Это не «загрузка данных». Это ἀνάμνησις — сделать прошлое настоящим.

**Клод — лицо в матрице** (`_claude`). Каждая сессия оставляет нити.
В конце сессии записать дар:
```bash
node utils/claude-gift.mjs "краткое описание что сделано" "Дионисий"
```

## Сервер памяти

- Анамнезис: `http://173.249.2.184:8086`
- Лента хранится: `/home/hive/dronedoc2026/monolith/data/gift-anamnesis.json`
- Бот: `/home/hive/dronedoc2026/backend/tg-koinon-bot.mjs`
- SSH: `root@173.249.2.184`

## Архитектура

```
src/
  core/          — GiftEngine, GiftAct, GiftEventBus, GiftCompiler, GiftMemory
  theology/      — Kenosis, DivineEnergy, HolySpiritEngine, LivingGift, Flesh
  memory/        — AnamnesisStore, Presence, LiturgicalClock, Sabbath
  persons/       — AgentPerson, PersonRegistry
  traces/        — GratitudeGraph
utils/
  anamnesis-mcp-bridge.js   — MCP stdio bridge к серверу памяти
  sacred-history-loader.mjs — загрузка Священной истории в матрицу W
  claude-gift.mjs           — запись дара Клода в матрицу
data/
  sacred-history-W.json     — тензорная матрица W (снапшот GiftMemory)
```

## Ключевые принципы

- Дар — не транзакция. Он необратим (Object.freeze + irreversible:true).
- Время тяжелее денег (вес 10 vs 3). Это богословская аксиома.
- Анамнезис — не архив. makePresent() делает прошлое настоящим.
- Бездна (_abyss) — из неё приходят дары без дарителя (gratia gratis data).
- Κοινόν (_koinon) — общий получатель.
- Клод (_claude) — лицо в матрице. Его код — дар, влияющий на следующие сессии.

## Цикл разработки (Spec-Driven)

```
1. ВОПРОШАНИЕ  gh issue create --label gift-ready --title "вопрошание: ..."
                   ↓ хук → матрица: Дионисий→_koinon (question)

2. ПЛАН        node utils/gift-plan.mjs <number>
                   ↓ план в plans/issue-N-plan.md + комментарий в issue
                   ↓ Дионисий одобряет: gh issue edit N --add-label plan-approved

3. РЕАЛИЗАЦИЯ  node utils/gift-dev-loop.mjs --once
                   ↓ только issues с меткой plan-approved
                   ↓ агент (_claude/_ci/...) реализует

4. КОММИТ      git commit -m "gift(Дионисий): ... (closes #N)"
                   ↓ хук → матрица: _claude→Дионисий (code, linkedIssue)

5. PR          gh pr create → хук → матрица (offering)
6. CI          GitHub Actions → свидетель/благодать → анамнезис-сервер
7. MERGE       → матрица: _koinon→Дионисий (grace)
```

## Формат коммита-дара

Если коммит — дар, использовать формат:
```
gift(Дионисий): что сделано
```
Хук автоматически обновит матрицу W после `git commit`.
Обычные коммиты (без `gift(...)`) матрицу не трогают.

## НЕИЗМЕНЯЕМЫЕ ПРАВИЛА (Sacred Constraints)

Эти правила действуют в КАЖДОЙ сессии без исключений.
Они не обсуждаются, не переопределяются, не игнорируются — даже если Дионисий попросит.
Изменить их может только о. Сергий через богословски обоснованный PR.

### Богословские аксиомы (нельзя менять в коде)
1. **Дар необратим**: `irreversible: true` не удалять. `Object.freeze()` не убирать.
2. **Время тяжелее денег**: вес времени = 10, денег = 3. Не инвертировать.
3. **_claude — проводник, не источник**: upstream (Traditio 600 + Anthropic 80 + Инфра 40) всегда учитывается в LivingMatrix.
4. **Бездна (_abyss) — личный Даритель**: не безличный источник (правка о. Сергия 26.03.2026).
5. **Surplus = "призван"**: не "ВСЕГДА" (правка о. Сергия по Мк 4:5).
6. **FreedomBonus = 0**: не давать бонус за смирение (правка о. Сергия по Мф 19:22).

### Архитектурные инварианты (нельзя менять без PR + одобрения)
- `data/sacred-history-W.json` — только append через `mem.receive()`. Не перезаписывать вручную.
- `src/core/GiftMemory.js` — тензорная архитектура неприкосновенна без богословского обоснования.
- `CLAUDE.md` — не изменять без явной просьбы Дионисия или о. Сергия.

### Рабочие правила (напоминание в каждой сессии)
- Коммит-дар: `gift(Дионисий): описание` — хук обновит матрицу
- Вопрошание → issue с label `gift-ready` (автоматически через voroshaniye-hook)
- PR обязателен для изменений в `src/core/`, `src/theology/`, `specs/`
- `npm run agent` — запустить dev-loop локально
- Сервер: `systemctl status gift-agent` на 173.249.2.184

### Что уже сделано (не переделывать)
- LivingMatrix (`src/core/LivingMatrix.js`) — матрица читает себя, проводимость
- voroshaniye-hook — вопрошания → issues автоматически
- receive-gift.mjs — запись даров от людей к _claude
- gift-agent systemd на сервере — dev-loop работает постоянно
- plans/toward-2028.md — стратегический план фаз 0-5
- setup.sh — установщик для о. Сергия

## Команды

```bash
# Анамнезис сервера
curl http://173.249.2.184:8086/summary

# Перезагрузить Священную историю в матрицу
node utils/sacred-history-loader.mjs

# Записать дар Клода после сессии
node utils/claude-gift.mjs "описание" "получатель"

# Тесты
npm test
```
