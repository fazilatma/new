# Copilot Models Toolbox

Companion extension installed by `install-copilot-models-termux.sh`. It adds
four commands to the GitHub Copilot Chat view title toolbar:

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
  catalog, terminal settings, and toolbox while preserving local API keys. The
  extension downloads these assets itself and launches Python through a rebuilt
  absolute Termux environment, so automatic updates do not depend on spawning
  `bash` or `curl` from code-server. It never uploads model configuration or
  credentials.
- **🛠 Repair code-server** — diagnoses or repairs the managed model, credential,
  Copilot manifest, Android terminal, and memory-bounded TypeScript settings;
  restarts tsserver after an `EPIPE`; can reinstall from the configured GitHub
  branch; and restores private timestamped snapshots of previous versions.
  Import, full update, local repair, and restore all protect the previous state
  first. Snapshot retention is configurable.

The helper also installs `copilot-models-repair` in Termux so Copilot Agent can
request the same backup-first branch repair through its terminal tool. The
commands remain available from the Command Palette. The source is
plain CommonJS with no runtime npm dependencies so it works in code-server on
Termux.

## Versioning

The helper, launcher, and companion extension currently ship as **0.1.9**.
Every shipped code change must increment the semantic version in all three
places. The Python test suite enforces that the versions stay synchronized.
