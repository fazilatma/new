#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  s4-remote.sh v1.2 -- Termux private files + mobile-friendly code-server
# ---------------------------------------------------------------------
#  All output of this script is in English (per request).
#
#  Route 2: SFTP over sshd on port 8022
#     Any file manager with SFTP (Solid Explorer, MiX Explorer, X-plore,
#     Cx, Material Files) can then browse the whole of
#     /data/data/com.termux/files/home, which no Android file manager can
#     read directly (it is app-private; Shizuku only unlocks /sdcard/Android/data).
#
#  Route 3: code-server, forced zoom + a Replit-like mobile shell
#     window.zoomLevel does nothing in a browser (only
#     src/vs/workbench/electron-browser/window.ts reads it), and the VS Code
#     web workbench ships
#        <meta name="viewport" ... user-scalable=no>   <!-- Disable pinch zooming -->
#     plus a nonce-locked Content-Security-Policy.  So a lightweight Node
#     proxy (deploy/s4-csproxy.js) sits in front of code-server and, in every
#     HTML response:
#        - drops the pinched viewport meta and injects an unlocked one
#        - injects CSS that zooms .monaco-workbench and compensates its box
#        - injects the mobile shell JS with the page's own CSP nonce
#          (without the nonce the browser silently discards the script)
#        - tunnels WebSocket upgrades as raw TCP (terminal, extension host)
#        - answers GET /__s4mobile with hard evidence for the agent rounds
#     It never touches the code-server install, so upgrades cannot break it.
#
#     code-server listens on 127.0.0.1:18081, the proxy on 127.0.0.1:8081.
#     Open the PROXY port in the browser.
#
#  Terminal "permission denied" fix (built in, see fix_terminal)
#     node-pty launches a shell through a small helper binary
#     (spawn-helper).  On Termux that fails when the helper lost its exec
#     bit, when the install sits on a noexec mount (shared storage), or when
#     VS Code picks a shell that does not exist (/bin/sh, /bin/bash).
#     This script chmods every spawn-helper, warns about noexec installs,
#     exports SHELL/TMPDIR/TERM, writes an explicit Termux bash terminal
#     profile, and then runs a real node-pty self-test that prints PTY_OK or
#     the exact error text.
#
#  Terminal "exited with code 1" fix (deploy/s4-termfix.sh, run by --termfix)
#     A different failure looks like this popup:
#        The terminal process ".../bin/bash" terminated with exit code: 1.
#     There the shell itself died, so the spawn-helper is not the problem.
#     The usual causes are a startup file that ends the shell (~/.bashrc,
#     ~/.profile, $PREFIX/etc/profile.d/*), a stripped environment (no
#     PREFIX/PATH/TMPDIR because code-server was started from a boot script
#     or a service) and a terminal cwd that no longer exists (a workspace on
#     ~/storage/shared after the storage permission was revoked).
#     s4-termfix.sh tests each layer, names the culprit, repairs it and adds
#     a "Termux bash (safe)" profile that ignores every startup file, so you
#     always get a terminal back.  It is fetched and run automatically at the
#     end of --fix-terminal; use --no-termfix to skip it.
#
#  Usage:
#     bash s4-remote.sh                     # ssh + mobile code-server
#     bash s4-remote.sh --code              # code-server only
#     bash s4-remote.sh --code --zoom 1.6   # forced zoom 160%
#     bash s4-remote.sh --code --open       # also open it in the browser
#     bash s4-remote.sh --fix-terminal      # only repair the terminal
#     bash s4-remote.sh --termfix           # why does the terminal exit 1?
#     bash s4-remote.sh --termfix --safe-profile  # ignore all rc files
#     bash s4-remote.sh --selftest          # only check + report evidence
#     bash s4-remote.sh --status            # what is running right now
#     bash s4-remote.sh --stop              # stop proxy/code-server/sshd
#     bash s4-remote.sh --code --no-proxy   # plain code-server, no injection
#     bash s4-remote.sh --code --css my.css # your own mobile CSS override
#
#  Security: everything binds to 127.0.0.1 unless you pass --bind-lan, and
#  --bind-lan exposes only the proxy (code-server itself stays on loopback).
# =====================================================================
set -u

VERSION="1.3.0"
MARKER="s4-cs-mobile-v2"
SSH_PORT="${SSH_PORT:-8022}"
CODE_PORT="${CODE_PORT:-8081}"        # what you open in the browser
CS_UPSTREAM="${CS_UPSTREAM:-18081}"   # code-server itself (loopback only)
CODE_HOST="127.0.0.1"
BASE="$HOME/.s4-remote"
PFX="${PREFIX:-/data/data/com.termux/files/usr}"   # Termux prefix (never unset)
REPO="${S4_REPO:-fazilatma/new}"
SRC_BRANCH="${S4_SRC_BRANCH:-arena/f5a628bb-new}"
RAWBASE="${S4_RAWBASE:-https://raw.githubusercontent.com/$REPO/$SRC_BRANCH}"
API="https://api.github.com"
PROXY_JS="s4-csproxy.js"
SHELL_CSS="s4-csmobile.css"
SHELL_JS="s4-csmobile.js"
HELP_LAST_LINE=72

