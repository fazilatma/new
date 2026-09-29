# Changelog

## 0.15.0 - PHP Scripting & Execution Support, Arena Agent Structured Agentic Coding Workflow & Collapsible Step Drawers

- **PHP Language & Execution Engine Support**:
  - Full support for writing, editing, auto-detecting, previewing, and executing PHP scripts (`.php`, `clean_lang == "php"`, `<?php ... ?>`).
  - PHP execution integrated in `/api/workspace/execute`, workspace file runner, and self-healing execution loop (`php '{filename}'`).
  - Added dedicated PHP file icon (`🐘`), syntax highlight mapping, and one-click "Save to Workspace" preset in chat code blocks.
  - Full-screen Live Execution modal support with PHP CLI runtime output inspector.
- **Arena Agent 4-Stage Structured Coding Workflow**:
  - **1. Goal & Intent Announcement (اعلام هدف و رویکرد)**: The agent begins by explicitly declaring its objective and planned strategy.
  - **2. Step-by-Step Work Plan (برنامه کاری مرحله‌ای)**: Explicit numbered execution roadmap (`### 📋 برنامه کاری (Work Plan)`) presented in a prominent highlighted workplan card.
  - **3. Collapsible Step Execution Drawers (کشوهای تاشوی مرحله‌ای)**:
    - Multi-step execution details, intermediate results, tools executed, and error tracebacks are encapsulated inside clean collapsible accordion drawers (`<details class="agent-step-drawer" open>`).
    - Interactive summary bar (`<summary class="agent-step-summary">`) with numbered step badges, title, expandable/collapsible toggle chevron, and live status badges (`✅ تکمیل شد (Done)`, `⏳ در حال انجام (Running)`, `⚠️ اصلاح خودکار (Healed)`).
    - Allows users to collapse or expand individual steps at will to keep the conversation clean, readable, and structured exactly like Arena Agent.
  - **4. Accomplishments & Deliverables Summary (خلاصه کارهای انجام‌شده)**:
    - Clean concluding report (`### 🏁 خلاصه کارهای انجام‌شده (Accomplishments)`) summarizing all files created, tests run, and verified results.
- **Test Suite Expansion**: Added automated pytest verification for PHP file auto-detection and execution command routing, as well as Arena Agent workflow system prompt requirements (34/34 tests passing).

## 0.14.0 - Autonomous Code Execution & Self-Healing Loop, Full-Screen Execution & Live Render View

- **Autonomous Code Execution Engine**: After the agent generates or updates code files in the workspace (Python, Bash/Shell, Node.js, TypeScript, or HTML), the platform automatically executes the code inside the active workspace environment.
- **Self-Healing Error Correction Loop**: Automatically inspects exit codes, standard output, and standard error tracebacks. If an error or exception occurs (Exit Code != 0), the full error traceback is immediately fed back into the LLM context with a diagnostic prompt. The agent analyzes the failure, fixes all identified bugs, saves the updated file, and re-executes in an autonomous repair loop (up to 3 iterations) until the code runs cleanly with Exit Code 0 and produces valid output.
- **Real-Time Streaming Self-Healing Feedback**: Yields live SSE events (`execution_running`, `execution_fixing`, `execution_healed`, `render_preview_ready`, and `execution_result`) so users observe the autonomous execution, traceback analysis, and self-healing progress in real time directly within the chat message stream.
- **Dedicated Full-Screen Execution & Live Render Modal (`#fullScreenRenderModal`)**:
  - Full-screen distraction-free interactive viewer for both script execution and live web rendering.
  - **Responsive Device Viewport Switcher**: Instantly simulate live web apps on **Desktop (100%)**, **Laptop (1024px)**, **Tablet (768px)**, and **Mobile (375px)** inside an isolated sandboxed iframe.
  - **High-Contrast Dark Terminal Console**: Displays command executed, duration in milliseconds, exit code badge (`Exit 0 (Success)` / `Exit 1 (Failed)`), syntax-colored stdout, and highlighted stderr/tracebacks.
  - **Side-by-Side Code Split View & Live Editor**: Toggleable source code inspector with live line counter, allowing inline code edits and 1-click **"💾 ذخیره و اجرا (Save & Re-run)"** or `Ctrl+Enter` shortcut execution.
  - Quick action controls: `▶️ اجرای مجدد (Run / Rerun)`, `🔄 بازخوانی (Reload Preview)`, `📋 کپی (Copy Output)`, `📥 دانلود (Download)`, and `✕ بستن (ESC)`.
