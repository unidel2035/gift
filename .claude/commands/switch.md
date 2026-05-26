Переключи бэкенд LLM прокси deepclaude. Аргумент: $ARGUMENTS

Если аргумент пустой — покажи текущий статус. Выполни:
```bash
curl -s http://127.0.0.1:3200/_proxy/status
```
Из ответа JSON покажи: "Провайдер: {label}, Модель: {model}, Запросов: {requests}"

Если аргумент указан — переключи бэкенд. Преобразуй: ra→routerai, ds→deepseek, or→openrouter, fw→fireworks. Выполни:
```bash
curl -sX POST http://127.0.0.1:3200/_proxy/mode -d "backend=<полное_имя>"
```
Из ответа JSON покажи: "{previous} → {mode} ({label}), Модель: {model}"

Бэкенды:
- ra — RouterAI (дешёвый, рубли, 360 моделей)
- ds — DeepSeek напрямую (Китай)
- or — OpenRouter
- fw — Fireworks AI
- anthropic — оригинальный Claude
