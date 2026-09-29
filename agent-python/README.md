# Arena AI Coding Agent (Python / FastAPI) — v0.8.0

A full-featured, production-ready AI Coding Agent system with an interactive modern UI, Server-Sent Events (SSE) live streaming, multi-file ChangeSet diff approval workflow, persistent background job worker, Git/GitHub workspaces, Playwright browser automation with unrestricted external web access, Project Definitions & Settings with real-time Auto-Save, and enterprise security.

---

## What's New in v0.8.0

1. **Enriched Code Editor & Project Explorer**:
   - **File Management**: Direct creation (`+📄` New File, `+📁` New Folder), rename, and permanent deletion of files/folders in the active workspace.
   - **Fast Search & Filter**: Real-time fuzzy search bar in the explorer tree.
   - **Tabbed Editing**: Multi-tab document manager with unsaved dirty indicators (`*`) and tab switching.
   - **Workspace Export**: One-click download of the complete workspace as a compressed `.zip` archive.
   - **Keyboard Shortcuts**: `Ctrl+S` / `Cmd+S` for quick saving, `Ctrl+K` for command palette.

2. **Enriched Agent Chat & Multi-Turn Conversations**:
   - **Prompt Preset Library**: One-click prompt chips for *Refactor Code*, *Write Unit Tests*, *Fix Bugs*, *Security Audit*, *Optimize Speed*, and *Explain Code*.
   - **Context Attachments**: Quick `@file` context injection button referencing the active editor file.
   - **Conversation History**: Multi-threaded chat history with save, switch, and delete actions.
   - **Message Actions**: One-click clipboard copy for any generated code or explanation.
   - **Streaming Controls**: Live stop/abort generation button with `AbortController`.

3. **Enriched Approvals & Change Sets**:
   - **Diff Modes**: Toggle between Unified and Split Diff views.
   - **Feedback Loop**: Reject changesets with custom feedback notes automatically fed back to the agent.
   - **Patch Export**: Download unified `.patch` files directly for external code reviews.
   - **Instant Rollback**: Revert any applied changeset or restore previous file snapshot versions.

4. **Enriched Terminal Console**:
   - **Command History**: Interactive `Up` / `Down` arrow key navigation for previously executed shell commands.
   - **Quick Action Scripts**: Preset buttons for `pytest -v`, `git status`, `ls -la`, `pip list`, `python -V`, and `df -h`.
   - **Process Manager**: Active background process list with one-click kill controls.
   - **Output Actions**: One-click copy output to clipboard and clear console.

5. **Enriched Git Version Control**:
   - **Branch Management**: Live branch switcher and new branch creation modal.
   - **Stash Management**: Quick `Stash` and `Pop Stash` buttons for clean working trees.
   - **Commit History**: Visual commit log with commit hashes, dates, authors, and messages.

6. **Enriched Playwright Browser Automation**:
   - **Interactive JavaScript Evaluation**: Run arbitrary JS expressions against active browser sessions.
   - **Page Previews & Screenshots**: Live screenshot viewer frame with download support.

7. **Enriched Observability, Telemetry & Logs**:
   - **Metrics Dashboard**: Live cards for Active Jobs, Completed Jobs, Failed Jobs, and Disk Usage.
   - **Log Filtering & Search**: Filter logs by level (`INFO`, `WARNING`, `ERROR`, `SECURITY`) and search term.
   - **Export Audit Logs**: Download full system telemetry in JSON or CSV format.

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

The application runs on `http://0.0.0.0:8000`.

Default Admin Credentials:
- **Username**: `admin`
- **Password**: `admin123` *(change upon first login in Settings)*

---

## Running the Automated Test Suite

```bash
PYTHONPATH=agent-python agent-python/.venv/bin/pytest agent-python/tests/ -v
```
