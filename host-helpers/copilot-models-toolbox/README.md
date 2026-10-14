# Copilot Models Toolbox

Companion extension installed by `install-copilot-models-termux.sh`. It adds
three commands to the GitHub Copilot Chat view title toolbar:

- **🧪 Test All AI Models** — after a cost/quota confirmation, sends one real,
  non-streaming inference request to every configured Custom OpenAI model and
  every model discovered from local Ollama. Results are written to the
  **Copilot Models Toolbox** output channel. Tests are cancellable.
- **📥 Import AI JSON** — opens a remote file picker, imports providers, models,
  and embedded keys through the bundled Python helper, and retains the helper's
  backup and mode-`0600` protections.
- **🔄 Sync GitHub** — downloads and validates the maintained catalog from the
  configured GitHub URL, then merges it while preserving local API keys. It
  never uploads model configuration or credentials.

The commands also remain available from the Command Palette. The source is
plain CommonJS with no runtime npm dependencies so it works in code-server on
Termux.

## Versioning

The helper, launcher, and companion extension currently ship as **0.1.1**.
Every shipped code change must increment the semantic version in all three
places. The Python test suite enforces that the versions stay synchronized.
