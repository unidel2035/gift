#!/usr/bin/env bash
# Установщик окружения @unidel/gift для о. Сергия
# Запуск: bash setup.sh
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
step() { echo -e "\n${YELLOW}▶${NC} $1"; }

echo ""
echo "  Онтология Дара — установка окружения"
echo "  ======================================"
echo ""

# 1. Node.js
step "Проверяю Node.js..."
if ! command -v node &>/dev/null; then
  fail "Node.js не найден. Установите с https://nodejs.org (версия 18+)"
fi
NODE_VER=$(node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>/dev/null && echo ok || echo fail)
if [ "$NODE_VER" = "fail" ]; then
  fail "Нужен Node.js >= 18. Текущий: $(node -v)"
fi
ok "Node.js $(node -v)"

# 2. npm install
step "Устанавливаю зависимости проекта..."
cd "$(dirname "$0")"
npm install --silent
ok "Зависимости установлены"

# 3. Claude Code CLI
step "Проверяю Claude Code CLI..."
if ! command -v claude &>/dev/null; then
  echo "  Claude Code не найден, устанавливаю..."
  npm install -g @anthropic/claude-code
  ok "Claude Code установлен"
else
  ok "Claude Code $(claude --version 2>/dev/null | head -1)"
fi

# 4. SSH ключ для сервера (для анамнезиса)
step "Настраиваю SSH-доступ к серверу памяти..."
SERVER="root@173.249.2.184"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=no "$SERVER" true 2>/dev/null; then
  if [ ! -f ~/.ssh/id_ed25519 ]; then
    echo "  Создаю SSH ключ..."
    ssh-keygen -t ed25519 -C "gift-$(whoami)" -f ~/.ssh/id_ed25519 -N ""
    ok "SSH ключ создан"
  fi
  echo ""
  warn "Нужно добавить ключ на сервер. Выполни:"
  echo ""
  echo "    ssh-copy-id $SERVER"
  echo ""
  echo "  (потребуется пароль от сервера — один раз)"
  echo "  После этого запусти setup.sh снова или просто: claude"
  echo ""
  warn "Без SSH анамнезис-сервер будет недоступен, но Claude работает."
else
  ok "SSH-туннель к серверу памяти: доступен"
fi

# 5. Итог
echo ""
echo "  ══════════════════════════════════════"
echo -e "  ${GREEN}Готово. Запускай:${NC}"
echo ""
echo "    cd $(pwd)"
echo "    claude"
echo ""
echo "  При первом запуске Claude попросит войти"
echo "  через браузер — это займёт минуту."
echo "  ══════════════════════════════════════"
echo ""
