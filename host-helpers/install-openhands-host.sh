#!/usr/bin/env bash
# Install and manage the official OpenHands Agent Canvas on a restricted Linux
# hosting account. Everything is installed below the account home: no sudo,
# apt, Docker, systemd, or writes to /usr are used.

set -Eeuo pipefail

SCRIPT_NAME="openhands-host"
SCRIPT_VERSION="2.2.0"
SELF_URL="https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/01a0f230-new/host-helpers/install-openhands-host.sh"
NODE_MAJOR="24"
PACKAGE_NAME="@openhands/agent-canvas"

ACTION="install"
ACTION_SET=false
HOME_OVERRIDE=""
CLI_PORT=""
CLI_LISTEN_HOST=""
CLI_ACCESS_HOST=""
CLI_ACCESS_SCHEME=""
CLI_CANVAS_VERSION=""
CLI_WORKSPACE=""
CLI_BACKEND_PORT=""
CLI_AUTOMATION_PORT=""
CLI_FRONTEND_PORT=""
NO_START=false
FOLLOW_LOG=false
ASSUME_YES=false
PURGE_DATA=false
SKIP_SELF_UPDATE=false

log() { printf '[%s] %s\n' "$SCRIPT_NAME" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$SCRIPT_NAME" "$*" >&2; }
die() { printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
OpenHands Agent Canvas host helper (user-local; no sudo, apt, or Docker)

Usage:
  install-openhands-host.sh [ACTION] [OPTIONS]
  openhands-host [ACTION] [OPTIONS]

Actions:
  install          Install Node.js 24, uv, and Agent Canvas; then start it.
  update           Update the helper, runtimes, and Agent Canvas; then restart.
  start            Start Agent Canvas as a helper-managed background service.
  stop             Stop the helper-managed Agent Canvas process.
  restart          Stop and start the background service.
  run              Run in the foreground for WebConsole supervision.
  status           Show installed versions, process state, and health.
  logs             Show the last 120 log lines (use --follow to keep watching).
  access-info      Print the browser URL and the private session API key.
  web-check        Check the local frontend and authenticated health endpoint.
  doctor           Run host, runtime, resource, configuration, and health checks.
  rotate-key       Generate a new API key and restart if currently running.
  self-update      Update only this helper from its canonical URL.
  uninstall        Remove runtimes; data/config remain unless --purge-data is used.
  helper-version   Print this helper's version.

Options:
  --home PATH             Writable account home (for example /home/sabashop).
  --port PORT             Public ingress port (default: 8810).
  --host HOST             Bind address (default: 0.0.0.0).
  --access-host HOST      Hostname printed by access-info (no scheme or port).
  --access-scheme SCHEME  Browser scheme: http (default) or https with a TLS proxy.
  --canvas-version VER    npm version/range (default: latest).
  --workspace PATH        Agent Canvas workspace directory.
  --backend-port PORT     Internal agent-server port (default: 18810).
  --automation-port PORT  Internal automation port (default: 18811).
  --frontend-port PORT    Internal static frontend port (default: 13810).
  --no-start              Install/update/rotate without starting afterward.
  --follow                Follow output with the logs action.
  --yes                   Confirm non-interactive uninstall.
  --purge-data            Also delete settings, workspaces, secrets, and logs.
  -h, --help              Show this help.

After the first installation, use only the short installed command:
  openhands-host update
  openhands-host status
  openhands-host restart
  openhands-host logs --follow
  openhands-host access-info
  openhands-host doctor

Security: Agent Canvas is started in --public mode with a generated 256-bit API
key. It is not a sandbox: agents have this hosting user's filesystem, shell, and
network permissions. Use HTTPS through a real reverse proxy before entering the
key over an untrusted network.
EOF
}

while (($#)); do
    case "$1" in
        install|update|start|stop|restart|run|status|logs|access-info|web-check|doctor|rotate-key|self-update|uninstall|helper-version|_serve)
            [[ "$ACTION_SET" == false ]] || die "More than one action was supplied: $1"
            ACTION="$1"; ACTION_SET=true; shift ;;
        --home)
            (($# >= 2)) || die '--home requires a path.'
            HOME_OVERRIDE="$2"; shift 2 ;;
        --port)
            (($# >= 2)) || die '--port requires a value.'
            CLI_PORT="$2"; shift 2 ;;
        --host)
            (($# >= 2)) || die '--host requires a value.'
            CLI_LISTEN_HOST="$2"; shift 2 ;;
        --access-host)
            (($# >= 2)) || die '--access-host requires a value.'
            CLI_ACCESS_HOST="$2"; shift 2 ;;
        --access-scheme)
            (($# >= 2)) || die '--access-scheme requires a value.'
            CLI_ACCESS_SCHEME="$2"; shift 2 ;;
        --canvas-version)
            (($# >= 2)) || die '--canvas-version requires a value.'
            CLI_CANVAS_VERSION="$2"; shift 2 ;;
        --workspace)
            (($# >= 2)) || die '--workspace requires a path.'
            CLI_WORKSPACE="$2"; shift 2 ;;
        --backend-port)
            (($# >= 2)) || die '--backend-port requires a value.'
            CLI_BACKEND_PORT="$2"; shift 2 ;;
        --automation-port)
            (($# >= 2)) || die '--automation-port requires a value.'
            CLI_AUTOMATION_PORT="$2"; shift 2 ;;
        --frontend-port)
            (($# >= 2)) || die '--frontend-port requires a value.'
            CLI_FRONTEND_PORT="$2"; shift 2 ;;
        --no-start) NO_START=true; shift ;;
        --follow) FOLLOW_LOG=true; shift ;;
        --yes) ASSUME_YES=true; shift ;;
        --purge-data) PURGE_DATA=true; shift ;;
        --skip-self-update) SKIP_SELF_UPDATE=true; shift ;;
        -h|--help) usage; exit 0 ;;
        --) shift; break ;;
        *) die "Unknown argument: $1" ;;
    esac
done

if [[ "$ACTION" == "helper-version" ]]; then
    printf '%s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
    exit 0
fi

[[ "$(uname -s)" == "Linux" ]] || die 'This helper currently supports Linux only.'
[[ "$(id -u)" != "0" ]] || die 'Run this helper as the hosting account, not root.'

resolve_home() {
    local candidate="" python_home="" passwd_home="" username=""
    username="$(id -un 2>/dev/null || true)"

    if [[ -n "$HOME_OVERRIDE" ]]; then
        [[ "$HOME_OVERRIDE" == /* ]] || die '--home must be an absolute path.'
        [[ -d "$HOME_OVERRIDE" && -w "$HOME_OVERRIDE" ]] || die "Home is missing or not writable: $HOME_OVERRIDE"
        (cd "$HOME_OVERRIDE" && pwd -P)
        return
    fi

    if command -v python3 >/dev/null 2>&1; then
        python_home="$(python3 -c 'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)' 2>/dev/null || true)"
    fi
    if command -v getent >/dev/null 2>&1; then
        passwd_home="$(getent passwd "$(id -u)" 2>/dev/null | awk -F: 'NR==1{print $6}' || true)"
    fi

    for candidate in "$python_home" "$passwd_home" "${HOME:-}" "/home/$username"; do
        [[ -n "$candidate" && "$candidate" == /* && "$candidate" != "/" ]] || continue
        if [[ -d "$candidate" && -w "$candidate" ]]; then
            (cd "$candidate" && pwd -P)
            return
        fi
    done

    die 'Could not detect a writable account home. Use --home /absolute/path.'
}

REAL_HOME="$(resolve_home)"
export HOME="$REAL_HOME"

APP_ROOT="$HOME/.local/share/openhands-host"
NODE_HOME="$APP_ROOT/node"
NPM_ROOT="$APP_ROOT/npm"
TOOLS_DIR="$APP_ROOT/tools"
DATA_DIR="$APP_ROOT/data"
CANVAS_STATE_DIR="$DATA_DIR/agent-canvas"
CACHE_DIR="$HOME/.cache/openhands-host"
CONFIG_DIR="$HOME/.config/openhands-host"
STATE_DIR="$HOME/.local/state/openhands-host"
HELPER_COPY="$APP_ROOT/helper.sh"
WRAPPER="$HOME/.local/bin/openhands-host"
ENV_FILE="$CONFIG_DIR/env.sh"
CONFIG_FILE="$CONFIG_DIR/config.env"
SECRETS_FILE="$CONFIG_DIR/secrets.env"
PID_FILE="$STATE_DIR/agent-canvas.pid"
PID_START_FILE="$STATE_DIR/agent-canvas.pid.start"
LOG_FILE="$STATE_DIR/agent-canvas.log"
UV_BIN="$TOOLS_DIR/uv"
UVX_BIN="$TOOLS_DIR/uvx"
AGENT_BIN="$NPM_ROOT/node_modules/.bin/agent-canvas"

PORT="8810"
LISTEN_HOST="0.0.0.0"
ACCESS_HOST="${OPENHANDS_ACCESS_HOST:-}"
ACCESS_SCHEME="http"
CANVAS_VERSION="latest"
WORKSPACE="$CANVAS_STATE_DIR/workspaces"
BACKEND_PORT="18810"
AUTOMATION_PORT="18811"
FRONTEND_PORT="13810"
NODE_INSTALLED_VERSION=""

# Only helper-generated, account-private configuration is sourced.
if [[ -r "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
fi

[[ -z "$CLI_PORT" ]] || PORT="$CLI_PORT"
[[ -z "$CLI_LISTEN_HOST" ]] || LISTEN_HOST="$CLI_LISTEN_HOST"
[[ -z "$CLI_ACCESS_HOST" ]] || ACCESS_HOST="$CLI_ACCESS_HOST"
[[ -z "$CLI_ACCESS_SCHEME" ]] || ACCESS_SCHEME="$CLI_ACCESS_SCHEME"
[[ -z "$CLI_CANVAS_VERSION" ]] || CANVAS_VERSION="$CLI_CANVAS_VERSION"
[[ -z "$CLI_WORKSPACE" ]] || WORKSPACE="$CLI_WORKSPACE"
[[ -z "$CLI_BACKEND_PORT" ]] || BACKEND_PORT="$CLI_BACKEND_PORT"
[[ -z "$CLI_AUTOMATION_PORT" ]] || AUTOMATION_PORT="$CLI_AUTOMATION_PORT"
[[ -z "$CLI_FRONTEND_PORT" ]] || FRONTEND_PORT="$CLI_FRONTEND_PORT"

validate_port() {
    local label="$1" value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] || die "$label must be numeric."
    ((value >= 1024 && value <= 65535)) || die "$label must be between 1024 and 65535."
}

validate_config() {
    local i j
    local -a labels=('ingress' 'agent-server' 'automation' 'frontend' 'editor')
    local -a ports
    validate_port 'Ingress port' "$PORT"
    validate_port 'Agent-server port' "$BACKEND_PORT"
    validate_port 'Automation port' "$AUTOMATION_PORT"
    validate_port 'Frontend port' "$FRONTEND_PORT"
    ((BACKEND_PORT + 1000 <= 65535)) || die 'The agent-server port is too high for its editor sidecar port.'
    ports=("$PORT" "$BACKEND_PORT" "$AUTOMATION_PORT" "$FRONTEND_PORT" "$((BACKEND_PORT + 1000))")

    for ((i = 0; i < ${#ports[@]}; i++)); do
        for ((j = i + 1; j < ${#ports[@]}; j++)); do
            [[ "${ports[$i]}" != "${ports[$j]}" ]] || \
                die "Ports must be unique: ${labels[$i]} and ${labels[$j]} both use ${ports[$i]}."
        done
    done

    [[ -n "$LISTEN_HOST" && "$LISTEN_HOST" != *[[:space:]]* ]] || die 'Invalid bind host.'
    [[ -z "$ACCESS_HOST" || ( "$ACCESS_HOST" != *[[:space:]/:]* && "$ACCESS_HOST" != *'://'*) ]] || die '--access-host must be a hostname or IP without scheme/port.'
    [[ "$ACCESS_SCHEME" == "http" || "$ACCESS_SCHEME" == "https" ]] || die '--access-scheme must be http or https.'
    [[ -n "$CANVAS_VERSION" && "$CANVAS_VERSION" != *[[:space:]]* ]] || die 'Invalid Agent Canvas version.'
    [[ "$WORKSPACE" == /* ]] || die '--workspace must be an absolute path.'
}
validate_config

prepare_dirs() {
    mkdir -p \
        "$HOME/.local/bin" \
        "$APP_ROOT" \
        "$TOOLS_DIR" \
        "$DATA_DIR" \
        "$CANVAS_STATE_DIR" \
        "$CACHE_DIR" \
        "$CONFIG_DIR" \
        "$STATE_DIR" \
        "$WORKSPACE"
    chmod 700 "$APP_ROOT" "$DATA_DIR" "$CACHE_DIR" "$CONFIG_DIR" "$STATE_DIR" 2>/dev/null || true
}

write_wrapper() {
    {
        printf '#!/usr/bin/env bash\n'
        printf 'exec %q --home %q "$@"\n' "$HELPER_COPY" "$HOME"
    } > "$WRAPPER"
    chmod 700 "$WRAPPER"
}

persist_helper() {
    local source_path="${BASH_SOURCE[0]:-}" source_real="" helper_real=""
    prepare_dirs

    if [[ -n "$source_path" && -f "$source_path" && "$source_path" != /dev/* ]]; then
        source_real="$(cd "$(dirname "$source_path")" && pwd -P)/$(basename "$source_path")"
        helper_real="$(cd "$(dirname "$HELPER_COPY")" && pwd -P)/$(basename "$HELPER_COPY")"
        if [[ "$source_real" != "$helper_real" ]]; then
            cp "$source_path" "$HELPER_COPY"
        fi
    elif [[ ! -s "$HELPER_COPY" ]]; then
        die "Download this helper to a file before running it: $SELF_URL"
    fi

    chmod 700 "$HELPER_COPY"
    write_wrapper
}

save_config() {
    prepare_dirs
    {
        printf '# Generated by %s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
        printf 'PORT=%q\n' "$PORT"
        printf 'LISTEN_HOST=%q\n' "$LISTEN_HOST"
        printf 'ACCESS_HOST=%q\n' "$ACCESS_HOST"
        printf 'ACCESS_SCHEME=%q\n' "$ACCESS_SCHEME"
        printf 'CANVAS_VERSION=%q\n' "$CANVAS_VERSION"
        printf 'WORKSPACE=%q\n' "$WORKSPACE"
        printf 'BACKEND_PORT=%q\n' "$BACKEND_PORT"
        printf 'AUTOMATION_PORT=%q\n' "$AUTOMATION_PORT"
        printf 'FRONTEND_PORT=%q\n' "$FRONTEND_PORT"
        printf 'NODE_INSTALLED_VERSION=%q\n' "$NODE_INSTALLED_VERSION"
    } > "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
}

write_environment() {
    local profile marker='# OpenHands Agent Canvas user-local environment'
    prepare_dirs
    {
        printf '# Generated by %s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
        printf 'export OPENHANDS_HOST_HOME=%q\n' "$APP_ROOT"
        printf 'export PATH=%q:%q:%q:"${PATH:-/usr/local/bin:/usr/bin:/bin}"\n' \
            "$NODE_HOME/bin" "$TOOLS_DIR" "$HOME/.local/bin"
        printf 'export UV_CACHE_DIR=%q\n' "$CACHE_DIR/uv"
        printf 'export UV_PYTHON_INSTALL_DIR=%q\n' "$APP_ROOT/python"
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    for profile in "$HOME/.profile" "$HOME/.bashrc"; do
        touch "$profile" 2>/dev/null || continue
        if ! grep -Fq "$marker" "$profile" 2>/dev/null; then
            {
                printf '\n%s\n' "$marker"
                printf '[ -r %q ] && . %q\n' "$ENV_FILE" "$ENV_FILE"
            } >> "$profile"
        fi
    done
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "$1 is required by this helper."
}

secure_curl() {
    curl --proto '=https' --tlsv1.2 -fL --retry 3 --connect-timeout 25 "$@"
}

sha256_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
    elif command -v python3 >/dev/null 2>&1; then
        python3 - "$file" <<'PY'
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], 'rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
print(h.hexdigest())
PY
    else
        die 'sha256sum, shasum, or Python 3 is required for download verification.'
    fi
}

verify_checksum() {
    local file="$1" manifest="$2" filename="$3" expected="" actual=""
    expected="$(awk -v name="$filename" '$2 == name {print $1; exit}' "$manifest")"
    [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || return 1
    actual="$(sha256_file "$file")"
    [[ "${actual,,}" == "${expected,,}" ]]
}

extract_tar_xz() {
    local archive="$1" destination="$2"
    if tar -xJf "$archive" -C "$destination" 2>/dev/null; then
        return 0
    fi
    command -v python3 >/dev/null 2>&1 || return 1
    python3 - "$archive" "$destination" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[1], 'r:xz') as archive:
    archive.extractall(sys.argv[2])
PY
}

node_major() {
    "$1" --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\).*/\1/p'
}

node_is_usable() {
    local binary="$1" major=""
    [[ -x "$binary" ]] || return 1
    major="$(node_major "$binary")"
    [[ "$major" =~ ^[0-9]+$ ]] && ((major >= NODE_MAJOR))
}

glibc_is_older_than_228() {
    local version="" major="" minor=""
    version="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}' || true)"
    [[ "$version" =~ ^([0-9]+)\.([0-9]+) ]] || return 1
    major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"
    ((major < 2 || (major == 2 && minor < 28)))
}

try_node_archive() {
    local base_url="$1" archive="$2" manifest="$3"
    local downloaded="$CACHE_DIR/$archive" stage="$CACHE_DIR/node-extract.$$"
    local extracted="$stage/${archive%.tar.xz}" candidate="$APP_ROOT/node.candidate.$$"
    local backup="$APP_ROOT/node.previous"

    log "Downloading $archive ..."
    secure_curl "$base_url/$archive" -o "$downloaded" || return 1
    if ! verify_checksum "$downloaded" "$manifest" "$archive"; then
        warn "SHA-256 verification failed for $archive"
        rm -f "$downloaded"
        return 1
    fi

    rm -rf "$stage" "$candidate"
    mkdir -p "$stage"
    if ! extract_tar_xz "$downloaded" "$stage"; then
        warn "Could not extract $archive (tar/Python xz support is required)."
        rm -rf "$stage"
        return 1
    fi
    [[ -x "$extracted/bin/node" ]] || { rm -rf "$stage"; return 1; }
    if ! "$extracted/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; then
        warn "The Node.js binary in $archive cannot run on this host."
        rm -rf "$stage"
        return 1
    fi

    mv "$extracted" "$candidate"
    rm -rf "$stage" "$backup"
    if [[ -e "$NODE_HOME" ]]; then mv "$NODE_HOME" "$backup"; fi
    if ! mv "$candidate" "$NODE_HOME"; then
        [[ ! -e "$backup" ]] || mv "$backup" "$NODE_HOME"
        return 1
    fi
    rm -rf "$backup"
    return 0
}

install_node() {
    local arch="" manifest="$CACHE_DIR/node-official-shasums.txt"
    local archive="" version="" base_url="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
    local unofficial_manifest="$CACHE_DIR/node-unofficial-shasums.txt"
    local unofficial_archive="" unofficial_base=""

    require_command curl
    require_command tar
    prepare_dirs

    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        aarch64|arm64) arch="arm64" ;;
        *) die "Unsupported CPU architecture for managed Node.js: $(uname -m)" ;;
    esac

    log "Resolving the latest Node.js ${NODE_MAJOR}.x release..."
    if ! secure_curl "$base_url/SHASUMS256.txt" -o "$manifest"; then
        if node_is_usable "$NODE_HOME/bin/node"; then
            warn 'Could not check Node.js updates; keeping the working managed runtime.'
            NODE_INSTALLED_VERSION="$($NODE_HOME/bin/node --version)"
            export PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
            return 0
        fi
        die 'Could not download the official Node.js checksum manifest.'
    fi

    archive="$(awk -v suffix="-linux-$arch.tar.xz" 'index($2, suffix) && substr($2, length($2)-length(suffix)+1) == suffix {print $2; exit}' "$manifest")"
    [[ -n "$archive" ]] || die "The Node.js release has no linux-$arch archive."
    version="${archive%%-linux-*}"
    version="${version#node-}"

    if node_is_usable "$NODE_HOME/bin/node" && [[ "$($NODE_HOME/bin/node --version)" == "$version" ]]; then
        log "Node.js is current: $version"
    else
        if [[ "$arch" == "x64" ]] && glibc_is_older_than_228; then
            warn 'Host glibc is older than 2.28; using the checksummed Node.js unofficial-builds compatibility binary.'
            unofficial_base="https://unofficial-builds.nodejs.org/download/release/$version"
            unofficial_archive="node-${version}-linux-x64-glibc-217.tar.xz"
            secure_curl "$unofficial_base/SHASUMS256.txt" -o "$unofficial_manifest" || \
                die "No compatibility checksum manifest is available for Node.js $version."
            try_node_archive "$unofficial_base" "$unofficial_archive" "$unofficial_manifest" || \
                die "No runnable glibc-2.17-compatible Node.js $version binary is available."
        elif ! try_node_archive "$base_url" "$archive" "$manifest"; then
            if [[ "$arch" != "x64" ]]; then
                die 'The official Node.js binary cannot run, and no safe compatibility fallback exists for this CPU.'
            fi
            warn 'Official Node.js could not run; trying the checksummed glibc-2.17 compatibility build.'
            unofficial_base="https://unofficial-builds.nodejs.org/download/release/$version"
            unofficial_archive="node-${version}-linux-x64-glibc-217.tar.xz"
            secure_curl "$unofficial_base/SHASUMS256.txt" -o "$unofficial_manifest" || \
                die "No compatibility checksum manifest is available for Node.js $version."
            try_node_archive "$unofficial_base" "$unofficial_archive" "$unofficial_manifest" || \
                die "Neither the official nor compatibility Node.js $version binary runs on this host."
        fi
    fi

    node_is_usable "$NODE_HOME/bin/node" || die 'Managed Node.js validation failed.'
    NODE_INSTALLED_VERSION="$($NODE_HOME/bin/node --version)"
    export PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
    log "Node.js ready: $NODE_INSTALLED_VERSION"
}

install_uv() {
    local installer="$CACHE_DIR/uv-installer.sh"
    require_command curl
    prepare_dirs
    log 'Downloading the official uv installer...'
    if ! secure_curl https://astral.sh/uv/install.sh -o "$installer"; then
        [[ -x "$UV_BIN" && -x "$UVX_BIN" ]] || die 'Could not download uv and no managed uv installation exists.'
        warn 'Could not check uv updates; keeping the working managed installation.'
        return
    fi
    [[ -s "$installer" ]] || die 'The downloaded uv installer is empty.'
    chmod 700 "$installer"
    log 'Installing/updating uv in the account directory...'
    env UV_UNMANAGED_INSTALL="$TOOLS_DIR" UV_NO_MODIFY_PATH=1 sh "$installer"
    [[ -x "$UV_BIN" && -x "$UVX_BIN" ]] || die "uv/uvx were not installed in $TOOLS_DIR"
    export PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
    log "uv ready: $($UV_BIN --version)"
}

install_canvas() {
    node_is_usable "$NODE_HOME/bin/node" || die 'Install Node.js 24+ before Agent Canvas.'
    [[ -x "$UVX_BIN" ]] || die 'Install uv before Agent Canvas.'
    prepare_dirs
    export PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
    export npm_config_cache="$CACHE_DIR/npm"
    log "Installing $PACKAGE_NAME@$CANVAS_VERSION from npm..."
    "$NODE_HOME/bin/npm" install \
        --prefix "$NPM_ROOT" \
        --omit=dev \
        --no-audit \
        --no-fund \
        --no-update-notifier \
        "$PACKAGE_NAME@$CANVAS_VERSION"
    [[ -x "$AGENT_BIN" ]] || die "Agent Canvas was not installed at $AGENT_BIN"
    "$AGENT_BIN" --version >/dev/null 2>&1 || die 'Agent Canvas executable validation failed.'
    log "Agent Canvas ready: $($AGENT_BIN --version)"
}

runtime_is_complete() {
    node_is_usable "$NODE_HOME/bin/node" || return 1
    [[ -x "$UV_BIN" && -x "$UVX_BIN" && -x "$AGENT_BIN" ]] || return 1
    PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}" \
        "$AGENT_BIN" --version >/dev/null 2>&1
}

ensure_runtime_installed() {
    if runtime_is_complete; then
        ensure_secrets
        write_environment
        return 0
    fi

    log 'Agent Canvas runtime is incomplete; repairing it automatically before startup...'
    preflight_install
    prepare_dirs
    if ! node_is_usable "$NODE_HOME/bin/node"; then
        install_node
    else
        export PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
        NODE_INSTALLED_VERSION="$($NODE_HOME/bin/node --version)"
        log "Using the installed managed Node.js: $NODE_INSTALLED_VERSION"
    fi
    if [[ ! -x "$UV_BIN" || ! -x "$UVX_BIN" ]]; then
        install_uv
    else
        log "Using the installed managed uv: $($UV_BIN --version)"
    fi
    if [[ ! -x "$AGENT_BIN" ]] || ! PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}" \
        "$AGENT_BIN" --version >/dev/null 2>&1; then
        install_canvas
    fi
    ensure_secrets
    save_config
    write_environment
    runtime_is_complete || die 'Automatic Agent Canvas runtime repair did not complete successfully.'
    log 'Automatic runtime repair completed.'
}

generate_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    elif [[ -r /dev/urandom ]] && command -v od >/dev/null 2>&1; then
        od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c 'import secrets; print(secrets.token_hex(32))'
    else
        die 'openssl, od with /dev/urandom, or Python 3 is required to generate secure keys.'
    fi
}

write_new_secrets() {
    local api_key secret_key
    prepare_dirs
    api_key="$(generate_secret)"
    secret_key="$(generate_secret)"
    [[ ${#api_key} -ge 64 && ${#secret_key} -ge 64 ]] || die 'Secure key generation failed.'
    {
        printf '# Generated locally by %s; never commit or share this file.\n' "$SCRIPT_NAME"
        printf 'LOCAL_BACKEND_API_KEY=%q\n' "$api_key"
        printf 'OH_SECRET_KEY=%q\n' "$secret_key"
    } > "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"
}

ensure_secrets() {
    if [[ ! -s "$SECRETS_FILE" ]]; then
        log 'Generating private 256-bit Agent Canvas keys...'
        write_new_secrets
    fi
    # shellcheck disable=SC1090
    . "$SECRETS_FILE"
    [[ -n "${LOCAL_BACKEND_API_KEY:-}" && ${#LOCAL_BACKEND_API_KEY} -ge 32 ]] || die 'The stored LOCAL_BACKEND_API_KEY is invalid.'
    [[ -n "${OH_SECRET_KEY:-}" && ${#OH_SECRET_KEY} -ge 32 ]] || die 'The stored OH_SECRET_KEY is invalid.'
    export LOCAL_BACKEND_API_KEY OH_SECRET_KEY
}

load_runtime_environment() {
    [[ -x "$AGENT_BIN" ]] || die 'Agent Canvas is not installed. Run: openhands-host install'
    [[ -x "$UVX_BIN" ]] || die 'Managed uvx is missing. Run: openhands-host install'
    node_is_usable "$NODE_HOME/bin/node" || die 'Managed Node.js 24+ is missing. Run: openhands-host install'
    ensure_secrets
    prepare_dirs
    export HOME
    export PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
    export UV_CACHE_DIR="$CACHE_DIR/uv"
    export UV_PYTHON_INSTALL_DIR="$APP_ROOT/python"
    export UV_TOOL_DIR="$APP_ROOT/uv-tools"
    export OH_CANVAS_SAFE_STATE_DIR="$CANVAS_STATE_DIR"
    export OH_CANVAS_SAFE_BACKEND_PORT="$BACKEND_PORT"
    export OH_CANVAS_SAFE_AUTOMATION_PORT="$AUTOMATION_PORT"
    export OH_CANVAS_SAFE_VITE_PORT="$FRONTEND_PORT"
    export VITE_WORKING_DIR="$WORKSPACE"
    export AUTOMATION_WORKSPACE_BASE="$WORKSPACE"
}

process_start_token() {
    local pid="$1"
    [[ -r "/proc/$pid/stat" ]] || return 1
    awk '{print $22}' "/proc/$pid/stat" 2>/dev/null
}

record_pid() {
    local pid="$1" token=""
    printf '%s\n' "$pid" > "$PID_FILE"
    token="$(process_start_token "$pid" 2>/dev/null || true)"
    printf '%s\n' "$token" > "$PID_START_FILE"
    chmod 600 "$PID_FILE" "$PID_START_FILE" 2>/dev/null || true
}

pid_belongs_to_canvas() {
    local pid="${1:-}" saved_token="" live_token="" uid_line="" cmdline=""
    [[ "$pid" =~ ^[0-9]+$ && -d "/proc/$pid" ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1

    uid_line="$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null || true)"
    [[ "$uid_line" == "$(id -u)" ]] || return 1
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if [[ "$cmdline" != *"$AGENT_BIN"* && "$cmdline" != *"$HELPER_COPY"* && "$cmdline" != *"$WRAPPER"* ]]; then
        [[ "$cmdline" == *"$NPM_ROOT"* && "$cmdline" == *"agent-canvas"* ]] || return 1
    fi

    if [[ -s "$PID_START_FILE" ]]; then
        saved_token="$(cat "$PID_START_FILE" 2>/dev/null || true)"
        live_token="$(process_start_token "$pid" 2>/dev/null || true)"
        [[ -z "$saved_token" || "$saved_token" == "$live_token" ]] || return 1
    fi
    return 0
}

managed_pid() {
    local pid=""
    [[ -r "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if pid_belongs_to_canvas "$pid"; then
        printf '%s\n' "$pid"
        return 0
    fi
    rm -f "$PID_FILE" "$PID_START_FILE"
    return 1
}

local_url() { printf 'http://127.0.0.1:%s' "$PORT"; }

browser_host() {
    local detected=""
    if [[ -n "$ACCESS_HOST" ]]; then
        printf '%s\n' "$ACCESS_HOST"
    elif [[ "$LISTEN_HOST" != "0.0.0.0" && "$LISTEN_HOST" != "::" && "$LISTEN_HOST" != "127.0.0.1" ]]; then
        printf '%s\n' "$LISTEN_HOST"
    else
        detected="$(hostname -f 2>/dev/null || hostname 2>/dev/null || true)"
        [[ -n "$detected" ]] && printf '%s\n' "$detected" || printf '%s\n' '<server-host>'
    fi
}

browser_url() {
    local host
    host="$(browser_host)"
    if [[ "$ACCESS_SCHEME" == "https" && "$PORT" == "443" ]]; then
        printf 'https://%s/' "$host"
    elif [[ "$ACCESS_SCHEME" == "http" && "$PORT" == "80" ]]; then
        printf 'http://%s/' "$host"
    else
        printf '%s://%s:%s/' "$ACCESS_SCHEME" "$host" "$PORT"
    fi
}

agent_is_healthy() {
    ensure_secrets >/dev/null
    curl -fsS --max-time 5 \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" \
        "$(local_url)/health" >/dev/null 2>&1
}

port_is_open() {
    local port="$1"
    (exec 9<>"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
}

assert_runtime_ports_free() {
    local label port
    for label in ingress agent-server automation frontend editor; do
        case "$label" in
            ingress) port="$PORT" ;;
            agent-server) port="$BACKEND_PORT" ;;
            automation) port="$AUTOMATION_PORT" ;;
            frontend) port="$FRONTEND_PORT" ;;
            editor) port="$((BACKEND_PORT + 1000))" ;;
        esac
        if port_is_open "$port"; then
            die "$label port $port is already in use. Choose different helper ports or stop the conflicting service."
        fi
    done
    return 0
}

serve_agent() {
    local -a args=(--public --port "$PORT" --host "$LISTEN_HOST")
    load_runtime_environment
    assert_runtime_ports_free
    record_pid "$$"

    # Keep stdout/stderr attached directly to WebConsole. Some restricted hosts
    # do not mount /dev/fd, so Bash process substitution (tee via /dev/fd/N)
    # fails before Agent Canvas can start. Background mode is already redirected
    # to the helper log by start_agent.
    log "Starting Agent Canvas in authenticated public mode on $LISTEN_HOST:$PORT"
    exec "$AGENT_BIN" "${args[@]}"
}

start_agent() {
    local pid="" waited=0
    prepare_dirs
    save_config
    persist_helper
    if pid="$(managed_pid 2>/dev/null)"; then
        log "Agent Canvas is already running (PID $pid)."
        agent_is_healthy && log "Health: OK ($(local_url)/health)" || warn 'The process is running but is not healthy yet.'
        return 0
    fi
    ensure_runtime_installed
    load_runtime_environment
    assert_runtime_ports_free
    : > "$LOG_FILE"
    chmod 600 "$LOG_FILE" 2>/dev/null || true

    log 'Starting Agent Canvas in the background...'
    if command -v setsid >/dev/null 2>&1; then
        nohup setsid "$WRAPPER" _serve >>"$LOG_FILE" 2>&1 </dev/null &
    else
        nohup "$WRAPPER" _serve >>"$LOG_FILE" 2>&1 </dev/null &
    fi
    pid=$!
    record_pid "$pid"

    while ((waited < 180)); do
        if agent_is_healthy; then
            log "Agent Canvas is ready: $(browser_url)"
            log 'Run openhands-host access-info to display the required API key.'
            return 0
        fi
        if ! pid_belongs_to_canvas "$pid"; then
            tail -n 80 "$LOG_FILE" >&2 2>/dev/null || true
            die 'Agent Canvas exited during startup. See: openhands-host logs'
        fi
        sleep 1
        waited=$((waited + 1))
    done

    warn 'Agent Canvas is still starting (the first uv/Python setup can take several minutes).'
    log 'Follow progress with: openhands-host logs --follow'
}

stop_agent() {
    local pid="" waited=0 pgid=""
    if ! pid="$(managed_pid 2>/dev/null)"; then
        log 'Agent Canvas is not running under this helper.'
        return 0
    fi

    log "Stopping Agent Canvas (PID $pid)..."
    kill -TERM "$pid" 2>/dev/null || true
    while ((waited < 25)) && kill -0 "$pid" 2>/dev/null; do
        sleep 1
        waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
        warn 'Graceful shutdown timed out; forcing the main process to stop.'
        pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
        if [[ "$pgid" == "$pid" ]]; then
            kill -KILL -- "-$pid" 2>/dev/null || true
        else
            kill -KILL "$pid" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE" "$PID_START_FILE"
    log 'Agent Canvas stopped.'
}

run_foreground() {
    local pid=""
    prepare_dirs
    save_config
    persist_helper
    if pid="$(managed_pid 2>/dev/null)"; then
        die "Agent Canvas is already running (PID $pid)."
    fi
    ensure_runtime_installed
    serve_agent foreground
}

show_status() {
    local pid="" canvas_version="not installed" node_version="not installed" uv_version="not installed"
    [[ -x "$NODE_HOME/bin/node" ]] && node_version="$($NODE_HOME/bin/node --version 2>&1 || true)"
    [[ -x "$UV_BIN" ]] && uv_version="$($UV_BIN --version 2>&1 || true)"
    if [[ -x "$AGENT_BIN" ]]; then
        export PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
        canvas_version="$($AGENT_BIN --version 2>&1 || true)"
    fi

    printf 'Helper: %s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
    printf 'Home: %s\n' "$HOME"
    printf 'Node.js: %s\n' "$node_version"
    printf 'uv: %s\n' "$uv_version"
    printf 'Agent Canvas: %s\n' "$canvas_version"
    printf 'Browser URL: %s\n' "$(browser_url)"
    printf 'Workspace: %s\n' "$WORKSPACE"
    printf 'Mode: public (API key required)\n'
    if pid="$(managed_pid 2>/dev/null)"; then
        printf 'Process: running (PID %s)\n' "$pid"
        if agent_is_healthy; then printf 'Health: OK\n'; else printf 'Health: starting/unavailable\n'; fi
    else
        printf 'Process: stopped\n'
        printf 'Health: unavailable\n'
    fi
}

show_logs() {
    [[ -e "$LOG_FILE" ]] || die "No helper log exists yet: $LOG_FILE"
    if [[ "$FOLLOW_LOG" == true ]]; then
        tail -n 120 -F "$LOG_FILE"
    else
        tail -n 120 "$LOG_FILE"
    fi
}

show_access_info() {
    ensure_secrets
    printf 'OpenHands URL: %s\n' "$(browser_url)"
    printf 'Session API key: %s\n' "$LOCAL_BACKEND_API_KEY"
    printf 'Mode: --public (the key is not embedded in the frontend)\n'
    if [[ "$ACCESS_SCHEME" == "http" ]]; then
        printf 'Transport: plain HTTP. Do not enter the key over an untrusted network.\n'
        printf 'For Internet use, terminate TLS in a real reverse proxy, then configure --access-scheme https.\n'
    else
        printf 'Transport: HTTPS URL configured; verify that your external proxy really terminates TLS.\n'
    fi
    printf 'Warning: authenticated agents have this account user\047s filesystem, shell, and network permissions.\n'
}

web_check() {
    local tmp="$CACHE_DIR/web-check.$$" root_code="" health_code=""
    ensure_secrets
    mkdir -p "$tmp"
    trap 'rm -rf "$tmp"' RETURN

    root_code="$(curl -sS --max-time 10 -o "$tmp/root" -w '%{http_code}' "$(local_url)/" || true)"
    health_code="$(curl -sS --max-time 10 -o "$tmp/health" -w '%{http_code}' \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" "$(local_url)/health" || true)"
    printf 'Root: HTTP %s (%s/)\n' "${root_code:-000}" "$(local_url)"
    printf 'Authenticated health: HTTP %s (%s/health)\n' "${health_code:-000}" "$(local_url)"

    [[ "$root_code" == "200" ]] || die 'Agent Canvas frontend check failed.'
    grep -Eqi '<!doctype html|<html' "$tmp/root" || die 'The ingress root did not return an HTML application.'
    [[ "$health_code" == "200" ]] || die 'Authenticated Agent Canvas health check failed.'
    log 'Web check passed.'
}

resource_report() {
    local available_kb="" memory_kb="" cpus=""
    available_kb="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}' || true)"
    memory_kb="$(awk '/^MemTotal:/{print $2; exit}' /proc/meminfo 2>/dev/null || true)"
    cpus="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
    [[ "$available_kb" =~ ^[0-9]+$ ]] && printf 'Disk available: %s MiB\n' "$((available_kb / 1024))"
    [[ "$memory_kb" =~ ^[0-9]+$ ]] && printf 'Memory total: %s MiB\n' "$((memory_kb / 1024))"
    [[ "$cpus" =~ ^[0-9]+$ ]] && printf 'Logical CPUs: %s\n' "$cpus"
    [[ "$available_kb" =~ ^[0-9]+$ ]] && ((available_kb >= 1048576)) || warn 'Less than 1 GiB of free disk may be insufficient.'
    [[ "$memory_kb" =~ ^[0-9]+$ ]] && ((memory_kb >= 3145728)) || warn 'OpenHands recommends about 4 GiB RAM; this host reports less than 3 GiB.'
}

doctor() {
    local failed=0 pid="" perms=""
    printf 'Helper: %s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
    printf 'Account: %s (uid %s)\n' "$(id -un)" "$(id -u)"
    printf 'Home: %s\n' "$HOME"
    printf 'Kernel: %s\n' "$(uname -srmo 2>/dev/null || uname -a)"
    printf 'Architecture: %s\n' "$(uname -m)"
    printf 'glibc: %s\n' "$(getconf GNU_LIBC_VERSION 2>/dev/null || echo unknown)"
    resource_report

    [[ -d "$HOME" && -w "$HOME" ]] || { warn 'Account home is not writable.'; failed=1; }
    command -v curl >/dev/null 2>&1 || { warn 'curl is missing.'; failed=1; }
    command -v tar >/dev/null 2>&1 || { warn 'tar is missing.'; failed=1; }
    if node_is_usable "$NODE_HOME/bin/node"; then
        printf 'Managed Node.js: %s\n' "$($NODE_HOME/bin/node --version)"
    else
        warn 'Managed Node.js 24+ is missing or cannot run.'; failed=1
    fi
    if [[ -x "$UV_BIN" && -x "$UVX_BIN" ]]; then
        printf 'Managed uv: %s\n' "$($UV_BIN --version 2>&1)"
    else
        warn 'Managed uv/uvx is missing.'; failed=1
    fi
    if [[ -x "$AGENT_BIN" ]]; then
        export PATH="$NODE_HOME/bin:$TOOLS_DIR:$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
        printf 'Agent Canvas: %s\n' "$($AGENT_BIN --version 2>&1 || echo broken)"
    else
        warn 'Agent Canvas is missing.'; failed=1
    fi
    if [[ -s "$SECRETS_FILE" ]]; then
        perms="$(stat -c '%a' "$SECRETS_FILE" 2>/dev/null || true)"
        printf 'Secrets file: present (mode %s)\n' "${perms:-unknown}"
        [[ -z "$perms" || "$perms" == "600" ]] || { warn 'Secrets file permissions should be 600.'; failed=1; }
    else
        warn 'Secrets file is missing.'; failed=1
    fi
    printf 'Configured ports: ingress=%s agent=%s automation=%s frontend=%s editor=%s\n' \
        "$PORT" "$BACKEND_PORT" "$AUTOMATION_PORT" "$FRONTEND_PORT" "$((BACKEND_PORT + 1000))"

    if pid="$(managed_pid 2>/dev/null)"; then
        printf 'Process: running (PID %s)\n' "$pid"
        if agent_is_healthy; then printf 'Health: OK\n'; else warn 'Process is running but health is unavailable.'; failed=1; fi
    else
        printf 'Process: stopped\n'
    fi
    ((failed == 0)) || return 1
    log 'Doctor checks passed.'
}

refresh_helper() {
    local resume_action="${1:-update}"
    local candidate="$CACHE_DIR/helper-update.sh" candidate_version="" newest=""
    local -a next_args
    [[ "$SKIP_SELF_UPDATE" == false ]] || return 0
    require_command curl
    prepare_dirs
    log 'Checking the canonical helper for an update...'
    if ! secure_curl "$SELF_URL" -o "$candidate"; then
        warn 'Could not check for a helper update; continuing with this version.'
        rm -f "$candidate"
        return 0
    fi
    if ! bash -n "$candidate"; then
        warn 'Downloaded helper failed syntax validation and was ignored.'
        rm -f "$candidate"
        return 0
    fi
    candidate_version="$(sed -n 's/^SCRIPT_VERSION="\([^"]*\)"/\1/p' "$candidate" | head -n 1)"
    [[ -n "$candidate_version" ]] || { rm -f "$candidate"; return 0; }
    newest="$(printf '%s\n%s\n' "$SCRIPT_VERSION" "$candidate_version" | sort -V | tail -n 1)"
    if [[ "$candidate_version" == "$SCRIPT_VERSION" || "$newest" != "$candidate_version" ]]; then
        rm -f "$candidate"
        return 0
    fi

    log "Updating helper $SCRIPT_VERSION -> $candidate_version"
    mv -f "$candidate" "$HELPER_COPY"
    chmod 700 "$HELPER_COPY"
    write_wrapper
    next_args=("$resume_action" --home "$HOME" --skip-self-update)
    [[ "$NO_START" == false ]] || next_args+=(--no-start)
    exec "$HELPER_COPY" "${next_args[@]}"
}

rotate_key() {
    local was_running=false
    managed_pid >/dev/null 2>&1 && was_running=true
    [[ "$was_running" == false ]] || stop_agent
    write_new_secrets
    log 'A new Agent Canvas API key was generated; the previous key is invalid.'
    if [[ "$NO_START" == false && "$was_running" == true ]]; then start_agent; fi
    show_access_info
}

self_update_only() {
    refresh_helper self-update
    persist_helper
    log "Helper is current: $SCRIPT_VERSION"
}

preflight_install() {
    local available_kb=""
    require_command curl
    require_command tar
    available_kb="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}' || true)"
    if [[ "$available_kb" =~ ^[0-9]+$ ]] && ((available_kb < 786432)); then
        die 'At least 768 MiB of free disk is required to begin installation.'
    fi
    if [[ "$available_kb" =~ ^[0-9]+$ ]] && ((available_kb < 2097152)); then
        warn 'Less than 2 GiB is free; initial Python package downloads may exhaust disk space.'
    fi
}

uninstall_runtime() {
    if [[ "$ASSUME_YES" != true ]]; then
        if [[ -t 0 ]]; then
            printf 'Remove the OpenHands runtimes under %s? [y/N] ' "$APP_ROOT"
            read -r answer
            [[ "$answer" =~ ^[Yy]$ ]] || { log 'Uninstall cancelled.'; return 0; }
        else
            die 'Use --yes to confirm a non-interactive uninstall.'
        fi
    fi
    stop_agent
    rm -rf "$NODE_HOME" "$NPM_ROOT" "$TOOLS_DIR" "$APP_ROOT/python" "$APP_ROOT/uv-tools" "$HELPER_COPY"
    rm -f "$WRAPPER" "$ENV_FILE"
    if [[ "$PURGE_DATA" == true ]]; then
        [[ "$APP_ROOT" == "$HOME/.local/share/openhands-host" ]] || die 'Refusing to purge an unexpected application path.'
        rm -rf "$APP_ROOT" "$CONFIG_DIR" "$STATE_DIR" "$CACHE_DIR"
        log 'OpenHands runtimes, settings, workspaces, secrets, caches, and logs were removed.'
    else
        log 'OpenHands runtimes were removed. Data, settings, workspaces, secrets, and logs were preserved.'
    fi
}

case "$ACTION" in
    install)
        preflight_install
        prepare_dirs
        persist_helper
        save_config
        stop_agent
        install_node
        install_uv
        install_canvas
        ensure_secrets
        save_config
        write_environment
        if [[ "$NO_START" == false ]]; then start_agent; fi
        show_status
        ;;
    update)
        preflight_install
        prepare_dirs
        refresh_helper
        persist_helper
        save_config
        stop_agent
        install_node
        install_uv
        install_canvas
        ensure_secrets
        save_config
        write_environment
        if [[ "$NO_START" == false ]]; then start_agent; fi
        show_status
        ;;
    start) start_agent ;;
    stop) stop_agent ;;
    restart)
        stop_agent
        start_agent
        ;;
    run) run_foreground ;;
    _serve) serve_agent background ;;
    status) show_status ;;
    logs) show_logs ;;
    access-info) show_access_info ;;
    web-check) web_check ;;
    doctor) doctor ;;
    rotate-key) rotate_key ;;
    self-update) self_update_only ;;
    uninstall) uninstall_runtime ;;
esac
