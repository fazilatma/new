# Copilot Chat BYOK models for code-server on Termux

This helper adds OpenAI-compatible providers to the **model picker used by GitHub
Copilot Chat**. It does not create a separate model list. It merges provider
groups into code-server's active profile resource:

```text
~/.local/share/code-server/User/chatLanguageModels.json
```

The maintained catalog currently contains 627 chat-capable model entries from
OpenRouter, Groq, Hugging Face, Cloudflare Workers AI, Google Gemini, Cerebras,
Mistral, Cohere, LLM7, OpenCode Zen, and Ollama Cloud. Together AI is populated
from its live `/models` endpoint when credentials are supplied; `--discover-all`
can refresh every selected provider from the same endpoint. Local Ollama is
registered through Copilot Chat's native Ollama provider and performs its own
discovery.

## Requirements

- Android Termux with `bash` and `curl`.
- `python` (the wrapper installs Termux's Python package when it is missing).
- A current code-server build and a current `GitHub.copilot-chat`/Copilot
  extension containing the `customoai` language-model provider.
- Copilot Chat must already be installed, enabled, and signed in. This helper
  does not bypass GitHub/Copilot authentication or entitlement checks.

## Safest interactive command

The prompts do not echo API keys. Press Enter for providers you do not use.

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/f1997f2f-new/host-helpers/install-copilot-models-termux.sh \
  | bash -s -- --prompt --enable-terminal
```

Omit `--enable-terminal` if you only want to change the model picker. To prompt
for only selected providers:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/f1997f2f-new/host-helpers/install-copilot-models-termux.sh \
  | bash -s -- --prompt --providers openrouter,groq,gemini,mistral
```

After it finishes, **restart the entire code-server process**. Open Chat, select
the model picker, and use **Manage Models** if a newly added model is hidden.

## Unattended credential file

Create a private environment file. Include only the services you use:

```bash
cat > "$HOME/.copilot-models.env" <<'EOF'
OPENROUTER_API_KEY=replace-me
TOGETHER_API_KEY=replace-me
GROQ_API_KEY=replace-me
HUGGINGFACE_API_KEY=replace-me
CLOUDFLARE_ACCOUNT_ID=replace-me
CLOUDFLARE_API_KEY=replace-me
GEMINI_API_KEY=replace-me
CEREBRAS_API_KEY=replace-me
MISTRAL_API_KEY=replace-me
COHERE_API_KEY=replace-me
LLM7_API_KEY=replace-me
OPENCODE_API_KEY=replace-me
OLLAMA_CLOUD_API_KEY=replace-me
OLLAMA_URL=http://127.0.0.1:11434
EOF
chmod 600 "$HOME/.copilot-models.env"

curl -fsSL https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/f1997f2f-new/host-helpers/install-copilot-models-termux.sh \
  | bash -s -- --env-file "$HOME/.copilot-models.env"
```

Existing keys are preserved on a later catalog-only rerun. Environment values
replace existing keys when supplied.

> **Plaintext warning:** the current VS Code profile format serializes provider
> configuration, including `apiKey`, into `chatLanguageModels.json`. The helper
> sets the file to mode `0600`, but the key is still plaintext for the Termux
> account. Do not use this on an account shared with untrusted users.

## Import a provider/model JSON export

The helper can convert the large provider JSON format directly. It recognizes
provider arrays, model arrays or maps, common URL/key field names, capability
fields, and `nonChat`/endpoint-type markers:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/f1997f2f-new/host-helpers/install-copilot-models-termux.sh \
  | bash -s -- --source "$HOME/providers.json" --env-file "$HOME/.copilot-models.env"
```

Keys embedded in the source JSON are intentionally ignored. This prevents an
export from silently copying exposed credentials. `--import-source-keys`
enables that behavior explicitly, but a private environment file or `--prompt`
is safer.

Non-chat models (embeddings, speech, image generation, reranking, and entries
marked `nonChat`) are excluded because Copilot Chat cannot use their endpoints.
Use `--include-non-chat` only if the export classified a real chat model
incorrectly.

For known providers, imported native operation URLs are automatically replaced
with their OpenAI-compatible Chat Completions base URL. The importer also
prefers `modelId` over internal database `id` values, reduces a local Ollama URL
to its server root, and defaults imported requests to non-streaming so providers
that reject OpenAI's `stream_options` field remain usable.

### Import the Android download directly and enable terminal tools

This non-interactive command imports the keys already embedded in the named
private export and configures both code-server's integrated terminal and
Copilot Agent's run-in-terminal tool:

```bash
PRIVATE_JSON="$HOME/storage/shared/download/ai-providers-2026-08-23-160523-gemini-llm7-opencode-ollama-cloud-added.json"
test -r "$PRIVATE_JSON" || { echo "Not readable: $PRIVATE_JSON" >&2; exit 1; }

curl -fsSL https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/f1997f2f-new/host-helpers/install-copilot-models-termux.sh \
  | bash -s -- --source "$PRIVATE_JSON" --import-source-keys --no-discover --enable-terminal
```

### Copilot Chat toolbar

The launcher also installs **Copilot Models Toolbox 0.1.1** through
code-server's own VSIX installer and verifies that code-server can discover it.
It normally appears under
`~/.local/share/code-server/extensions/fazilatma.copilot-models-toolbox-0.1.1`;
a custom `extensions-dir` is detected and used automatically. After restarting
code-server, these buttons appear in the GitHub Copilot Chat title toolbar and
remain available in the Command Palette:

- **🧪 Test All AI Models** asks for confirmation, then sends one real,
  non-streaming inference request with at most eight output tokens to every
  configured model. This can consume provider quota or incur charges. The run
  is cancellable and pass/fail details appear in the **Copilot Models Toolbox**
  output channel.
- **📥 Import AI JSON** opens the Termux filesystem picker and imports providers,
  models, and embedded API keys through the same protected helper. The picker
  starts in a recognized Android download directory when available.
- **🔄 Sync GitHub** downloads and validates the latest maintained catalog from
  this agent branch, then merges it while preserving local API keys. It is a
  download-only operation: configuration and credentials are never uploaded to
  GitHub.

Use `--no-toolbox` only when the companion toolbar extension is not wanted.
To verify the installed version from Termux:

```bash
code-server --list-extensions --show-versions \
  | grep '^fazilatma.copilot-models-toolbox@0\.1\.1$'
```

`--enable-terminal` detects `$PREFIX/bin/bash` on Termux and merges these values
into the active profile's `settings.json`:

- `terminal.integrated.profiles.linux`
- `terminal.integrated.defaultProfile.linux`
- `terminal.integrated.automationProfile.linux`
- `chat.tools.terminal.terminalProfile.linux`
- `chat.tools.terminal.enableAutoApprove`

The Bash profile deliberately has no `-l` argument. A forced Termux login shell
runs `$PREFIX/etc/profile` and user login files; if any startup command fails, code-server
immediately reports that `bash '-l'` terminated with exit code 1. Rerunning the
current helper replaces the older login-shell profile with a normal interactive
Bash profile.

Existing terminal profiles and approval rules are preserved. The helper does
not add an approve-all pattern to `chat.tools.terminal.autoApprove`, so commands
outside VS Code's guarded defaults still require approval. Existing JSONC
comments and trailing commas are accepted; because settings are rewritten as
strict JSON, the untouched original is retained in the helper's first-run
backup.

The option also advertises `toolCalling: true` for installed models so Agent
mode can expose tools. This does not manufacture tool support in an upstream
model: select a model/provider that really implements OpenAI-compatible tool
calling. Trust the workspace, restart the entire code-server process, select
**Agent** mode in Chat, and approve terminal commands when prompted.

### Restart code-server

After every successful install or restore, the helper now prints the complete
restart sequence below. Run it from a separate Termux session—not from the
code-server integrated terminal, because stopping code-server also disconnects
that terminal:

```bash
pkill -f '[c]ode-server' || true
sleep 1
mkdir -p "$HOME/.local/share/code-server"
nohup code-server >>"$HOME/.local/share/code-server/code-server.log" 2>&1 </dev/null &
```

This starts code-server using its normal `config.yaml`. If code-server is
managed by `termux-services` or another supervisor, use that supervisor's
restart command instead, for example `sv restart code-server`.

## Useful options

| Option | Purpose |
| --- | --- |
| `--list` | List provider slugs and maintained model counts. |
| `--providers a,b` | Install only the listed provider groups. |
| `--prompt` | Securely prompt for missing credentials through `/dev/tty`. |
| `--env-file PATH` | Read `NAME=value` credentials without evaluating shell code. |
| `--source PATH` | Merge a provider/model export over the maintained catalog. |
| `--import-source-keys` | Explicitly import credentials embedded in `--source`. |
| `--skip-missing-keys` | Do not list providers until they have a key. |
| `--discover-all` | Merge every provider's current `/models` response. |
| `--no-discover` | Never contact `/models`; use only catalog/import entries. |
| `--dry-run` | Validate paths, data, and manifest compatibility without writing. |
| `--user-data-dir PATH` | Override code-server's user-data directory. |
| `--profile-dir PATH` | Target a non-default profile directory. |
| `--config-file PATH` | Target an exact `chatLanguageModels.json` file. |
| `--settings-file PATH` | Target an exact code-server `settings.json` file. |
| `--enable-terminal` | Configure integrated/Agent terminals and advertise tool calling. |
| `--no-toolbox` | Skip installing the three-button Copilot Chat companion extension. |
| `--extension-dir PATH` | Supply the Copilot extension directory if auto-detection fails. |
| `--no-patch` | Do not change the Copilot extension manifest. |
| `--restore` | Restore the files saved before the helper's first change. |

Example for a custom code-server profile:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/f1997f2f-new/host-helpers/install-copilot-models-termux.sh \
  | bash -s -- --profile-dir "$HOME/.local/share/code-server/User/profiles/PROFILE_ID" --prompt
```

## What the helper changes

1. It validates and idempotently merges groups by `vendor:name`, preserving
   unrelated groups already in `chatLanguageModels.json`.
2. It creates a first-run backup beside each changed file with suffix
   `.copilot-models-helper.bak` (or a creation marker if the config did not
   previously exist).
3. Current stable Copilot builds register `customoai` in code but hide its
   manifest contribution behind `productQualityType != 'stable'`. The helper
   removes only that exact condition. It refuses to remove an unfamiliar
   condition or fabricate a provider schema.
4. With `--enable-terminal`, it safely merges the Termux shell profiles into
   `settings.json`, enables tool calling metadata, and leaves explicit command
   approval rules intact.
5. Unless `--no-toolbox` is supplied, it installs the companion extension and a
   private runtime copy of the helper/catalog under code-server's extension
   directory. `--restore` removes this helper-owned extension.
6. It writes JSON atomically and makes both model and settings configuration
   readable only by its owner.

An extension update can replace the manifest patch. Rerun the helper after an
update if **OpenAI Compatible** disappears from Manage Models.

Restore the original config and manifest with:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/f1997f2f-new/host-helpers/install-copilot-models-termux.sh \
  | bash -s -- --restore
```

## Availability notes

Provider catalogs and account entitlements change. A model being present in the
picker does not guarantee that a particular API key currently has access to it.
Use `--discover-all` to refresh model IDs, and remove providers you do not use
with `--providers` plus `--skip-missing-keys`. Endpoint errors, quotas, billing,
regional restrictions, and provider-specific tool support remain controlled by
the upstream service.