ZOOM="$(cat "$BASE/zoom" 2>/dev/null || echo 1.3)"
USE_PROXY=1; OPEN_BROWSER=0; CUSTOM_CSS=""
DO_SSH=0; DO_CODE=0; STOP=0; STATUS=0; SET_PW=0; BIND_LAN=0; NO_SETTINGS=0
FIX_TERMINAL=0; SELFTEST=0; NO_SHELL=0
TERMFIX=0; NO_TERMFIX=0; TERMFIX_SAFE=0
TERMFIX_SH="s4-termfix.sh"

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*" >&2; }
die()  { printf 'ERROR %s\n' "$*" >&2; exit 1; }
hr()   { say "------------------------------------------------------------"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh)           DO_SSH=1; shift ;;
    --code)          DO_CODE=1; shift ;;
    --both)          DO_SSH=1; DO_CODE=1; shift ;;
    --stop)          STOP=1; shift ;;
    --status)        STATUS=1; shift ;;
    --set-password)  SET_PW=1; shift ;;
    --fix-terminal)  FIX_TERMINAL=1; shift ;;
    --termfix)       TERMFIX=1; FIX_TERMINAL=1; shift ;;
    --no-termfix)    NO_TERMFIX=1; shift ;;
    --safe-profile)  TERMFIX_SAFE=1; TERMFIX=1; FIX_TERMINAL=1; shift ;;
    --selftest)      SELFTEST=1; shift ;;
    --ssh-port)      SSH_PORT="${2:-8022}"; shift 2 ;;
    --code-port)     CODE_PORT="${2:-8081}"; shift 2 ;;
    --upstream-port) CS_UPSTREAM="${2:-18081}"; shift 2 ;;
    --zoom)          ZOOM="${2:-1.3}"; shift 2 ;;
    --zoom=*)        ZOOM="${1#*=}"; shift ;;
    --no-proxy)      USE_PROXY=0; shift ;;
    --proxy)         USE_PROXY=1; shift ;;
    --no-shell)      NO_SHELL=1; shift ;;
    --open)          OPEN_BROWSER=1; shift ;;
    --css)           CUSTOM_CSS="${2:-}"; shift 2 ;;
    --css=*)         CUSTOM_CSS="${1#*=}"; shift ;;
    --bind-lan)      BIND_LAN=1; CODE_HOST="0.0.0.0"; shift ;;
    --no-settings)   NO_SETTINGS=1; shift ;;
    -h|--help)       sed -n "2,${HELP_LAST_LINE}p" "$0"; exit 0 ;;
    -V|--version)    echo "s4-remote $VERSION"; exit 0 ;;
    *)               die "unknown flag: $1  (try --help)" ;;
  esac
done

if [ "$SELFTEST" = 0 ] && [ "$FIX_TERMINAL" = 0 ] && [ "$DO_SSH" = 0 ] && [ "$DO_CODE" = 0 ]; then
  DO_SSH=1; DO_CODE=1
fi

mkdir -p "$BASE" 2>/dev/null || true
printf '%s' "$ZOOM" > "$BASE/zoom" 2>/dev/null || true

