# Arena AI Coding Agent (Python / FastAPI) — v0.7.0

A full-featured, production-ready AI Coding Agent system with an interactive modern UI, Server-Sent Events (SSE) live streaming, multi-file ChangeSet diff approval workflow, persistent background job worker, Git/GitHub workspaces, Playwright browser automation with unrestricted external web access, Project Definitions & Settings with real-time Auto-Save, and enterprise security.

---

## What's New in v0.7.0

1. **Prominent Hamburger Menu & Navigation**:
   - High-visibility hamburger menu button (`☰`) in the top navigation bar and sidebar header across desktop and mobile.
   - Quick direct `⚙️ Settings` button in the top bar.

2. **Persistent Model & Provider Selection**:
   - Your selected provider and model choices are automatically saved and preserved across browser refreshes.

3. **Universal Real-Time Auto-Save**:
   - All project settings, descriptions, instructions, agent rules, and environment secrets auto-save automatically with a visual `✓ Auto-saved` indicator.

4. **Project Definitions & Settings Management**:
   - Define custom project profiles with name, description, default provider, model, target branch, instructions, rules (`.agentrules`), and environment variables.

5. **Unrestricted External Web & Network Access**:
   - Playwright browser and terminal operations have unrestricted access to any external websites, APIs, external git remotes, pip repositories, and curl requests.

6. **In-UI Diff Approval & Rollback Engine**:
   - Multi-file ChangeSet staging with interactive visual diffs (green additions / red deletions).
   - In-chat inline diff cards with one-click **[Approve & Apply]** and **[Reject]** actions.
   - Snapshot backups and version rollback for any file or changeset.

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
