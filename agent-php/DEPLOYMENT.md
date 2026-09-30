# Deployment — Arena Coding Agent (PHP edition)

## 1. Quick start (any host with shell access)

```bash
git clone <this repo> && cd agent-php
./install.sh
php bin/console.php serve 8080 0.0.0.0   # terminal 1
php bin/worker.php                        # terminal 2
```

Open `http://<host>:8080/`, log in as **admin / admin123**, change the password.

The built-in server is single-threaded — fine for one user, not for production.
Use Apache or nginx below for anything real.

---

## 2. Apache (mod_php or php-fpm)

```apache
<VirtualHost *:80>
    ServerName agent.example.com
    DocumentRoot /srv/arena/agent-php/public

    <Directory /srv/arena/agent-php/public>
        AllowOverride All
        Require all granted
    </Directory>

    # Never let the browser reach the data or storage directories.
    <Directory /srv/arena/agent-php/data>   Require all denied </Directory>
    <Directory /srv/arena/agent-php/storage>Require all denied </Directory>

    # SSE: no buffering, no compression, no timeout for the chat stream.
    SetEnvIfNoCase Request_URI "/api/chat/stream" no-gzip dont-vary
    ProxyTimeout 3600

    ErrorLog  /var/log/apache2/arena-error.log
    CustomLog /var/log/apache2/arena-access.log combined
</VirtualHost>
```

`public/.htaccess` already contains the rewrite rules; `AllowOverride All` is
what makes it effective. If your host disallows `.htaccess`, copy its
`RewriteRule` block into the vhost.

---

## 3. nginx + php-fpm

```nginx
server {
    listen 80;
    server_name agent.example.com;
    root /srv/arena/agent-php/public;
    index index.php index.html;

    client_max_body_size 64m;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;

        # Agent runs and SSE streams are long-lived.
        fastcgi_read_timeout 3600;

        # Critical for token streaming:
        fastcgi_buffering off;
        gzip off;
    }

    # data/ and storage/ are outside root already; belt and braces:
    location ~ ^/(data|storage|app|bin|migrations|scripts)/ { deny all; }
}
```

`php-fpm` pool tuning for long agent runs:

```ini
; /etc/php/8.3/fpm/pool.d/www.conf
request_terminate_timeout = 0
pm = dynamic
pm.max_children = 12
```

```ini
; /etc/php/8.3/fpm/php.ini
max_execution_time = 0
memory_limit = 512M
output_buffering = Off
zlib.output_compression = Off
upload_max_filesize = 64M
post_max_size = 64M
; proc_open MUST NOT appear here:
disable_functions =
```

---

## 4. Streaming checklist

If tokens arrive all at once instead of progressively, something in the chain is
buffering. In order of likelihood:

1. `zlib.output_compression = On` in php.ini → turn it **off**.
2. nginx `fastcgi_buffering on` (default) → `off`, or rely on the
   `X-Accel-Buffering: no` header the app already sends.
3. Apache `mod_deflate` compressing `text/event-stream` → the `SetEnvIfNoCase`
   line above disables it.
4. Cloudflare or another CDN in front → disable the proxy (grey cloud) for this
   hostname, or accept 2–3 s chunking.

Verify from the server itself:

```bash
curl -N -s -X POST http://127.0.0.1:8080/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello","provider":"openrouter","model":"..."}'
```

Events should appear one by one.

---

## 5. The background worker

**systemd (recommended)**

```ini
# /etc/systemd/system/arena-agent-worker.service
[Unit]
Description=Arena Coding Agent — background job worker
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/arena/agent-php
ExecStart=/usr/bin/php /srv/arena/agent-php/bin/worker.php
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now arena-agent-worker
journalctl -u arena-agent-worker -f
```

**supervisor**

```ini
[program:arena-agent-worker]
command=/usr/bin/php /srv/arena/agent-php/bin/worker.php
directory=/srv/arena/agent-php
user=www-data
autostart=true
autorestart=true
stderr_logfile=/var/log/arena-worker.err.log
stdout_logfile=/var/log/arena-worker.out.log
```

**cron only** (shared hosting without long-running processes)

```cron
* * * * * cd /srv/arena/agent-php && /usr/bin/php bin/worker.php --once >/dev/null 2>&1
```

With cron-only mode keep `AGENT_WORKER_AUTOSPAWN=true` so queued jobs still
start immediately when `proc_open()` is available.

---

## 6. Post-deploy smoke test

