# Dockerfile — образ онтологии дара
# Строит миниатюру системы: gift CLI + portal + nous + (опц) Claude CLI.
#
# Сборка:  docker build -t unidel/gift:latest .
# Запуск:  docker run -p 3700:3700 -p 8089:8089 unidel/gift:latest
# Или через docker-compose.

FROM node:22-alpine

LABEL org.opencontainers.image.source="https://github.com/unidel2035/gift"
LABEL org.opencontainers.image.description="Онтология дара — соборная модель (CAT-9)"
LABEL org.opencontainers.image.licenses="MIT"

# Системные зависимости (git, bash, curl для хуков)
RUN apk add --no-cache git bash curl

WORKDIR /app

# Зависимости — сначала (для кэша слоя)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

# Код
COPY . .

# Make gift CLI доступен глобально
RUN chmod +x bin/gift utils/*.mjs benchmarks/*.mjs || true
RUN ln -sf /app/bin/gift /usr/local/bin/gift

# Порты: portal + nous
EXPOSE 3700 8089

# По умолчанию — portal. Запустить nous отдельно через docker-compose.
ENV PORT=3700
ENV NOUS_URL=http://localhost:8089

CMD ["node", "utils/gift-portal-server.mjs"]
