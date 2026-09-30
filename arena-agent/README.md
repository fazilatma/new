# Arena Agent

A self-hosted, multi-provider AI chat and coding workspace in plain PHP.
No Composer, no build step, no framework — copy the folder to a host and open it.

Version **2.1.0**. See [CHANGELOG.md](CHANGELOG.md).

---

## Why this exists

This is a ground-up rewrite. The previous edition worked locally and then
failed on a real shared host with the web server's own *page not found* page,
because the front end assumed URL rewriting was available. Three successive
fixes each addressed a symptom. The rewrite removes the assumption instead.

**Every URL the app builds looks like this:**

```
index.php?p=/api/providers
```

That form needs no `mod_rewrite`, no `AcceptPathInfo`, no `.htaccess`, no
virtual host, and no knowledge of which directory the app was installed in.
If your host can execute a `.php` file, the app works. Pretty URLs still work
when the host supports them — they are a bonus, never a requirement.

Assets are referenced relatively (`assets/app.css`), so they resolve correctly
whether the app sits at `/`, `/agent/`, or `/clients/acme/tools/agent/`.

---

## Installing

1. Copy this directory anywhere your host serves PHP 8.1 or newer.
2. Make `data/` and `storage/` writable by the web server (often `0775`).
3. Open the folder in a browser. Sign in as `admin` / `admin`.
4. Change the password in **تنظیمات → تغییر گذرواژه**.

Optionally copy `.env.example` to `.env` first to set the initial credentials,
switch authentication off for a private install, or enable the terminal.

Check a host before trusting it:

```bash
php bin/console.php doctor
```

```
 ok  PHP >= 8.1           8.3.6
 ok  pdo_sqlite
 ok  curl
 ok  openssl
 ok  data writable
FAIL storage writable
```

Everything the app needs is in that list. There is nothing else to configure.

### Requirements

| Needed | Why |
|---|---|
| PHP 8.1+ | typed properties, enums in match, `array_is_list` |
| `pdo_sqlite` | all state lives in one SQLite file |
| `curl` *or* `allow_url_fopen` | talking to providers; cURL also enables streaming |
| `openssl` *or* `sodium` | encrypting stored API keys |
| `proc_open` | only for the terminal view; optional |

---

## What it does

**Chat** — streaming conversations against any provider, with history kept per
conversation and titles derived from the first message.

**An agent** — flip the switch in the composer and the model gets tools: it
lists and reads files, searches the workspace, proposes edits, and runs
commands where the host allows it. You watch each tool call and its result as
they happen, and it stops after twelve rounds rather than looping forever.

**Providers and models** — add them by hand, ask the provider for its own model
list, or import a catalogue. Six wire protocols: OpenAI and anything
compatible, Anthropic, Google Gemini, Ollama, Mistral, Azure OpenAI.

**Files** — a sandboxed workspace browser and editor. Paths are resolved
lexically and then checked against the root, so traversal fails closed.

**Change approval** — the agent does not write to your files. It proposes, and
you see a unified diff with accept and reject buttons. The previous contents
are kept, so an accepted change can still be undone. If you would rather it
just got on with things, switch the policy to *apply immediately*; the history
and the undo work exactly the same.

**Terminal** — real command execution, off by default (`ARENA_SHELL=true`),
with a deny-list for the handful of commands that wreck a machine by accident.

**Diagnostics** — a built-in page that checks routing, the database, folder
permissions, extensions, and whether POST bodies of various shapes and sizes
actually survive the trip through your host.

---

## What the agent can do

| Tool | What it does |
|---|---|
| `list_files` | List a folder |
| `read_file` | Read a text file |
| `search_files` | Find which files contain some text, with line numbers |
| `write_file` | Create a file or replace it wholesale |
| `edit_file` | Replace one exact passage — refused if it is missing or ambiguous |
| `delete_file` | Remove a file |
| `run_command` | Run a command and report its output and exit code |

`run_command` appears only when `ARENA_SHELL=true` and the host permits
`proc_open`. When it is absent the model is told so, rather than being left to
call a tool that is not there.

Every tool goes through the same guards as the web interface: nothing reaches
outside the workspace, writing goes through the approval gate, and command
execution obeys the deny-list. A tool that fails returns the reason to the
model instead of ending the run — a missing file is something to recover from,
not a crash.

One honest limitation: a step that may contain tool calls is not streamed
token by token. A tool call is only usable once complete, so each step's prose
arrives whole and what you watch live is the tools working. Plain chat, with
the agent switch off, still streams token by token.

## Importing a catalogue

The importer sniffs the shape rather than demanding one. All of these work:

```jsonc
{ "openrouter": { "name": "OpenRouter", "models": [...] } }   // keyed by id
[ { "id": "openrouter", "name": "OpenRouter" } ]              // a list
{ "providers": { ... } }                                      // wrapped
{ "version": "2.0.0", "providers": [ ... ] }                  // an export
```

Details that are easy to get wrong, and are handled:

- `url` and `baseUrl` are both accepted; the protocol is inferred from the
  endpoint when the file does not state it (`:11434` → Ollama, and so on).
- Model entries may be strings or objects; unrecognised keys are preserved
  under `extra` rather than dropped.
- `"nonChat": true` imports the model but leaves it disabled.
- Re-importing never blanks a stored API key with an absent one.
- A UTF-8 BOM and trailing commas are tolerated.

If the browser cannot reach the endpoint — some shared hosts run a firewall
that rejects request bodies containing API keys — the UI retries the same
bytes base64-encoded, and says so. Failing that:

```bash
php bin/console.php provider:import providers.json --replace
```

---

## When something does not work

Open **تشخیص** in the sidebar, or `index.php?p=/api/diag` directly. It reports
the resolved routing, database state, folder permissions, PHP limits, and the
result of POSTing small, realistic and large bodies through your host. That
output distinguishes the three failures that look identical from the outside:
the request never arrived, the request arrived but the app could not write,
or the request arrived and the data was wrong.

---

## Layout

```
public/index.php        the only entry point
public/app.html         the interface
public/assets/          stylesheet and script
src/Bootstrap.php       paths, .env, autoloading
src/Http.php            Request, Response, Router
src/Db.php              SQLite schema and helpers
src/Auth.php            sessions, roles, throttling
src/Crypto.php          API key encryption
src/Providers.php       catalogue, import and export
src/Llm.php             the six protocol adapters
src/Chat.php            conversations and SSE streaming
src/Workspace.php       sandboxed file access
src/Shell.php           command execution
src/Routes.php          the whole HTTP surface
bin/console.php         command line companion
tools/                  test harness and dev server
```

Data lives in `data/arena.sqlite`; the encryption key in `data/master.key`;
workspace files in `storage/workspaces/`. Backing up means copying `data/`.

---

## Development

There is no PHP binary requirement for the test suite; it runs the real
interpreter through WebAssembly.

```bash
cd ../agent-php/tools && npm install          # one-time, provides php-wasm
cd ../../arena-agent

# 38 end-to-end checks through the real router
node ../agent-php/tools/phprun.mjs --root=. tools/tests/smoke.php

# 101 checks over the agent, its tools, diffs and the approval gate
node ../agent-php/tools/phprun.mjs --root=. tools/tests/agent.php

# browse the app locally (real PHP 8.3, no system install)
node tools/devserver.mjs 3000

# drive the agent without a real provider: run this, then add a provider
# pointing at http://127.0.0.1:8788/v1 with any key
node tools/mockprovider.mjs 8788
```

With a system PHP, `php bin/console.php serve 8080` is simpler.
