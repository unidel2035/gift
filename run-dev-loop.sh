#!/bin/bash
LOG=/home/hive/gift-worker/data/dev-loop-server.log
echo "[start $(date '+%Y-%m-%d %H:%M')]" >> $LOG
cd /home/hive/gift-worker && git pull origin main >> $LOG 2>&1
su - new -s /bin/bash -c '/home/new/gift-worker-run.sh' >> $LOG 2>&1
echo "[done $(date '+%Y-%m-%d %H:%M')]" >> $LOG
