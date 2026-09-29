# Arena AI Coding Agent (Python / FastAPI) — v0.6.0

A full-featured, production-ready AI Coding Agent system with an interactive modern UI, Server-Sent Events (SSE) live streaming, multi-file ChangeSet diff approval workflow, persistent background job worker, Git/GitHub workspaces, Playwright browser automation with unrestricted external web access, Project Definitions & Settings, and enterprise security.

---

## What's New in v0.6.0

1. **Project Definitions & Settings Management**:
   - Define custom project profiles with:
     - Name & detailed description
     - Default AI Provider & Model
     - Target Git Branch
     - Project-specific instructions & system prompt additions
     - Agent behavioral rules (`.agentrules`)
     - Custom environment variables and quick commands
   - Dedicated **Project Settings** tab in UI with live configuration editor and 1-click project switching.
   - Dynamic prompt injection tailoring the AI agent's context to the active project definition.

2. **Unrestricted External Web & Network Access**:
   - Playwright browser and terminal operations have unrestricted access to any external websites, APIs, external git remotes, pip repositories, and curl requests.

3. **In-UI Diff Approval & Rollback Engine**:
   - Multi-file ChangeSet staging with interactive visual diffs (green additions / red deletions).
   - In-chat inline diff cards with one-click **[Approve & Apply]** and **[Reject]** actions.
   - Snapshot backups and version rollback for any file or changeset.

---

## Key Features & Architecture

### 1. Project Management & Configuration
- Create and manage multiple project definitions.
- Set default provider and model preferences per project.
- Configure project-specific instructions and agent rules.

### 2. Multi-Protocol Model & Provider Catalog
- Seamless support for:
  - **OpenAI-Compatible** (`/v1/chat/completions`)
  - **Anthropic Native** (`/v1/messages`)
  - **Gemini Native** (`generateContent`)
  - **Ollama Native** (`/api/chat`)
  - **Mistral Native**, **Azure OpenAI**, **Cloudflare AI**
- **Multi-Key Rotation**: Automatically rotates API keys per provider to manage rate limits.
- **Circuit Breaker**: Detects provider failures and automatically routes to configured fallback models.
- **Latency & Error Tracking**: Model health test runner in UI.

### 3. Persistent Background Worker & Job Queue
- SQLite WAL-mode job queue with concurrency semaphore (`MAX_CONCURRENT_JOBS`).
- **Server Restart Recovery**: Stuck `running` jobs are automatically recovered and re-queued.
- **Control Actions**: Cancel, Pause, Resume, and Manual Retry.
- Step-by-step tool execution timeline with live logs.
- Large output artifacts saved to disk (`data/job_outputs/`).

### 4. Enterprise Security & RBAC
- **PBKDF2 Password Hashing** with random cryptographic salt.
- **Role-Based Access Control (RBAC)**: Admin, Developer, Viewer.
- **Master Key Encryption**: Secrets encrypted at rest with AES-256 Fernet.
- **Log Sanitizer**: Automatic masking of API keys and Bearer tokens in all logs.

### 5. Git & GitHub Workspace
- Branch manager (list, create, switch, delete).
- Interactive 3-way merge conflict resolver.
- Commit staging, push with explicit approval modal, stashes, tags, and commit history graphs.
- Full GitHub API connector for Pull Requests (Create, Review, Merge) and GitHub Actions.

### 6. Playwright Browser Automation
- Chromium browser controller with full external web access.
- DOM content extraction, interactive form filling, clicks, and page screenshots.

### 7. Arena Modern UI
- Collapsible desktop sidebar and mobile sliding drawer.
- In-chat interactive tool cards with inline Diff Approve / Reject buttons.
- Real-time token streaming over SSE.
- Command Palette (`Ctrl+K` / `⌘K`).
- Full Dark and Light theme toggle.

---

## Quick Start

```bash
# 1. Setup virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the agent server
python main.py
```

The application runs on `http://0.0.0.0:8787`.

Default Admin Credentials:
- **Username**: `admin`
- **Password**: `admin123` *(change upon first login in Settings)*

---

## Running the Automated Test Suite

```bash
PYTHONPATH=. .venv/bin/pytest tests/ -v
```
