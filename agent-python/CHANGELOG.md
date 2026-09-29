# Changelog

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