- **Integrated Full-Screen Entry Points**: Added one-click `⛶ تمام‌صفحه` launch buttons across Chat execution feedback cards, the Session Folder Explorer view, Workspace file cards, and the Advanced File Inspection modal.
- **Test Suite Expansion**: Added automated pytest verification for code file metadata extraction, script execution with traceback capture, HTML live preview generation, autonomous self-healing execution loops, and streaming SSE repair events (32/32 tests passing).

## 0.13.0 - True Real-Time LLM Token Streaming, Network Resilience & Simplified Project Creation

- **True Upstream Real-Time LLM Token Streaming**: Implemented native token streaming (`stream_call_provider_api` and `stream_complete_chat`) connecting directly to upstream provider SSE streams (OpenAI-compatible, OpenRouter, Anthropic, Ollama, Groq, Mistral). Tokens and reasoning traces (`<think>...</think>`) stream to the browser in real time without buffering delays, eliminating long HTTP blocking and socket timeouts.
- **Resolution of "Request Failed: network error"**: Resolved the 95% chat failure rate by adding anti-buffering reverse proxy headers (`X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`), adaptive proxy-to-direct fallback, and resilient error recovery with 1-click retry (`🔄 تلاش مجدد`).
- **Live Tool Progress Indicator**: While the agent executes workspace file or terminal tools between streaming steps, real-time status indicators (`⚙️ در حال اجرای ابزار ...`) provide continuous live feedback so connections never appear frozen.
- **Simplified 1-Click Project Creation**: Redesigned the New Project creation modal to be fast and effortless. Users only need to enter the Project Name (and optional short description) for instant 1-click creation. All non-essential, tedious parameters (Default Provider, Default Model, Default Target Branch, Custom System Instructions, Agent Rules) have been moved into a clean, collapsible **"⚙️ تنظیمات پیشرفته و اختیاری"** drawer with smart defaults.
- **Test Suite Expansion**: Added automated pytest verification for true SSE streaming headers and 1-click project creation with minimal fields (27/27 tests passing).

## 0.12.0 - Session Workspace Folder View, Advanced File Modal, Execution Engine & Universal Proxy Gateway

- **Intuitive Session Workspace Folder Explorer View**: Files created by the AI agent in the chat session's dedicated workspace (`session_{convId}`) are now displayed in a clean, standard folder & file explorer view with file type icons, formatted sizes, extensions, search filtering, and quick action chips (`▶ اجرا`, `🔍 باز کردن`, `📥 دانلود`, `🗑️ حذف`).
- **Advanced Workspace File Details, Edit & Execution Modal**: Clicking any file card or item opens an advanced modal featuring:
  - Full file metadata (relative path, formatted size, MIME format).
  - Code Editor with line numbers, line/character counters, syntax editing, and direct save capability.
  - Multi-format Live Preview for HTML (iframe sandbox), Markdown (rendered HTML), Image viewer, CSV data table, Audio player, Video player, and PDF viewer.
  - Interactive Action Toolbar: `▶️ اجرا (Run)`, `💾 ذخیره (Save)`, `👁️ پیش‌نمایش (Preview)`, `📝 کد منبع (Source Code)`, `📋 کپی (Copy)`, `📥 دانلود (Download)`, `✨ ارجاع در چت (Explain in Chat)`, and `🗑️ حذف (Delete)`.
  - Built-in Execution Console Drawer displaying real-time command execution, exit codes (`Exit 0`), latency (`XXms`), stdout, and stderr with copy and clear actions.
