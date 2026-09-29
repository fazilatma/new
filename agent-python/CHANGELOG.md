# Changelog

## 0.12.0 - Universal Proxy Gateway & Forward Proxy Routing, Sidebar Folding & Model Exporter

- **Interactive Model Test Details & Diagnostics Modal**: Clicking any row in the Model Health & Latency Test Results table now opens a dedicated diagnostics modal displaying full model information, the exact request sent (masked headers and JSON payload), direct and proxy-routed endpoints, rendered assistant response and reasoning traces, and the full raw JSON response with 1-click copy actions and live retesting.
- **Moved Active References Bar to Settings**: Removed the references section from the main chat viewport to maximize message viewing real estate, and relocated the full Cross-Chat & Cross-Project References management card into the Settings view.
- **Universal Proxy Traffic Routing for Model Responses**: Fixed proxy routing to support both standard forward proxies (`http://...`, `https://...`, `socks5://...`, `socks5h://...`) via HTTP client tunneling (`httpx.AsyncClient(proxy=...)`) and URL-rewriting gateways (like Cloudflare Workers `?url={url}` or `/proxy?target=`). Includes adaptive direct retry fallback on connectivity errors.
- **Unified Per-Provider and Global Proxy Settings**: Per-provider proxy overrides and global proxy settings now use the same unified proxy parser (`parse_proxy_setting`).
- **Browser Automation Proxy Routing**: Multi-tier HTTPX web fetching in browser automation now respects proxy configuration for unrestricted global web access.
- **Workspace Sidebar Folding & Closing**: Added collapse/fold toggle (`◀ بستن منو` / `📁 نمایش فایل‌ها`) for the workspace file tree sidebar with persistent state across sessions, plus an instant "✕ بستن پنجره" button to close the workspace panel and return to chat.
- **Dedicated Proxy Server Configuration**: Integrated first-class Proxy Server settings with default `https://proxy.fazilat-ma.workers.dev/?url={url}` for seamless routing of model endpoints, web searches, and browser operations; supports live connection testing and instant default reset.
- **Copy All AI Model Test Results**: Added 1-click export and copy actions for all AI model diagnostic tests in both structured Markdown Table and JSON formats, complete with status indicators, latency metrics, and diagnostic traces.
- **Test Suite Expansion**: Added automated pytest verification for proxy configuration, forward proxy client parsing, SOCKS5 support, URL template substitution, and testing endpoints (24/24 tests passing).

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