```bash
BASE=http://127.0.0.1:8080

curl -s $BASE/health                       # {"status":"ok","version":"1.3.2"}
curl -s $BASE/api/version
curl -s $BASE/api/auth/status

# log in and keep the cookie
curl -s -c /tmp/c.txt -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

curl -s -b /tmp/c.txt $BASE/api/system/capabilities   # PHP-edition extra
curl -s -b /tmp/c.txt $BASE/api/workspaces
curl -s -b /tmp/c.txt $BASE/api/providers | head -c 400

# real shell (the whole point of this edition)
curl -s -b /tmp/c.txt -X POST $BASE/api/terminal/exec \
  -H 'Content-Type: application/json' \
  -d '{"command":"python3 -c \"print(6*7)\""}'
# → {"command":"...","exitCode":0,"stdout":"42\n","stderr":"","durationMs":…,"mode":"host"}

# write + execute a file
curl -s -b /tmp/c.txt -X PUT $BASE/api/workspace/file \
  -H 'Content-Type: application/json' \
  -d '{"path":"hello.py","content":"print(\"hi\")"}'
curl -s -b /tmp/c.txt -X POST $BASE/api/workspace/execute \
  -H 'Content-Type: application/json' -d '{"path":"hello.py"}'

# git, browser, jobs
curl -s -b /tmp/c.txt $BASE/api/git/status
curl -s -b /tmp/c.txt -X POST $BASE/api/browser/navigate \
  -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
curl -s -b /tmp/c.txt $BASE/api/jobs/stats
```

---

## 6b. Local AI runtime

```bash
php bin/console.php ai:host                 # RAM / CPU / GPU / disk / engine
php bin/console.php ai:recommend '{"tasks":["code","agent"],"ramBudgetGb":8}'
php bin/console.php ai:install qwen2.5-coder:7b
curl -s localhost:8080/api/localai/models | jq .
```

The runtime installs **without root** into `storage/localai/` and listens on
`127.0.0.1:11434`. Keep that port closed to the outside world — it has no auth
of its own. The install job needs `tar`, outbound HTTPS to `ollama.com`, and
free disk for the model. Under systemd add:

```ini
Environment=AGENT_LOCALAI_DIR=/var/lib/arena-agent/localai
Environment=OLLAMA_MODELS=/var/lib/arena-agent/localai/models
```

and make sure the unit's `ReadWritePaths` covers that directory. For the web
process, `php bin/console.php ai:serve` (or the wizard's ▶️ button) starts the
engine detached with `setsid`, so it survives an FPM reload.

---

## 7. Hardening

* `chmod 600 .env data/master.key data/environment.json`
* `chown -R www-data:www-data data storage` and `chmod 750` them
* Put the site behind TLS (the session cookie sets `Secure` automatically when
  it sees HTTPS or `X-Forwarded-Proto: https`).
* Set `CORS_ORIGINS=https://agent.example.com` instead of `*` once deployed.
* Keep `AUTH_ENABLED=true`. Consider also setting `AGENT_AUTH_TOKEN` for
  machine clients.
* If the host is multi-tenant, set `DOCKER_SANDBOX_ENABLED=true` so every shell
  command runs in a throwaway `python:3.11-slim` container with the workspace
  bind-mounted at `/workspace` (1 GB RAM, 2 CPUs).
* Back up `data/agent.db` and `storage/workspaces/` — that is the entire state.

---

## 8. Upgrading

```bash
git pull
php bin/console.php migrate     # idempotent: CREATE TABLE IF NOT EXISTS …
sudo systemctl restart arena-agent-worker php8.3-fpm
```

`data/`, `storage/` and `.env` are never touched by an upgrade.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `500` with an empty page | Check `storage/php-error.log`; usually a missing extension. |
| Terminal returns exit 126 `proc_open() is disabled` | Remove `proc_open` from `disable_functions` in php.ini and restart php-fpm. |
| `pdo_sqlite extension (required…)` in doctor | `apt install php8.3-sqlite3` (or the distro equivalent). |
| Tokens arrive in one lump | See §4. |
| "database is locked" | Another process holds a write lock; the DB is in WAL mode, so this means a stuck worker — restart it. |
| Browser tool returns a synthetic wireframe | No Playwright and no Chrome/Chromium found. Install Playwright (§ README 1). |
| Git routes say git is unavailable | `git` is not on `PATH` for the web user, or `proc_open` is disabled. |
| Jobs stay `queued` | Worker not running: `systemctl status arena-agent-worker`, or add the cron entry in §5. |