- **Session Workspace Execution Routing & Path Traversal Fix**: Resolved file execution path traversal and `Failed to fetch` errors by introducing automatic session workspace activation via `conversation_id`, directory-aware execution, and handling for both relative and absolute paths.
- **Interactive Model Test Details & Diagnostics Modal**: Clicking any row in the Model Health & Latency Test Results table opens a dedicated diagnostics modal displaying full model information, the exact request sent (masked headers and JSON payload), direct and proxy-routed endpoints, rendered assistant response and reasoning traces, and the full raw JSON response with 1-click copy actions and live retesting.
- **Universal Proxy Traffic Routing for Model Responses**: Fixed proxy routing to support both standard forward proxies (`http://...`, `https://...`, `socks5://...`, `socks5h://...`) via HTTP client tunneling (`httpx.AsyncClient(proxy=...)`) and URL-rewriting gateways (like Cloudflare Workers `?url={url}` or `/proxy?target=`). Includes adaptive direct retry fallback on connectivity errors.
- **Dedicated Proxy Server Configuration**: Integrated first-class Proxy Server settings with default `https://proxy.fazilat-ma.workers.dev/?url={url}` for seamless routing of model endpoints, web searches, and browser operations; supports live connection testing and instant default reset.
- **Copy All AI Model Test Results**: Added 1-click export and copy actions for all AI model diagnostic tests in both structured Markdown Table and JSON formats, complete with status indicators, latency metrics, and diagnostic traces.
- **Test Suite Expansion**: Added automated pytest verification for session workspace folder listing, file execution routing, proxy configuration, forward proxy client parsing, and testing endpoints (25/25 tests passing).

## 0.11.0 - RTL Persian Typography, Isolated LTR Terminals, Message Sync & Edit Lifecycle

- **Enriched File Management & Explorer**: Added one-click creation for files and folders (`+📄`, `+📁`), file renaming, deletion, file tree real-time fuzzy search filter, and full workspace zip archive export (`/api/workspace/export-zip`).
- **Tabbed Code Editor**: Multi-tab document management with unsaved change indicators (`*`), line & character stats, `Ctrl+S` quick save shortcut, and direct "Explain in Chat" context transfer.
- **Chat Prompt Presets & History**: Added 6 one-click preset prompt chips (*Refactor Code*, *Write Unit Tests*, *Fix Bugs*, *Security Audit*, *Optimize Speed*, *Explain Code*), `@file` context attachment chip, multi-turn threaded conversation manager (save, switch, delete), and per-message copy buttons.
- **ChangeSet Reviews & Patch Export**: Support for toggling Diff view modes (Unified / Split), custom rejection feedback notes passed directly back into the agent context, unified `.patch` file export, and instant rollback.
- **Terminal History & Quick Action Chips**: Interactive Up/Down arrow key command history navigation, quick action preset chips (`pytest -v`, `git status`, `ls -la`, `pip list`, `python -V`, `df -h`), copy terminal output, and active process management with kill switch.
- **Git Version Control Upgrades**: Branch manager with new branch dialog, stash changes and pop stash controls, and visual commit log viewer.
- **Playwright Browser JS Evaluation**: Support for running arbitrary JavaScript expressions directly in active browser sessions alongside live DOM and screenshot previews.
- **Observability Export**: Added one-click export for system logs in both JSON and CSV formats.

## 0.7.0 - UI Navigation, Model Selection Persistence & Universal Auto-Save

- **Prominent Hamburger & Navigation Button**: Added an always-visible hamburger menu button (`☰`) in the top navigation bar and sidebar header for quick access across both desktop and mobile layouts.
- **Persistent Model & Provider Selection**: Selected provider and model are automatically saved to `localStorage` and preserved across page refreshes, preventing unwanted resets to previous defaults.
- **Universal Auto-Save**: Project configuration, custom instructions, agent rules, and environment secrets auto-save in real time as changes are typed, with a visual `✓ Auto-saved` status indicator.
- **Direct Settings Shortcut**: Quick `⚙️ Settings` button in top bar for instant access to security and configuration.
- **Provider & Model Catalog UI**: Full provider and model catalog view with live endpoint testing, JSON file and text import/export, and circuit breaker resets.

