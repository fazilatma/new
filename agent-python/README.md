# Arena AI Coding Agent (Python / FastAPI)

A full-featured, production-ready AI Coding Agent system with an interactive modern UI, Server-Sent Events (SSE) live streaming, multi-file ChangeSet diff approval workflow, persistent background job worker, Git/GitHub workspaces, Playwright browser automation, and enterprise security.

---

## Key Features & Architecture

### 1. In-UI Diff Approval & Rollback Engine (Phase 4)
- **ChangeSet System**: Agent file writes and dangerous modifications are staged into a ChangeSet instead of being written directly.
- **Interactive Diff Viewer**: Colorized additions (green) and deletions (red) with hunk-by-hunk review.
- **Granular Actions**:
  - **Approve All**: Applies all staged changes atomically to disk.
  - **Reject All**: Discards pending changes.
  - **Approve / Reject Single File**: Approve only specific files within a multi-file ChangeSet.
  - **Rollback**: One-click rollback of any ChangeSet or restore previous version snapshots.
- **Automated Durability**: Version snapshots saved in SQLite (`file_versions`) and disk (`data/versions/`) on every modification.

### 2. Multi-Protocol Model & Provider Catalog (Phase 11)
- Seamless support for:
  - **OpenAI-Compatible** (`/v1/chat/completions`)
  - **Anthropic Native** (`/v1/messages`)
  - **Gemini Native** (`generateContent`)
  - **Ollama Native** (`/api/chat`)
  - **Mistral Native**, **Azure OpenAI**, **Cloudflare AI**
- **Multi-Key Rotation**: Automatically rotates API keys per provider to manage rate limits.
- **Circuit Breaker**: Detects provider failures and automatically routes to configured fallback models.
- **Latency & Error Tracking**: Model health test runner in UI.

### 3. Persistent Background Worker & Job Queue (Phase 2)
- SQLite WAL-mode job queue with concurrency semaphore (`MAX_CONCURRENT_JOBS`).
- **Server Restart Recovery**: Stuck `running` jobs are automatically recovered and re-queued.
- **Control Actions**: Cancel, Pause, Resume, and Manual Retry.
- Step-by-step tool execution timeline with live logs.
- Large output artifacts saved to disk (`data/job_outputs/`).

### 4. Enterprise Security & RBAC (Phases 1 & 12)
- **PBKDF2 Password Hashing** with random cryptographic salt.
- **Role-Based Access Control (RBAC)**:
  - **Admin**: Full system management, user management, environment secrets.
  - **Developer**: Workspace edits, chat, terminal commands, git workflow.
  - **Viewer**: Read-only inspection of files, logs, and job status.
- **Master Key Encryption**: Secrets encrypted at rest with AES-256 Fernet.
- **Log Sanitizer**: Automatic masking of API keys and Bearer tokens in all logs.
- **Rate Limiting & CSRF**: Per-IP sliding window protection.

### 5. Sandboxed Terminal Execution (Phase 5)
- Confined to active workspace directory with path-traversal prevention.
- Dangerous command protection (`rm -rf /`, `DROP TABLE`, `git push --force`) requiring explicit confirmation.
- Active process supervisor with manual kill button.
- Optional Docker container isolation mode.

### 6. Full Git & GitHub Workspace (Phases 6 & 7)
- Branch manager (list, create, switch, delete).
- Interactive 3-way merge conflict resolver.
- Commit staging, push with explicit approval modal, stashes, tags, and commit history graphs.
- Full GitHub API connector for Pull Requests (Create, Review, Merge) and GitHub Actions.

### 7. Playwright Browser Automation (Phase 8)
- Chromium sandbox browser controller.
- DOM content extraction, interactive form filling, clicks, and page screenshots.
- SSRF security blocking private network ranges (`127.0.0.0/8`, `10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`, `169.254.0.0/16`).

### 8. Arena Modern UI (Phases 3, 9 & 10)
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
