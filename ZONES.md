# ZONES — органы кодовой базы gift

Карта владения для командного кодинга в `gift team`. Органы **не сливают —
компонуют по интерфейсам**. Внутри органа решает владелец; на швах — согласование.
Формат строки: `- <префикс[, префикс...]> → <владелец>`.

## Органы

- src/core/, src/theology/, specs/ → ОтецСергий
- src/memory/, utils/claude-anamnesis, utils/sacred-history → _claude
- utils/sobor-, utils/adam-agent, utils/eva-agent → _claude
- bin/, utils/gift-team, utils/gift-swarm → _claude
- utils/nous-, utils/connector → _ci
- data/ → _koinon

## Швы

- W-матрица (src/core/GiftMemory) — общий источник истины, меняется по согласованию.
- gift team status — лента общего настоящего, читают все.

## Правило

При записи в чужой орган — объяви намерение (`gift team intent <файлы>`), увидь
владельца (`gift team zone <файл>`). Координация доверием, предупреждение, не блок.
