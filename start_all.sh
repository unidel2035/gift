#!/bin/bash
# start_all.sh — Serafim: полный запуск
# bash start_all.sh            # всё
# bash start_all.sh copilot    # копилот для Uncrashed
# bash start_all.sh flight     # 3D-симулятор
# bash start_all.sh sitl       # SITL + Суворов

GIFT="$(cd "$(dirname "$0")" && pwd)"
DT="$GIFT/src/digital_twin"
MODE="${1:-all}"

echo "╔══════════════════════════════════════════════╗"
echo "║  SERAFIM LAUNCH                              ║"
echo "╚══════════════════════════════════════════════╝"

# Проверить Ollama
if curl -s --max-time 2 http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama готов"
else
    echo "Запуск Ollama..."
    ollama serve > /tmp/ollama.log 2>&1 &
    sleep 5
fi

# Копилот для Uncrashed
start_copilot() {
    echo "─── Copilot :8600 ───"
    python3 "$DT/serafim_copilot_web.py" --port 8600 --pilot "Сын" &
    sleep 2
    echo "✅ http://localhost:8600 — вводи что видишь → Serafim советует"
}

# Цифровой двойник + 3D
start_flight() {
    echo "─── Flight :8101 ───"
    python3 "$DT/serafim_flight.py" --port 8101 --drone-id "serafim-1" &
    sleep 2
    echo "✅ http://localhost:8101 — 3D визуализация"
}

# SITL + Суворов
start_sitl() {
    echo "─── SITL+Суворов :8102 ───"
    python3 "$DT/serafim_sitl.py" --port 8102 &
    sleep 8
    echo "✅ http://localhost:8102 — ArduPilot + Serafim + Суворов"
}

case "$MODE" in
    all)     start_copilot; start_flight; start_sitl ;;
    copilot) start_copilot ;;
    flight)  start_flight ;;
    sitl)    start_sitl ;;
    *)       echo "Используй: bash start_all.sh [all|copilot|flight|sitl]" ;;
esac

echo ""
echo "Порты: Copilot=8600 | Flight=8101 | SITL=8102"
