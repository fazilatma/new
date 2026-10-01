# OpenHands shared-host compatibility laboratory

This directory is the permanent, rootless validation environment for changes to the OpenHands host helper. It deliberately does not require Docker, `sudo`, or a system package manager. Run the complete gate with `./run-all.sh [output-directory]`; it executes both the provider integration suite and the runtime build/compatibility suite.

## Runtime laboratory

`build-static-llama-runtime.sh [output-directory]` performs the complete runtime gate:

1. installs exact, wheel-hash-pinned CMake, Ninja, and Zig tools in a temporary directory;
2. downloads immutable llama.cpp commit `b8f96c3e82284028cb077811ed1666caac3c5bac` and verifies source SHA-256;
3. cross-builds `llama-server` for fully static `x86_64-linux-musl`, with native CPU tuning, OpenMP, OpenSSL, and CURL disabled;
4. strips the executable and rejects any ELF interpreter, `NEEDED` dynamic library, or GLIBC version symbol;
5. executes the resulting `llama-server --version` rather than relying on syntax/build success;
6. packages a normalized archive and writes binary/archive checksums plus a machine-readable result.

The accepted archive is stored in `../runtime/` because release-asset upload is unavailable to the repository GitHub App. The manager downloads it through its immutable Git blob ID and independently enforces the hard-coded archive SHA-256 before extraction. The compact evidence from the accepted build is in `evidence/`.

## Provider import integration laboratory

`node test-provider-import.mjs` starts a real model-manager process and a stateful mock of the official OpenHands API. It submits an authenticated provider JSON containing a sentinel API key while explicitly sending the old `importSecrets: false` value. The test fails unless all of these are true:

- an existing Provider Connection is rotated with `PATCH`;
- every existing Profile for that provider and every imported Profile is linked;
- a bare `codestral-2508` Profile becomes `mistral/codestral-2508` and receives its model-level endpoint without overwrite;
- a Profile from another provider remains untouched;
- Profile writes use `include_secrets=false` and never contain inline `api_key`;
- snapshot, safe export, manager stdout, and manager stderr do not contain the sentinel key;
- even a backend error that reflects a submitted credential is replaced with a detail-free public error.

The accepted integration result is recorded in `evidence/provider-import-result.json`.

## Live model-test UI laboratory

`python3 test-profile-tester.py` exercises the real tester against dependency-free OpenHands stubs and proves its batch-start, per-Profile running, as-completed result, metric, provider, redaction, and legacy blocking-output contracts. `node test-live-model-tests.mjs` then starts the real manager with three Profiles and a deterministic streaming process. It validates the complete asynchronous job path rather than a static UI fixture: queued/running states, partial results observed before completion, pass/fail counters, latency and queue metrics, persisted results, blocking CLI compatibility, cancellation, and credential-safe logs. It also fetches the generated manager page, compiles its browser JavaScript, and verifies that the accessible modal, filters, table, and mobile breakpoint are present. Evidence is recorded in `evidence/profile-tester-result.json` and `evidence/live-model-tests-result.json`.
