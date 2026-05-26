# Задача: gift-agent → production-ready

Файл: `src/agent-cli/gift-agent.js` (1449 строк — было 990)

## Контекст
gift-agent — standalone coding agent без зависимости от claude binary. Работает через прокси (DeepSeek/RouterAI). Есть: agent loop, 6 tools + 6 gift-tools, W-matrix, KoinonBus, CIS, sessions, streaming, permission system, compaction, TermUI.

## Done (26.05.2026)

### 1. SSE Streaming
- `apiCallStream` переписан на инкрементальный `reader.read()` через ReadableStream (вместо `await resp.text()`)
- REPL: первый вызов и tool-loop используют streaming через `streamCall` helper
- `agentLoop` (pipe-режим) тоже стримит
- Спиннер гаснет при первом чанке текста, tool_use показывается сразу
- Текст рендерится посимвольно через `renderMarkdown`

### 2. Permission System
- `SAFE_TOOLS`: Read/Grep/Glob — авто
- `confirmTools()` + `toolPreview()` — diff/команда перед Write/Edit/Bash
- `confirmAction()` в TermUI — [y/n] в raw и readline режимах
- Флаг `--yes`/`--accept-edits` для автоподтверждения
- Интегрировано в REPL и agentLoop

### 3. Context Compaction
- `estimateTokens()`: text.length / 4
- `compactMessages()`: summarise old → keep last 5 turns
- Автосжатие при >100K токенов в REPL и agentLoop
- Slash-команда `/compact` для ручного сжатия

### 4. MCP Gift-Tools
6 новых инструментов в TOOLS + executeTool:
- `matrix_query` — summary/persons/threads/recent
- `matrix_record` — запись акта в W + KoinonBus
- `koinon_say` — публикация в шину
- `koinon_inbox` — чтение сообщений
- `recall_treasure` — поиск в insights/proposals/reflection
- `sobor_ask` — 3 параллельных LLM-запроса (theologian/engineer/strategist)

### 5. TermUI Slash-Menu
- Код проверен — логика `_renderPrompt()`, меню, навигация выглядят корректно
- Нужен тест в реальном TTY (`gift start`)

## TODO — Следующая сессия
- [ ] Протестировать TermUI slash-menu в реальном TTY через `gift start`
- [ ] Протестировать permission-диалоги [y/n] в реальном TTY
- [ ] `sobor_ask`: параллельные API-вызовы через один прокси могут конфликтовать — добавить очередь или семафор
- [ ] `DEFAULT_SYSTEM` не определён (предсуществующий баг в agentLoop)
- [ ] Интеграция с `gift start` (launcher сейчас использует claude binary, не gift-agent.js)

## Как запустить
```bash
cd /home/unidel/gift

# Прокси
export DEEPSEEK_API_KEY=sk-6c45e2f605be470aa127a0ae6d74cc05
export ROUTERAI_API_KEY=sk-PQcWfL67VhhX0hKC9BgoQzFrFcLAUYV_
node src/proxy/start-proxy.js "https://api.deepseek.com/anthropic" "$DEEPSEEK_API_KEY" &
sleep 2
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d 'backend=deepseek'

# Агент
ANTHROPIC_BASE_URL=http://127.0.0.1:3200 ANTHROPIC_AUTH_TOKEN=$DEEPSEEK_API_KEY \
  node src/agent-cli/gift-agent.js

# Pipe-режим с автоподтверждением
echo "создай файл /tmp/test.txt" | node src/agent-cli/gift-agent.js --yes

# Или через launcher
gift start
```

## Тестирование
```bash
# Single-turn (pipe)
echo "покажи первые 3 строки package.json" | node src/agent-cli/gift-agent.js

# С флагом --yes
echo "создай файл /tmp/test-gift.txt с текстом 'hello'" | node src/agent-cli/gift-agent.js --yes

# Interactive (TTY)
gift start
❯ /help
❯ /switch ra
❯ создай файл /tmp/test-gift.txt с текстом "hello"
❯ /matrix
❯ /koinon
❯ /compact
❯ /exit
```

## Файлы
- `src/agent-cli/gift-agent.js` — основной агент (1449 строк)
- `src/agent-cli/term-ui.js` — TUI с raw mode и slash-menu (530 строк)
- `src/proxy/model-proxy.js` — multi-backend прокси
- `src/proxy/launcher.js` — запуск прокси + агента
- `src/koinon/KoinonBus.js` — межагентная шина
- `src/core/GiftMemory.js` — W-матрица (полная)
- `src/core/LivingMatrix.js` — живая матрица
