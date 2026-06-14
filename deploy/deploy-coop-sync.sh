#!/usr/bin/env bash
# Развернуть relay присутствия на сервере общины. Запускать ДИОНИСИЮ (рядом с живым ботом).
# Идемпотентно. Использование: bash deploy/deploy-coop-sync.sh [user@host] [/opt/gift]
set -e
HOST="${1:-root@173.249.2.184}"; DEST="${2:-/opt/gift}"
echo "→ relay на $HOST:$DEST (порт 8095)"
ssh "$HOST" "mkdir -p $DEST/utils $DEST/deploy"
scp utils/coop-sync-server.mjs "$HOST:$DEST/utils/"
scp deploy/coop-sync.service "$HOST:/etc/systemd/system/coop-sync.service"
ssh "$HOST" "sed -i 's|/opt/gift|$DEST|' /etc/systemd/system/coop-sync.service && systemctl daemon-reload && systemctl enable --now coop-sync && sleep 1 && curl -s localhost:8095/health"
echo ""; echo "✓ кентаврам: COOP_SYNC_URL=http://<host>:8095"
