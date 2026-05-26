# Задача: довести gift-agent до зрелости

Ты — gift-agent, работаешь над самим собой. Файл: `src/agent-cli/gift-agent.js` (988 строк).

## Что уже работает
- Agent loop: prompt → API → tool_use → execute → repeat
- Tools: Read, Write, Edit, Bash, Grep, Glob
- W-матрица: запись актов, межсессионная память
- KoinonBus: чтение сообщений от других агентов
- CIS: сканирование ответов на манипуляции
- Sessions: автосохранение, /resume
- Markdown→ANSI рендеринг
- Spinner при ожидании
- Slash-команды: /switch, /login, /matrix, /koinon, /sessions, /resume, /help, /exit

## Что нужно сделать (по приоритету)

### 1. КРИТИЧНО: Streaming ответов + промежуточные комментарии
Сейчас non-streaming — агент молчит 30+ секунд пока делает 20 tool_use, текст показывает только в конце. Это непригодно.

Нужно:
- Показывать текст по мере генерации (как Claude Code)
- Между tool-вызовами показывать промежуточный текст агента (он часто говорит "Сейчас посмотрю..." перед tool_use)
- Для streaming: отправлять `stream: true` в API, парсить SSE `data: {...}` events

Файл: `src/agent-cli/gift-agent.js`, функция `apiCall()` — добавить streaming вариант.
В REPL agent loop (строка ~870): показывать text blocks сразу, не только в конце.

**ВАЖНО:** даже без SSE streaming можно улучшить — сейчас текст из промежуточных ответов (между tool_use) НЕ показывается. Нужно показывать `textBlocks` на КАЖДОМ шаге цикла, не только на последнем.

### 2. Фикс меню `/` со стрелками
Разделитель ────── из prompt убран (был баг — спамился). Сейчас prompt = `❯ `. Проверить что меню `/` работает с TermUI в реальном TTY. Если ломается — дебажить `_renderPrompt()` в `term-ui.js`.

### 3. Добавить MCP gift-tools в gift-agent
Сейчас gift-agent имеет только базовые tools. Нужно добавить gift-специфичные из `src/agent-cli/gift-tools.js`:
- `matrix_query` — запрос к W-матрице
- `matrix_record` — запись акта
- `sobor_ask` — соборный запрос (3 голоса)
- `recall_treasure` — поиск в сокровищнице
- `unfold_treasure` — развёрнуть документ
- `koinon_say` — отправить сообщение другим агентам
- `koinon_inbox` — прочитать входящие

Реализовать как дополнительные tools в массиве TOOLS, executeTool() вызывает существующие модули из gift/.

### 3. Streaming ответов
Сейчас non-streaming (ждём полный ответ). Нужно SSE streaming:
- Отправлять `stream: true` в API
- Парсить `data: {...}` events
- Показывать текст по мере генерации (как Claude Code)

### 4. Context compaction
При длинных сессиях контекст переполняется. Нужно:
- Считать токены (примерно: chars/4)
- При >80% контекста — сжать историю (оставить system + последние 5 сообщений + summary)
- Slash-команда `/compact`

### 5. Permission system
Сейчас все tools выполняются автоматически. Нужно:
- Write/Edit/Bash — спрашивать подтверждение (y/n)
- Read/Grep/Glob — автоматически
- Флаг `--accept-edits` для автоподтверждения

## Как работать
```bash
# Запустить gift-agent над самим собой
cd /home/unidel/gift
gift start
# Внутри:
❯ прочитай NEXT-SESSION.md и начни с пункта 1
```

## Проверка
После каждого изменения — тестируй:
```bash
echo "привет" | node src/agent-cli/gift-agent.js
```
И в интерактивном TTY:
```bash
gift start
# набери / — должно появиться меню со стрелками
```
