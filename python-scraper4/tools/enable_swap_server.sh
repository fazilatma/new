#!/usr/bin/env bash
# enable_swap_server.sh — idempotent swapfile setup for the scraper server.
# Companion to the WebConsole 1.6.6 swap components; usable directly over SSH:
#   bash enable_swap_server.sh 4096        # 4 GB (default 4096)
# Root or passwordless sudo required; containers without swap support are
# detected and skipped gracefully. Re-running is safe: enough swap = no-op,
# a smaller /swapfile is resized in place.
set -u
TARGET_MB="${1:-4096}"
case "$TARGET_MB" in ''|*[!0-9]*) echo "usage: bash enable_swap_server.sh <size-in-MB>"; exit 1;; esac
[ "$TARGET_MB" -lt 256 ] && TARGET_MB=256
[ "$TARGET_MB" -gt 65536 ] && TARGET_MB=65536
SWAP_FILE=/swapfile
if [ "$(id -u)" = "0" ]; then SUDO=""; else SUDO="sudo -n"; fi
CUR_MB=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' | head -n1)
echo "[swap] current swap: ${CUR_MB:-0} MB, target: ${TARGET_MB} MB"
if [ "${CUR_MB:-0}" -ge "$TARGET_MB" ] 2>/dev/null; then
  echo "[swap] already satisfied — nothing to do."; exit 0
fi
if [ -f /proc/user_beancounters ]; then
  echo "[swap WARNING] OpenVZ-style container: swap cannot be managed from inside."; exit 0
fi
if [ -f "$SWAP_FILE" ]; then $SUDO swapoff "$SWAP_FILE" >/dev/null 2>&1 || true; fi
$SUDO rm -f "$SWAP_FILE" >/dev/null 2>&1 || true
if command -v fallocate >/dev/null 2>&1 && $SUDO fallocate -l "${TARGET_MB}M" "$SWAP_FILE" >/dev/null 2>&1; then
  echo "[swap] allocated ${TARGET_MB} MB via fallocate"
else
  $SUDO dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$TARGET_MB" status=none >/dev/null 2>&1 \
    || { echo "[swap ERROR] allocation failed (need root or passwordless sudo)"; exit 0; }
fi
$SUDO chmod 600 "$SWAP_FILE" >/dev/null 2>&1 || true
$SUDO mkswap -f "$SWAP_FILE" >/dev/null 2>&1 || { echo "[swap ERROR] mkswap failed"; exit 0; }
$SUDO swapon "$SWAP_FILE" >/dev/null 2>&1 || { echo "[swap WARNING] swapon refused (container without swap privileges?)"; exit 0; }
grep -q '^/swapfile ' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null 2>&1 || true
if [ -d /etc/sysctl.d ] && ! grep -qs 'vm.swappiness' /etc/sysctl.conf /etc/sysctl.d/*.conf 2>/dev/null; then
  echo 'vm.swappiness=20' | $SUDO tee /etc/sysctl.d/99-s4-swap.conf >/dev/null 2>&1 \
    && $SUDO sysctl -q -p /etc/sysctl.d/99-s4-swap.conf >/dev/null 2>&1 || true
fi
echo "[swap] active: $(free -m 2>/dev/null | awk '/^Swap:/{print $2}' | head -n1) MB — survives reboot via /etc/fstab"
