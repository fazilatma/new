#!/usr/bin/env bash
# Rootless Docker bootstrap for restricted Linux hosts (no sudo/apt required).
# Optionally installs Agent Zero after Docker becomes healthy.
#
# Usage:
#   curl -fsSL <RAW_URL> | bash
#   curl -fsSL <RAW_URL> | bash -s -- --install-agent-zero
#
# This helper cannot bypass host kernel restrictions. newuidmap/newgidmap,
# subordinate UID/GID ranges, and unprivileged user namespaces must already
# be enabled by the hosting provider.

set -Eeuo pipefail

SCRIPT_NAME="rootless-docker-helper"
INSTALL_AGENT_ZERO=false
CHECK_ONLY=false
SKIP_IPTABLES_CHECK=false
HOME_OVERRIDE=""
AGENT_PORT="50080"
AGENT_NAME="agent-zero"
AGENT_IMAGE="agent0ai/agent-zero:latest"

log() { printf '[%s] %s\n' "$SCRIPT_NAME" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$SCRIPT_NAME" "$*" >&2; }
die() { printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Rootless Docker helper for restricted Linux hosting

Options:
  --home PATH              Use PATH as the real writable account home.
  --check-only             Check host prerequisites; do not install anything.
  --skip-iptables-check    Pass SKIP_IPTABLES=1 to Docker's installer.
                           Use only when the provider confirms this is safe.
  --install-agent-zero     Pull and run Agent Zero after Docker is healthy.
  --agent-port PORT        Agent Zero public port (default: 50080; >= 1024).
  --agent-name NAME        Container name (default: agent-zero).
  --agent-image IMAGE      Image/tag (default: agent0ai/agent-zero:latest).
  -h, --help               Show this help.

Examples:
  curl -fsSL RAW_URL | bash
  curl -fsSL RAW_URL | bash -s -- --install-agent-zero
  curl -fsSL RAW_URL | bash -s -- --home /home/myuser --install-agent-zero
EOF
}

while (($#)); do
    case "$1" in
        --home)
            (($# >= 2)) || die '--home requires a path'
            HOME_OVERRIDE="$2"; shift 2 ;;
        --check-only) CHECK_ONLY=true; shift ;;
        --skip-iptables-check) SKIP_IPTABLES_CHECK=true; shift ;;
        --install-agent-zero) INSTALL_AGENT_ZERO=true; shift ;;
        --agent-port)
            (($# >= 2)) || die '--agent-port requires a value'
            AGENT_PORT="$2"; shift 2 ;;
        --agent-name)
            (($# >= 2)) || die '--agent-name requires a value'
            AGENT_NAME="$2"; shift 2 ;;
        --agent-image)
            (($# >= 2)) || die '--agent-image requires a value'
            AGENT_IMAGE="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1" ;;
    esac
done

[[ "$(uname -s)" == "Linux" ]] || die 'Rootless Docker helper supports Linux only.'
[[ "$(id -u)" != "0" ]] || die 'Run this helper as the normal hosting account, not root.'
command -v curl >/dev/null 2>&1 || die 'curl is required.'

resolve_home() {
    local candidate="" python_home="" passwd_home="" username
    username="$(id -un 2>/dev/null || true)"

    if [[ -n "$HOME_OVERRIDE" ]]; then
        [[ "$HOME_OVERRIDE" == /* ]] || die '--home must be an absolute path.'
        [[ -d "$HOME_OVERRIDE" && -w "$HOME_OVERRIDE" ]] || die "Requested home is missing or not writable: $HOME_OVERRIDE"
        printf '%s\n' "$HOME_OVERRIDE"
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
            printf '%s\n' "$candidate"
            return
        fi
    done

    die "Could not find a writable account home. Re-run with --home /absolute/path (never use public_html)."
}

REAL_HOME="$(resolve_home)"
export HOME="$REAL_HOME"
cd "$HOME"
mkdir -p "$HOME/bin" "$HOME/.cache" "$HOME/.config/docker-rootless" "$HOME/.local/state/docker-rootless"
log "Using account home: $HOME"

choose_runtime_dir() {
    local candidate="${XDG_RUNTIME_DIR:-}" uid
    uid="$(id -u)"
    if [[ -n "$candidate" && -d "$candidate" && -w "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return
    fi
    candidate="/run/user/$uid"
    if [[ -d "$candidate" && -w "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return
    fi
    candidate="$HOME/.docker/run"
    mkdir -p "$candidate"
    chmod 700 "$candidate"
    printf '%s\n' "$candidate"
}

export XDG_RUNTIME_DIR="$(choose_runtime_dir)"
export PATH="$HOME/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
export DOCKER_HOST="unix://$XDG_RUNTIME_DIR/docker.sock"
log "Using runtime directory: $XDG_RUNTIME_DIR"

subid_total() {
    local file="$1" user uid
    user="$(id -un)"; uid="$(id -u)"
    [[ -r "$file" ]] || { printf '0\n'; return; }
    awk -F: -v user="$user" -v uid="$uid" '$1==user || $1==uid {sum += $3} END {print sum+0}' "$file"
}

check_prerequisites() {
    local failed=0 subuids subgids iptables_bin=""
    log 'Checking rootless Docker host prerequisites...'

    for tool in newuidmap newgidmap; do
        if command -v "$tool" >/dev/null 2>&1; then
            log "Found $tool: $(command -v "$tool")"
        else
            warn "$tool is missing. The hosting provider must install/configure uidmap support."
            failed=1
        fi
    done

    subuids="$(subid_total /etc/subuid)"
    subgids="$(subid_total /etc/subgid)"
    if ((subuids >= 65536)); then
        log "Subordinate UIDs available: $subuids"
    else
        warn "At least 65536 subordinate UIDs are required; detected: $subuids"
        failed=1
    fi
    if ((subgids >= 65536)); then
        log "Subordinate GIDs available: $subgids"
    else
        warn "At least 65536 subordinate GIDs are required; detected: $subgids"
        failed=1
    fi

    if [[ -r /proc/sys/kernel/unprivileged_userns_clone ]] && [[ "$(cat /proc/sys/kernel/unprivileged_userns_clone)" != "1" ]]; then
        warn 'kernel.unprivileged_userns_clone is disabled by the hosting provider.'
        failed=1
    fi
    if [[ -r /proc/sys/user/max_user_namespaces ]] && [[ "$(cat /proc/sys/user/max_user_namespaces)" == "0" ]]; then
        warn 'user.max_user_namespaces is zero.'
        failed=1
    fi
    if command -v unshare >/dev/null 2>&1; then
        if unshare -Ur true >/dev/null 2>&1; then
            log 'Unprivileged user namespaces: available'
        else
            warn 'Unprivileged user namespaces are blocked (unshare -Ur failed).'
            failed=1
        fi
    fi

    iptables_bin="$(PATH="$PATH:/sbin:/usr/sbin" command -v iptables 2>/dev/null || true)"
    if [[ -n "$iptables_bin" ]]; then
        log "Found iptables: $iptables_bin"
    elif [[ "$SKIP_IPTABLES_CHECK" == true ]]; then
        warn 'iptables is missing; continuing only because --skip-iptables-check was supplied.'
    else
        warn 'iptables is missing. Docker networking/port publishing may not work.'
        warn 'Ask the provider to install it, or retry with --skip-iptables-check only if they approve.'
        failed=1
    fi

    ((failed == 0)) || die 'Host prerequisites are incomplete. curl cannot bypass these provider/kernel restrictions.'
    log 'Prerequisite checks passed.'
}

write_environment_file() {
    local env_file="$HOME/.config/docker-rootless/env.sh" profile marker
    {
        printf '# Generated by %s\n' "$SCRIPT_NAME"
        printf 'export HOME=%q\n' "$HOME"
        printf 'export PATH=%q:${PATH:-/usr/local/bin:/usr/bin:/bin}\n' "$HOME/bin"
        printf 'export XDG_RUNTIME_DIR=%q\n' "$XDG_RUNTIME_DIR"
        printf 'export DOCKER_HOST=%q\n' "$DOCKER_HOST"
    } > "$env_file"
    chmod 600 "$env_file"

    marker='# WebConsole rootless Docker environment'
    for profile in "$HOME/.profile" "$HOME/.bashrc"; do
        touch "$profile" 2>/dev/null || continue
        if ! grep -Fq "$marker" "$profile" 2>/dev/null; then
            {
                printf '\n%s\n' "$marker"
                printf '[ -r %q ] && . %q\n' "$env_file" "$env_file"
            } >> "$profile"
        fi
    done
    log "Environment saved to: $env_file"
}

start_rootless_daemon() {
    local daemon="$HOME/bin/dockerd-rootless.sh"
    local log_file="$HOME/.local/state/docker-rootless/dockerd.log"
    local pid_file="$XDG_RUNTIME_DIR/docker.pid"
    local i daemon_pid=""

    if docker info >/dev/null 2>&1; then
        log 'Docker daemon is already healthy.'
        return
    fi

    if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload >/dev/null 2>&1; then
        log 'Starting rootless Docker with systemd user service...'
        systemctl --user start docker.service >/dev/null 2>&1 || true
        for ((i=0; i<20; i++)); do
            docker info >/dev/null 2>&1 && return
            sleep 1
        done
        warn 'The systemd user service did not become ready; trying a direct daemon start.'
    fi

    [[ -x "$daemon" ]] || die "Rootless daemon launcher not found: $daemon"
    if [[ -r "$pid_file" ]]; then
        daemon_pid="$(cat "$pid_file" 2>/dev/null || true)"
    fi
    if [[ -z "$daemon_pid" || ! -d "/proc/$daemon_pid" ]]; then
        log 'Starting dockerd-rootless.sh without systemd...'
        nohup "$daemon" >"$log_file" 2>&1 </dev/null &
        daemon_pid=$!
        printf '%s\n' "$daemon_pid" > "$HOME/.local/state/docker-rootless/launcher.pid"
    fi

    for ((i=0; i<45; i++)); do
        if docker info >/dev/null 2>&1; then
            log 'Rootless Docker daemon is healthy.'
            return
        fi
        if [[ -n "$daemon_pid" && ! -d "/proc/$daemon_pid" ]]; then
            break
        fi
        sleep 1
    done

    warn "Docker daemon failed to start. Recent log output:"
    tail -n 80 "$log_file" 2>/dev/null >&2 || true
    die "Rootless Docker is not healthy. Full log: $log_file"
}

install_rootless_docker() {
    local installer="$HOME/.cache/get-docker-rootless.sh"

    export PATH="$HOME/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        log "Working Docker detected: $(docker --version)"
        write_environment_file
        return
    fi

    check_prerequisites
    [[ "$CHECK_ONLY" == false ]] || { log 'Check-only mode completed successfully.'; exit 0; }

    if [[ ! -x "$HOME/bin/dockerd" ]]; then
        log 'Downloading the official Docker rootless installer...'
        curl --proto '=https' --tlsv1.2 -fsSL https://get.docker.com/rootless -o "$installer"
        [[ -s "$installer" ]] || die 'Downloaded installer is empty.'
        chmod 700 "$installer"
        log 'Running the official Docker rootless installer...'
        if [[ "$SKIP_IPTABLES_CHECK" == true ]]; then
            HOME="$HOME" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" SKIP_IPTABLES=1 sh "$installer"
        else
            HOME="$HOME" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" sh "$installer"
        fi
    else
        log 'Existing rootless Docker binaries found; skipping binary download.'
    fi

    write_environment_file
    start_rootless_daemon
    docker info >/dev/null 2>&1 || die 'docker info failed after daemon startup.'
    log "Installed successfully: $(docker --version)"
    log "Security options: $(docker info --format '{{json .SecurityOptions}}' 2>/dev/null || echo rootless)"
}

install_agent_zero() {
    [[ "$AGENT_PORT" =~ ^[0-9]+$ ]] || die 'Agent port must be numeric.'
    ((AGENT_PORT >= 1024 && AGENT_PORT <= 65535)) || die 'Rootless Agent Zero port must be between 1024 and 65535.'
    [[ "$AGENT_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die 'Invalid Agent Zero container name.'

    log "Pulling Agent Zero image: $AGENT_IMAGE"
    docker pull "$AGENT_IMAGE"
    docker volume create a0_usr >/dev/null
    if docker container inspect "$AGENT_NAME" >/dev/null 2>&1; then
        log "Replacing existing container while preserving volume a0_usr..."
        docker rm -f "$AGENT_NAME" >/dev/null
    fi
    docker run -d \
        --name "$AGENT_NAME" \
        --restart unless-stopped \
        --add-host host.docker.internal:host-gateway \
        --ulimit nofile=65535:65535 \
        -p "$AGENT_PORT:80" \
        -v a0_usr:/a0/usr \
        "$AGENT_IMAGE" >/dev/null

    log "Agent Zero is running at: http://HOST:$AGENT_PORT"
    log "View logs with: docker logs -f $AGENT_NAME"
    warn 'Enable Agent Zero Web UI authentication before exposing this port publicly.'
}

install_rootless_docker
if [[ "$INSTALL_AGENT_ZERO" == true ]]; then
    install_agent_zero
fi

cat <<EOF

Completed.
Current shell environment used by this helper:
  HOME=$HOME
  PATH begins with $HOME/bin
  XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR
  DOCKER_HOST=$DOCKER_HOST

For a new shell, run:
  . "$HOME/.config/docker-rootless/env.sh"
  docker info
EOF
