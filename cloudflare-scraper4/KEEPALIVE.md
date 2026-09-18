# Keep Scraper4 running — VPS and Termux

## Automatic recovery (1.210.0+)

The deployer now supervises the scraper it starts. Unexpected exits (including
exit 0, update exit 75 and signals) schedule a retry after 5 seconds, backing off
to at most 60 seconds between attempts. Logs preserve the exit code/signal and
retry reason. Six failed HTTP probes, 15 seconds apart, also trigger recovery
once the five-minute startup/build grace period has elapsed. Any HTTP response
counts as alive: a database error is not grounds for a restart loop. Existing
foreign-port ownership checks remain in place; unrelated programs are not killed.

The resource panel reports keepalive state, retry time and automatic restart count.
**Stop** cancels pending recovery; **Start/Restart** enables it again. A fresh
service/deployer launch autostarts unless `LOCAL_SCRAPER_AUTOSTART=false`.
`LOCAL_SCRAPER_KEEPALIVE=false` disables automatic scraper recovery.

The deployer must itself stay running. Closing the browser is fine. Closing or
killing the deployer removes its supervision, although the detached scraper can
continue serving. Use an OS service below for recovery of the deployer and reboot
startup. These commands must run on your own VPS/phone; publishing code does not
install a service there. Stop any manually running deployer/scraper before enabling
the service to avoid two supervisors.

## Linux VPS: systemd user service

Run as the normal account that owns the checkout (not root). From
`~/new/cloudflare-scraper4`, or your actual project directory:

```sh
mkdir -p "$HOME/.config/systemd/user"
node scripts/keepalive-service.mjs --systemd > "$HOME/.config/systemd/user/scraper4.service"
systemctl --user daemon-reload
systemctl --user enable --now scraper4.service
systemctl --user status scraper4.service
journalctl --user -u scraper4.service -f
```

To start at boot and stay alive after logout, an administrator must enable linger:

```sh
sudo loginctl enable-linger "$(id -un)"
```

The generated unit records your current Node path, project location and PATH.
Regenerate it if Node or the checkout moves. It uses `Restart=always` and restarts
within five seconds. Stop deliberately with `systemctl --user stop scraper4`;
disable boot startup with `systemctl --user disable scraper4`.

Keep the deployer bound to loopback unless you have deliberately configured
HTTPS/firewall protection. Service mode does not change network exposure.

## Termux: termux-services (runit)

From the project directory:

```sh
pkg install termux-services
# Close and reopen the Termux terminal once to start its service daemon.
mkdir -p "$PREFIX/var/service/scraper4"
node scripts/keepalive-service.mjs --termux > "$PREFIX/var/service/scraper4/run"
chmod 700 "$PREFIX/var/service/scraper4/run"
sv-enable scraper4
sv up scraper4
sv status scraper4
```

The generated run script requests `termux-wake-lock` and runs the deployer in the
foreground under runit. Stop with `sv down scraper4`; disable with
`sv-disable scraper4`. Release the wake lock with `termux-wake-unlock` if no
other ongoing work needs it. A wake lock consumes battery.

For reboot startup, install the compatible **Termux:Boot** companion app and open
it once. Create `~/.termux/boot/start-services` with:

```sh
#!/data/data/com.termux/files/usr/bin/sh
export PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
termux-wake-lock
. "$PREFIX/etc/profile"
```

Run `chmod 700 ~/.termux/boot/start-services`. Set Android battery mode to
**Unrestricted** for Termux and Termux:Boot, permit background activity/vendor
Auto-start, and avoid Force stop. Android/OEM process killing, RAM exhaustion,
power loss and network loss still prevent a guarantee of uninterrupted service.

## Updates and scope

Both generated services set `DEPLOYER_SUPERVISED=true`: a deployer code update
exits for the OS supervisor to restart, rather than forking a competing deployer.
They also set `LOCAL_SCRAPER_STOP_WITH_UI=true` so service shutdown cleans up its
scraper. Restart the service after updating this release.

Tests cover policy/backoff, intentional stops and a real local scraper process
that crashes once and is restarted by the actual deployer. Systemd boot and
Android OEM battery behavior have not been verified on your devices. This is
recovery protection, not a diagnosis or cure of the original crash/OOM cause.
