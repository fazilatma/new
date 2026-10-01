#!/usr/bin/env bash
# Install and manage the official OpenHands Agent Canvas on a restricted Linux
# hosting account. Everything is installed below the account home: no sudo,
# apt, Docker, systemd, or writes to /usr are used.

set -Eeuo pipefail

SCRIPT_NAME="openhands-host"
SCRIPT_VERSION="3.0.1"
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
CLI_PUBLIC_URL=""
CLI_BASE_PATH=""
CLI_CANVAS_VERSION=""
CLI_WORKSPACE=""
CLI_UPSTREAM_PORT=""
CLI_BACKEND_PORT=""
CLI_AUTOMATION_PORT=""
CLI_FRONTEND_PORT=""
NO_START=false
FOLLOW_LOG=false
ASSUME_YES=false
PURGE_DATA=false
SKIP_SELF_UPDATE=false
MANAGER_FILE=""
MANAGER_IMPORT_SECRETS=false
MANAGER_OVERWRITE=false
MANAGER_NAME=""
MANAGER_MODEL_URL=""
MANAGER_SHA256=""
MANAGER_CONTEXT_LENGTH="8192"
MANAGER_BASE_URL=""
MANAGER_MODEL=""
MANAGER_API_KEY_FILE=""
MANAGER_PROXY_MODE=""
MANAGER_PROXY_URL=""

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
  pair             Create a five-minute browser pairing code.
  web-check        Check the frontend, ingress, and real Agent Server backend.
  doctor           Run host, runtime, resource, configuration, and health checks.
  models           Print the authenticated browser model-manager URL.
  providers-export Export provider/model JSON without API keys (--file PATH).
  providers-import Import the compatible provider JSON format (--file PATH).
  test-models      Run a minimal bulk test against every LLM Profile.
  proxy-config     Configure direct/fallback/proxy-only model routing.
  local-model-install  Install a GGUF model with managed llama.cpp.
  local-model-start    Start an installed GGUF model (--name NAME).
  local-model-stop     Stop the active managed GGUF model.
  local-endpoint-add   Register an existing OpenAI-compatible local endpoint.
  rotate-key       Generate a new API key and restart if currently running.
  self-update      Update only this helper from its canonical URL.
  uninstall        Remove runtimes; data/config remain unless --purge-data is used.
  helper-version   Print this helper's version.

