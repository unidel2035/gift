#!/bin/bash
# DeepClaude + КИС — запуск прокси и Claude Code
export DEEPSEEK_API_KEY=sk-6c45e2f605be470aa127a0ae6d74cc05
export ROUTERAI_API_KEY=sk-PQcWfL67VhhX0hKC9BgoQzFrFcLAUYV_

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# НЕ делаем cd — claude запустится в текущей директории пользователя

# Убить старый прокси если есть
for p in 3200 3201 3202; do
  pid=$(lsof -ti:$p 2>/dev/null)
  [ -n "$pid" ] && kill $pid 2>/dev/null
done
sleep 1

# 1. Запустить прокси с КИС
node "$SCRIPT_DIR/proxy/start-proxy.js" "https://api.deepseek.com/anthropic" "$DEEPSEEK_API_KEY" > /tmp/kis-proxy.log 2>&1 &
PROXY_PID=$!
sleep 3

# Прочитать порт из вывода
PROXY_PORT=$(head -1 /tmp/kis-proxy.log | grep -oE '^[0-9]+$' || echo "3200")

# 2. Переключить на DeepSeek
curl -sX POST http://127.0.0.1:$PROXY_PORT/_proxy/mode -d 'backend=deepseek' > /dev/null

# Получить текущий бэкенд
CURRENT_MODE=$(curl -s http://127.0.0.1:$PROXY_PORT/_proxy/status 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('label','DeepSeek'))" 2>/dev/null || echo "DeepSeek")

echo ""
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║  DeepClaude + КИС запущен                        ║"
echo "  ║  Прокси: http://127.0.0.1:$PROXY_PORT                   ║"
printf "  ║  Провайдер: %-37s ║\n" "$CURRENT_MODE"
echo "  ║  Иммунитет: 15 антител + 490 VDJ + 7 традиций   ║"
echo "  ║  /switch ra|ds|or|fw — переключить бэкенд        ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo ""

# 3. Запустить Claude Code через прокси
export ANTHROPIC_BASE_URL=http://127.0.0.1:$PROXY_PORT
export ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
export CLAUDE_CODE_EFFORT_LEVEL=max

# Убить прокси при выходе
trap "kill $PROXY_PID 2>/dev/null" EXIT

claude --dangerously-skip-permissions "$@"
