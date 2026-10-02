#!/usr/bin/env bash
# Fails when a change does not come with a version bump and a changelog entry.
set -Eeuo pipefail
LAB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${LAB_DIR}/../.." && pwd)"
BASE_REF="${1:-origin/arena/01a0f230-new}"

helper_version() { grep -m1 '^SCRIPT_VERSION=' "$1" | cut -d'"' -f2; }

current="$(helper_version "${ROOT}/host-helpers/install-openhands-host.sh")"
manager_entry="$(grep -m1 -oE '"[0-9]+\.[0-9]+\.[0-9]+"' "${ROOT}/host-helpers/openhands-model-manager.mjs" | tr -d '"')"
doc_entry="$(grep -m1 -oE '^## [0-9]+\.[0-9]+\.[0-9]+' "${ROOT}/CHANGELOG.md" | awk '{print $2}')"

if [[ "$current" != "$manager_entry" || "$current" != "$doc_entry" ]]; then
  echo "version mismatch: helper=$current manager-changelog=$manager_entry CHANGELOG.md=$doc_entry" >&2
  exit 1
fi

if ! git -C "$ROOT" rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "version bump check: base ref $BASE_REF is unavailable, checked local consistency only ($current)"
  exit 0
fi

changed="$(git -C "$ROOT" diff --name-only "$BASE_REF" -- host-helpers README.md | grep -v '^host-helpers/lab/evidence/' || true)"
if [[ -z "$changed" ]]; then
  echo "version bump check: no helper changes against $BASE_REF ($current)"
  exit 0
fi

previous="$(git -C "$ROOT" show "$BASE_REF:host-helpers/install-openhands-host.sh" 2>/dev/null | grep -m1 '^SCRIPT_VERSION=' | cut -d'"' -f2 || true)"
if [[ -n "$previous" && "$previous" == "$current" ]]; then
  echo "helper changed but SCRIPT_VERSION is still $current; bump it and add a CHANGELOG.md entry" >&2
  exit 1
fi

if ! git -C "$ROOT" diff --name-only "$BASE_REF" -- CHANGELOG.md | grep -q CHANGELOG.md; then
  echo "helper changed but CHANGELOG.md was not updated" >&2
  exit 1
fi

echo "version bump check ok: $previous -> $current"
