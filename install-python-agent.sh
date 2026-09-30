#!/usr/bin/env bash
# Install the latest stable CPython and Open WebUI Computer (cptr) without
# sudo, apt, Docker, or changes to /usr/bin.
#
# Download once, then use only the helper:
#   curl -fsSL RAW_URL -o "$HOME/install-python-agent.sh"
#   bash "$HOME/install-python-agent.sh" install --home "$HOME"
#   python-agent status
#
# The helper installs user-level python/python3 launchers in ~/.local/bin and
# places that directory first in PATH for future login and Bash sessions.

set -Eeuo pipefail

SCRIPT_NAME="python-agent-helper"
SCRIPT_VERSION="1.0.0"
SELF_URL="https://raw.githubusercontent.com/fazilatma/new/main/install-python-agent.sh"

ACTION="install"
ACTION_SET=false
HOME_OVERRIDE=""
CLI_PORT=""
CLI_HOST=""
CLI_PYTHON_REQUEST=""
CLI_EXTRAS=""
CLI_WORKSPACE=""
NO_START=false
FOLLOW_LOG=false
ASSUME_YES=false
SKIP_SELF_UPDATE=false

log() { printf '[%s] %s\n' "$SCRIPT_NAME" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$SCRIPT_NAME" "$*" >&2; }
die() { printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
User-local latest Python + Open WebUI Computer helper

Usage:
  install-python-agent.sh [ACTION] [OPTIONS]
  python-agent [ACTION] [OPTIONS]

Actions:
  install          Install/upgrade uv, latest Python, cptr, then start (default).
  update           Upgrade uv, Python, and cptr, then restart the agent.
  python           Install/upgrade only the user-level Python runtime.
  start            Start cptr in the background.
  stop             Stop the helper-managed background process.
  restart          Restart the helper-managed background process.
  run              Run cptr in the foreground (for WebConsole supervision).
  status           Show Python, cptr, process, and health status.
  logs             Show the last 100 agent log lines.
  doctor           Diagnose the installed user-level runtime.
  python-version   Print the helper-managed Python path and version.
  uninstall        Remove the agent environment; keeps Python and uv.

Options:
  --home PATH           Writable account home (for example /home/sabashop).
  --port PORT           Listening port (default: 8000; must be 1024-65535).
  --host HOST           Listening host (default: 0.0.0.0).
  --python VERSION      Python request (default: latest stable CPython).
                        Examples: latest, 3.14, 3.14.7.
  --extras SET          cptr features: base, mcp, agents, recommended, all.
  --workspace PATH      Exposed workspace (default: account home).
  --no-start            Install/update without starting the background agent.
  --follow              Follow logs continuously (with the logs action).
  --yes                 Confirm uninstall without an interactive prompt.
  -h, --help            Show this help.

After the first installation, use only these short helper commands:
  python-agent update
  python-agent status
  python-agent restart
  python-agent logs --follow
EOF
}

while (($#)); do
    case "$1" in
        install|update|python|start|stop|restart|run|status|logs|doctor|python-version|uninstall)
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
            CLI_HOST="$2"; shift 2 ;;
        --python)
            (($# >= 2)) || die '--python requires a version.'
            CLI_PYTHON_REQUEST="$2"; shift 2 ;;
        --extras)
            (($# >= 2)) || die '--extras requires a value.'
            CLI_EXTRAS="$2"; shift 2 ;;
        --workspace)
            (($# >= 2)) || die '--workspace requires a path.'
            CLI_WORKSPACE="$2"; shift 2 ;;
        --no-start) NO_START=true; shift ;;
        --follow) FOLLOW_LOG=true; shift ;;
        --yes) ASSUME_YES=true; shift ;;
        --skip-self-update) SKIP_SELF_UPDATE=true; shift ;;
        -h|--help) usage; exit 0 ;;
        --) shift; break ;;
        *) die "Unknown argument: $1" ;;
    esac
done

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
export PATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"

APP_ROOT="$HOME/.local/share/webconsole-agent"
STATE_DIR="$HOME/.local/state/webconsole-agent"
CONFIG_DIR="$HOME/.config/webconsole-agent"
CACHE_DIR="$HOME/.cache/webconsole-agent"
VENV_DIR="$APP_ROOT/venv"
DATA_DIR="$APP_ROOT/data"
HELPER_COPY="$APP_ROOT/helper.sh"
WRAPPER="$HOME/.local/bin/python-agent"
UV_BIN="$HOME/.local/bin/uv"
CONFIG_FILE="$CONFIG_DIR/config.env"
ENV_FILE="$CONFIG_DIR/env.sh"
PID_FILE="$STATE_DIR/agent.pid"
PID_START_FILE="$STATE_DIR/agent.pid.start"
LOG_FILE="$STATE_DIR/agent.log"

