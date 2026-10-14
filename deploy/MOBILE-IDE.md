# Mobile code-server on Termux (forced zoom + Replit-like shell)

Everything here is in English, runs on the phone, and never modifies the
code-server installation (so an upgrade cannot break it).

| file | what it is |
|---|---|
| `s4-remote.sh` | the launcher. Starts sshd and/or code-server + the mobile proxy, repairs the integrated terminal, writes mobile settings, verifies the result. |
| `s4-csproxy.js` | Node injection proxy. Sits in front of code-server on loopback and rewrites every HTML response. |
| `s4-csmobile.css` | forced zoom + touch skin + the shell's own styles. Injected as an inline `<style>`. |
| `s4-csmobile.js` | the Replit-like mobile shell: bottom tab dock, top bar, extra-keys row. Injected as an inline `<script>` **with the page CSP nonce**. |
| `tests/s4-mobile-selftest.js` | regression harness (Node, optional jsdom). Proves the whole chain. |

## Quick start

```sh
curl -fsSL -o ~/s4-remote.sh https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-remote.sh
bash ~/s4-remote.sh --code --zoom 1.5 --open
```

Then open **`http://127.0.0.1:8081/`** — the proxy port. code-server itself
listens on `127.0.0.1:18081` and must not be opened directly (it has no zoom
and no shell).

Other commands:

```sh
bash ~/s4-remote.sh --status          # what is running, plus live verification
bash ~/s4-remote.sh --selftest        # files, syntax, injection, terminal PTY
bash ~/s4-remote.sh --fix-terminal    # only repair the integrated terminal
bash ~/s4-remote.sh --stop            # stop proxy + code-server + sshd
bash ~/s4-remote.sh --ssh             # SFTP on 127.0.0.1:8022 for file managers
bash ~/s4-remote.sh --code --zoom 1.8 # a different default zoom (persisted)
bash ~/s4-remote.sh --code --css my.css   # your own CSS override
bash ~/s4-remote.sh --code --no-proxy     # plain code-server, no injection
```

## Why forced zoom needs a proxy

* `window.zoomLevel` is only read by `src/vs/workbench/electron-browser/window.ts`,
  i.e. **Electron only**. In a browser the setting does nothing.
* The VS Code web workbench template ships
  `<meta name="viewport" ... maximum-scale=1.0, user-scalable=no>`
  under the comment `<!-- Disable pinch zooming -->`, so even pinch-zoom is dead.
* Therefore the proxy (1) strips every pre-existing viewport meta and injects an
  unlocked one, and (2) injects CSS that zooms `.monaco-workbench` and
  compensates its box with `calc(100% * var(--s4-inv))`.

Zooming `.monaco-workbench` instead of `<html>`/`<body>` matters:
`dom.getClientArea()` uses `element.clientWidth` for anything that is not
`document.body`, so the workbench keeps measuring itself consistently, while
body-level zoom would mix `window.innerWidth` (viewport px) with `clientWidth`
(local px) and clip the right/bottom edge.

Three independent zoom layers, so at least one always works:

1. injected CSS (`html`/`body` never touched, `--s4-zoom` from the launcher)
2. the shell's `A-` / `A+` buttons, two-finger pinch, `?z=1.8`, `Ctrl +/-/0`
3. unlocked pinch-zoom in the browser itself (viewport meta)

## Why the injected script needs a nonce

code-server/VS Code answer with

```
Content-Security-Policy: ... script-src 'self' 'unsafe-eval' blob: 'nonce-XYZ' ...;
                             style-src 'self' 'unsafe-inline'; ...
```

An inline `<script>` without `nonce-XYZ` is **silently discarded** by the
browser — that is why the first version's zoom controls never appeared. The
proxy therefore reuses the page's own nonce (found in the CSP header or in the
page's `<script nonce=...>`), or generates one and amends the CSP
header/`<meta>` when the page has a CSP without a nonce.

The injected `<style>` deliberately carries **no** nonce: `style-src` allows
`'unsafe-inline'` but has no nonce, and per CSP rules adding a nonce would
switch `'unsafe-inline'` off for that directive and break the stylesheet.

## The mobile shell

* **Bottom dock** (tabs, like the Replit mobile app):
  `Files · Search · Git · Terminal · Output · Editor · More`
