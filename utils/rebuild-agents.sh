#!/bin/bash
# rebuild-agents.sh — Пересборка всех агентов из обновлённых Modelfiles
#
# Это НЕ переобучение (fine-tuning).
# Это обновление SYSTEM-промптов — системы ценностей агентов.
# Веса qwen2.5 не меняются. Меняется «кто они».
#
# Аналогия: не меняем мозг — обновляем призвание.
#
# Запуск: bash utils/rebuild-agents.sh
# Или отдельно: bash utils/rebuild-agents.sh adam

set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$DIR/data/agent-models"

rebuild_agent() {
  local name=$1
  local modelfile="$MODELS_DIR/Modelfile.$name"

  if [ ! -f "$modelfile" ]; then
    echo "⚠  $name: Modelfile не найден ($modelfile)"
    return 1
  fi

  echo "→ Пересборка $name..."
  ollama create "$name" -f "$modelfile" 2>&1 | tail -3

  # Проверить что модель появилась
  if ollama list 2>/dev/null | grep -q "^$name"; then
    echo "✓ $name готов"
  else
    echo "✗ $name: не появился в ollama list"
    return 1
  fi
}

# Список агентов для пересборки
AGENTS=("adam" "eva" "serafim" "bezalel")

if [ -n "$1" ]; then
  # Пересобрать конкретного
  rebuild_agent "$1"
else
  # Пересобрать всех
  echo "=== Пересборка агентов Онтологии Дара ==="
  echo "Это обновление призваний (SYSTEM prompt), не весов модели."
  echo ""
  for agent in "${AGENTS[@]}"; do
    rebuild_agent "$agent"
    echo ""
  done
  echo "=== Готово ==="
  ollama list | grep -E "^(adam|eva|serafim|bezalel)"
fi
