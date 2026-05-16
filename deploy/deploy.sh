#!/usr/bin/env bash
# deploy.sh — развёртывание онтологии дара на root@173.249.2.184
# Запускается с локальной машины, через SSH.
#
# Usage:
#   ./deploy/deploy.sh              — полный деплой
#   ./deploy/deploy.sh --update     — pull + restart
#   ./deploy/deploy.sh --status     — sanity check
#
# Требования на сервере:
#   - node 20+
#   - git, systemd
#   - пользователь hive существует
#   - /home/hive/gift — существует (git-репо)

set -euo pipefail

HOST="${GIFT_HOST:-root@173.249.2.184}"
REMOTE_DIR="/home/hive/gift"
MODE="${1:-full}"

ssh_exec() { ssh "$HOST" "$@"; }
scp_file() { scp "$1" "$HOST:$2"; }

step() { echo -e "\n▸ $1"; }

case "$MODE" in
  --status)
    step "Проверка сервера"
    ssh_exec "systemctl status gift-portal gift-nous --no-pager 2>&1 | head -30"
    ssh_exec "curl -s http://localhost:3700/api/sessions | head -c 200 && echo"
    ssh_exec "curl -s http://localhost:8089/summary | head -c 200 && echo"
    exit 0
    ;;

  --update)
    step "Pull + restart"
    ssh_exec "cd $REMOTE_DIR && git pull --rebase origin main 2>&1 | tail -5"
    ssh_exec "cd $REMOTE_DIR && npm install --omit=dev --no-audit 2>&1 | tail -3"
    ssh_exec "systemctl restart gift-nous gift-portal"
    ssh_exec "systemctl status gift-portal --no-pager | head -5"
    exit 0
    ;;

  full|--full)
    step "Полный деплой на $HOST"

    step "1/6 Pull последний код"
    ssh_exec "cd $REMOTE_DIR && git fetch origin main && git pull --rebase origin main 2>&1 | tail -5"

    step "2/6 npm install"
    ssh_exec "cd $REMOTE_DIR && npm install --omit=dev --no-audit 2>&1 | tail -5"

    step "3/6 Права и директории"
    ssh_exec "chown -R hive:hive $REMOTE_DIR && chmod +x $REMOTE_DIR/bin/gift $REMOTE_DIR/utils/*.mjs 2>/dev/null || true"
    ssh_exec "ln -sf $REMOTE_DIR/bin/gift /usr/local/bin/gift"

    step "4/6 systemd units"
    scp_file deploy/gift-nous.service /etc/systemd/system/gift-nous.service
    scp_file deploy/gift-portal.service /etc/systemd/system/gift-portal.service
    ssh_exec "systemctl daemon-reload && systemctl enable gift-nous gift-portal"

    step "5/6 Старт служб"
    ssh_exec "systemctl restart gift-nous gift-portal"
    sleep 3

    step "6/6 Sanity-check"
    ssh_exec "systemctl status gift-portal --no-pager | head -8"
    ssh_exec "curl -s --max-time 5 http://localhost:3700/api/sessions | head -c 200 && echo"

    echo -e "\n✓ Деплой завершён."
    echo "  Портал:  http://173.249.2.184:3700"
    echo "  Nous:    http://173.249.2.184:8089  (обычно за nginx)"
    echo "  Логи:    ssh $HOST journalctl -u gift-portal -f"
    ;;

  *)
    echo "Неизвестный режим: $MODE"
    echo "Использование: $0 [full|--update|--status]"
    exit 1
    ;;
esac
