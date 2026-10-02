#!/usr/bin/env bash
# Runs every permanent OpenHands shared-host laboratory gate.
set -Eeuo pipefail
LAB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-${LAB_DIR}/output}"
mkdir -p "${OUTPUT_DIR}"
ROOT="$(cd -- "${LAB_DIR}/../.." && pwd)"
version_guard() {
  local helper_version changelog_version doc_version
  helper_version="$(grep -m1 '^SCRIPT_VERSION=' "$ROOT/host-helpers/install-openhands-host.sh" | cut -d'"' -f2)"
  changelog_version="$(grep -m1 -oE '"[0-9]+\.[0-9]+\.[0-9]+"' "$ROOT/host-helpers/openhands-model-manager.mjs" | tr -d '"')"
  doc_version="$(grep -m1 -oE '^## [0-9]+\.[0-9]+\.[0-9]+' "$ROOT/CHANGELOG.md" | awk '{print $2}')"
  if [[ "$helper_version" != "$changelog_version" || "$helper_version" != "$doc_version" ]]; then
    echo "version mismatch: helper=$helper_version manager-changelog=$changelog_version CHANGELOG.md=$doc_version" >&2
    exit 1
  fi
  echo "version guard ok: $helper_version"
}
version_guard
"${LAB_DIR}/check-version-bump.sh" || exit 1
node --check "${LAB_DIR}/../openhands-model-manager.mjs"
node --check "${LAB_DIR}/test-gateway-model-search.mjs"
node --check "${LAB_DIR}/test-local-model-address.mjs"
node --check "${LAB_DIR}/test-gateway-chat.mjs"
node --check "${LAB_DIR}/test-manager-ui.mjs"
node --check "${LAB_DIR}/test-conversation-keeper.mjs"
python3 -m py_compile "${LAB_DIR}/../openhands-profile-tester.py" "${LAB_DIR}/test-profile-tester.py"
bash -n "${LAB_DIR}/../install-openhands-host.sh"
node "${LAB_DIR}/test-gateway-model-search.mjs" | tee "${OUTPUT_DIR}/gateway-model-search-result.json"
node "${LAB_DIR}/test-gateway-chat.mjs" | tee "${OUTPUT_DIR}/gateway-chat-result.json"
node "${LAB_DIR}/test-provider-import.mjs" | tee "${OUTPUT_DIR}/provider-import-result.json"
python3 "${LAB_DIR}/test-profile-tester.py" | tee "${OUTPUT_DIR}/profile-tester-result.json"
node "${LAB_DIR}/test-live-model-tests.mjs" | tee "${OUTPUT_DIR}/live-model-tests-result.json"
node "${LAB_DIR}/test-local-model-address.mjs" | tee "${OUTPUT_DIR}/local-model-address-result.json"
node "${LAB_DIR}/test-manager-ui.mjs" | tee "${OUTPUT_DIR}/manager-ui-result.json"
node "${LAB_DIR}/test-conversation-keeper.mjs" | tee "${OUTPUT_DIR}/conversation-keeper-result.json"
"${LAB_DIR}/build-static-llama-runtime.sh" "${OUTPUT_DIR}"
printf '[lab] All gateway UI, provider, live model-test, local-address, manager-UI, and runtime integration gates passed.\n'