## 0.6.0 - Project Definitions & Unrestricted External Access

- **Project Management Engine**: Full project configuration with name, description, path, default provider, default model, default branch, custom system prompt instructions, agent rules (`.agentrules`), environment variables, and quick commands.
- **Project Settings in UI**: Dedicated Project Settings tab with live configuration editor, project switcher, creation dialog, and active project indicator.
- **Unrestricted Web & External Access**: Removed external sandbox barriers, allowing Playwright browser and terminal executions full access to any external websites, APIs, pip packages, git remotes, and curl commands.
- **Dynamic System Prompt**: Chat loop dynamically incorporates active project description, custom guidelines, and behavioral rules.
- **Automated Tests**: Added project CRUD and configuration tests.

## 0.5.0 - Arena Agent Full Suite & Diff Approval Engine

- **Phase 1: Full Authentication & Security**: Multi-user SQLite storage, PBKDF2 password hashing with salt, Session token management, RBAC (Admin, Developer, Viewer), Security audit logging, Token masking in logs, Rate limiting, CSRF protection.
- **Phase 2: Persistent Worker & Job Queue**: Concurrency semaphore with restart crash recovery, Cancel/Pause/Resume/Retry workflow, Step timeline, Job outputs persisted to disk, Prune old jobs.
- **Phase 3: Professional Code Editor**: Project tree, Tabbed editor, Line numbering, Unified diff preview, Dirty change tracking, UTF-8/LF status.
- **Phase 4: Change Set & Approval System**: Unified & Side-by-side diff generation, Multi-file Changeset staging, In-chat inline Diff Cards with Approve/Reject actions, Rollback snapshots and Historical Version comparison.
- **Phase 5: Sandboxed Terminal**: Workspace-confined subprocess supervisor, Docker container sandbox support, Dangerous commands blocklist and confirmation, Active process tracking and kill switch.
- **Phase 6: Full Git Version Control**: Branch switching/creation/deletion, Staging, Stash/Apply, Merge conflict resolver, Push confirmation.
- **Phase 7: GitHub Workspace**: Repositories, Branches, Pull Requests (Create, Review, Merge), Actions and Issues management.
- **Phase 8: Playwright Browser Automation**: Multi-tab Chromium sandbox, DOM text extraction, Screenshot capture.
- **Phase 9: Arena Modern UI**: Collapsible sidebar, Mobile drawer, Command Palette (`Ctrl+K`), Dark/Light themes, In-chat interactive cards, Active Provider/Model indicators.
- **Phase 10: Live Chat Streaming**: Server-Sent Events (SSE) streaming token generation, In-chat tool call timeline, Stop streaming controls.
- **Phase 11: Multi-Protocol Providers**: OpenAI-compatible, Anthropic, Gemini, Ollama, Mistral native adapters, Multi-key rotation, Circuit Breaker, Model health testing.
- **Phase 12: Secrets Encryption & Proxy**: Master Key AES-256 encryption at rest, Key masking, SSRF-safe proxy support.
- **Phase 13: Observability & Logs**: Structured logging ring buffer, System metrics (CPU, RAM, Disk, Active jobs), Log level and search filtering.
- **Phase 14: Workspace Management**: Multi-workspace switcher, Templates (FastAPI, React/Vite, Python CLI, Node), Instructions and `.agentrules`.

## 0.4.0 - Connector Enhancements

- Added GitHub repository and file browsing.
- Added HTTP fetch connector.
- Added session cookies.

## 0.3.0 - Agent Chat Foundation

- Added provider-routed chat API and basic tool loop.
- Added workspace file tools and terminal execution.

## 0.2.0 - Management Console

- Added provider/model dashboard and CRUD.

## 0.1.0 - Foundation

- Initial FastAPI architecture.