* **Top bar**: menu/sidebar, command palette, `A-`, zoom %, `A+`, extra-keys
  toggle, fullscreen, hide bars (a round handle brings them back).
* **Extra-keys row**: `Esc Tab Ctrl Alt / - : ; . , " ' ` \ | & * ? ! @ # $ % ^
  ~ + = _ ( ) [ ] { } < > ← ↑ ↓ → Home End PgUp PgDn Del Enter` — the keys a
  phone keyboard hides. `Ctrl`/`Alt` are sticky.
* **More sheet**: commands, sidebar, panel, save all, split, close tab, find,
  undo, redo, extensions, zen, reload, zoom presets, fullscreen.

Each action tries three strategies in order and verifies the result with its own
DOM predicate: **click the real node** (`#workbench.view.explorer`, panel tabs)
→ **command palette** (open, type the title, click the best row) → **synthetic
keybinding**. What worked is recorded and reported.

## Evidence endpoint

```sh
curl -s http://127.0.0.1:8081/__s4mobile?probe=1
```

Returns the proxy version, the configured zoom, which shell files are in use,
how the nonce was obtained, counters (`htmlSeen`, `htmlInjected`,
`viewportStripped`, `ws`, `upstreamErr`, `browserReports`), a live upstream
probe, and `lastBrowserReport` — the state **your browser** posted back: zoom
actually applied, whether CSS `zoom` is supported, how many dock tabs and extra
keys were built, and which strategy verified each tab. That is what turns
"it doesn't work" into something fixable.

Other routes: `/__s4mobile/html` (the exact injected snippet),
`/__s4mobile/shell.css`, `/__s4mobile/shell.js`, `/__s4mobile/log`,
`POST /__s4mobile/report`.

## Terminal "permission denied"

`--fix-terminal` (also run automatically by `--code`) covers the three real
causes on Termux:

1. **node-pty's `spawn-helper` lost its exec bit** → every `spawn-helper` under
   the install is found and `chmod 755`'d, before/after modes printed.
2. **the install sits on a noexec mount** (shared storage) → detected and
   reported; the fix is `pkg install code-server` inside Termux home.
3. **VS Code picked a shell that does not exist on Android** (`/bin/sh`,
   `/bin/bash`) → `SHELL`/`TMPDIR`/`TERM` are exported and `settings.json` gets
   an explicit `Termux bash` profile (`$PREFIX/bin/bash -l`) as the default and
   automation profile.

Then it runs a **real node-pty self-test** (`~/.s4-remote/pty-selftest.js`) that
does exactly what the VS Code terminal does, and prints `PTY_OK` or the precise
`PTY_FAIL ...` reason (`posix_spawnp failed`, `EACCES`, missing module, ...).

## Terminal process terminated with exit code: 1

When VS Code pops up:
```
The terminal process "/data/data/com.termux/files/usr/bin/bash" terminated with exit code: 1.
```
the shell itself was spawned successfully, but exited immediately. The causes are:

1. **A startup file (`~/.bashrc`, `~/.bash_profile`, `~/.profile`, `$PREFIX/etc/profile.d/*`) exits or fails under `set -e`**.
2. **A stripped environment** (`PREFIX`, `PATH`, `TMPDIR` missing if code-server was started from a service/boot script).
3. **An invalid terminal cwd** (e.g. shared storage path when permissions expired).

Run the automated diagnostic and repair tool:
```bash
curl -fsSL -o ~/s4-termfix.sh https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-termfix.sh && bash ~/s4-termfix.sh
```
Or via `s4-remote.sh`:
```bash
bash ~/s4-remote.sh --termfix
```
It tests every startup layer, isolates the failing file, injects a fallback "safe profile" (`bash --norc --noprofile -i`), restores `PREFIX`/`TMPDIR`/`PATH` into `terminal.integrated.env.linux`, and ensures `cwd` falls back to `$HOME`.

## Self-test

```sh
node deploy/tests/s4-mobile-selftest.js          # 100 checks, needs jsdom
node deploy/tests/s4-mobile-selftest.js --no-jsdom   # HTTP/CSP part only
```

`npm install jsdom` first. The harness serves the real workbench skeleton with
the real CSP header, runs the proxy against it, then executes the injected shell
in jsdom against a mock workbench and checks that the dock, the tabs, the
palette ladder, the zoom variables and the browser→proxy report all work.
