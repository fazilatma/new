#!/usr/bin/env bash
# Runs every permanent OpenHands shared-host laboratory gate.
set -Eeuo pipefail
LAB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-${LAB_DIR}/output}"
mkdir -p "${OUTPUT_DIR}"
node --check "${LAB_DIR}/../openhands-model-manager.mjs"
node --check "${LAB_DIR}/test-gateway-model-search.mjs"
python3 -m py_compile "${LAB_DIR}/../openhands-profile-tester.py" "${LAB_DIR}/test-profile-tester.py"
bash -n "${LAB_DIR}/../install-openhands-host.sh"
node "${LAB_DIR}/test-gateway-model-search.mjs" | tee "${OUTPUT_DIR}/gateway-model-search-result.json"
node "${LAB_DIR}/test-provider-import.mjs" | tee "${OUTPUT_DIR}/provider-import-result.json"
python3 "${LAB_DIR}/test-profile-tester.py" | tee "${OUTPUT_DIR}/profile-tester-result.json"
node "${LAB_DIR}/test-live-model-tests.mjs" | tee "${OUTPUT_DIR}/live-model-tests-result.json"
"${LAB_DIR}/build-static-llama-runtime.sh" "${OUTPUT_DIR}"
printf '[lab] All gateway UI, provider, live model-test, and runtime integration gates passed.\n'
