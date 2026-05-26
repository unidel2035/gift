Установи API-ключ для бэкенда LLM прокси. Аргумент: $ARGUMENTS

Формат: `/login <бэкенд> <ключ>`
Пример: `/login ra sk-PQcWfL67VhhX0hKC9BgoQzFrFcLAUYV_`

Преобразуй короткое имя бэкенда: ra→routerai, ds→deepseek, or→openrouter, fw→fireworks.

Из аргумента извлеки первое слово (бэкенд) и второе слово (ключ). Выполни:
```bash
curl -sX POST http://127.0.0.1:3200/_proxy/key -d "backend=<полное_имя>&key=<ключ>"
```

После установки ключа автоматически переключи на этот бэкенд:
```bash
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=<полное_имя>"
```

Покажи результат кратко: "Ключ установлен для <бэкенд>, переключено."

Если аргумент пустой — покажи справку:
```
/login ra <ключ>    — RouterAI (рубли, дешёвый)
/login ds <ключ>    — DeepSeek
/login or <ключ>    — OpenRouter
/login fw <ключ>    — Fireworks AI
```
