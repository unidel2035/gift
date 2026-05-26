# Задача: gift-agent → production-ready

Файл: `src/agent-cli/gift-agent.js` (990 строк)

## Контекст
gift-agent — standalone coding agent без зависимости от claude binary. Работает через прокси (DeepSeek/RouterAI). Есть: agent loop, 6 tools (Read/Write/Edit/Bash/Grep/Glob), W-matrix, KoinonBus, CIS, sessions, markdown rendering, spinner, TermUI.

## Что сломано сейчас
1. **Non-streaming** — агент молчит 10-30 сек пока LLM думает. Текст появляется только после полного ответа. Промежуточный текст между tool_use уже показывается, но сам ответ — не стримится.
2. **Меню `/`** — TermUI подключён но не проверен в реальном TTY через `gift start`. Может глючить.
3. **Нет permission system** — Write/Edit/Bash выполняются без подтверждения.

## Задачи по приоритету

### 1. SSE Streaming (критично)
`apiCallStream()` уже написан (строка ~441) но не используется в REPL loop.

Нужно:
- В REPL agent loop (строка ~963) заменить `apiCall()` на `apiCallStream()` для первого вызова
- `onText: (chunk) => process.stdout.write(renderMarkdown(chunk))` — текст сразу в терминал
- `onToolUse: (name, input) => spinner.update(name)` — показать что tool вызывается
- Spinner останавливать когда пошёл текст, запускать когда tool_use
- `safeFetch` для localhost (прокси) использует native `fetch` — он поддерживает `resp.body` как ReadableStream. Переделать `apiCallStream` чтобы парсил stream инкрементально, а не `await resp.text()` целиком

Тестирование: `gift start`, набрать промпт, текст должен появляться посимвольно.

### 2. Permission system
- Read/Grep/Glob — автоматически (безопасные)
- Write/Edit — показать diff, спросить `[y/n]` перед выполнением
- Bash — показать команду, спросить `[y/n]`
- Флаг `--yes` или `--accept-edits` для автоподтверждения
- В TermUI: после tool_use показать `  ● Edit file.js [y/n]?` и ждать нажатия

### 3. Context compaction
- Считать токены примерно: `text.length / 4`
- При >100K tokens в conversation — автосжатие
- Оставить: system prompt + summary старых сообщений + последние 5 turns
- Slash-команда `/compact` для ручного сжатия

### 4. MCP gift-tools
Добавить gift-специфичные tools в TOOLS массив + executeTool():
- `matrix_query` — `loadGiftMemory()`, показать threads/persons
- `matrix_record` — записать акт в W-матрицу
- `koinon_say` — `bus.publish({...})`
- `koinon_inbox` — `bus.pollSince()`
- `recall_treasure` — поиск в сокровищнице (LcmStore)
- `sobor_ask` — запустить 3 параллельных LLM-запроса с разными system prompts

### 5. Фикс TermUI slash-menu
Проверить в реальном TTY. Если глючит — дебажить `_renderPrompt()` в `term-ui.js`. Prompt сейчас однострочный `❯ `. Разделитель `────` рисуется один раз после ответа (строка ~1028).

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

# Или через launcher
gift start
```

## Тестирование
```bash
# Single-turn (pipe)
echo "покажи первые 3 строки package.json" | node src/agent-cli/gift-agent.js

# Interactive (TTY)
gift start
❯ /help
❯ /switch ra
❯ создай файл /tmp/test-gift.txt с текстом "hello"
❯ /matrix
❯ /koinon
❯ /exit
```

## Файлы
- `src/agent-cli/gift-agent.js` — основной агент (990 строк)
- `src/agent-cli/term-ui.js` — TUI с raw mode и slash-menu (457 строк)
- `src/proxy/model-proxy.js` — multi-backend прокси
- `src/proxy/launcher.js` — запуск прокси + агента
- `src/koinon/KoinonBus.js` — межагентная шина
- `src/core/GiftMemory.js` — W-матрица (полная)
- `src/core/LivingMatrix.js` — живая матрица
