# Gift Telegram Bot — scaffold

Telegram-бот для Gift CLI. Создайте своего бота и подключите к gift.

## Быстрый старт

### 1. Создать бота в Telegram

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте `/newbot`
3. Введите имя бота (например: "My Gift Bot")
4. Введите username (например: `my_gift_bot`)
5. Скопируйте токен: `1234567890:ABCdef...`

### 2. Настроить переменные

```bash
export TELEGRAM_BOT_TOKEN="1234567890:ABCdef..."
export DEEPSEEK_API_KEY="sk-..."          # или
export ROUTERAI_API_KEY="sk-..."          # дешевле
```

### 3. Запустить

```bash
# Из директории gift/
node bot/server.js

# Или через Docker:
docker compose up bot
```

### 4. Использование в Telegram

- `/start` — приветствие
- `/switch ra` — переключить бэкенд на RouterAI
- `/switch ds` — на DeepSeek
- `/status` — текущий провайдер, баланс
- `/matrix` — W-матрица (если включён богословский режим)
- Любой текст — отправляется в LLM

## Структура

```
bot/
├── README.md          — эта инструкция
├── server.js          — точка входа (scaffold)
└── handlers/          — обработчики команд (создайте свои)
```

## Связь с Gift CLI

Бот использует тот же прокси что и `gift start`:
- Прокси на `http://127.0.0.1:3200`
- `/switch` в боте вызывает `/_proxy/mode`
- W-матрица — тот же SQLite файл

## Docker

```yaml
# docker-compose.yml (уже включён в корне gift/)
services:
  bot:
    build: .
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - ROUTERAI_API_KEY=${ROUTERAI_API_KEY}
    volumes:
      - ./data:/app/data    # W-матрица персистится
```
