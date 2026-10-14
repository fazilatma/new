# Copilot Models Toolbox

Companion extension installed by `install-copilot-models-termux.sh`. It adds
three commands to the GitHub Copilot Chat view title toolbar:

- **🧪 Test All AI Models** — opens a live test-center panel with a searchable
  table, status counters, credential fingerprints, HTTP/latency columns,
  expandable and copyable error details, cancellation, retry-failed, bulk copy,
  and JSON export. It sends real, non-streaming inference requests only after
  the user presses Start in the cost/quota warning panel.
- **📥 Import AI JSON** — opens a remote file picker, imports providers, models,
  and embedded keys through the bundled Python helper, reports non-secret key
  diagnostics, and transfers staged mode-`0600` plaintext values into
  code-server Chat SecretStorage. Only `${input:chat.lm.secret.…}` references
  remain in the model configuration; a protected Toolbox copy powers Test All.
- **🔄 Sync GitHub** — opens a full-update panel for repository, branch, manual
  update, automatic-update opt-in, and interval. It installs the branch helper,
  catalog, terminal settings, and toolbox while preserving local API keys. It
  never uploads model configuration or credentials.

The commands also remain available from the Command Palette. The source is
plain CommonJS with no runtime npm dependencies so it works in code-server on
Termux.

## Versioning

The helper, launcher, and companion extension currently ship as **0.1.7**.
Every shipped code change must increment the semantic version in all three
places. The Python test suite enforces that the versions stay synchronized.
