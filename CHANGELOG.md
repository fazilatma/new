# Release notes

## scraper4 10.730

- Adopted the latest project snapshot from `arena/ae9391a9-new` onto the active chat branch.
- Group sent and received chat messages by unique vendor-customer conversation, preventing cross-customer mixing.
- Documented the existing notification/cron health endpoint (`?notif_health=1`) in the project overview.

## Notification delivery diagnosis (already present in 10.730)

- The external cron is only a trigger. On shared hosting, it invokes `cron_run`; with `server.sh`, the persistent worker runs the internal cron tick (default 60 seconds) without a system cron.
- Notification polling and auto-replies run near the beginning of `cron_run`, before long sync/extraction tasks, to avoid host request timeouts preventing notifications from being checked.
- Cron heartbeat and final ping delivery are independent from Basalam shop credentials. Messenger readiness still requires an enabled channel with valid credentials and recipient/chat ID.
- `?notif_health=1` distinguishes a missing cron run, an incomplete run/lock, disabled ping, missing messenger setup, and notification polling errors. `?notif_test_send=1` tests delivery (and checks Basalam prerequisites).