Options:
  --home PATH             Writable account home (for example /home/sabashop).
  --port PORT             Public prefix-gateway port (default: 8810).
  --host HOST             Bind address (default: 0.0.0.0).
  --access-host HOST      Hostname printed by access-info (no scheme or port).
  --access-scheme SCHEME  Direct browser scheme: http (default) or https.
  --public-url URL        Full externally proxied browser URL (optional).
  --base-path PATH        External URL prefix (default: /open; use / for root).
  --canvas-version VER    npm version/range (default: latest).
  --workspace PATH        Agent Canvas workspace directory.
  --upstream-port PORT    Internal Canvas ingress port (default: 18812).
  --backend-port PORT     Internal agent-server port (default: 18810).
  --automation-port PORT  Internal automation port (default: 18811).
  --frontend-port PORT    Internal static frontend port (default: 13810).
  --file PATH             JSON import/export file path.
  --import-secrets        Import fresh API keys from the local JSON file.
  --overwrite             Update same-name profiles except protected inline keys.
  --name NAME             Local model/endpoint name.
  --model-url URL         HTTPS GGUF URL from Hugging Face or GitHub.
  --sha256 HEX            Optional expected GGUF SHA-256.
  --context-length N      Local model context length (default: 8192).
  --base-url URL          Existing OpenAI-compatible local endpoint URL.
  --model MODEL           Model ID for an existing local endpoint.
  --api-key-file PATH     Owner-readable file containing an endpoint API key.
  --proxy-mode MODE       direct, direct-fallback, or proxy-only.
  --proxy-url TEMPLATE    HTTPS URL template containing {url}.
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
  openhands-host pair
  openhands-host models
  openhands-host test-models
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
        install|update|start|stop|restart|run|status|logs|access-info|pair|web-check|doctor|models|providers-export|providers-import|test-models|proxy-config|local-model-install|local-model-start|local-model-stop|local-endpoint-add|rotate-key|self-update|uninstall|helper-version|_serve)
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
        --public-url)
            (($# >= 2)) || die '--public-url requires a value.'
            CLI_PUBLIC_URL="$2"; shift 2 ;;
        --base-path)
            (($# >= 2)) || die '--base-path requires a value.'
            CLI_BASE_PATH="$2"; shift 2 ;;
        --canvas-version)
            (($# >= 2)) || die '--canvas-version requires a value.'
            CLI_CANVAS_VERSION="$2"; shift 2 ;;
        --workspace)
            (($# >= 2)) || die '--workspace requires a path.'
            CLI_WORKSPACE="$2"; shift 2 ;;
        --upstream-port)
            (($# >= 2)) || die '--upstream-port requires a value.'
            CLI_UPSTREAM_PORT="$2"; shift 2 ;;
        --backend-port)
            (($# >= 2)) || die '--backend-port requires a value.'
            CLI_BACKEND_PORT="$2"; shift 2 ;;
        --automation-port)
            (($# >= 2)) || die '--automation-port requires a value.'
            CLI_AUTOMATION_PORT="$2"; shift 2 ;;
        --frontend-port)
            (($# >= 2)) || die '--frontend-port requires a value.'
            CLI_FRONTEND_PORT="$2"; shift 2 ;;
        --file)
            (($# >= 2)) || die '--file requires a path.'
            MANAGER_FILE="$2"; shift 2 ;;
        --import-secrets) MANAGER_IMPORT_SECRETS=true; shift ;;
        --overwrite) MANAGER_OVERWRITE=true; shift ;;
        --name)
            (($# >= 2)) || die '--name requires a value.'
            MANAGER_NAME="$2"; shift 2 ;;
        --model-url)
            (($# >= 2)) || die '--model-url requires a URL.'
            MANAGER_MODEL_URL="$2"; shift 2 ;;
        --sha256)
            (($# >= 2)) || die '--sha256 requires a value.'
            MANAGER_SHA256="$2"; shift 2 ;;
        --context-length)
            (($# >= 2)) || die '--context-length requires a value.'
            MANAGER_CONTEXT_LENGTH="$2"; shift 2 ;;
        --base-url)
            (($# >= 2)) || die '--base-url requires a URL.'
            MANAGER_BASE_URL="$2"; shift 2 ;;
        --model)
            (($# >= 2)) || die '--model requires a value.'
            MANAGER_MODEL="$2"; shift 2 ;;
        --api-key-file)
            (($# >= 2)) || die '--api-key-file requires a path.'
            MANAGER_API_KEY_FILE="$2"; shift 2 ;;
        --proxy-mode)
            (($# >= 2)) || die '--proxy-mode requires a value.'
            MANAGER_PROXY_MODE="$2"; shift 2 ;;
        --proxy-url)
            (($# >= 2)) || die '--proxy-url requires a template.'
            MANAGER_PROXY_URL="$2"; shift 2 ;;
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
READY_FILE="$STATE_DIR/agent-canvas.ready"
PAIR_FILE="$STATE_DIR/browser-pair.env"
START_LOCK_DIR="$STATE_DIR/start.lock"
GATEWAY_SCRIPT="$APP_ROOT/prefix-gateway.mjs"
PROFILE_SEED_SCRIPT="$APP_ROOT/seed-llm-profiles.mjs"
MODEL_MANAGER_SCRIPT="$APP_ROOT/model-manager.mjs"
PROFILE_TESTER_SCRIPT="$APP_ROOT/profile-tester.py"
MODEL_MANAGER_CONFIG_FILE="$CONFIG_DIR/model-manager.json"
MODEL_MANAGER_DATA_DIR="$DATA_DIR/model-manager"
UV_BIN="$TOOLS_DIR/uv"
UVX_BIN="$TOOLS_DIR/uvx"
AGENT_BIN="$NPM_ROOT/node_modules/.bin/agent-canvas"

PORT="8810"
LISTEN_HOST="0.0.0.0"
ACCESS_HOST="${OPENHANDS_ACCESS_HOST:-}"
ACCESS_SCHEME="http"
PUBLIC_URL="${OPENHANDS_PUBLIC_URL:-}"
BASE_PATH="${OPENHANDS_BASE_PATH:-/open}"
CANVAS_VERSION="latest"
WORKSPACE="$CANVAS_STATE_DIR/workspaces"
UPSTREAM_PORT="18812"
BACKEND_PORT="18810"
AUTOMATION_PORT="18811"
FRONTEND_PORT="13810"
MODEL_MANAGER_PORT="18819"
LOCAL_MODEL_PORT="18820"
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
[[ -z "$CLI_PUBLIC_URL" ]] || PUBLIC_URL="$CLI_PUBLIC_URL"
[[ -z "$CLI_BASE_PATH" ]] || BASE_PATH="$CLI_BASE_PATH"
[[ -z "$CLI_CANVAS_VERSION" ]] || CANVAS_VERSION="$CLI_CANVAS_VERSION"
[[ -z "$CLI_WORKSPACE" ]] || WORKSPACE="$CLI_WORKSPACE"
[[ -z "$CLI_UPSTREAM_PORT" ]] || UPSTREAM_PORT="$CLI_UPSTREAM_PORT"
[[ -z "$CLI_BACKEND_PORT" ]] || BACKEND_PORT="$CLI_BACKEND_PORT"
[[ -z "$CLI_AUTOMATION_PORT" ]] || AUTOMATION_PORT="$CLI_AUTOMATION_PORT"
[[ -z "$CLI_FRONTEND_PORT" ]] || FRONTEND_PORT="$CLI_FRONTEND_PORT"

validate_port() {
    local label="$1" value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] || die "$label must be numeric."
    ((value >= 1024 && value <= 65535)) || die "$label must be between 1024 and 65535."
}

normalize_base_path() {
    local value="$1"
    [[ -n "$value" ]] || value="/"
    [[ "$value" == /* ]] || value="/$value"
    while [[ "$value" != "/" && "$value" == */ ]]; do value="${value%/}"; done
    printf '%s\n' "$value"
}
BASE_PATH="$(normalize_base_path "$BASE_PATH")"

validate_config() {
    local i j
    local -a labels=('gateway' 'canvas-ingress' 'agent-server' 'automation' 'frontend' 'editor' 'model-manager' 'local-model')
    local -a ports
    validate_port 'Gateway port' "$PORT"
    validate_port 'Canvas ingress port' "$UPSTREAM_PORT"
    validate_port 'Agent-server port' "$BACKEND_PORT"
    validate_port 'Automation port' "$AUTOMATION_PORT"
    validate_port 'Frontend port' "$FRONTEND_PORT"
    validate_port 'Model manager port' "$MODEL_MANAGER_PORT"
    validate_port 'Local model port' "$LOCAL_MODEL_PORT"
    ((BACKEND_PORT + 1000 <= 65535)) || die 'The agent-server port is too high for its editor sidecar port.'
    ports=("$PORT" "$UPSTREAM_PORT" "$BACKEND_PORT" "$AUTOMATION_PORT" "$FRONTEND_PORT" "$((BACKEND_PORT + 1000))" "$MODEL_MANAGER_PORT" "$LOCAL_MODEL_PORT")

    for ((i = 0; i < ${#ports[@]}; i++)); do
        for ((j = i + 1; j < ${#ports[@]}; j++)); do
            [[ "${ports[$i]}" != "${ports[$j]}" ]] || \
                die "Ports must be unique: ${labels[$i]} and ${labels[$j]} both use ${ports[$i]}."
        done
    done

    [[ -n "$LISTEN_HOST" && "$LISTEN_HOST" != *[[:space:]]* ]] || die 'Invalid bind host.'
    [[ -z "$ACCESS_HOST" || ( "$ACCESS_HOST" != *[[:space:]/:]* && "$ACCESS_HOST" != *'://'*) ]] || die '--access-host must be a hostname or IP without scheme/port.'
    [[ "$ACCESS_SCHEME" == "http" || "$ACCESS_SCHEME" == "https" ]] || die '--access-scheme must be http or https.'
    [[ -z "$PUBLIC_URL" || "$PUBLIC_URL" =~ ^https?://[^[:space:]]+$ ]] || die '--public-url must be a complete http(s) URL without spaces.'
    [[ "$BASE_PATH" == /* && "$BASE_PATH" != *[[:space:]?#]* ]] || die '--base-path must be a URL path such as /open.'
    [[ "$BASE_PATH" == "/" || "$BASE_PATH" != */ ]] || die 'Normalized base path must not end with a slash.'
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
        "$MODEL_MANAGER_DATA_DIR" \
        "$CACHE_DIR" \
        "$CONFIG_DIR" \
        "$STATE_DIR" \
        "$WORKSPACE"
    chmod 700 "$APP_ROOT" "$DATA_DIR" "$MODEL_MANAGER_DATA_DIR" "$CACHE_DIR" "$CONFIG_DIR" "$STATE_DIR" 2>/dev/null || true
}

write_gateway() {
    prepare_dirs
    cat > "$GATEWAY_SCRIPT" <<'EOF_GATEWAY'
#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";

const listenHost = process.env.OH_GATEWAY_HOST || "0.0.0.0";
const listenPort = Number(process.env.OH_GATEWAY_PORT);
const upstreamPort = Number(process.env.OH_GATEWAY_UPSTREAM_PORT);
const managerPort = Number(process.env.OH_GATEWAY_MODEL_MANAGER_PORT);
const pairFile = process.env.OH_GATEWAY_PAIR_FILE || "";
const secretsFile = process.env.OH_GATEWAY_SECRETS_FILE || "";
const rawBasePath = process.env.OH_GATEWAY_BASE_PATH || "/open";
const basePath = rawBasePath === "/" ? "/" : `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`;
const publicPairPath = `${basePath === "/" ? "" : basePath}/_openhands/pair`;
const publicPairPagePath = `${basePath === "/" ? "" : basePath}/pair`;
const pairPaths = new Set([publicPairPath, publicPairPagePath, "/_openhands/pair", "/pair"]);

if (!Number.isInteger(listenPort) || !Number.isInteger(upstreamPort) || !Number.isInteger(managerPort)) {
  console.error("Gateway and model-manager ports must be integers.");
  process.exit(2);
}

const backendPrefixes = [
  "/api",
  "/sockets",
  "/alive",
  "/health",
  "/ready",
  "/server_info",
  "/docs",
  "/redoc",
  "/openapi.json",
  "/vscode",
];

function matchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isBackendPath(pathname) {
  return backendPrefixes.some((prefix) => matchesPrefix(pathname, prefix));
}

// WebConsole's domain publisher strips /open before proxying while direct
// :8810/open requests retain it. Normalize both forms for the official Canvas
// ingress: backend routes are root-mounted; frontend routes keep the base path.
function upstreamUrl(rawUrl = "/") {
  const queryIndex = rawUrl.indexOf("?");
  const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : rawUrl.slice(queryIndex);
  if (basePath === "/") return rawUrl;

  const hasBase = pathname === basePath || pathname.startsWith(`${basePath}/`);
  const withoutBase = hasBase ? pathname.slice(basePath.length) || "/" : pathname;
  if (isBackendPath(withoutBase)) return `${withoutBase}${query}`;
  if (hasBase) return rawUrl;
  return `${basePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}${query}`;
}

function rewriteAssetUrls(input) {
  if (basePath === "/") return input;
  return input.replace(/(["'`])\/assets\//g, `$1${basePath}/assets/`);
}

function injectModelManagerLink(input) {
  const href = `${basePath === "/" ? "" : basePath}/models`;
  const link = `<a id="openhands-host-model-manager-link" href="${href}" title="Import/export providers, local models, bulk tests, and proxy settings" style="position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:10px 14px;border-radius:999px;background:#0284c7;color:#fff;text-decoration:none;font:700 14px/1.2 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.25)">⚙ مدیریت مدل‌ها</a>`;
  return input.includes("</body>") ? input.replace("</body>", `${link}\n</body>`) : `${input}${link}`;
}

function rewriteHtml(input) {
  if (basePath === "/") return injectModelManagerLink(input);
  const baseJson = JSON.stringify(basePath);
  const bootstrap = `<script> (function(){const base=${baseJson};window.__AGENT_CANVAS_BASE_PATH__=base;try{const backendsKey="openhands-backends",activeKey="openhands-active-backend",healthKey="openhands-backend-health",host=location.origin+base;let backends=[];const stored=localStorage.getItem(backendsKey);if(stored){const parsed=JSON.parse(stored);if(Array.isArray(parsed))backends=parsed;}let backend=backends.find((item)=>item&&item.id==="default-local");if(!backend){backend={id:"default-local",name:"Local",host,apiKey:"",kind:"local",authMode:"api-key"};backends.unshift(backend);}else{const changed=backend.host!==host;backend.name=backend.name||"Local";backend.host=host;backend.apiKey=typeof backend.apiKey==="string"?backend.apiKey:"";backend.kind="local";backend.authMode="api-key";if(changed)backend.connectionRevision=(Number.isSafeInteger(backend.connectionRevision)?backend.connectionRevision:0)+1;}localStorage.setItem(backendsKey,JSON.stringify(backends));let selection=null;try{selection=JSON.parse(sessionStorage.getItem(activeKey)||localStorage.getItem(activeKey)||"null");}catch{}const selected=selection&&backends.find((item)=>item&&item.id===selection.backendId);if(!selected||selected.id==="no-backend"||(selected.kind==="local"&&(!selected.host||selected.host===location.origin))){const value=JSON.stringify({backendId:backend.id,orgId:null});localStorage.setItem(activeKey,value);sessionStorage.setItem(activeKey,value);}try{const health=JSON.parse(localStorage.getItem(healthKey)||"{}");if(health&&typeof health==="object"&&backend.id in health){delete health[backend.id];if(Object.keys(health).length)localStorage.setItem(healthKey,JSON.stringify(health));else localStorage.removeItem(healthKey);}}catch{}}catch{}if(!location.pathname.startsWith(base+"/")&&location.pathname!==base){history.replaceState(history.state,"",base+(location.pathname.startsWith("/")?location.pathname:"/"+location.pathname)+location.search+location.hash);}}());</script>`;
  let html = rewriteAssetUrls(input)
    .replace(/(["'])\/favicon\.svg/g, `$1${basePath}/favicon.svg`)
    .replace(/"basename":"\/"/g, `"basename":${baseJson}`);
  html = html.includes("</head>")
    ? html.replace("</head>", `${bootstrap}\n</head>`)
    : `${bootstrap}${html}`;
  return injectModelManagerLink(html);
}

function requestPath(rawUrl = "/") {
  try {
    return new URL(rawUrl, "http://gateway.invalid").pathname;
  } catch {
    return "/";
  }
}

function isPairRequest(rawUrl) {
  return pairPaths.has(requestPath(rawUrl));
}

function pathWithoutBase(rawUrl) {
  const queryIndex = rawUrl.indexOf("?");
  const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : rawUrl.slice(queryIndex);
  if (basePath !== "/" && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    return `${pathname.slice(basePath.length) || "/"}${query}`;
  }
  return `${pathname}${query}`;
}

function isModelManagerRequest(rawUrl) {
  const pathname = requestPath(pathWithoutBase(rawUrl));
  return pathname === "/models" || pathname === "/models/" || pathname.startsWith("/_openhands/models-api/") || pathname === "/_openhands/models-api";
}

function proxyModelManager(req, res) {
  const headers = { ...req.headers, "accept-encoding": "identity", host: `127.0.0.1:${managerPort}` };
  const managerReq = http.request({ hostname: "127.0.0.1", port: managerPort, method: req.method, path: pathWithoutBase(req.url || "/"), headers }, (managerRes) => {
    res.writeHead(managerRes.statusCode || 502, managerRes.statusMessage, managerRes.headers);
    managerRes.pipe(res);
  });
  managerReq.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: `Model manager is unavailable: ${error.message}` }));
  });
  req.pipe(managerReq);
}

function pairingHeaders(contentType) {
  return {
    "cache-control": "no-store, max-age=0",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}

function pairingPage() {
  const endpointJson = JSON.stringify(publicPairPath);
  const baseJson = JSON.stringify(basePath);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair OpenHands</title><style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:12vh auto;padding:1.5rem;background:#111827;color:#f9fafb}main{border:1px solid #374151;border-radius:14px;padding:1.5rem;background:#1f2937}h1{margin-top:0;font-size:1.4rem}p{line-height:1.5}form{display:flex;gap:.6rem;flex-wrap:wrap}input{flex:1;min-width:14rem;padding:.8rem;border:1px solid #6b7280;border-radius:8px;background:#111827;color:#fff;font:1.05rem ui-monospace,monospace;text-transform:uppercase}button{padding:.8rem 1.1rem;border:0;border-radius:8px;background:#10b981;color:#052e24;font-weight:700;cursor:pointer}button:disabled{opacity:.55}.ok{color:#6ee7b7}.err{color:#fca5a5}</style></head><body><main><h1>Pair this browser with OpenHands</h1><p>Run <code>openhands-host pair</code>, then enter the short code shown in the terminal.</p><form id="pair-form"><input id="pair-code" inputmode="text" autocomplete="one-time-code" maxlength="19" placeholder="ABCD-EF01-2345-6789" aria-label="Pairing code" required><button id="pair-button" type="submit">Connect</button></form><p id="status"></p></main><script>(()=>{const form=document.getElementById("pair-form"),input=document.getElementById("pair-code"),button=document.getElementById("pair-button"),status=document.getElementById("status"),normalize=value=>String(value||"").replace(/[^a-f0-9]/gi,"").toLowerCase();async function connect(value){const token=normalize(value);if(!/^(?:[a-f0-9]{16}|[a-f0-9]{64})$/.test(token)){status.className="err";status.textContent="Enter the complete pairing code.";return;}button.disabled=true;status.className="";status.textContent="Pairing…";try{const response=await fetch(${endpointJson},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token})});const data=await response.json();if(!response.ok||!data.apiKey)throw new Error(data.error||"Pairing failed");const base=${baseJson},backendsKey="openhands-backends",activeKey="openhands-active-backend",healthKey="openhands-backend-health",host=location.origin+(base==="/"?"":base);let backends=[];try{const parsed=JSON.parse(localStorage.getItem(backendsKey)||"[]");if(Array.isArray(parsed))backends=parsed;}catch{}let backend=backends.find(item=>item&&item.id==="default-local");if(!backend){backend={id:"default-local",name:"Local",host,apiKey:data.apiKey,kind:"local",authMode:"api-key",connectionRevision:1};backends.unshift(backend);}else{backend.name=backend.name||"Local";backend.host=host;backend.apiKey=data.apiKey;backend.kind="local";backend.authMode="api-key";backend.connectionRevision=(Number.isSafeInteger(backend.connectionRevision)?backend.connectionRevision:0)+1;}localStorage.setItem(backendsKey,JSON.stringify(backends));const selection=JSON.stringify({backendId:backend.id,orgId:null});localStorage.setItem(activeKey,selection);sessionStorage.setItem(activeKey,selection);try{const health=JSON.parse(localStorage.getItem(healthKey)||"{}");if(health&&typeof health==="object"){delete health[backend.id];if(Object.keys(health).length)localStorage.setItem(healthKey,JSON.stringify(health));else localStorage.removeItem(healthKey);}}catch{}status.className="ok";status.textContent="Paired successfully. Opening OpenHands…";setTimeout(()=>location.replace(base==="/"?"/":base+"/"),250);}catch(error){button.disabled=false;status.className="err";status.textContent=error instanceof Error?error.message:"Pairing failed";}}form.addEventListener("submit",event=>{event.preventDefault();connect(input.value);});const fragment=location.hash.slice(1);history.replaceState(null,"",location.pathname);if(fragment)connect(fragment);else input.focus();})();</script></body></html>`;
}

function readPairRecord() {
  if (!pairFile) throw new Error("Browser pairing is not configured");
  const raw = fs.readFileSync(pairFile, "utf8");
  const hash = raw.match(/^TOKEN_SHA256=([a-f0-9]{64})$/mi)?.[1]?.toLowerCase();
  const expiresAt = Number(raw.match(/^EXPIRES_AT=([0-9]+)$/m)?.[1]);
  const attemptsLeft = Number(raw.match(/^ATTEMPTS_LEFT=([0-9]+)$/m)?.[1] || "8");
  if (!hash || !Number.isSafeInteger(expiresAt) || !Number.isInteger(attemptsLeft) || attemptsLeft < 1 || attemptsLeft > 8) {
    throw new Error("The pairing record is invalid");
  }
  return { hash, expiresAt, attemptsLeft };
}

function writePairRecord(record) {
  fs.writeFileSync(pairFile, `TOKEN_SHA256=${record.hash}\nEXPIRES_AT=${record.expiresAt}\nATTEMPTS_LEFT=${record.attemptsLeft}\n`, { mode: 0o600 });
  fs.chmodSync(pairFile, 0o600);
}

function readStoredApiKey() {
  if (!secretsFile) throw new Error("OpenHands secrets are not configured");
  const raw = fs.readFileSync(secretsFile, "utf8");
  const apiKey = raw.match(/^LOCAL_BACKEND_API_KEY=([a-f0-9]{64,})$/mi)?.[1];
  if (!apiKey) throw new Error("The stored OpenHands API key is invalid");
  return apiKey;
}

function consumePairToken(input) {
  const token = String(input || "").replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (!/^(?:[a-f0-9]{16}|[a-f0-9]{64})$/.test(token)) throw new Error("Invalid pairing code");
  const record = readPairRecord();
  if (Math.floor(Date.now() / 1000) > record.expiresAt) {
    try { fs.unlinkSync(pairFile); } catch {}
    throw new Error("This pairing code has expired");
  }
  const actual = crypto.createHash("sha256").update(token, "utf8").digest();
  const expected = Buffer.from(record.hash, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    if (record.attemptsLeft <= 1) {
      try { fs.unlinkSync(pairFile); } catch {}
    } else {
      writePairRecord({ ...record, attemptsLeft: record.attemptsLeft - 1 });
    }
    throw new Error("Invalid pairing code");
  }
  const apiKey = readStoredApiKey();
  // Synchronous validation and deletion happen in one event-loop turn, making
  // the code single-use even if two POST requests arrive together.
  fs.unlinkSync(pairFile);
  return apiKey;
}

function handlePairRequest(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    const body = Buffer.from(pairingPage(), "utf8");
    res.writeHead(200, { ...pairingHeaders("text/html; charset=utf-8"), "content-length": String(body.length) });
    if (req.method === "HEAD") res.end(); else res.end(body);
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { ...pairingHeaders("application/json; charset=utf-8"), allow: "GET, HEAD, POST" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const chunks = [];
  let size = 0;
  let rejected = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > 4096) {
      rejected = true;
      res.writeHead(413, pairingHeaders("application/json; charset=utf-8"));
      res.end(JSON.stringify({ error: "Pairing request is too large" }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (rejected) return;
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const apiKey = consumePairToken(String(input?.token || ""));
      res.writeHead(200, pairingHeaders("application/json; charset=utf-8"));
      res.end(JSON.stringify({ apiKey }));
    } catch (error) {
      const missing = error && typeof error === "object" && "code" in error && error.code === "ENOENT";
      const message = error instanceof Error ? error.message : "Pairing failed";
      res.writeHead(missing ? 410 : 403, pairingHeaders("application/json; charset=utf-8"));
      res.end(JSON.stringify({ error: missing ? "This pairing code is expired or already used" : message }));
    }
  });
}

function proxyHttp(req, res) {
  if (isModelManagerRequest(req.url || "/")) {
    proxyModelManager(req, res);
    return;
  }
  if (isPairRequest(req.url)) {
    handlePairRequest(req, res);
    return;
  }
  const headers = { ...req.headers, "accept-encoding": "identity" };
  headers.host = `127.0.0.1:${upstreamPort}`;
  headers["x-forwarded-host"] ||= req.headers.host || "";

  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: upstreamUrl(req.url),
      headers,
    },
    (proxyRes) => {
      const contentType = String(proxyRes.headers["content-type"] || "").toLowerCase();
      const isHtml = contentType.includes("text/html");
      const isJavaScript = contentType.includes("javascript");
      if (req.method === "HEAD" || (!isHtml && !isJavaScript)) {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, proxyRes.headers);
        proxyRes.pipe(res);
        return;
      }

      const chunks = [];
      let size = 0;
      proxyRes.on("data", (chunk) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          proxyRes.destroy(new Error("Text response exceeded the gateway limit"));
          return;
        }
        chunks.push(chunk);
      });
      proxyRes.on("end", () => {
        const source = Buffer.concat(chunks).toString("utf8");
        const body = Buffer.from(isHtml ? rewriteHtml(source) : rewriteAssetUrls(source), "utf8");
        const responseHeaders = { ...proxyRes.headers };
        delete responseHeaders["content-encoding"];
        delete responseHeaders["transfer-encoding"];
        delete responseHeaders.etag;
        responseHeaders["content-length"] = String(body.length);
        responseHeaders["cache-control"] = "no-store";
        res.writeHead(proxyRes.statusCode || 200, proxyRes.statusMessage, responseHeaders);
        if (req.method === "HEAD") res.end();
        else res.end(body);
      });
      proxyRes.on("error", (error) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end(`Canvas upstream response failed: ${error.message}`);
      });
    },
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Canvas upstream is unavailable: ${error.message}`);
  });
  req.pipe(proxyReq);
}

const server = http.createServer(proxyHttp);

server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(upstreamPort, "127.0.0.1");
  upstream.on("connect", () => {
    upstream.write(`${req.method} ${upstreamUrl(req.url)} HTTP/${req.httpVersion}\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const value = name.toLowerCase() === "host" ? `127.0.0.1:${upstreamPort}` : req.rawHeaders[i + 1];
      upstream.write(`${name}: ${value}\r\n`);
    }
    upstream.write("\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => {
    if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  socket.on("error", () => upstream.destroy());
});

server.on("clientError", (_error, socket) => {
  if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(listenPort, listenHost, () => {
  console.log(`[openhands-prefix-gateway] Public gateway listening on http://${listenHost}:${listenPort}${basePath === "/" ? "/" : `${basePath}/`}`);
  console.log(`[openhands-prefix-gateway] Canvas upstream: http://127.0.0.1:${upstreamPort}${basePath === "/" ? "/" : `${basePath}/`}`);
});
EOF_GATEWAY
    chmod 700 "$GATEWAY_SCRIPT"
}

write_profile_seed() {
    prepare_dirs
    cat > "$PROFILE_SEED_SCRIPT" <<'EOF_PROFILE_SEED'
#!/usr/bin/env node

const backendPort = Number(process.env.OH_PROFILE_SEED_BACKEND_PORT);
const modelManagerPort = Number(process.env.OH_PROFILE_SEED_MODEL_MANAGER_PORT || "18819");
const sessionKey = process.env.LOCAL_BACKEND_API_KEY || "";
const backend = `http://127.0.0.1:${backendPort}`;

if (!Number.isInteger(backendPort) || !Number.isInteger(modelManagerPort) || !sessionKey) {
  console.error("[openhands-profile-seed] Backend port or session key is missing.");
  process.exit(2);
}

// These are deliberately credential-free templates. The API key posted in
// chat is never written here. Link the profiles to a fresh OpenRouter Provider
// Connection from Settings > LLM after revoking the exposed key.
const profiles = [
  { name: "openrouter-seed-2-1-turbo", model: "openrouter/bytedance-seed/seed-2-1-turbo", maxInput: 262144, maxOutput: 8192 },
  { name: "openrouter-qwen3-8-2-4t-a95b", model: "openrouter/qwen/qwen3.8-2.4t-a95b", maxInput: 1000000, maxOutput: 8192 },
  { name: "openrouter-seed-2-0-code", model: "openrouter/bytedance-seed/seed-2.0-code", maxInput: 262144, maxOutput: 8192 },
  { name: "openrouter-deepseek-v4-pro-0813", model: "openrouter/deepseek/deepseek-v4-pro-0813", maxInput: 1048576, maxOutput: 8192 },
  { name: "openrouter-grok-4-6", model: "openrouter/x-ai/grok-4.6", maxInput: 500000, maxOutput: 8192 },
  { name: "openrouter-lfm-2-5-2-6b-free", model: "openrouter/liquid/lfm-2.5-2.6b:free", maxInput: 65536, maxOutput: 8192 },
  { name: "openrouter-nemotron-3-5-lightning", model: "openrouter/nvidia/nemotron-3.5-lightning", maxInput: 262144, maxOutput: 8192 },
  { name: "openrouter-nemotron-3-5-lightning-free", model: "openrouter/nvidia/nemotron-3.5-lightning:free", maxInput: 1000000, maxOutput: 8192 },
  { name: "openrouter-sakana-namazu", model: "openrouter/sakana/sakana-namazu", maxInput: 262144, maxOutput: 8192 },
  { name: "openrouter-solar-pro4", model: "openrouter/upstage/solar-pro4", maxInput: 524288, maxOutput: 8192 },
  { name: "openrouter-muse-glimmer-30b", model: "openrouter/meta/muse-glimmer-30b", maxInput: 131072, maxOutput: 8192 },
  { name: "openrouter-muse-spark-1-2", model: "openrouter/meta/muse-spark-1.2", maxInput: 1048576, maxOutput: 8192 },
];

async function request(path, options = {}) {
  const response = await fetch(`${backend}${path}`, {
    ...options,
    headers: {
      "X-Session-API-Key": sessionKey,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`HTTP ${response.status}: ${String(detail).slice(0, 500)}`);
  }
  return data;
}

let listed;
try {
  listed = await request("/api/profiles");
} catch (error) {
  console.error(`[openhands-profile-seed] Could not list LLM profiles: ${error.message}`);
  process.exit(1);
}

const existing = new Set(Array.isArray(listed?.profiles) ? listed.profiles.map((profile) => profile?.name).filter(Boolean) : []);
let added = 0;
const failures = [];
for (const profile of profiles) {
  if (existing.has(profile.name)) continue;
  const body = {
    llm: {
      model: profile.model,
      base_url: `http://127.0.0.1:${modelManagerPort}/routes/openrouter/api/v1`,
      max_input_tokens: profile.maxInput,
      max_output_tokens: profile.maxOutput,
      native_tool_calling: true,
      api_mode: "chat",
      drop_params: true,
    },
    include_secrets: false,
  };
  try {
    await request(`/api/profiles/${encodeURIComponent(profile.name)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    added += 1;
  } catch (error) {
    failures.push(`${profile.name}: ${error.message}`);
  }
}

console.log(`[openhands-profile-seed] OpenRouter profiles present: ${profiles.length - failures.length}/${profiles.length}; newly added: ${added}.`);
if (failures.length) {
  for (const failure of failures) console.error(`[openhands-profile-seed] ${failure}`);
  process.exit(1);
}
EOF_PROFILE_SEED
    chmod 700 "$PROFILE_SEED_SCRIPT"
}

write_wrapper() {
    {
        printf '#!/usr/bin/env bash\n'
        printf 'exec %q --home %q "$@"\n' "$HELPER_COPY" "$HOME"
    } > "$WRAPPER"
    chmod 700 "$WRAPPER"
}

install_companion() {
    local filename="$1" destination="$2" source_path="" source_dir="" candidate="" temp=""
    source_path="${BASH_SOURCE[0]:-}"
    if [[ "$source_path" != */* ]]; then source_path="$(command -v -- "$source_path" 2>/dev/null || printf '%s' "$source_path")"; fi
    source_dir="$(cd "$(dirname "$source_path")" 2>/dev/null && pwd -P || true)"
    candidate="$source_dir/$filename"
    if [[ -r "$candidate" ]]; then
        cp "$candidate" "$destination"
    elif [[ ! -s "$destination" ]]; then
        temp="$destination.download.$$"
        secure_curl -o "$temp" "https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/01a0f230-new/host-helpers/$filename"
        mv -f "$temp" "$destination"
    fi
    [[ -s "$destination" ]] || die "OpenHands companion file is missing: $filename"
    chmod 700 "$destination"
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
    write_gateway
    write_profile_seed
    install_companion 'openhands-model-manager.mjs' "$MODEL_MANAGER_SCRIPT"
    install_companion 'openhands-profile-tester.py' "$PROFILE_TESTER_SCRIPT"
}

save_config() {
    prepare_dirs
    {
        printf '# Generated by %s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
        printf 'PORT=%q\n' "$PORT"
        printf 'LISTEN_HOST=%q\n' "$LISTEN_HOST"
        printf 'ACCESS_HOST=%q\n' "$ACCESS_HOST"
        printf 'ACCESS_SCHEME=%q\n' "$ACCESS_SCHEME"
        printf 'PUBLIC_URL=%q\n' "$PUBLIC_URL"
        printf 'BASE_PATH=%q\n' "$BASE_PATH"
        printf 'CANVAS_VERSION=%q\n' "$CANVAS_VERSION"
        printf 'WORKSPACE=%q\n' "$WORKSPACE"
        printf 'UPSTREAM_PORT=%q\n' "$UPSTREAM_PORT"
        printf 'BACKEND_PORT=%q\n' "$BACKEND_PORT"
        printf 'AUTOMATION_PORT=%q\n' "$AUTOMATION_PORT"
        printf 'FRONTEND_PORT=%q\n' "$FRONTEND_PORT"
        printf 'MODEL_MANAGER_PORT=%q\n' "$MODEL_MANAGER_PORT"
        printf 'LOCAL_MODEL_PORT=%q\n' "$LOCAL_MODEL_PORT"
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

sha256_value() {
    local value="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$value" | sha256sum | awk '{print $1}'
    elif command -v openssl >/dev/null 2>&1; then
        printf '%s' "$value" | openssl dgst -sha256 -r | awk '{print $1}'
    elif command -v python3 >/dev/null 2>&1; then
        printf '%s' "$value" | python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
    else
        die 'sha256sum, openssl, or Python 3 is required for browser pairing.'
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
    export VITE_BASE_PATH="$BASE_PATH"
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
    if [[ "$cmdline" != *"$AGENT_BIN"* && "$cmdline" != *"$HELPER_COPY"* && "$cmdline" != *"$WRAPPER"* && "$cmdline" != *install-openhands-host.sh* ]]; then
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
    rm -f "$PID_FILE" "$PID_START_FILE" "$READY_FILE" "$PAIR_FILE"
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
    local host path
    if [[ -n "$PUBLIC_URL" ]]; then
        if [[ "$PUBLIC_URL" == */ ]]; then printf '%s\n' "$PUBLIC_URL"; else printf '%s/\n' "$PUBLIC_URL"; fi
        return
    fi

    host="$(browser_host)"
    path="/"
    [[ "$BASE_PATH" == "/" ]] || path="$BASE_PATH/"

    # A named host plus a non-root base path denotes WebConsole's HTTPS domain
    # publisher. Direct port users can override this with --public-url.
    if [[ -n "$ACCESS_HOST" && "$BASE_PATH" != "/" ]]; then
        printf 'https://%s%s\n' "$host" "$path"
    elif [[ "$ACCESS_SCHEME" == "https" && "$PORT" == "443" ]]; then
        printf 'https://%s%s\n' "$host" "$path"
    elif [[ "$ACCESS_SCHEME" == "http" && "$PORT" == "80" ]]; then
        printf 'http://%s%s\n' "$host" "$path"
    else
        printf '%s://%s:%s%s\n' "$ACCESS_SCHEME" "$host" "$PORT" "$path"
    fi
}

agent_server_accepts_key() {
    ensure_secrets >/dev/null
    # /server_info is intentionally public. Match Canvas's own connection
    # validation by probing protected settings with the currently stored key.
    curl -fsS --max-time 5 \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" \
        "http://127.0.0.1:$BACKEND_PORT/api/settings" >/dev/null 2>&1
}

agent_server_is_ready() {
    # The official Canvas ingress has its own /health route, which can remain
    # HTTP 200 after the Python agent-server behind it has exited. Probe both
    # the backend identity and protected settings so a live frontend or a
    # stale runtime key cannot masquerade as a usable backend.
    agent_server_accepts_key && curl -fsS --max-time 5 \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" \
        "http://127.0.0.1:$BACKEND_PORT/server_info" >/dev/null 2>&1
}

agent_is_healthy() {
    local prefix="$BASE_PATH"
    [[ "$prefix" == "/" ]] && prefix=""
    agent_server_is_ready && curl -fsS --max-time 5 \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" \
        "$(local_url)$prefix/api/settings" >/dev/null 2>&1
}

port_is_open() {
    local port="$1"
    (exec 9<>"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
}

START_LOCK_HELD=false
SUPERVISED_AGENT_PID=""
SUPERVISED_GATEWAY_PID=""
SUPERVISED_MODEL_MANAGER_PID=""

startup_lock_owner_is_live() {
    local pid="" saved_token="" live_token="" uid_line=""
    [[ -r "$START_LOCK_DIR/pid" ]] || return 1
    pid="$(cat "$START_LOCK_DIR/pid" 2>/dev/null || true)"
    saved_token="$(cat "$START_LOCK_DIR/start" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/status" ]] || return 1
    uid_line="$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null || true)"
    [[ "$uid_line" == "$(id -u)" ]] || return 1
    live_token="$(process_start_token "$pid" 2>/dev/null || true)"
    [[ -n "$live_token" && "$live_token" == "$saved_token" ]] || return 1
    kill -0 "$pid" 2>/dev/null
}

acquire_startup_lock() {
    local waited=0 owner=""
    prepare_dirs
    while ! mkdir "$START_LOCK_DIR" 2>/dev/null; do
        if ! startup_lock_owner_is_live; then
            # mkdir is atomic, but its owner metadata is written immediately
            # afterward. Give that tiny initialization window one full second.
            sleep 1
            if ! startup_lock_owner_is_live; then
                [[ "$START_LOCK_DIR" == "$STATE_DIR/start.lock" ]] || die 'Refusing to remove an unexpected startup lock path.'
                rm -rf "$START_LOCK_DIR"
            fi
            continue
        fi
        owner="$(cat "$START_LOCK_DIR/pid" 2>/dev/null || true)"
        if ((waited == 0)); then
            log "Waiting for the existing OpenHands launcher (PID $owner) to stop..."
        fi
        ((waited < 90)) || die "Another OpenHands launcher still owns the startup lock (PID $owner)."
        sleep 1
        waited=$((waited + 1))
    done
    printf '%s\n' "$$" > "$START_LOCK_DIR/pid"
    process_start_token "$$" > "$START_LOCK_DIR/start"
    chmod 700 "$START_LOCK_DIR" 2>/dev/null || true
    chmod 600 "$START_LOCK_DIR/pid" "$START_LOCK_DIR/start" 2>/dev/null || true
    START_LOCK_HELD=true
}

release_startup_lock() {
    local owner=""
    [[ "$START_LOCK_HELD" == true ]] || return 0
    owner="$(cat "$START_LOCK_DIR/pid" 2>/dev/null || true)"
    if [[ "$owner" == "$$" && "$START_LOCK_DIR" == "$STATE_DIR/start.lock" ]]; then
        rm -rf "$START_LOCK_DIR"
    fi
    START_LOCK_HELD=false
}

pid_is_self_or_ancestor() {
    local target="$1" current="$$" self="$$"
    # Never select this supervisor or one of its ancestors (for example, the
    # background `start` action that is waiting for this child to become ready).
    while [[ "$current" =~ ^[0-9]+$ && "$current" != "0" ]]; do
        [[ "$target" != "$current" ]] || return 0
        current="$(awk '/^PPid:/{print $2; exit}' "/proc/$current/status" 2>/dev/null || true)"
    done
    # /proc scanning itself creates short-lived Bash/awk/tr descendants whose
    # command line can contain this helper's name. Exclude the full child tree.
    current="$target"
    while [[ "$current" =~ ^[0-9]+$ && "$current" != "0" ]]; do
        [[ "$current" != "$self" ]] || return 0
        current="$(awk '/^PPid:/{print $2; exit}' "/proc/$current/status" 2>/dev/null || true)"
    done
    return 1
}

pid_is_canvas_runtime() {
    local pid="${1:-}" uid_line="" cmdline=""
    [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/status" ]] || return 1
    uid_line="$(awk '/^Uid:/{print $2; exit}' "/proc/$pid/status" 2>/dev/null || true)"
    [[ "$uid_line" == "$(id -u)" ]] || return 1
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    [[ -n "$cmdline" ]] || return 1
    case "$cmdline" in
        *install-openhands-host.sh*|*"$HELPER_COPY"*|*"$WRAPPER"*|*"$GATEWAY_SCRIPT"*|*"$MODEL_MANAGER_SCRIPT"*|*"$TOOLS_DIR/llama.cpp"*llama-server*|*"$NPM_ROOT"*agent-canvas*|*"$TOOLS_DIR/uvx"*|*"$APP_ROOT/python"*openhands*|*"$APP_ROOT/uv-tools"*openhands*|*"$CACHE_DIR/uv"*openhands*|*"$CANVAS_STATE_DIR"*|*openhands-agent-server*|*openhands.automation*|*openvscode-server*) ;;
        *) return 1 ;;
    esac
    pid_is_self_or_ancestor "$pid" && return 1
    return 0
}

canvas_runtime_pids() {
    local proc pid
    for proc in /proc/[0-9]*; do
        pid="${proc##*/}"
        pid_is_canvas_runtime "$pid" && printf '%s\n' "$pid"
    done
    return 0
}

cleanup_orphaned_runtime() {
    local pids="" pid="" waited=0 announced=false

    # Do not gate cleanup on an already-open port. A launcher from the previous
    # deployment may still be installing Python and bind several seconds later.
    # Re-scan while stopping so children spawned during shutdown are caught too.
    while ((waited < 12)); do
        pids="$(canvas_runtime_pids | sort -un || true)"
        [[ -n "$pids" ]] || break
        if [[ "$announced" == false ]]; then
            log 'Removing account-owned OpenHands runtime processes from the previous launch...'
            announced=true
        fi
        for pid in $pids; do
            pid_is_canvas_runtime "$pid" && kill -TERM "$pid" 2>/dev/null || true
        done
        sleep 1
        waited=$((waited + 1))
    done

    pids="$(canvas_runtime_pids | sort -un || true)"
    for pid in $pids; do
        if pid_is_canvas_runtime "$pid" && kill -0 "$pid" 2>/dev/null; then
            warn "Force-stopping orphaned OpenHands process $pid"
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done

    waited=0
    while ((waited < 5)); do
        pids="$(canvas_runtime_pids | sort -un || true)"
        [[ -n "$pids" ]] || break
        for pid in $pids; do
            pid_is_canvas_runtime "$pid" && kill -KILL "$pid" 2>/dev/null || true
        done
        sleep 1
        waited=$((waited + 1))
    done
    rm -f "$PID_FILE" "$PID_START_FILE" "$READY_FILE" "$PAIR_FILE"
}

assert_runtime_ports_free() {
    local label port
    for label in gateway canvas-ingress agent-server automation frontend editor model-manager local-model; do
        case "$label" in
            gateway) port="$PORT" ;;
            canvas-ingress) port="$UPSTREAM_PORT" ;;
            agent-server) port="$BACKEND_PORT" ;;
            automation) port="$AUTOMATION_PORT" ;;
            frontend) port="$FRONTEND_PORT" ;;
            editor) port="$((BACKEND_PORT + 1000))" ;;
            model-manager) port="$MODEL_MANAGER_PORT" ;;
            local-model) port="$LOCAL_MODEL_PORT" ;;
        esac
        if port_is_open "$port"; then
            die "$label port $port is already in use by an unrecognized process. Choose different helper ports or stop that process."
        fi
    done
    return 0
}

supervisor_cleanup() {
    local pid="" waited=0 recorded=""
    trap - EXIT INT TERM HUP
    set +e
    rm -f "$READY_FILE" "$PAIR_FILE"
    for pid in "$SUPERVISED_GATEWAY_PID" "$SUPERVISED_MODEL_MANAGER_PID" "$SUPERVISED_AGENT_PID"; do
        [[ "$pid" =~ ^[0-9]+$ ]] && kill -TERM "$pid" 2>/dev/null || true
    done
    while ((waited < 12)); do
        local alive=false
        for pid in "$SUPERVISED_GATEWAY_PID" "$SUPERVISED_MODEL_MANAGER_PID" "$SUPERVISED_AGENT_PID"; do
            if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then alive=true; fi
        done
        [[ "$alive" == true ]] || break
        sleep 1
        waited=$((waited + 1))
    done
    for pid in "$SUPERVISED_GATEWAY_PID" "$SUPERVISED_MODEL_MANAGER_PID" "$SUPERVISED_AGENT_PID"; do
        if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
            warn "Force-stopping supervised OpenHands process $pid"
            kill -KILL "$pid" 2>/dev/null || true
        fi
        [[ "$pid" =~ ^[0-9]+$ ]] && wait "$pid" 2>/dev/null || true
    done
    cleanup_orphaned_runtime
    recorded="$(cat "$PID_FILE" 2>/dev/null || true)"
    [[ "$recorded" != "$$" ]] || rm -f "$PID_FILE" "$PID_START_FILE"
    release_startup_lock
}

seed_llm_profiles() {
    write_profile_seed
    if ! OH_PROFILE_SEED_BACKEND_PORT="$BACKEND_PORT" \
        OH_PROFILE_SEED_MODEL_MANAGER_PORT="$MODEL_MANAGER_PORT" \
        LOCAL_BACKEND_API_KEY="$LOCAL_BACKEND_API_KEY" \
        "$NODE_HOME/bin/node" "$PROFILE_SEED_SCRIPT"; then
        warn 'One or more OpenRouter profile templates could not be seeded; startup will continue.'
    fi
}

serve_agent() {
    local -a args=(--public --port "$UPSTREAM_PORT" --host 127.0.0.1)
    local waited=0 gateway_path="" root_code="" child_status=1 health_failures=0

    load_runtime_environment
    write_gateway
    acquire_startup_lock
    trap supervisor_cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP

    cleanup_orphaned_runtime
    assert_runtime_ports_free
    record_pid "$$"
    rm -f "$READY_FILE"

    log "Starting Agent Canvas upstream in authenticated public mode on 127.0.0.1:$UPSTREAM_PORT"
    log "Canvas browser base path: $BASE_PATH"
    "$AGENT_BIN" "${args[@]}" &
    SUPERVISED_AGENT_PID=$!

    # Canvas starts its ingress even when the Python agent-server timed out or
    # exited, and that ingress keeps /health green. Do not publish the frontend
    # until the actual backend answers /server_info and accepts the stored key
    # at /api/settings on its internal port.
    while ! agent_server_is_ready; do
        if ! kill -0 "$SUPERVISED_AGENT_PID" 2>/dev/null; then
            if wait "$SUPERVISED_AGENT_PID"; then child_status=0; else child_status=$?; fi
            die "Agent Canvas upstream exited during startup (code $child_status)."
        fi
        if ((waited > 0 && waited % 30 == 0)); then
            log 'Agent Server is still starting (initial Python setup can take several minutes)...'
        fi
        ((waited < 900)) || die 'Agent Server did not become ready in 15 minutes; restarting the supervised stack.'
        sleep 1
        waited=$((waited + 1))
    done
    log "Agent Server backend is ready and accepts the stored API key on 127.0.0.1:$BACKEND_PORT"
    seed_llm_profiles

    log "Starting the authenticated model manager on 127.0.0.1:$MODEL_MANAGER_PORT"
    OH_MODEL_MANAGER_PORT="$MODEL_MANAGER_PORT" \
        OH_LOCAL_MODEL_PORT="$LOCAL_MODEL_PORT" \
        OH_MODEL_MANAGER_BACKEND_PORT="$BACKEND_PORT" \
        OH_GATEWAY_BASE_PATH="$BASE_PATH" \
        OH_MODEL_MANAGER_CONFIG_FILE="$MODEL_MANAGER_CONFIG_FILE" \
        OH_MODEL_MANAGER_DATA_DIR="$MODEL_MANAGER_DATA_DIR" \
        OH_MODEL_MANAGER_TOOLS_DIR="$TOOLS_DIR" \
        OH_MODEL_MANAGER_UV_BIN="$UV_BIN" \
        OH_MODEL_MANAGER_TESTER="$PROFILE_TESTER_SCRIPT" \
        OH_MODEL_MANAGER_WORKSPACE="$WORKSPACE" \
        OH_PERSISTENCE_DIR="$DATA_DIR" \
        LOCAL_BACKEND_API_KEY="$LOCAL_BACKEND_API_KEY" \
        OH_SECRET_KEY="$OH_SECRET_KEY" \
        "$NODE_HOME/bin/node" "$MODEL_MANAGER_SCRIPT" &
    SUPERVISED_MODEL_MANAGER_PID=$!
    waited=0
    while ! curl -fsS --max-time 3 "http://127.0.0.1:$MODEL_MANAGER_PORT/health" >/dev/null 2>&1; do
        if ! kill -0 "$SUPERVISED_MODEL_MANAGER_PID" 2>/dev/null; then
            if wait "$SUPERVISED_MODEL_MANAGER_PID"; then child_status=0; else child_status=$?; fi
            die "OpenHands model manager exited during startup (code $child_status)."
        fi
        ((waited < 30)) || die 'OpenHands model manager did not become ready in 30 seconds.'
        sleep 1
        waited=$((waited + 1))
    done

    export OH_GATEWAY_HOST="$LISTEN_HOST"
    export OH_GATEWAY_PORT="$PORT"
    export OH_GATEWAY_UPSTREAM_PORT="$UPSTREAM_PORT"
    export OH_GATEWAY_MODEL_MANAGER_PORT="$MODEL_MANAGER_PORT"
    export OH_GATEWAY_BASE_PATH="$BASE_PATH"
    export OH_GATEWAY_PAIR_FILE="$PAIR_FILE"
    export OH_GATEWAY_SECRETS_FILE="$SECRETS_FILE"
    log "Starting the prefix-aware public gateway on $LISTEN_HOST:$PORT"
    "$NODE_HOME/bin/node" "$GATEWAY_SCRIPT" &
    SUPERVISED_GATEWAY_PID=$!

    gateway_path="$BASE_PATH"
    [[ "$gateway_path" == "/" ]] && gateway_path=""
    waited=0
    while :; do
        root_code="$(curl -sS --max-time 5 -o "$CACHE_DIR/gateway-root.$$" -w '%{http_code}' \
            "http://127.0.0.1:$PORT$gateway_path/" 2>/dev/null || true)"
        if [[ "$root_code" == "200" ]] && grep -Eqi '<!doctype html|<html' "$CACHE_DIR/gateway-root.$$"; then
            break
        fi
        if ! kill -0 "$SUPERVISED_GATEWAY_PID" 2>/dev/null; then
            if wait "$SUPERVISED_GATEWAY_PID"; then child_status=0; else child_status=$?; fi
            die "OpenHands public gateway exited during startup (code $child_status)."
        fi
        ((waited < 30)) || die 'OpenHands public gateway did not become ready in 30 seconds.'
        sleep 1
        waited=$((waited + 1))
    done
    rm -f "$CACHE_DIR/gateway-root.$$"
    printf '%s\n' "$$" > "$READY_FILE"
    chmod 600 "$READY_FILE" 2>/dev/null || true
    log "Agent Canvas is ready: $(browser_url)"

    while kill -0 "$SUPERVISED_AGENT_PID" 2>/dev/null && kill -0 "$SUPERVISED_MODEL_MANAGER_PID" 2>/dev/null && kill -0 "$SUPERVISED_GATEWAY_PID" 2>/dev/null; do
        sleep 5
        if agent_server_is_ready; then
            health_failures=0
        else
            health_failures=$((health_failures + 1))
            warn "Agent Server readiness/API-key probe failed ($health_failures/3) on 127.0.0.1:$BACKEND_PORT."
            if ((health_failures >= 3)); then
                warn 'Agent Server stayed unavailable; exiting the supervised stack so WebConsole can restart it cleanly.'
                return 1
            fi
        fi
    done
    if ! kill -0 "$SUPERVISED_AGENT_PID" 2>/dev/null; then
        if wait "$SUPERVISED_AGENT_PID"; then child_status=0; else child_status=$?; fi
        warn "Agent Canvas upstream exited (code $child_status)."
    elif ! kill -0 "$SUPERVISED_MODEL_MANAGER_PID" 2>/dev/null; then
        if wait "$SUPERVISED_MODEL_MANAGER_PID"; then child_status=0; else child_status=$?; fi
        warn "OpenHands model manager exited (code $child_status)."
    else
        if wait "$SUPERVISED_GATEWAY_PID"; then child_status=0; else child_status=$?; fi
        warn "OpenHands public gateway exited (code $child_status)."
    fi
    return "$child_status"
}

start_agent() {
    local pid="" waited=0
    prepare_dirs
    save_config
    persist_helper
    if pid="$(managed_pid 2>/dev/null)"; then
        log "Agent Canvas is already running (PID $pid)."
        agent_is_healthy && log "Health: OK (Agent Server /server_info)" || warn 'The process is running but the Agent Server is not ready yet.'
        return 0
    fi
    ensure_runtime_installed
    load_runtime_environment
    rm -f "$READY_FILE"
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
        if [[ "$(cat "$READY_FILE" 2>/dev/null || true)" == "$pid" ]] && agent_is_healthy; then
            log "Agent Canvas is ready: $(browser_url)"
            log 'Run openhands-host pair for a secure one-click browser login.'
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
    if pid="$(managed_pid 2>/dev/null)"; then
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
    else
        log 'No live helper supervisor was recorded; checking for orphaned runtimes.'
    fi
    cleanup_orphaned_runtime
    rm -f "$PID_FILE" "$PID_START_FILE" "$READY_FILE"
    log 'Agent Canvas stopped.'
}

run_foreground() {
    prepare_dirs
    save_config
    persist_helper
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
    printf 'Model manager: %s\n' "$(models_url)"
    printf 'Browser base path: %s\n' "$BASE_PATH"
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
    if [[ "$(browser_url)" == https://* ]]; then
        printf 'Transport: HTTPS URL configured; verify that your external proxy really terminates TLS.\n'
    else
        printf 'Transport: plain HTTP. Do not enter the key over an untrusted network.\n'
        printf 'For Internet use, terminate TLS in a real reverse proxy, then configure --public-url.\n'
    fi
    printf 'Warning: authenticated agents have this account user\047s filesystem, shell, and network permissions.\n'
}

pair_browser() {
    local random="" token="" display_code="" token_hash="" expires_at="" url="" prefix="" probe="$CACHE_DIR/pair-probe.$$" tmp="$PAIR_FILE.$$"
    ensure_secrets
    agent_is_healthy || die 'OpenHands is not ready or its stored API key is out of sync. Restart the WebConsole project, then retry pairing.'
    url="$(browser_url)"
    [[ "$url" == https://* ]] || die 'One-click browser pairing requires an HTTPS public URL.'

    prefix="$BASE_PATH"
    [[ "$prefix" == "/" ]] && prefix=""
    if ! curl -fsS --max-time 10 "$(local_url)$prefix/_openhands/pair" -o "$probe" || \
        ! grep -Fq 'Pair this browser with OpenHands' "$probe"; then
        rm -f "$probe"
        die 'The running gateway does not support one-click pairing yet. Deploy/update and restart the existing WebConsole project, then retry.'
    fi
    rm -f "$probe"

    random="$(generate_secret)"
    token="${random:0:16}"
    token_hash="$(sha256_value "$token")"
    [[ "$token" =~ ^[a-f0-9]{16}$ && "$token_hash" =~ ^[a-f0-9]{64}$ ]] || die 'Secure pairing code generation failed.'
    display_code="$(printf '%s' "$token" | tr '[:lower:]' '[:upper:]' | sed 's/\(....\)/\1-/g; s/-$//')"
    expires_at="$(( $(date +%s) + 300 ))"
    {
        printf 'TOKEN_SHA256=%s\n' "$token_hash"
        printf 'EXPIRES_AT=%s\n' "$expires_at"
        printf 'ATTEMPTS_LEFT=8\n'
    } > "$tmp"
    chmod 600 "$tmp"
    mv -f "$tmp" "$PAIR_FILE"

    printf 'Open this page (code expires in 5 minutes):\n'
    printf '%s/pair\n' "${url%/}"
    printf 'Pairing code:\n%s\n' "$display_code"
    printf 'The code is single-use. Run openhands-host pair again for another browser.\n'
}

models_url() {
    printf '%smodels\n' "$(browser_url)"
}

require_model_manager() {
    load_runtime_environment
    curl -fsS --max-time 5 "http://127.0.0.1:$MODEL_MANAGER_PORT/health" >/dev/null 2>&1 || \
        die 'The model manager is unavailable. Restart the WebConsole project and retry.'
}

manager_api() {
    local method="$1" endpoint="$2" payload_file="${3:-}" output_file="${4:-}"
    require_model_manager
    MANAGER_METHOD="$method" MANAGER_ENDPOINT="$endpoint" MANAGER_PAYLOAD_FILE="$payload_file" \
        MANAGER_OUTPUT_FILE="$output_file" MANAGER_PORT_VALUE="$MODEL_MANAGER_PORT" \
        LOCAL_BACKEND_API_KEY="$LOCAL_BACKEND_API_KEY" python3 - <<'PY'
import json, os, pathlib, sys, tempfile, urllib.error, urllib.request
method = os.environ['MANAGER_METHOD']
endpoint = os.environ['MANAGER_ENDPOINT']
payload_file = os.environ.get('MANAGER_PAYLOAD_FILE', '')
output_file = os.environ.get('MANAGER_OUTPUT_FILE', '')
data = pathlib.Path(payload_file).read_bytes() if payload_file else None
request = urllib.request.Request(
    f"http://127.0.0.1:{os.environ['MANAGER_PORT_VALUE']}/_openhands/models-api{endpoint}",
    data=data,
    method=method,
    headers={
        'X-Session-API-Key': os.environ['LOCAL_BACKEND_API_KEY'],
        **({'Content-Type': 'application/json'} if data is not None else {}),
    },
)
try:
    with urllib.request.urlopen(request, timeout=1000) as response:
        body = response.read()
except urllib.error.HTTPError as error:
    message = error.read().decode('utf-8', 'replace')
    try: message = json.loads(message).get('error', message)
    except Exception: pass
    print(f"Model manager HTTP {error.code}: {message}", file=sys.stderr)
    raise SystemExit(1)
if output_file:
    target = pathlib.Path(output_file).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=target.name + '.', dir=target.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as stream: stream.write(body)
        pathlib.Path(temp).replace(target)
    except Exception:
        try: os.close(fd)
        except OSError: pass
        pathlib.Path(temp).unlink(missing_ok=True)
        raise
else:
    try: print(json.dumps(json.loads(body), ensure_ascii=False, indent=2))
    except Exception: sys.stdout.buffer.write(body)
PY
}

providers_export_cli() {
    [[ -n "$MANAGER_FILE" ]] || die 'providers-export requires --file PATH.'
    manager_api GET '/providers/export' '' "$MANAGER_FILE"
    log "Safe provider JSON exported without API keys: $MANAGER_FILE"
}

providers_import_cli() {
    local payload="$CACHE_DIR/provider-import.$$"
    [[ -r "$MANAGER_FILE" ]] || die 'providers-import requires a readable --file PATH.'
    if [[ "$MANAGER_IMPORT_SECRETS" == true ]]; then
        local perms=""
        perms="$(stat -c '%a' "$MANAGER_FILE" 2>/dev/null || true)"
        [[ -z "$perms" || "$perms" =~ ^[0-7]00$ ]] || die 'A JSON file containing API keys must not be group/world-readable (use chmod 600).'
    fi
    PAYLOAD_SOURCE="$MANAGER_FILE" IMPORT_SECRETS="$MANAGER_IMPORT_SECRETS" IMPORT_OVERWRITE="$MANAGER_OVERWRITE" \
        python3 - <<'PY' > "$payload"
import json, os, pathlib
source = json.loads(pathlib.Path(os.environ['PAYLOAD_SOURCE']).read_text())
print(json.dumps({'document': source, 'importSecrets': os.environ['IMPORT_SECRETS']=='true', 'overwrite': os.environ['IMPORT_OVERWRITE']=='true'}))
PY
    chmod 600 "$payload"
    if ! manager_api POST '/providers/import' "$payload"; then rm -f "$payload"; return 1; fi
    rm -f "$payload"
}

test_models_cli() {
    local payload="$CACHE_DIR/test-models.$$"
    printf '{"concurrency":3}\n' > "$payload"; chmod 600 "$payload"
    if ! manager_api POST '/profiles/test' "$payload"; then rm -f "$payload"; return 1; fi
    rm -f "$payload"
}

proxy_config_cli() {
    local payload="$CACHE_DIR/proxy-config.$$"
    [[ "$MANAGER_PROXY_MODE" == direct || "$MANAGER_PROXY_MODE" == direct-fallback || "$MANAGER_PROXY_MODE" == proxy-only ]] || \
        die 'proxy-config requires --proxy-mode direct, direct-fallback, or proxy-only.'
    [[ -n "$MANAGER_PROXY_URL" ]] || MANAGER_PROXY_URL='https://proxy.fazilat-ma.workers.dev/?url={url}'
    PROXY_MODE="$MANAGER_PROXY_MODE" PROXY_URL="$MANAGER_PROXY_URL" python3 - <<'PY' > "$payload"
import json, os
print(json.dumps({'defaultMode': os.environ['PROXY_MODE'], 'proxyTemplate': os.environ['PROXY_URL']}))
PY
    chmod 600 "$payload"; if ! manager_api PUT '/proxy' "$payload"; then rm -f "$payload"; return 1; fi; rm -f "$payload"
}

local_model_install_cli() {
    local payload="$CACHE_DIR/local-model.$$"
    [[ -n "$MANAGER_NAME" && -n "$MANAGER_MODEL_URL" ]] || die 'local-model-install requires --name NAME and --model-url HTTPS_URL.'
    MODEL_NAME="$MANAGER_NAME" MODEL_URL="$MANAGER_MODEL_URL" MODEL_SHA="$MANAGER_SHA256" MODEL_CONTEXT="$MANAGER_CONTEXT_LENGTH" \
        python3 - <<'PY' > "$payload"
import json, os
print(json.dumps({'name': os.environ['MODEL_NAME'], 'url': os.environ['MODEL_URL'], 'sha256': os.environ['MODEL_SHA'], 'contextLength': int(os.environ['MODEL_CONTEXT'])}))
PY
    chmod 600 "$payload"; if ! manager_api POST '/local/install' "$payload"; then rm -f "$payload"; return 1; fi; rm -f "$payload"
    log "The download continues in the model manager. Progress: $(models_url)"
}

local_model_start_cli() {
    local payload="$CACHE_DIR/local-model-start.$$"
    [[ -n "$MANAGER_NAME" ]] || die 'local-model-start requires --name NAME.'
    MODEL_NAME="$MANAGER_NAME" python3 - <<'PY' > "$payload"
import json, os
print(json.dumps({'name': os.environ['MODEL_NAME']}))
PY
    chmod 600 "$payload"; if ! manager_api POST '/local/start' "$payload"; then rm -f "$payload"; return 1; fi; rm -f "$payload"
}

local_model_stop_cli() {
    local payload="$CACHE_DIR/local-model-stop.$$"
    printf '{}\n' > "$payload"; chmod 600 "$payload"
    if ! manager_api POST '/local/stop' "$payload"; then rm -f "$payload"; return 1; fi; rm -f "$payload"
}

local_endpoint_add_cli() {
    local payload="$CACHE_DIR/local-endpoint.$$" api_key=""
    [[ -n "$MANAGER_NAME" && -n "$MANAGER_BASE_URL" && -n "$MANAGER_MODEL" ]] || \
        die 'local-endpoint-add requires --name, --base-url, and --model.'
    if [[ -n "$MANAGER_API_KEY_FILE" ]]; then
        local key_perms=""
        [[ -r "$MANAGER_API_KEY_FILE" ]] || die 'The --api-key-file is not readable.'
        key_perms="$(stat -c '%a' "$MANAGER_API_KEY_FILE" 2>/dev/null || true)"
        [[ -z "$key_perms" || "$key_perms" =~ ^[0-7]00$ ]] || die 'The --api-key-file must not be group/world-readable (use chmod 600).'
        api_key="$(tr -d '\r\n' < "$MANAGER_API_KEY_FILE")"
    fi
    MODEL_NAME="$MANAGER_NAME" MODEL_BASE="$MANAGER_BASE_URL" MODEL_ID="$MANAGER_MODEL" MODEL_API_KEY="$api_key" \
        python3 - <<'PY' > "$payload"
import json, os
print(json.dumps({'name': os.environ['MODEL_NAME'], 'baseUrl': os.environ['MODEL_BASE'], 'model': os.environ['MODEL_ID'], 'apiKey': os.environ['MODEL_API_KEY']}))
PY
    unset api_key
    chmod 600 "$payload"; if ! manager_api POST '/local/register-endpoint' "$payload"; then rm -f "$payload"; return 1; fi; rm -f "$payload"
}

web_check() {
    local tmp="$CACHE_DIR/web-check.$$" root_code="" health_code="" settings_code="" server_info_code="" manager_page_code="" manager_api_code="" asset_code="" asset_path="" prefix=""
    ensure_secrets
    mkdir -p "$tmp"
    trap 'rm -rf "$tmp"' RETURN
    prefix="$BASE_PATH"
    [[ "$prefix" == "/" ]] && prefix=""

    root_code="$(curl -sS --max-time 10 -o "$tmp/root" -w '%{http_code}' "$(local_url)$prefix/" || true)"
    health_code="$(curl -sS --max-time 10 -o "$tmp/health" -w '%{http_code}' \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" "$(local_url)$prefix/health" || true)"
    settings_code="$(curl -sS --max-time 10 -o "$tmp/settings" -w '%{http_code}' \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" "$(local_url)$prefix/api/settings" || true)"
    server_info_code="$(curl -sS --max-time 10 -o "$tmp/server-info" -w '%{http_code}' \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" "$(local_url)$prefix/server_info" || true)"
    manager_page_code="$(curl -sS --max-time 10 -o "$tmp/models" -w '%{http_code}' "$(local_url)$prefix/models" || true)"
    manager_api_code="$(curl -sS --max-time 10 -o "$tmp/models-status" -w '%{http_code}' \
        -H "X-Session-API-Key: $LOCAL_BACKEND_API_KEY" "$(local_url)$prefix/_openhands/models-api/status" || true)"
    asset_path="$(grep -Eo "$prefix/assets/[A-Za-z0-9._~-]+\\.js" "$tmp/root" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$asset_path" ]]; then
        asset_code="$(curl -sS --max-time 10 -o "$tmp/asset" -w '%{http_code}' "$(local_url)$asset_path" || true)"
    fi

    printf 'Frontend: HTTP %s (%s%s/)\n' "${root_code:-000}" "$(local_url)" "$prefix"
    printf 'Initial JavaScript: HTTP %s (%s%s)\n' "${asset_code:-000}" "$(local_url)" "${asset_path:-/missing-asset}"
    printf 'Canvas ingress health: HTTP %s (%s%s/health)\n' "${health_code:-000}" "$(local_url)" "$prefix"
    printf 'Stored API key validation: HTTP %s (%s%s/api/settings)\n' "${settings_code:-000}" "$(local_url)" "$prefix"
    printf 'Agent Server readiness: HTTP %s (%s%s/server_info)\n' "${server_info_code:-000}" "$(local_url)" "$prefix"
    printf 'Model manager page: HTTP %s (%s%s/models)\n' "${manager_page_code:-000}" "$(local_url)" "$prefix"
    printf 'Authenticated model manager API: HTTP %s\n' "${manager_api_code:-000}"

    [[ "$root_code" == "200" ]] || die 'Agent Canvas frontend check failed.'
    grep -Eqi '<!doctype html|<html' "$tmp/root" || die 'The gateway did not return an HTML application.'
    grep -Fq 'openhands-host-model-manager-link' "$tmp/root" || die 'The visible model-manager link is missing from the Canvas page.'
    grep -Fq "href=\"$prefix/models\"" "$tmp/root" || die 'The visible model-manager link has the wrong base path.'
    [[ -n "$asset_path" && "$asset_code" == "200" ]] || die 'The base-path JavaScript asset check failed.'
    if [[ "$BASE_PATH" != "/" ]]; then
        if grep -Fq '"/assets/' "$tmp/asset" || grep -Fq "'/assets/" "$tmp/asset"; then
            die 'A JavaScript manifest still contains unprefixed root asset URLs.'
        fi
        grep -Fq '__AGENT_CANVAS_BASE_PATH__' "$tmp/root" || die 'The frontend base-path runtime configuration is missing.'
        grep -Fq 'openhands-backends' "$tmp/root" || die 'The local backend bootstrap configuration is missing.'
        grep -Fq "\"basename\":\"$BASE_PATH\"" "$tmp/root" || die 'The frontend router basename was not rewritten.'
    fi
    [[ "$health_code" == "200" ]] || die 'Canvas ingress health check failed.'
    [[ "$settings_code" == "200" ]] || die 'The running Agent Server rejected the API key stored by openhands-host.'
    [[ "$server_info_code" == "200" ]] || die 'Agent Server readiness check failed; the frontend ingress is up but its Python backend is unavailable.'
    [[ "$manager_page_code" == "200" ]] && grep -Fq 'مدیریت ارائه‌دهنده‌ها و مدل‌ها' "$tmp/models" || die 'The model-manager page check failed.'
    [[ "$manager_api_code" == "200" ]] || die 'The authenticated model-manager API check failed.'
    log 'Web check passed, including Canvas, model manager, API-key validation, and Agent Server readiness.'
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
    if [[ -x "$GATEWAY_SCRIPT" ]]; then
        printf 'Prefix gateway: present (base path %s)\n' "$BASE_PATH"
    else
        warn 'The generated prefix gateway is missing.'; failed=1
    fi
    if [[ -x "$MODEL_MANAGER_SCRIPT" && -x "$PROFILE_TESTER_SCRIPT" ]]; then
        printf 'Model manager: present (%s/models)\n' "${BASE_PATH%/}"
    else
        warn 'Model manager companion files are missing.'; failed=1
    fi
    if [[ -s "$SECRETS_FILE" ]]; then
        perms="$(stat -c '%a' "$SECRETS_FILE" 2>/dev/null || true)"
        printf 'Secrets file: present (mode %s)\n' "${perms:-unknown}"
        [[ -z "$perms" || "$perms" == "600" ]] || { warn 'Secrets file permissions should be 600.'; failed=1; }
    else
        warn 'Secrets file is missing.'; failed=1
    fi
    printf 'Configured ports: gateway=%s canvas-ingress=%s agent=%s automation=%s frontend=%s editor=%s model-manager=%s local-model=%s\n' \
        "$PORT" "$UPSTREAM_PORT" "$BACKEND_PORT" "$AUTOMATION_PORT" "$FRONTEND_PORT" "$((BACKEND_PORT + 1000))" "$MODEL_MANAGER_PORT" "$LOCAL_MODEL_PORT"

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
    # Persist the replacement before stopping. WebConsole may relaunch a
    # supervised service immediately after TERM; writing first guarantees that
    # any racing replacement process can only load the new key.
    write_new_secrets
    log 'A new Agent Canvas API key was generated; the previous key is invalid.'
    [[ "$was_running" == false ]] || stop_agent
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
    pair) pair_browser ;;
    models) printf '%s\n' "$(models_url)" ;;
    providers-export) providers_export_cli ;;
    providers-import) providers_import_cli ;;
    test-models) test_models_cli ;;
    proxy-config) proxy_config_cli ;;
    local-model-install) local_model_install_cli ;;
    local-model-start) local_model_start_cli ;;
    local-model-stop) local_model_stop_cli ;;
    local-endpoint-add) local_endpoint_add_cli ;;
    web-check) web_check ;;
    doctor) doctor ;;
    rotate-key) rotate_key ;;
    self-update) self_update_only ;;
    uninstall) uninstall_runtime ;;
esac
