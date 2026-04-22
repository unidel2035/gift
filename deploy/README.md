# Деплой онтологии дара

Три сценария. Выбирай по потребности.

---

## 1. Локально (dev)

```bash
npm install
npm link
gift web              # портал на :3700
```

Открыть `http://localhost:3700` — чат с собором.
Для живого собора нужен `claude` CLI в PATH (он запускает subagents).

---

## 2. Docker — один сервер, один пользователь

```bash
docker compose up -d
# Портал:   http://localhost:3700
# Nous:     http://localhost:8089
docker compose logs -f gift-portal
docker compose down
```

**Ограничение:** внутри контейнера нет `claude` CLI, поэтому SSE-чат работает
только в `--static` режиме (живой собор требует claude subagent'ов).

Для живого собора в Docker:
1. Положи Claude CLI binary в `./deploy/bin/claude` (host)
2. Раскомментируй в `docker-compose.yml`:
   ```yaml
   volumes:
     - ./deploy/bin/claude:/usr/local/bin/claude:ro
     - ~/.claude:/root/.claude:ro
   ```
3. `docker compose up -d --build`

---

## 3. Публичный деплой (сервер root@173.249.2.184)

### a. Перенос кода

```bash
# с локальной машины
rsync -avz --exclude 'node_modules' --exclude '.git' \
  /home/unidel/gift/ root@173.249.2.184:/opt/gift/
ssh root@173.249.2.184
cd /opt/gift && npm install && npm link
```

### b. Systemd-юнит

```bash
# на сервере
cat > /etc/systemd/system/gift-portal.service <<'EOF'
[Unit]
Description=Gift Portal (conciliar chat)
After=network.target

[Service]
Type=simple
User=hive
WorkingDirectory=/opt/gift
ExecStart=/usr/bin/node utils/gift-portal-server.mjs
Restart=on-failure
Environment=PORT=3700
Environment=NOUS_URL=http://localhost:8089

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/gift-nous.service <<'EOF'
[Unit]
Description=Gift Nous (memory server)
After=network.target

[Service]
Type=simple
User=hive
WorkingDirectory=/opt/gift
ExecStart=/usr/bin/node utils/nous-server.mjs
Restart=on-failure
Environment=PORT=8089

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now gift-nous gift-portal
systemctl status gift-portal
```

### c. Nginx reverse-proxy

```nginx
# /etc/nginx/sites-available/gift
server {
    listen 443 ssl http2;
    server_name gift.koinon.online;

    ssl_certificate     /etc/letsencrypt/live/gift.koinon.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gift.koinon.online/privkey.pem;

    location / {
        proxy_pass http://localhost:3700;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE требует отключения буферизации
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
```

### d. Безопасность публичного портала

Портал по умолчанию **открытый**. Для продакшна добавить:

1. **Basic auth** на чат:
   ```nginx
   location /api/chat/stream {
       auth_basic "Κοινόν";
       auth_basic_user_file /etc/nginx/.htpasswd;
       proxy_pass http://localhost:3700;
   }
   ```

2. **Rate-limit** (чтобы не тратить Claude API):
   ```nginx
   limit_req_zone $binary_remote_addr zone=sobor:10m rate=10r/m;
   location /api/chat/stream { limit_req zone=sobor burst=3; ... }
   ```

3. **Telegram-бот как канал**: боты подключаются к nous через сервер-окно,
   не через публичный портал.

---

## Проверка после деплоя

```bash
curl http://localhost:3700/api/sessions | head
curl http://localhost:8089/summary       # если nous up
curl -N 'http://localhost:3700/api/chat/stream?q=/status'
```

---

## Обновление

```bash
cd /opt/gift
git pull
npm install
systemctl restart gift-portal gift-nous
# или через docker:
docker compose pull && docker compose up -d --build
```

---

## Роллбек

```bash
cd /opt/gift
git log --oneline -5    # найти предыдущий commit
git checkout <sha>
systemctl restart gift-portal
```

Onology-state в `data/` — шарится между версиями. Если новый код несовместим,
откат не потеряет матрицу.
