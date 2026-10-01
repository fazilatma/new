#!/usr/bin/env bash
# Runs every permanent OpenHands shared-host laboratory gate.
set -Eeuo pipefail
LAB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-${LAB_DIR}/output}"
mkdir -p "${OUTPUT_DIR}"
node --check "${LAB_DIR}/../openhands-model-manager.mjs"
bash -n "${LAB_DIR}/../install-openhands-host.sh"
node "${LAB_DIR}/test-provider-import.mjs" | tee "${OUTPUT_DIR}/provider-import-result.json"
"${LAB_DIR}/build-static-llama-runtime.sh" "${OUTPUT_DIR}"
printf '[lab] All provider and runtime integration gates passed.\n'
