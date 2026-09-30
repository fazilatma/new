# Changelog

All notable changes to Arena Agent. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`APP_VERSION` in `src/Bootstrap.php` is the single source of truth;
`/api/health` and `/api/diag` both report it.

---

## [2.0.0] — 2026-09-30

A ground-up rewrite, replacing the ported edition in `agent-php/`.

### Why

The ported app inherited a 347 KB single-file front end and, with it, the
assumption that `/api/...` would be routed to the application. On a host
without URL rewriting that assumption produced the web server's own 404 page,
which looked like an application bug and was diagnosed as one three times.

This version cannot fail that way: every URL it builds is
`index.php?p=/path`, which requires no rewriting, no `PATH_INFO`, no
`.htaccess` and no knowledge of the install directory. Assets are referenced
relatively, so a subdirectory install needs no configuration either.

### Added
- Six provider protocols behind one adapter interface: OpenAI and compatible
  gateways, Anthropic, Google Gemini, Ollama, Mistral, Azure OpenAI.
- Streaming chat over server-sent events, with conversations, message history
  and titles derived from the first message.
- Catalogue import that sniffs the file's shape instead of demanding one, plus
  base64 transport for hosts whose firewall rejects bodies containing API
  keys, and a `probe` mode that reports what arrived without saving it.
- Model discovery — ask a provider for its own list.
- Sandboxed workspace browser and editor; paths are resolved lexically and
  then checked against the root, so a traversal fails closed and a brand-new
  file in a brand-new folder still succeeds.
- Command execution, disabled by default, with a deny-list.
- API keys encrypted at rest (AES-256-GCM, falling back to libsodium).
- A diagnostics view and `/api/diag` reporting routing, database, folder
  permissions, PHP limits and whether POST bodies of several shapes and sizes
  survive the host.
- `bin/console.php` with `doctor`, `init`, `serve`, user management and
  catalogue import/export.
- A model picker that folds into a one-line summary on phones and at high
  zoom, remembering an explicit choice.

### Fixed during development
Three defects found by running the suite against real PHP 8.3, not by reading:
- **Every parameterised route silently failed to match.** The generated
  pattern contained `[^/]` inside a `/`-delimited expression, which terminated
  the delimiter. Patterns are now assembled from quoted literals and capture
  groups with a `#` delimiter.
- **Protocol inference ignored the `url` spelling**, so a catalogue using
  `url` instead of `baseUrl` imported every provider as generic OpenAI.
- **Creating a file in a folder that did not exist yet was rejected** as a
  traversal attempt, because `realpath()` returns `false` for a path that is
  not there.