listening() { command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$1 "; }
have() { command -v "$1" >/dev/null 2>&1; }

# ------------------------------------------------- code-server install root
CS_BIN=""; CS_ROOT=""
locate_code_server() {
  [ -n "$CS_ROOT" ] && return 0
  CS_BIN="$(command -v code-server 2>/dev/null || true)"
  [ -z "$CS_BIN" ] && return 1
  local real; real="$(readlink -f "$CS_BIN" 2>/dev/null || printf '%s' "$CS_BIN")"
  # Termux package: $PREFIX/bin/code-server -> $PREFIX/lib/code-server/...
  # npm -g       : $PREFIX/lib/node_modules/code-server/out/node/entry.js
  CS_ROOT="$(printf '%s' "$real" | sed -e 's#/out/node/.*##' -e 's#/bin/code-server$##')"
  [ -d "$CS_ROOT" ] || CS_ROOT="$(dirname "$real")"
  return 0
}

# ================================================ terminal repair (English)
fix_terminal() {
  say ""
  say "== Terminal repair =="
  local pfx="${PREFIX:-/data/data/com.termux/files/usr}"
  local bash_bin="$pfx/bin/bash"

  # 1) a shell that actually exists
  if [ -x "$bash_bin" ]; then
    export SHELL="$bash_bin"
    say "  SHELL=$SHELL"
  else
    warn "no bash at $bash_bin  (pkg install bash)"
    export SHELL="${SHELL:-$pfx/bin/sh}"
  fi
  export TMPDIR="${TMPDIR:-$pfx/tmp}"
  export TERM="${TERM:-xterm-256color}"
  mkdir -p "$TMPDIR" 2>/dev/null || true
  say "  TMPDIR=$TMPDIR  TERM=$TERM"

  # 2) node-pty spawn-helper must be executable
  if locate_code_server; then
    say "  code-server install: $CS_ROOT"
    case "$CS_ROOT" in
      /storage/*|"$HOME"/storage/*)
        warn "code-server is installed on shared storage, which is mounted"
        warn "noexec: the pty helper cannot run there. Reinstall it inside"
        warn "Termux home:  pkg install code-server"
        ;;
    esac
    local helpers found=0 fixed=0
    helpers="$(find "$CS_ROOT" -name 'spawn-helper' -type f 2>/dev/null | head -20)"
    if [ -z "$helpers" ]; then
      helpers="$(find "$pfx/lib" -name 'spawn-helper' -type f 2>/dev/null | head -20)"
    fi
    if [ -n "$helpers" ]; then
      while IFS= read -r h; do
        [ -z "$h" ] && continue
        found=$((found + 1))
        local before after
        before="$(ls -l "$h" 2>/dev/null | awk '{print $1}')"
        if [ -x "$h" ]; then
          say "  helper ok       $before  $h"
        else
          chmod 755 "$h" 2>/dev/null || chmod +x "$h" 2>/dev/null || true
          after="$(ls -l "$h" 2>/dev/null | awk '{print $1}')"
          if [ -x "$h" ]; then
            fixed=$((fixed + 1))
            say "  helper FIXED    $before -> $after  $h"
          else
            say "  helper FAILED   $before  $h  (chmod refused: noexec mount?)"
          fi
        fi
      done <<EOF2
$helpers
EOF2
      say "  spawn-helper: found=$found fixed=$fixed"
      [ "$found" = 0 ] && warn "no spawn-helper found; node-pty may be missing"
    else
      warn "no spawn-helper found under $CS_ROOT or $pfx/lib"
    fi

    # 3) is the install on a noexec mount?
    if have mount; then
      local mnt
      mnt="$(df "$CS_ROOT" 2>/dev/null | awk 'NR==2{print $NF}')"
      if [ -n "${mnt:-}" ] && mount 2>/dev/null | grep -F " $mnt " | grep -q noexec; then
        warn "mount $mnt is noexec: binaries there cannot be executed"
      else
        say "  mount for $CS_ROOT: ${mnt:-unknown} (exec allowed)"
      fi
    fi
  else
    warn "code-server not found on PATH (pkg install code-server)"
  fi

  # 4) real node-pty self-test: this is what VS Code does when it opens a
  #    terminal, so its output is the definitive answer.
  if have node; then
    cat > "$BASE/pty-selftest.js" <<'EOF2'
/* Spawn a shell through node-pty exactly like the code-server terminal does. */
const fs = require('fs');
const path = require('path');
const roots = (process.argv[2] || '').split(':').filter(Boolean);
const shell = process.env.SHELL || '/data/data/com.termux/files/usr/bin/bash';

function candidates() {
  const out = [];
  for (const root of roots) {
    for (const rel of [
      'lib/node_modules/@coder/node-pty-prebuilt-multiarch',
      'node_modules/@coder/node-pty-prebuilt-multiarch',
      'lib/node_modules/node-pty',
      'node_modules/node-pty',
      'lib/node_modules/code-server/node_modules/node-pty'
    ]) {
      const p = path.join(root, rel);
      if (fs.existsSync(p)) out.push(p);
    }
  }
  return out;
}

function findHelper(dir, depth) {
  if (depth > 6) return null;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === 'spawn-helper') return p;
    if (e.isDirectory() && e.name !== '.git') {
      const hit = findHelper(p, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

const cands = candidates();
if (!cands.length) { console.log('PTY_FAIL no node-pty module under: ' + roots.join(', ')); process.exit(0); }
console.log('pty module: ' + cands[0]);
const helper = findHelper(cands[0], 0);
if (helper) {
  let mode = 'unknown', exec = false;
  try { const st = fs.statSync(helper); mode = (st.mode & 0o7777).toString(8); exec = !!(st.mode & 0o111); } catch (e) {}
  console.log('spawn-helper: ' + helper + ' mode=' + mode + ' executable=' + exec);
  if (!exec) { try { fs.chmodSync(helper, 0o755); console.log('spawn-helper: chmod 755 applied'); } catch (e) { console.log('spawn-helper: chmod failed: ' + e.message); } }
} else { console.log('spawn-helper: NOT FOUND'); }
console.log('shell: ' + shell + ' exists=' + fs.existsSync(shell));

let pty;
try { pty = require(cands[0]); }
catch (e) { console.log('PTY_FAIL require: ' + (e.message || e).split('\n')[0]); process.exit(0); }

let out = '';
let done = false;
try {
  const p = pty.spawn(shell, ['-lc', 'echo PTY_CHILD_OK; id -un; pwd'], {
    name: process.env.TERM || 'xterm-256color',
    cols: 80, rows: 24,
    cwd: process.env.HOME || '/data/data/com.termux/files/home',
    env: Object.assign({}, process.env)
  });
  p.onData((d) => { out += d; if (out.indexOf('PTY_CHILD_OK') >= 0 && !done) { done = true; } });
  p.onExit(({ exitCode, signal }) => {
    console.log('PTY_EXIT=' + exitCode + ' signal=' + (signal || 0));
    console.log('PTY_OUTPUT=' + JSON.stringify(out.replace(/\r/g, '').slice(0, 300)));
    console.log(out.indexOf('PTY_CHILD_OK') >= 0 ? 'PTY_OK' : 'PTY_FAIL child did not answer');
    process.exit(0);
  });
} catch (e) {
  console.log('PTY_FAIL spawn: ' + (e && (e.message || e.name) || e));
  console.log('PTY_STACK=' + String((e && e.stack) || '').split('\n').slice(0, 3).join(' | '));
  process.exit(0);
}
setTimeout(() => {
  console.log('PTY_OUTPUT=' + JSON.stringify(out.replace(/\r/g, '').slice(0, 300)));
  console.log(out.indexOf('PTY_CHILD_OK') >= 0 ? 'PTY_OK (timeout waiting for exit)' : 'PTY_TIMEOUT');
  process.exit(0);
}, 12000);
EOF2
    local roots_arg="$CS_ROOT:$PFX/lib/node_modules/code-server:$PFX"
    say "  running node-pty self-test (this is what the terminal does) ..."
    ( cd "$BASE" && SHELL="$SHELL" TMPDIR="$TMPDIR" TERM="$TERM" \
        timeout 25 node "$BASE/pty-selftest.js" "$roots_arg" 2>&1 | sed 's/^/    /' ) \
      || say "    self-test could not run (timeout or node error)"
  else
    warn "node is missing: pkg install node (the proxy and this self-test need it)"
  fi
  say "  done. If it still fails, the PTY_FAIL line above is the exact cause."

  # 5) the shell itself dying (exit code 1) needs a different investigation:
  #    startup files, environment, cwd.  s4-termfix.sh does that.
  if [ "$NO_TERMFIX" = 0 ]; then run_termfix; fi
}

run_termfix() {
  local dst local_src extra
  dst="$BASE/$TERMFIX_SH"
  local_src="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$TERMFIX_SH"
  if [ ! -f "$dst" ]; then
    if [ -f "$local_src" ]; then
      cp -f "$local_src" "$dst" 2>/dev/null || true
    else
      fetch_file "$TERMFIX_SH"
    fi
  fi
  if [ ! -f "$dst" ]; then
    warn "$TERMFIX_SH is not available: skipping the deep terminal diagnosis"
    warn "(download it from $RAWBASE/deploy/$TERMFIX_SH and run: bash $TERMFIX_SH)"
    return 0
  fi
  extra=""
  [ "$TERMFIX_SAFE" = 1 ] && extra="--safe-profile"
  say ""
  say "== Deep terminal diagnosis ($TERMFIX_SH) =="
  # shellcheck disable=SC2086
  bash "$dst" $extra 2>&1 | sed 's/^/  /'
}

# ======================================================= settings.json merge
apply_settings() {
  local pfx="$PFX"
  SETTINGS_DIR="$HOME/.local/share/code-server/User"
  SETTINGS="$SETTINGS_DIR/settings.json"
  mkdir -p "$SETTINGS_DIR" 2>/dev/null
  if ! have python3; then
    warn "python3 missing: settings not merged (forced zoom comes from the proxy anyway)"
    return 0
  fi
  [ -f "$SETTINGS" ] && cp -p "$SETTINGS" "$SETTINGS.bak.$(date +%s)" 2>/dev/null
  SETTINGS="$SETTINGS" S4_BASH="$pfx/bin/bash" S4_PFX="$pfx" S4_HOME="$HOME" python3 - <<'PY' 2>&1 | sed 's/^/  /'
import json, os
p = os.environ["SETTINGS"]
bash = os.environ.get("S4_BASH", "/data/data/com.termux/files/usr/bin/bash")
pfx = os.environ.get("S4_PFX", "/data/data/com.termux/files/usr")
home = os.environ.get("S4_HOME") or os.path.expanduser("~")
try:
    cur = json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else {}
    if not isinstance(cur, dict):
        cur = {}
except Exception:
    cur = {}
cwd = cur.get("terminal.integrated.cwd") or home
if not os.path.isdir(cwd):
    cwd = home
mobile = {
    # --- readable on a phone -------------------------------------------
    "editor.fontSize": 18,
    "editor.lineHeight": 30,
    "editor.wordWrap": "on",
    "editor.minimap.enabled": False,
    "editor.scrollbar.verticalScrollbarSize": 18,
    "editor.scrollbar.horizontalScrollbarSize": 18,
    "editor.renderLineHighlight": "all",
    "editor.stickyScroll.enabled": False,
    "editor.glyphMargin": False,
    "terminal.integrated.fontSize": 16,
    "terminal.integrated.lineHeight": 1.3,
    "workbench.tree.indent": 22,
    "workbench.list.smoothScrolling": True,
    "breadcrumbs.enabled": False,
    "window.menuBarVisibility": "compact",
    "explorer.compactFolders": False,
    "files.simpleDialog.enable": True,
    "telemetry.telemetryLevel": "off",
    "workbench.editor.limit.enabled": True,
    "workbench.editor.limit.value": 6,
    # the mobile shell replaces the left rail with a bottom tab dock; "top"
    # keeps #workbench.view.* clickable (use "hidden" for maximum room)
    "workbench.activityBar.location": "top",
    # --- terminal: never guess a shell that does not exist on Android ----
    "terminal.integrated.profiles.linux": {
        "Termux bash": {"path": bash, "args": ["-l"], "icon": "terminal-bash"},
        # a shell that reads no startup file at all: it opens even when
        # ~/.bashrc or $PREFIX/etc/profile.d/* kills every other shell
        "Termux bash (safe)": {"path": bash, "args": ["--norc", "--noprofile", "-i"],
                               "icon": "terminal-bash"},
        "Termux sh": {"path": os.path.join(os.path.dirname(bash), "sh"), "args": ["-l"]}
    },
    # tasks/automation must not depend on the user's rc files either
    "terminal.integrated.automationProfile.linux":
        {"path": bash, "args": ["--norc", "--noprofile", "-l"]},
    # a cwd that always exists: a workspace on revoked shared storage is a
    # dangling symlink and the shell then exits 1 before printing anything
    "terminal.integrated.cwd": cwd,
    # rebuild the environment inside the terminal even when code-server was
    # started with a stripped one (boot script, runit service, bare nohup)
    "terminal.integrated.env.linux": {
        "PREFIX": pfx,
        "HOME": home,
        "TMPDIR": os.path.join(pfx, "tmp"),
        "SHELL": bash,
        "TERM": "xterm-256color",
        "PATH": "%s/bin:%s/bin/applets:/system/bin:/system/xbin:/vendor/bin" % (pfx, pfx),
        "LD_LIBRARY_PATH": os.path.join(pfx, "lib"),
    },
    "terminal.integrated.copyOnSelection": True,
}
# keep a default profile that s4-termfix.sh already chose (it switches to the
# safe one when it finds a startup file that kills the shell)
default_profile = cur.get("terminal.integrated.defaultProfile.linux")
if default_profile not in mobile["terminal.integrated.profiles.linux"]:
    default_profile = "Termux bash"
mobile["terminal.integrated.defaultProfile.linux"] = default_profile
changed = sorted(k for k, v in mobile.items() if cur.get(k) != v)
cur.update(mobile)
json.dump(cur, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("settings:", p)
print("changed:", ", ".join(changed) or "none")
PY
}

# ================================================== download shell + proxy
fetch_file() {  # fetch_file <name>
  local name="$1" dst="$BASE/$1" src local_src
  local_src="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$name"
  if [ -f "$local_src" ]; then
    cp -f "$local_src" "$dst" && { say "  $name: copied from $local_src"; return 0; }
  fi
  if curl -fsSL --connect-timeout 12 --max-time 60 -o "$dst.tmp" "$RAWBASE/deploy/$name" 2>/dev/null && [ -s "$dst.tmp" ]; then
    mv -f "$dst.tmp" "$dst"; say "  $name: downloaded (raw.githubusercontent.com)"; return 0
  fi
  if curl -fsSL --connect-timeout 12 --max-time 60 -H 'Accept: application/vnd.github.raw' \
       -o "$dst.tmp" "$API/repos/$REPO/contents/deploy/$name?ref=$SRC_BRANCH" 2>/dev/null && [ -s "$dst.tmp" ]; then
    mv -f "$dst.tmp" "$dst"; say "  $name: downloaded (api.github.com)"; return 0
  fi
  rm -f "$dst.tmp" 2>/dev/null
  if [ -f "$dst" ]; then warn "$name: download failed, keeping the existing copy"; return 0; fi
  warn "$name: unavailable"; return 1
}

# ======================================================== evidence / checks
verify_injection() {  # prints S4_VERIFY=pass|fail
  local body="$BASE/probe.html" code marks zoomcss pinch blocked nonce src
  code="$(curl -sS -o "$body" -w '%{http_code}' --max-time 25 "http://127.0.0.1:$CODE_PORT/" 2>/dev/null || echo 000)"
  marks="$(grep -c "$MARKER" "$body" 2>/dev/null | head -1)";      marks="${marks:-0}"
  zoomcss="$(grep -c -- '--s4-zoom' "$body" 2>/dev/null | head -1)"; zoomcss="${zoomcss:-0}"
  pinch="$(grep -c 'user-scalable=yes' "$body" 2>/dev/null | head -1)"; pinch="${pinch:-0}"
  blocked="$(grep -c 'user-scalable=no' "$body" 2>/dev/null | head -1)"; blocked="${blocked:-0}"
  nonce="$(grep -c 'data-s4="mob" nonce="' "$body" 2>/dev/null | head -1)"; nonce="${nonce:-0}"
  say "  page probe: http=$code marker=$marks forced-zoom-css=$zoomcss pinch-unlocked=$pinch pinch-blocked=$blocked"
  say "  shell script nonce attribute: $nonce (0 is correct when the page has no CSP)"

  if [ -f "$BASE/mobile.css" ]; then
    say "  note: $BASE/mobile.css overrides the shipped shell CSS (replace it with --css <file>)"
  fi
  if [ -f "$BASE/mobile.js" ]; then
    say "  note: $BASE/mobile.js overrides the shipped shell JS"
  fi
  local st="$BASE/probe-status.json"
  curl -sS --max-time 20 -o "$st" "http://127.0.0.1:$CODE_PORT/__s4mobile?probe=1" 2>/dev/null || true
  if [ -s "$st" ] && have python3; then
    python3 - "$st" <<'PY' 2>/dev/null | sed 's/^/  /'
import json,sys
try:
    d=json.load(open(sys.argv[1],encoding='utf-8'))
except Exception as e:
    print('status endpoint: unreadable (%s)'%e); sys.exit(0)
print('proxy status: v%s marker=%s zoom=%s uptime=%ss'%(d.get('version'),d.get('marker'),d.get('zoom'),d.get('uptimeSec')))
print('  shell css=%s (%sB)  js=%s (%sB)'%(d.get('shell',{}).get('css',{}).get('source'),d.get('shell',{}).get('css',{}).get('bytes'),d.get('shell',{}).get('js',{}).get('source'),d.get('shell',{}).get('js',{}).get('bytes')))
print('  nonce: last=%s counts=%s cspRewritten=%s'%(d.get('nonce',{}).get('lastSource'),d.get('nonce',{}).get('counts'),d.get('nonce',{}).get('cspRewritten')))
c=d.get('counters',{})
print('  counters: htmlSeen=%s htmlInjected=%s viewportStripped=%s ws=%s upstreamErr=%s browserReports=%s'%(c.get('htmlSeen'),c.get('htmlInjected'),c.get('viewportStripped'),c.get('ws'),c.get('upstreamErr'),c.get('browserReports')))
print('  upstreamProbe: %s'%d.get('upstreamProbe'))
r=d.get('lastBrowserReport')
if r:
    print('  last browser report: v=%s zoom=%s supported=%s tabs=%s extraKeys=%s acts=%s errs=%s'%(r.get('v'),r.get('zoom'),r.get('zoomSupported'),r.get('tabs'),r.get('extraKeys'),r.get('acts'),r.get('errs')))
    print('    (this is what YOUR browser told the proxy - open the page, then re-run --selftest)')
else:
    print('  last browser report: none yet (open the page in the browser once)')
if d.get('lastError'): print('  lastError: %s'%d.get('lastError'))
PY
  else
    warn "no answer from http://127.0.0.1:$CODE_PORT/__s4mobile (is the proxy running?)"
  fi

  if [ "${marks:-0}" -gt 0 ] && [ "${zoomcss:-0}" -gt 0 ] && [ "${pinch:-0}" -gt 0 ] && [ "${blocked:-0}" -eq 0 ]; then
    say "  S4_VERIFY=pass  (forced zoom + pinch unlock + mobile shell are being served)"
    rm -f "$body" "$st" 2>/dev/null
    return 0
  fi
  say "  S4_VERIFY=fail"
  say "  proxy log:"; tail -20 "$BASE/csproxy.log" 2>/dev/null | sed 's/^/    /'
  rm -f "$body" "$st" 2>/dev/null
  return 1
}

# ------------------------------------------------------------------ status
if [ "$STATUS" = 1 ]; then
  say "s4-remote $VERSION"
  say "  sshd:        $(have sshd && echo "installed ($(command -v sshd))" || echo 'not installed')"
  say "  code-server: $(have code-server && code-server --version 2>/dev/null | head -1 || echo 'not installed')"
  say "  node:        $(have node && node -v 2>/dev/null || echo 'not installed')"
  say "  proxy file:  $([ -f "$BASE/$PROXY_JS" ] && echo "present ($(wc -c < "$BASE/$PROXY_JS" | tr -d ' ') bytes)" || echo 'not fetched')"
  say "  shell files: $([ -f "$BASE/$SHELL_CSS" ] && echo "css ok" || echo 'css missing') / $([ -f "$BASE/$SHELL_JS" ] && echo "js ok" || echo 'js missing')"
  say "  saved zoom:  $ZOOM"
  say "  ports:       browser->$CODE_PORT  code-server->$CS_UPSTREAM  ssh->$SSH_PORT"
  for p in "$CODE_PORT" "$CS_UPSTREAM" "$SSH_PORT"; do
    if listening "$p"; then say "    :$p LISTENING"; else say "    :$p closed"; fi
  done
  if listening "$CODE_PORT"; then verify_injection; fi
  exit 0
fi

if [ "$STOP" = 1 ]; then
  for f in csproxy.pid code.pid sshd.pid; do
    if [ -f "$BASE/$f" ] && kill -0 "$(cat "$BASE/$f")" 2>/dev/null; then
      kill "$(cat "$BASE/$f")" 2>/dev/null && say "stopped pid $(cat "$BASE/$f") ($f)"
      rm -f "$BASE/$f"
    fi
  done
  pkill -f "$PROXY_JS" 2>/dev/null && say "proxy killed"
  pkill -f "code-server" 2>/dev/null && say "code-server killed"
  pkill -f "sshd" 2>/dev/null && say "sshd killed"
  say "S4_STOP=done"
  exit 0
fi

# ---------------------------------------------------------- ssh password
if [ "$SET_PW" = 1 ]; then
  have passwd || die "passwd not found"
  say "Setting the ssh password for user $(whoami) (type it twice):"
  passwd || die "passwd failed"
  say "password set"
fi

# ------------------------------------------------------- terminal repair
if [ "$FIX_TERMINAL" = 1 ]; then
  fix_terminal
  [ "$DO_CODE" = 0 ] && [ "$DO_SSH" = 0 ] && [ "$SELFTEST" = 0 ] && exit 0
fi

# ============================================================== route 2: ssh
if [ "$DO_SSH" = 1 ]; then
  say ""
  hr
  say "== Route 2: SFTP (Termux private files from any file manager) =="
  if ! have sshd; then
    say "  installing openssh ..."
    have pkg || die "pkg not found"
    yes | pkg install -y openssh 2>&1 | tail -8 | sed 's/^/    /'
  fi
  have sshd || die "sshd did not install"
  ls "$PFX/etc/ssh"/ssh_host_* >/dev/null 2>&1 \
    || { say "  generating host keys ..."; ssh-keygen -A 2>&1 | tail -6 | sed 's/^/    /'; }
  LAN_IP="$( { ip -4 addr show wlan0 2>/dev/null || ifconfig wlan0 2>/dev/null; } | grep -o 'inet [0-9.]*' | head -1 | cut -d' ' -f2 )"
  if pgrep -f sshd >/dev/null 2>&1; then
    say "  sshd is already running"
  else
    sshd -p "$SSH_PORT" 2>"$BASE/sshd.err" && say "  sshd started on port $SSH_PORT" \
      || { say "  sshd failed to start:"; sed 's/^/      /' "$BASE/sshd.err"; }
  fi
  sleep 1
  if listening "$SSH_PORT"; then say "  port $SSH_PORT LISTENING"; else warn "nothing listening on $SSH_PORT"; fi
  say ""
  say "  In your file manager create an SFTP connection:"
  say "     host: 127.0.0.1   port: $SSH_PORT   path: ~"
  if [ -t 1 ]; then
    say "     username: $(whoami)"
    say "     password: the one you set with passwd (none yet? bash $0 --set-password)"
  else
    say "     username: (output of whoami)   password: (set with --set-password; not printed here)"
  fi
  [ -n "${LAN_IP:-}" ] && say "  From a computer on the same wifi: $LAN_IP:$SSH_PORT"
  say "  Autostart: pkg install termux-services && sv-enable sshd"
fi

# ==================================================== route 3: code-server
if [ "$DO_CODE" = 1 ] && ! have code-server; then
  warn "code-server is not installed: pkg install code-server"
  DO_CODE=0
fi

if [ "$DO_CODE" = 1 ]; then
  say ""
  hr
  say "== Route 3: mobile code-server (forced zoom + tabbed shell) =="
  [ "$NO_SETTINGS" = 0 ] && apply_settings
  fix_terminal

  # ---------------------------------------------------- fetch the proxy
  if [ "$USE_PROXY" = 1 ] && ! have node; then
    warn "node is missing (pkg install node) - continuing without the proxy"
    USE_PROXY=0
  fi
  if [ "$USE_PROXY" = 1 ]; then
    say "  files:"
    fetch_file "$PROXY_JS"  || USE_PROXY=0
    fetch_file "$SHELL_CSS" || true
    fetch_file "$SHELL_JS"  || true
  fi
  if [ "$USE_PROXY" = 1 ] && [ -f "$BASE/$PROXY_JS" ]; then
    node --check "$BASE/$PROXY_JS" >/dev/null 2>&1 \
      && say "  syntax: $PROXY_JS ok" \
      || { warn "$PROXY_JS has a syntax error - continuing without the proxy"; USE_PROXY=0; }
    for f in "$SHELL_CSS" "$SHELL_JS"; do
      if [ -f "$BASE/$f" ]; then
        say "  present: $f ($(wc -c < "$BASE/$f" | tr -d ' ') bytes)"
      else
        warn "$f missing - the proxy will use its builtin fallback shell"
      fi
    done
    if [ -n "$CUSTOM_CSS" ]; then
      if [ -f "$CUSTOM_CSS" ]; then
        cp -f "$CUSTOM_CSS" "$BASE/mobile.css" && say "  custom CSS: $CUSTOM_CSS -> $BASE/mobile.css"
      else
        warn "custom CSS not found: $CUSTOM_CSS"
      fi
    fi
  fi

  # ------------------------------------------------ start code-server
  SERVE_PORT="$CODE_PORT"
  [ "$USE_PROXY" = 1 ] && SERVE_PORT="$CS_UPSTREAM"
  # code-server always stays on loopback; --bind-lan exposes only the proxy.

  if pgrep -f "code-server.*$SERVE_PORT" >/dev/null 2>&1; then
    say "  code-server already running on $SERVE_PORT"
  else
    say "  starting code-server on 127.0.0.1:$SERVE_PORT ..."
    ( cd "$HOME" && SHELL="${SHELL:-$PFX/bin/bash}" TMPDIR="${TMPDIR:-$PFX/tmp}" TERM="${TERM:-xterm-256color}" \
        nohup code-server \
        --bind-addr "127.0.0.1:$SERVE_PORT" \
        --auth password --disable-telemetry --disable-update-check \
        "$HOME" > "$BASE/code-server.log" 2>&1 &
      echo $! > "$BASE/code.pid" ) 2>/dev/null
    for _ in $(seq 1 30); do
      listening "$SERVE_PORT" && break
      sleep 1
    done
    if listening "$SERVE_PORT"; then
      say "  code-server up (pid $(cat "$BASE/code.pid" 2>/dev/null))"
    else
      say "  code-server failed to start; log:"; tail -20 "$BASE/code-server.log" 2>/dev/null | sed 's/^/      /'
    fi
  fi

  # ------------------------------------------------------- start proxy
  if [ "$USE_PROXY" = 1 ]; then
    if pgrep -f "$PROXY_JS" >/dev/null 2>&1; then
      say "  proxy already running (to apply a new zoom: bash $0 --stop, then run again)"
    else
      ( cd "$BASE" && S4_CS_HOST="$CODE_HOST" S4_CS_PORT="$CODE_PORT" S4_CS_UPSTREAM="$CS_UPSTREAM" \
          S4_CS_ZOOM="$ZOOM" S4_CS_STATE="$BASE" \
          S4_CS_CSS="${CUSTOM_CSS:+$BASE/mobile.css}" S4_CS_NO_SHELL="$([ "$NO_SHELL" = 1 ] && echo 1 || echo '')" \
          nohup node "$BASE/$PROXY_JS" > "$BASE/csproxy.log" 2>&1 &
        echo $! > "$BASE/csproxy.pid" ) 2>/dev/null
      sleep 2
      if kill -0 "$(cat "$BASE/csproxy.pid" 2>/dev/null)" 2>/dev/null; then
        say "  mobile proxy up (pid $(cat "$BASE/csproxy.pid")) - default zoom $ZOOM"
      else
        say "  proxy failed to start; log:"; tail -15 "$BASE/csproxy.log" 2>/dev/null | sed 's/^/      /'
      fi
    fi
    sleep 1
    say "  verification:"
    verify_injection
  fi

  CFG="$HOME/.config/code-server/config.yaml"
  say ""
  say "  OPEN THIS:   http://$CODE_HOST:$CODE_PORT/"
  if [ "$USE_PROXY" = 1 ]; then
    say "  evidence:    curl -s http://127.0.0.1:$CODE_PORT/__s4mobile?probe=1"
    say "  zoom now:    A- / A+ in the top bar, pinch with two fingers, or ?z=1.8 in the URL"
    say "  zoom saved:  bash $0 --code --zoom 1.6   (stored in $BASE/zoom)"
    say "  your own CSS: bash $0 --code --css ~/mobile.css"
    say "  mobile dock: Files / Search / Git / Terminal / Output / Editor / More"
    say "  extra keys:  Esc Tab Ctrl Alt arrows and the symbols a phone keyboard hides"
  fi
  if [ -t 1 ] && [ -f "$CFG" ]; then
    say "  login password: $(grep -m1 'password:' "$CFG" | cut -d' ' -f2-)"
  else
    say "  login password: see $CFG"
  fi
  if [ "$OPEN_BROWSER" = 1 ] && have termux-open-url; then
    termux-open-url "http://127.0.0.1:$CODE_PORT/" 2>/dev/null && say "  opened in the browser"
  fi
fi

# ------------------------------------------------------------- selftest
if [ "$SELFTEST" = 1 ]; then
  say ""
  hr
  say "== Self-test =="
  say "  files:"
  for f in "$PROXY_JS" "$SHELL_CSS" "$SHELL_JS"; do
    if [ -f "$BASE/$f" ]; then say "    $f $(wc -c < "$BASE/$f" | tr -d ' ') bytes"; else say "    $f MISSING"; fi
  done
  if have node && [ -f "$BASE/$PROXY_JS" ]; then
    node --check "$BASE/$PROXY_JS" >/dev/null 2>&1 && say "    node --check $PROXY_JS: ok" || say "    node --check $PROXY_JS: SYNTAX ERROR"
    [ -f "$BASE/$SHELL_JS" ] && { node --check "$BASE/$SHELL_JS" >/dev/null 2>&1 && say "    node --check $SHELL_JS: ok" || say "    node --check $SHELL_JS: SYNTAX ERROR"; }
  fi
  if [ "$DO_CODE" = 0 ] && listening "$CODE_PORT"; then
    say "  injection:"; verify_injection
  fi
  say "  terminal:"; fix_terminal
  say "S4_SELFTEST=done"
fi

say ""
hr
say "Done.  status: bash $0 --status    stop: bash $0 --stop"
say "Recommended browser: Chrome / Samsung Internet / Edge (they honour CSS zoom)."
say "If a page looks unzoomed, open  http://127.0.0.1:$CODE_PORT/__s4mobile  -"
say "it reports exactly what the proxy served and what your browser did with it."
hr
