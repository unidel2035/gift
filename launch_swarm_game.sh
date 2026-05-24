#!/bin/bash
# launch_swarm_game.sh — Запуск игры: Serafim + Uncrashed/GTAV
#
# Три компонента:
#   1. Ollama (Serafim V2 Q8) — локальный LLM
#   2. Swarm Game Server (:8500) — игровой мир + API
#   3. Centaur Cockpit (:8300) — веб-интерфейс пилота
#
# Как играть:
#   Сын запускает Uncrashed (Free Flight) и летит на FPV.
#   Serafim анализирует обстановку и предлагает решения.
#   Сын в веб-интерфейсе (:8300) принимает/отклоняет предложения.
#   Все решения → обучающие данные для Serafim.

set -e
GIFT_DIR="/home/unidel/gift"
DIGITAL_TWIN="$GIFT_DIR/src/digital_twin"

echo "╔══════════════════════════════════════════════════╗"
echo "║  SWARM GAME — Serafim + Uncrashed               ║"
echo "╚══════════════════════════════════════════════════╝"

# 1. Ollama
echo ""
echo "[1/3] Проверка Ollama..."
if ! pgrep -x ollama > /dev/null; then
    echo "  Запускаю Ollama..."
    ollama serve > /tmp/ollama.log 2>&1 &
    sleep 5
fi
curl -s --max-time 3 http://localhost:11434/api/tags > /dev/null && echo "  ✅ Ollama готов" || echo "  ❌ Ollama не запустился"

# 2. Игровой сервер
echo ""
echo "[2/3] Запуск игрового сервера (:8500)..."
python3 "$DIGITAL_TWIN/swarm_game_server.py" --port 8500 --pilot-name "Сын" --pilot-age 14 &
GAME_PID=$!
sleep 3
echo "  ✅ Сервер: http://localhost:8500/api/game/state"

# 3. Веб-кокпит
echo ""
echo "[3/3] Запуск кокпита кентавра (:8300)..."
python3 -c "
import sys, threading, time
sys.path.insert(0, '$DIGITAL_TWIN')
from centaur_cockpit import CentaurCockpit, CentaurWebServer

cockpit = CentaurCockpit('son-1', 'Сын', 14)
web = CentaurWebServer(cockpit, port=8300)

# Запустить в фоне
t = threading.Thread(target=cockpit.start_mission, daemon=True)
t.start()

print('  ✅ Кокпит: http://localhost:8300')
web.start()
" &
COCKPIT_PID=$!
sleep 2

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ГОТОВО К ЗАПУСКУ                               ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Игровой API:  http://localhost:8500/api/game   ║"
echo "║  Кокпит:       http://localhost:8300            ║"
echo "║  Арена:        http://localhost:8200 (если заупщ)║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  🎮 Сын: запусти Uncrashed → Free Flight       ║"
echo "║  🤖 Serafim будет предлагать решения            ║"
echo "║  👤 В кокпите: ✅ принять / ❌ отклонить       ║"
echo "║  📊 Опыт → training_data.json                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Остановить: kill $GAME_PID $COCKPIT_PID"

# Cleanup on exit
trap "echo 'Остановка...'; kill $GAME_PID $COCKPIT_PID 2>/dev/null; exit" INT TERM

# Ждать
wait
