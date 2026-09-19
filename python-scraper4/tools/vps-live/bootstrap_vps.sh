#!/usr/bin/env bash
# One-shot VPS bootstrap: clone/update repo, then install Scraper4 at /put/
# Run ON THE VPS as root.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

if [[ $EUID -ne 0 ]]; then
  echo "Run as root on the VPS." >&2
  exit 1
fi

REPO="${AMPHP_DIR:-/opt/amphp}"
BRANCH="${AMPHP_BRANCH:-arena/01a06ac3-amphp}"

apt-get update -y
apt-get install -y git ca-certificates

if [[ -d "$REPO/.git" ]]; then
  git -C "$REPO" fetch --depth 1 origin "$BRANCH"
  git -C "$REPO" checkout -B "$BRANCH" FETCH_HEAD
else
  rm -rf "$REPO"
  git clone --depth 1 --branch "$BRANCH" https://github.com/fazilatma/amphp.git "$REPO"
fi

bash "$REPO/tools/vps-live/install_scraper4_vps.sh"
