# Copilot Models Toolbox

Companion extension installed by `install-copilot-models-termux.sh`. It adds
four commands to the GitHub Copilot Chat view title toolbar:

- **🧪 Test All AI Models** — opens a live test-center panel with a mobile-safe
  always-visible searchable table, an inline Import Models button, configured
  versus resolved model IDs, status counters, credential fingerprints,
  HTTP/latency columns, expandable/copyable answers/errors, cancellation,
  retry-failed, bulk copy, and JSON export. It displays token/context limits,
  vision/streaming, reasoning, and tool-calling capability. Its editable
  **Coding power test prompt** defaults to a strict TypeScript multi-provider
  scheduler challenge. Power starts as a transparent metadata baseline, then is
  replaced by a deterministic 0–100 rubric score of the actual answer, including
  completeness, typing, fairness, concurrency, pacing, cancellation cleanup,
  429/503 retry with backoff/jitter, ordering, typed failures, tests, and
  complexity. Raw prompts/answers stay out of sanitized GitHub diagnostics.
  Tests run in complete provider
  round-robin waves with a configurable pause between waves. Each passing row's
  **Use in Chat** button pins/unhides the resolved ID, requests a live switch,
  and backup-first persists the exact selected panel model. It resolves unique
  name/case mismatches against the provider `/models` response and backup-first
  repairs IDs that then pass a real inference request. It sends real,
  non-streaming inference requests only after
  the user presses Start in the cost/quota warning panel. Passing models are
  automatically persisted in Copilot Chat's pinned list; existing pins are
  preserved, hidden successes are made visible, and profile storage is privately
  backed up before the change. Restart code-server when prompted to refresh the
  workbench's in-memory picker cache.
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
  `bash` or `curl` from code-server. Python helpers retry through Android's ELF
  linker after `EACCES`; update additionally has a process-free, atomic Node
  fallback for the already validated extension/helper/catalog runtime. Nothing
  uploads automatically. An explicitly
  confirmed button scans retained code-server and VS Code logs and sends every
  detected sanitized error to a GitHub issue tied to the selected branch, using
  numbered comments when needed. The latest model-test failures are included but
  are no longer required. Credentials, prompts, source, full URLs, and local paths
  are excluded. A separate button copies the complete visible update log. If
  Android returns `EACCES` while spawning Termux `gh`, upload retries through the
  system ELF linker and then VS Code's secure in-memory GitHub session; Toolbox
  never stores the token. Upload also opts into auto-update so a pushed fix can
  install itself.
- **🛠 Repair code-server** — diagnoses or repairs the managed model, credential,
  Copilot manifest, Android terminal, and 256 MB TypeScript stability settings;
  restarts tsserver after an `EPIPE`, and can locally capture/open its crash log;
  it can reinstall from the configured GitHub
  branch; and restores private timestamped snapshots of previous versions.
  Import, full update, local repair, and restore all protect the previous state
  first. Snapshot retention is configurable.

The helper also installs `copilot-models-repair` in Termux so Copilot Agent can
request the same backup-first branch repair through its terminal tool. The
commands remain available from the Command Palette. The source is
plain CommonJS with no runtime npm dependencies so it works in code-server on
Termux.

## Versioning

The helper, launcher, and companion extension currently ship as **0.1.17**.
Every shipped code change must increment the semantic version in all three
places. The Python test suite enforces that the versions stay synchronized.
