# Changelog

All notable changes to Arena Agent. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`APP_VERSION` in `src/Bootstrap.php` is the single source of truth;
`/api/health` and `/api/diag` both report it.

---

## [2.3.0] — 2026-09-30

Local AI installer and a more tolerant provider import.

### Added
- **Local AI installer** (`src/LocalAI.php`, `public/localai.html`, `/localai`):
  host scan (RAM/CPU/GPU/disk), root-free Ollama runtime install under
  `storage/localai/`, start/stop the server on 127.0.0.1, pull/remove models,
  and register them as a `Local Ollama` provider. Independent of `ARENA_SHELL`.
- Routes: `GET /api/localai/{host,runtime,catalog,models}`,
  `POST /api/localai/{install,pull,register}`,
  `POST /api/localai/runtime/{install,start,stop}`,
  `DELETE /api/localai/models/{name}`.
- Sidebar and providers toolbar links to the installer page.

### Fixed
- **Import reported twice as many models as it stored.** `Providers::save()`
  already persisted `models`; the import loop counted them again. Models are
  now stripped before `save()` and counted once.
- Import accepts more catalogue spellings: `type` / `provider` for protocol,
  `endpoint` for base URL, and `api_key` / `key` / `token` / `secret` for the
  credential. Protocol aliases include openrouter, together, groq, deepseek,
  local, lmstudio, and others common in shared catalogues.

## [2.2.0] — 2026-09-30

Git, run as real processes.

### Added
- **A Git view**: current branch and how far it is from its upstream, the
  index and the working tree as two lists, per-file stage / unstage / discard,
  a diff pane, a commit box, branch switching and creation, push and pull, and
  recent history.
- **Four more agent tools** — `git_status`, `git_diff`, `git_log` and
  `git_commit` — offered only once the workspace is actually a repository. The
  agent is told to read the diff before writing a commit message, and not to
  commit work it has not verified.
- Routes: `GET /api/git`, `/api/git/{status,diff,log,branches}`, and
  `POST /api/git/{init,stage,unstage,discard,commit,checkout,push,pull,remote}`
  plus `PUT /api/git/config`.
- A personal access token can be stored for https push and pull. It is
  encrypted at rest with the same key as the provider keys, injected into the
  remote URL for the duration of one command, never written to `.git/config`,
  and scrubbed out of anything shown to a person or returned by the API.
- Settings gains a git identity form and a remote form. A credential pasted
  into a remote URL is stripped before the URL is stored.

### Security
- Every git invocation uses `proc_open` with an **argument array**, so no
  shell is involved. A branch named `evil;touch-pwned` or a file named
  `a; touch pwned.txt; b.md` is one argument, not two commands. There is a
  test for exactly that.
- Git has its own switch (`ARENA_GIT`) rather than riding on `ARENA_SHELL`:
  running `git status` is not the same risk as running arbitrary shell, and
  most people will want one without the other.

### Fixed
Found by running against the real binary, and serious:
- **Exit codes were being discarded.** `proc_get_status()` reaps the status on
  the first poll after a process ends; every later read, including
  `proc_close()`, then reports something useless. Both `Shell::run()` and the
  git runner took the `proc_close()` value, so a *failed* push was reported as
  a success — the output said "Could not resolve host" and the return said
  `ok: true`. The exit code is now taken at the only moment it is valid.
- `git restore --staged` needs a HEAD, so unstaging before the very first
  commit silently did nothing. The right command is now chosen by asking
  whether the repository has any commits.
- Before the first commit git reports the branch as `## No commits yet on
  main`, which the status parser read as a branch called "No".
- `git commit` with an empty index says "nothing added to commit but untracked
  files present" when untracked files exist; only two of the three wordings
  were recognised, so that case surfaced as a generic failure instead of a
  409 explaining that nothing was staged.

### Development
- `agent-php/tools/phprun.mjs` gains `--spawn`, wiring PHP's `proc_open` to
  Node's `child_process` so code that shells out can be tested against the
  real binaries. Opt-in, because it lets the script under test run commands.
- `tools/devserver.mjs` now keeps its state in `.devstate/` on the host and
  installs the same spawn bridge, so the preview has a working terminal and a
  working git. Previously any attempt to spawn took the server down.

### Verified
`tools/tests/git.php` — 87 checks against git 2.39.5: the shell, python and
node; creating a repository; staging, unstaging, committing, discarding;
diffs including untracked files; branches; remotes; token storage and
scrubbing; and a **real push and pull** to a real bare repository. Plus the
101 agent checks and the 38 smoke checks, all still passing.

---

## [2.1.0] — 2026-09-30

Turns the chat application into an actual agent.

### Added
- **A tool-calling loop.** The model can ask for a tool, see the result, and
  carry on, up to twelve rounds. Progress is streamed as it happens: each
  step, each tool call with its arguments, each result, each proposed change.
- **Seven tools**, all going through the same guards the web interface uses:
  `list_files`, `read_file`, `search_files`, `write_file`, `edit_file`,
  `delete_file` and `run_command`. The last appears only when the host can
  actually run commands, and the model is told which tools it does not have.
- **Change approval.** By default the agent does not write. It proposes, and
  each proposal is stored with the previous contents and shown as a unified
  diff you can accept or reject. Applied changes can still be undone, because
  the previous contents are kept either way. `ask` can be switched to `auto`
  for people who would rather it just got on with it.
- **A diff engine** (`src/Diff.php`) producing the same output as `diff -u`,
  from pure PHP: common head and tail trimmed first, then a longest-common-
  subsequence over what remains, grouped into hunks with three lines of
  context.
- Routes: `GET /api/agent/tools`, `POST /api/agent/stream`, `GET /api/changes`,
  `GET /api/changes/{id}`, `POST /api/changes/{id}/{approve|reject|revert}`,
  `POST /api/changes/decide-all`, `PUT /api/changes/mode`.
- A **Changes** view with a colour-coded diff and per-change buttons, a
  pending-count badge in the sidebar, an agent-mode switch in the composer,
  collapsible tool cards in the transcript (failures open by themselves), and
  a list of the agent's tools in Settings.
- `tools/mockprovider.mjs`, a scripted OpenAI-compatible endpoint for driving
  the agent locally without a real provider. Development only.

### Notes on what this does and does not do
- A step that may contain tool calls is **not** token-streamed. A tool call is
  only usable once complete, and no provider streams them in a form worth
  reassembling across four wire formats — so each step's prose arrives whole
  and the live progress you watch is the tools. The plain chat at
  `/api/chat/stream` still streams token by token and is unchanged.
- Ollama cannot stream and call tools in the same request, so the adapter
  turns streaming off when tools are in play rather than silently getting
  neither.

### Changed
- SSE writing moved out of `Chat` into `src/Sse.php`, now shared.
- `messages` gains a `meta` column holding tool calls and results, so a
  reloaded conversation keeps the agent's working context. Added by an
  idempotent migration; existing databases are upgraded in place on boot.

### Verified
`tools/tests/agent.php` — 101 checks in real PHP 8.3 covering the diff engine,
the approval gate, every tool, the four wire formats in both directions, and
the loop itself driven by a scripted provider. Plus the original 38 in
`tools/tests/smoke.php`. The loop was also run through the live HTTP server
against a mock provider, end to end.

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
