# Arena AI Coding Agent — Production Deployment Guide

## 1. Quick Start with Docker Compose

```bash
cd agent-python
docker compose up -d --build
```

Access the UI at `http://your-server-ip:8787`.

---

## 2. Systemd Service Deployment on Linux VPS

### Step 1: Create Virtualenv and Install Dependencies
```bash
cd /opt/arena-agent/agent-python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium --with-deps
```

### Step 2: Systemd Unit File (`/etc/systemd/system/arena-agent.service`)
```ini
[Unit]
Description=Arena AI Coding Agent Service
After=network.target

[Service]
Type=simple
User=agentuser
Group=agentuser
WorkingDirectory=/opt/arena-agent/agent-python
ExecStart=/opt/arena-agent/agent-python/.venv/bin/python main.py
Restart=always
RestartSec=3
Environment="AGENT_ENV=production"
Environment="AUTH_ENABLED=true"
Environment="REQUIRE_FILE_APPROVAL=true"
Environment="MAX_CONCURRENT_JOBS=4"

[Install]
WantedBy=multi-user.target
```

### Step 3: Enable and Start Service
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now arena-agent
sudo systemctl status arena-agent
```

---

## 3. Reverse Proxy with Nginx & SSL

Configure Nginx with SSE (Server-Sent Events) buffering disabled and WebSocket upgrade headers:

```nginx
server {
    listen 80;
    server_name agent.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name agent.example.com;

    ssl_certificate /etc/letsencrypt/live/agent.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agent.example.com/privkey.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for real-time SSE streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

---

## 4. Security & Hardening Checklist

1. **Change Default Admin Password**:
   - Log into UI as `admin` / `admin123`.
   - Go to Security & Settings to update the password.
2. **Master Key Encryption**:
   - Master Key is automatically generated in `data/master.key` (or set via `AGENT_MASTER_KEY` environment variable).
   - Back up `data/master.key` safely.
3. **File Approval Workflow**:
   - Keep `REQUIRE_FILE_APPROVAL=true` in production to prevent unintended file modifications.
4. **Rate Limiting**:
   - API endpoints and login routes are rate-limited per IP automatically.
5. **Database Backups**:
   - Automatic SQLite WAL mode is enabled.
   - Set up daily backup cron:
     ```bash
     sqlite3 /opt/arena-agent/agent-python/data/agent.sqlite3 ".backup '/opt/backups/agent_$(date +%Y%m%d).sqlite3'"
     ```