PORT="8000"
LISTEN_HOST="0.0.0.0"
PYTHON_REQUEST="latest"
CPTR_EXTRAS="base"
WORKSPACE="$HOME"
PYTHON_BIN=""

# The configuration is generated with shell escaping and is owned by this user.
if [[ -r "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
fi

[[ -z "$CLI_PORT" ]] || PORT="$CLI_PORT"
[[ -z "$CLI_HOST" ]] || LISTEN_HOST="$CLI_HOST"
[[ -z "$CLI_PYTHON_REQUEST" ]] || PYTHON_REQUEST="$CLI_PYTHON_REQUEST"
[[ -z "$CLI_EXTRAS" ]] || CPTR_EXTRAS="$CLI_EXTRAS"
[[ -z "$CLI_WORKSPACE" ]] || WORKSPACE="$CLI_WORKSPACE"

validate_config() {
    [[ "$PORT" =~ ^[0-9]+$ ]] || die 'Port must be numeric.'
    ((PORT >= 1024 && PORT <= 65535)) || die 'Port must be between 1024 and 65535.'
    [[ -n "$LISTEN_HOST" && "$LISTEN_HOST" != *[[:space:]]* ]] || die 'Invalid listening host.'
    [[ -n "$PYTHON_REQUEST" && "$PYTHON_REQUEST" != *[[:space:]]* ]] || die 'Invalid Python request.'
    case "$CPTR_EXTRAS" in
        base|mcp|agents|recommended|all) ;;
        *) die '--extras must be one of: base, mcp, agents, recommended, all.' ;;
    esac
    [[ "$WORKSPACE" == /* ]] || die '--workspace must be an absolute path.'
    if [[ "$ACTION" =~ ^(install|update|start|restart|run)$ ]]; then
        mkdir -p "$WORKSPACE" 2>/dev/null || die "Cannot create workspace: $WORKSPACE"
        [[ -d "$WORKSPACE" && -r "$WORKSPACE" ]] || die "Workspace is unavailable: $WORKSPACE"
    fi
}
validate_config

prepare_dirs() {
    mkdir -p \
        "$HOME/.local/bin" \
        "$APP_ROOT" \
        "$STATE_DIR" \
        "$CONFIG_DIR" \
        "$CACHE_DIR" \
        "$DATA_DIR"
    chmod 700 "$CONFIG_DIR" "$STATE_DIR" 2>/dev/null || true
}

persist_helper() {
    local source_path="${BASH_SOURCE[0]:-}"
    prepare_dirs

    if [[ -n "$source_path" && -f "$source_path" && "$source_path" != /dev/* ]]; then
        if [[ "$(cd "$(dirname "$source_path")" && pwd -P)/$(basename "$source_path")" != "$HELPER_COPY" ]]; then
            cp "$source_path" "$HELPER_COPY"
        fi
    elif [[ ! -s "$HELPER_COPY" ]]; then
        warn 'The helper was read from a pipe and cannot persist itself.'
        warn "Download it first with: curl -fsSL $SELF_URL -o \"$HOME/install-python-agent.sh\""
        return
    fi

    if [[ -s "$HELPER_COPY" ]]; then
        chmod 700 "$HELPER_COPY"
        {
            printf '#!/usr/bin/env bash\n'
            printf 'exec %q --home %q "$@"\n' "$HELPER_COPY" "$HOME"
        } > "$WRAPPER"
        chmod 700 "$WRAPPER"
    fi
}

save_config() {
    prepare_dirs
    {
        printf '# Generated by %s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
        printf 'PORT=%q\n' "$PORT"
        printf 'LISTEN_HOST=%q\n' "$LISTEN_HOST"
        printf 'PYTHON_REQUEST=%q\n' "$PYTHON_REQUEST"
        printf 'CPTR_EXTRAS=%q\n' "$CPTR_EXTRAS"
        printf 'WORKSPACE=%q\n' "$WORKSPACE"
        [[ -z "$PYTHON_BIN" ]] || printf 'PYTHON_BIN=%q\n' "$PYTHON_BIN"
    } > "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
}

write_environment() {
    local profile marker='# WebConsole latest Python and AI agent environment'
    prepare_dirs
    {
        printf '# Generated by %s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
        printf 'export HOME=%q\n' "$HOME"
        printf 'case ":${PATH:-}:" in *":%s:"*) ;; *) export PATH=%q:"${PATH:-/usr/local/bin:/usr/bin:/bin}" ;; esac\n' \
            "$HOME/.local/bin" "$HOME/.local/bin"
        [[ -z "$PYTHON_BIN" ]] || printf 'export PYTHON_BIN=%q\n' "$PYTHON_BIN"
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

require_curl() {
    command -v curl >/dev/null 2>&1 || die 'curl is required by the helper.'
}

refresh_helper() {
    local candidate="$CACHE_DIR/helper-update.sh" candidate_version="" current_version="$SCRIPT_VERSION"
    local -a next_args
    [[ "$SKIP_SELF_UPDATE" == false ]] || return
    require_curl
    prepare_dirs

    log 'Checking for a newer helper release...'
    if ! curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$SELF_URL" -o "$candidate"; then
        warn 'Could not check the main branch for a helper update; continuing with the installed helper.'
        rm -f "$candidate"
        return
    fi
    if ! bash -n "$candidate"; then
        warn 'The downloaded helper failed syntax validation; it will not be used.'
        rm -f "$candidate"
        return
    fi
    candidate_version="$(sed -n 's/^SCRIPT_VERSION="\([^"]*\)"/\1/p' "$candidate" | head -n 1)"
    if [[ -z "$candidate_version" || "$candidate_version" == "$current_version" ]]; then
        rm -f "$candidate"
        return
    fi
    if command -v sort >/dev/null 2>&1 && \
       [[ "$(printf '%s\n%s\n' "$current_version" "$candidate_version" | sort -V | tail -n 1)" != "$candidate_version" ]]; then
        warn "Ignoring older helper release $candidate_version (installed: $current_version)."
        rm -f "$candidate"
        return
    fi

    log "Updating helper $current_version -> $candidate_version"
    mv -f "$candidate" "$HELPER_COPY"
    chmod 700 "$HELPER_COPY"
    next_args=(
        update
        --home "$HOME"
        --port "$PORT"
        --host "$LISTEN_HOST"
        --python "$PYTHON_REQUEST"
        --extras "$CPTR_EXTRAS"
        --workspace "$WORKSPACE"
        --skip-self-update
    )
    [[ "$NO_START" == false ]] || next_args+=(--no-start)
    exec "$HELPER_COPY" "${next_args[@]}"
}

install_uv() {
    local installer="$CACHE_DIR/uv-installer.sh"
    require_curl
    prepare_dirs
    log 'Downloading the official uv installer...'
    curl --proto '=https' --tlsv1.2 -fsSL --retry 3 \
        https://astral.sh/uv/install.sh -o "$installer"
    [[ -s "$installer" ]] || die 'The downloaded uv installer is empty.'
    chmod 700 "$installer"
    log 'Installing/updating uv in the account directory...'
    env \
        HOME="$HOME" \
        UV_INSTALL_DIR="$HOME/.local/bin" \
        UV_NO_MODIFY_PATH=1 \
        sh "$installer"
    [[ -x "$UV_BIN" ]] || die "uv was not installed at $UV_BIN"
    log "uv ready: $($UV_BIN --version)"
}

normalized_python_request() {
    case "$PYTHON_REQUEST" in
        latest|stable|cpython) printf 'cpython\n' ;;
        *) printf '%s\n' "$PYTHON_REQUEST" ;;
    esac
}

install_python() {
    local request version_tuple
    request="$(normalized_python_request)"
    [[ -x "$UV_BIN" ]] || install_uv

    log "Installing the newest stable Python matching: $request"
    (
        cd "$HOME"
        UV_NO_CONFIG=1 "$UV_BIN" python install "$request" --default --force
    )

    PYTHON_BIN="$(UV_NO_CONFIG=1 "$UV_BIN" python find --managed-python "$request" 2>/dev/null || true)"
    [[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || die 'uv installed Python, but its executable could not be located.'
    version_tuple="$($PYTHON_BIN -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
    "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)' \
        || die "cptr requires Python 3.10 or newer; selected: $version_tuple"

    save_config
    write_environment
    log "Python ready: $($PYTHON_BIN --version 2>&1)"
    log "Python executable: $PYTHON_BIN"
    log "User default launcher: $HOME/.local/bin/python3"
}

cptr_package_spec() {
    case "$CPTR_EXTRAS" in
        base) printf 'cptr\n' ;;
        mcp) printf 'cptr[mcp]\n' ;;
        agents) printf 'cptr[agents]\n' ;;
        recommended) printf 'cptr[mcp,docs,agents]\n' ;;
        all) printf 'cptr[all]\n' ;;
    esac
}

python_runtime_version() {
    "$1" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])' 2>/dev/null || true
}

install_agent() {
    local package_spec desired_version current_version="" cptr_version
    [[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]] || install_python
    package_spec="$(cptr_package_spec)"
    desired_version="$(python_runtime_version "$PYTHON_BIN")"
    [[ -n "$desired_version" ]] || die 'Could not read the selected Python version.'

    if [[ -x "$VENV_DIR/bin/python" ]]; then
        current_version="$(python_runtime_version "$VENV_DIR/bin/python")"
    fi
    if [[ -z "$current_version" || "$current_version" != "$desired_version" ]]; then
        if [[ -d "$VENV_DIR" ]]; then
            log "Rebuilding the agent environment for Python $desired_version..."
            [[ "$VENV_DIR" == "$APP_ROOT/venv" ]] || die 'Refusing to remove an unexpected virtual environment path.'
            rm -rf "$VENV_DIR"
        fi
        log "Creating agent environment with Python $desired_version..."
        UV_NO_CONFIG=1 "$UV_BIN" venv --python "$PYTHON_BIN" "$VENV_DIR"
    fi

    log "Installing/upgrading Open WebUI Computer package: $package_spec"
    UV_NO_CONFIG=1 "$UV_BIN" pip install \
        --python "$VENV_DIR/bin/python" \
        --upgrade \
        "$package_spec"

    [[ -x "$VENV_DIR/bin/cptr" ]] || die 'cptr installation completed without creating its executable.'
    cptr_version="$($VENV_DIR/bin/python -c 'import importlib.metadata; print(importlib.metadata.version("cptr"))')"
    log "Open WebUI Computer ready: cptr $cptr_version"
    save_config
}

pid_is_alive() {
    local pid="${1:-}"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

process_start_id() {
    local pid="${1:-}"
    [[ -r "/proc/$pid/stat" ]] || return 1
    sed 's/^.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $20}'
}

pid_belongs_to_agent() {
    local pid="${1:-}" command_line="" expected_start="" current_start=""
    pid_is_alive "$pid" || return 1

    if [[ -r "$PID_START_FILE" ]]; then
        expected_start="$(cat "$PID_START_FILE" 2>/dev/null || true)"
        current_start="$(process_start_id "$pid" 2>/dev/null || true)"
        if [[ -n "$expected_start" && "$current_start" == "$expected_start" ]]; then
            return 0
        fi
    fi

    if [[ -r "/proc/$pid/cmdline" ]]; then
        command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        [[ "$command_line" == *"$VENV_DIR"* && "$command_line" == *cptr* ]]
    else
        return 1
    fi
}

health_url() {
    local client_host="$LISTEN_HOST"
    case "$client_host" in
        0.0.0.0|::|'[::]') client_host="127.0.0.1" ;;
    esac
    printf 'http://%s:%s/api/health\n' "$client_host" "$PORT"
}

agent_is_healthy() {
    command -v curl >/dev/null 2>&1 || return 1
    curl -fsS --max-time 3 "$(health_url)" >/dev/null 2>&1
}

require_agent() {
    [[ -x "$VENV_DIR/bin/cptr" ]] || die 'The agent is not installed. Run: python-agent install'
}

start_agent() {
    local pid="" i
    require_agent
    prepare_dirs

    if [[ -r "$PID_FILE" ]]; then
        pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    fi
    if pid_belongs_to_agent "$pid"; then
        log "Agent is already running (PID $pid)."
        agent_is_healthy && log "Health check passed: $(health_url)"
        return
    fi
    rm -f "$PID_FILE" "$PID_START_FILE"

    if agent_is_healthy; then
        die "Port $PORT already serves a healthy cptr instance not managed by this PID file."
    fi

    log "Starting Open WebUI Computer on $LISTEN_HOST:$PORT..."
    (
        cd "$WORKSPACE"
        nohup env \
            HOME="$HOME" \
            PATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}" \
            CPTR_DATA_DIR="$DATA_DIR" \
            "$VENV_DIR/bin/cptr" run \
                --host "$LISTEN_HOST" \
                --port "$PORT" \
                --headless \
            >"$LOG_FILE" 2>&1 </dev/null &
        printf '%s\n' "$!" > "$PID_FILE"
    )
    pid="$(cat "$PID_FILE")"
    process_start_id "$pid" > "$PID_START_FILE" 2>/dev/null || true

    for ((i=0; i<60; i++)); do
        if ! pid_is_alive "$pid"; then
            warn 'The agent exited during startup. Recent log output:'
            tail -n 80 "$LOG_FILE" >&2 2>/dev/null || true
            rm -f "$PID_FILE" "$PID_START_FILE"
            die "Agent startup failed. Full log: $LOG_FILE"
        fi
        if agent_is_healthy; then
            log "Agent is healthy (PID $pid): http://HOST:$PORT"
            log "Logs: python-agent logs --follow"
            warn 'Keep the access token printed in the log private.'
            return
        fi
        sleep 1
    done

    warn 'The process is still alive, but its health endpoint did not become ready in 60 seconds.'
    warn "Inspect it with: python-agent logs --follow"
    return 1
}

stop_agent() {
    local pid="" i
    if [[ -r "$PID_FILE" ]]; then
        pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    fi
    if ! pid_is_alive "$pid"; then
        rm -f "$PID_FILE" "$PID_START_FILE"
        log 'No helper-managed background agent is running.'
        return
    fi
    if ! pid_belongs_to_agent "$pid"; then
        rm -f "$PID_FILE" "$PID_START_FILE"
        die "PID $pid does not look like this helper's cptr process; it was not stopped."
    fi

    log "Stopping agent (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    for ((i=0; i<20; i++)); do
        if ! pid_is_alive "$pid"; then
            rm -f "$PID_FILE" "$PID_START_FILE"
            log 'Agent stopped.'
            return
        fi
        sleep 1
    done
    warn 'The agent ignored SIGTERM; sending SIGKILL.'
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE" "$PID_START_FILE"
}

run_agent_foreground() {
    require_agent
    mkdir -p "$DATA_DIR" "$WORKSPACE"
    cd "$WORKSPACE"
    log "Handing foreground supervision to cptr on $LISTEN_HOST:$PORT..."
    exec env \
        HOME="$HOME" \
        PATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}" \
        CPTR_DATA_DIR="$DATA_DIR" \
        "$VENV_DIR/bin/cptr" run \
            --host "$LISTEN_HOST" \
            --port "$PORT" \
            --headless
}

show_python_version() {
    if [[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]]; then
        printf 'python=%s\n' "$PYTHON_BIN"
        "$PYTHON_BIN" --version
    elif [[ -x "$UV_BIN" ]]; then
        PYTHON_BIN="$(UV_NO_CONFIG=1 "$UV_BIN" python find --managed-python "$(normalized_python_request)" 2>/dev/null || true)"
        [[ -n "$PYTHON_BIN" ]] || die 'No helper-managed Python is installed.'
        printf 'python=%s\n' "$PYTHON_BIN"
        "$PYTHON_BIN" --version
    else
        die 'No helper-managed Python is installed.'
    fi
    printf 'python3_launcher=%s\n' "$HOME/.local/bin/python3"
}

show_status() {
    local pid="" cptr_version="not installed" process_state="stopped" health_state="unreachable"
    printf 'helper=%s\n' "$SCRIPT_VERSION"
    printf 'home=%s\n' "$HOME"
    printf 'port=%s\n' "$PORT"
    printf 'workspace=%s\n' "$WORKSPACE"
    if [[ -x "$UV_BIN" ]]; then
        printf 'uv=%s\n' "$($UV_BIN --version 2>&1)"
    else
        printf 'uv=not installed\n'
    fi
    if [[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]]; then
        printf 'python=%s (%s)\n' "$PYTHON_BIN" "$($PYTHON_BIN --version 2>&1)"
    else
        printf 'python=not installed by this helper\n'
    fi
    if [[ -x "$VENV_DIR/bin/python" ]]; then
        cptr_version="$($VENV_DIR/bin/python -c 'import importlib.metadata; print(importlib.metadata.version("cptr"))' 2>/dev/null || echo broken)"
    fi
    printf 'cptr=%s\n' "$cptr_version"
    if [[ -r "$PID_FILE" ]]; then
        pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    fi
    pid_belongs_to_agent "$pid" && process_state="running (PID $pid)"
    agent_is_healthy && health_state="healthy ($(health_url))"
    printf 'process=%s\n' "$process_state"
    printf 'health=%s\n' "$health_state"
    printf 'log=%s\n' "$LOG_FILE"
}

show_logs() {
    [[ -e "$LOG_FILE" ]] || die "No agent log exists yet: $LOG_FILE"
    if [[ "$FOLLOW_LOG" == true ]]; then
        exec tail -n 100 -f "$LOG_FILE"
    fi
    tail -n 100 "$LOG_FILE"
}

doctor() {
    local failed=0 pid=""
    printf 'Helper: %s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
    printf 'Account: %s (uid %s)\n' "$(id -un)" "$(id -u)"
    printf 'Home: %s\n' "$HOME"
    printf 'Kernel: %s\n' "$(uname -srmo 2>/dev/null || uname -a)"
    printf 'Architecture: %s\n' "$(uname -m)"

    [[ -d "$HOME" && -w "$HOME" ]] || { warn 'Home is not writable.'; failed=1; }
    command -v curl >/dev/null 2>&1 || { warn 'curl is missing.'; failed=1; }
    if [[ -x "$UV_BIN" ]]; then
        printf 'uv: %s\n' "$($UV_BIN --version 2>&1)"
    else
        warn "uv is missing: $UV_BIN"; failed=1
    fi
    if [[ -n "$PYTHON_BIN" && -x "$PYTHON_BIN" ]]; then
        printf 'Python: %s (%s)\n' "$PYTHON_BIN" "$($PYTHON_BIN --version 2>&1)"
    else
        warn 'Helper-managed Python is missing.'; failed=1
    fi
    if [[ -x "$VENV_DIR/bin/cptr" ]]; then
        printf 'cptr: %s\n' "$($VENV_DIR/bin/python -c 'import importlib.metadata; print(importlib.metadata.version("cptr"))' 2>/dev/null || echo broken)"
    else
        warn 'cptr is missing.'; failed=1
    fi
    if [[ -r "$PID_FILE" ]]; then pid="$(cat "$PID_FILE" 2>/dev/null || true)"; fi
    if pid_belongs_to_agent "$pid"; then
        printf 'Process: running (PID %s)\n' "$pid"
    else
        printf 'Process: stopped\n'
    fi
    if agent_is_healthy; then
        printf 'Health: OK (%s)\n' "$(health_url)"
    else
        printf 'Health: unavailable\n'
    fi
    ((failed == 0)) || return 1
    log 'Doctor checks passed.'
}

uninstall_agent() {
    if [[ "$ASSUME_YES" != true ]]; then
        if [[ -t 0 ]]; then
            printf 'Remove the cptr environment and agent data under %s? [y/N] ' "$APP_ROOT"
            read -r answer
            [[ "$answer" =~ ^[Yy]$ ]] || { log 'Uninstall cancelled.'; return; }
        else
            die 'Use --yes to confirm a non-interactive uninstall.'
        fi
    fi
    stop_agent
    [[ "$APP_ROOT" == "$HOME/.local/share/webconsole-agent" ]] || die 'Refusing to remove an unexpected application path.'
    rm -rf "$APP_ROOT" "$STATE_DIR"
    rm -f "$WRAPPER"
    log 'Agent removed. User-level uv and Python were intentionally kept.'
}

case "$ACTION" in
    install)
        prepare_dirs
        persist_helper
        [[ ! -s "$PID_FILE" ]] || stop_agent
        install_uv
        install_python
        install_agent
        if [[ "$NO_START" == false ]]; then start_agent; fi
        show_status
        ;;
    update)
        prepare_dirs
        refresh_helper
        persist_helper
        stop_agent
        install_uv
        install_python
        install_agent
        if [[ "$NO_START" == false ]]; then start_agent; fi
        show_status
        ;;
    python)
        prepare_dirs
        persist_helper
        install_uv
        install_python
        show_python_version
        ;;
    start) start_agent ;;
    stop) stop_agent ;;
    restart)
        stop_agent
        start_agent
        ;;
    run) run_agent_foreground ;;
    status) show_status ;;
    logs) show_logs ;;
    doctor) doctor ;;
    python-version) show_python_version ;;
    uninstall) uninstall_agent ;;
esac
