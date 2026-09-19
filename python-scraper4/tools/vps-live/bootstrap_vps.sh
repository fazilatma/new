#!/usr/bin/env bash
# One-shot VPS bootstrap: clone/update the repo, then install Scraper4 at /put/
# Run ON THE VPS as root:
#   curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/01a0b7db-new/python-scraper4/tools/vps-live/bootstrap_vps.sh | bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
# Do NOT use NEEDRESTART_MODE=a: it restarts sshd, which drops the admin's
# session and leaves the install half-finished. 'l' only reports.
export NEEDRESTART_MODE=l
export NEEDRESTART_SUSPEND=1

if [[ $EUID -ne 0 ]]; then
  echo "Run as root on the VPS." >&2
  exit 1
fi

# This fork, not fazilatma/amphp: that repo has no dashboard files, so
# installing from it leaves /ui returning 404.
REPO_URL="${SCRAPER_REPO_URL:-https://github.com/fazilatma/new.git}"
REPO="${SCRAPER_REPO_DIR:-/opt/new}"
BRANCH="${SCRAPER_BRANCH:-arena/01a0b7db-new}"

apt-get update -y
apt-get install -y git ca-certificates

if [[ -d "$REPO/.git" ]]; then
  # Full (not --depth 1) so the app's own git auto-update can fast-forward.
  git -C "$REPO" remote set-url origin "$REPO_URL"
  git -C "$REPO" fetch origin "$BRANCH"
  git -C "$REPO" checkout -B "$BRANCH" "origin/$BRANCH"
else
  rm -rf "$REPO"
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO"
fi

# Let the installed app find this checkout for its minute-by-minute updates.
export SCRAPER_REPO_DIR="$REPO"

bash "$REPO/python-scraper4/tools/vps-live/install_scraper4_vps.sh"
