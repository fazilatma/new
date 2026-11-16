# Release notes

## scraper4 10.742

- Fixed the 10.730 conversation assertion, which still searched for the word «تهران» in the merged chat text and therefore failed once the label was removed. It now checks the exact formatted message time in parentheses and separately asserts that the Tehran word is absent.

## scraper4 10.741

- Timestamps no longer carry the word «تهران». `s4FormatTehranChatTime()` returns a bare `HH:MM` (with the Jalali date prefix for older days) and `s4TehranStamp()` returns the Jalali date/time without the «به وقت تهران» suffix. The values are still computed in Tehran time; only the label is gone.
- Root cause of Noviex not running long server-side operations: `exec` is listed in `disable_functions`, so the persistent CLI worker could never start and every spawn path returned `exec_disabled`. Long jobs therefore died with the web request that created them.
- Added capability detection instead of domain detection. `s4RuntimeCaps()` actually *runs* a probe through `exec` (not just `function_exists`) and picks the engine: a working `exec` keeps the existing persistent CLI daemon (Sabashopping is unchanged), a disabled `exec` switches to a self-chained web worker.
- The web worker is a detached loopback request authenticated with a rotating HMAC token. It takes the canonical `worker.lock`, writes the same `worker_state` heartbeat, drains the job queue for one bounded slice (default 45s) and calls the next slice over loopback HTTP before exiting, so a long operation survives across request lifetimes.
- `exec` children were given an HTTP equivalent: matrix build, matrix fix, manual sync and the internal cron run through the existing endpoints over loopback, preserving the memory isolation that motivated using child processes. Backend extraction, which already runs in-process, is queued and the web worker is armed immediately.
- Every successful enqueue arms the engine, throttled to at most one kick per 8 seconds, and a slice only chains when it actually did work and more claimable work remains — so no endless loop of empty requests, and `worker_stop.json` is still honoured.
- `?worker_status` and the PHP health report now expose `engine` (`cli_daemon` / `web_worker`), `exec_available` and the web-worker state, so it is visible which engine a host is using.

## scraper4 10.740

- Fixed messenger message times showing 3.5 hours ahead (for example `17:15 تهران` for a message that arrived at 13:45 Tehran). Basalam returns Tehran wall-clock without a zone suffix, but the code treated those values as UTC and converted them to Tehran a second time.
- Added `S4_API_NAIVE_TIMEZONE` (`Asia/Tehran`): zone-less values are Tehran wall-clock, values with `Z`/`±hh:mm` are absolute, numeric values are Unix seconds. All three now resolve to the same correct Tehran clock.
- `s4FormatTehranChatTime()` and `s4ParseApiTimestamp()` share one parser, and the remaining raw `strtotime()` calls for chat message times, order creation time, order sorting and the "recent order" window were switched to it, so ordering and freshness detection are no longer shifted either.

## scraper4 10.739

- Fixed the sudden drop in the number of shops shown in the Start page's final table and daily chart. Any narrow discrepancy-matrix build (for example the per-cell «برابر‌سازی» action, which rebuilds one profile for one destination) overwrote the whole matrix result file, and the Start table derived its destination columns from that file.
- Destination columns now come from the configured Basalam shops (`s4StartConfiguredDestinations()`), so a narrow build can no longer make shops disappear.
- Added a durable per-destination count store (`start_destination_counts.json`). A destination that the latest build did not measure keeps its last real number and is labelled as not refreshed instead of silently reading zero.
- The daily and per-refresh histories keep per-destination values, so a partial refresh updates only the shops it measured. Total, configured shop count and measured shop count are now reported separately in the badge, metrics and tooltip.

## scraper4 10.738

- Fixed a self-referential needle in the 10.737 assertion that always reported failure; the check now builds its search strings in parts and verifies the real `bslSanitizeProductWritePayload(payload, endpoint)` behaviour.

## scraper4 10.737

- Fixed a reversed-argument call to `bslSanitizeProductWritePayload()` inside the 10.721 self-test fixture that raised a `TypeError` and aborted the whole `?selftest=1` run; all version assertions are reported again.

## scraper4 10.736

- Every server-side timestamp is now rendered in `Asia/Tehran`. Added `s4TehranDate()`, `s4ZoneDate()`, `s4TehranStamp()` and `s4ParseApiTimestamp()` and replaced all `date()` calls so the server clock (usually UTC) no longer leaks into messenger messages, reports, logs or file stamps.
- Messenger bodies that embed a time (admin human reply to customer, operation result report, cron heartbeat and cron summary, server status output) now show a Jalali Tehran stamp with an explicit `به وقت تهران` label.
- Basalam order notifications include the order creation time, parsing zone-less API timestamps as UTC before converting to Tehran.
- Daily digest scheduling, off-hours detection and daily counters are evaluated on the Tehran day/hour (or the explicitly configured digest timezone).

## scraper4 10.735

- Every conversation notification is now sent as one integrated text post, including long conversations; oversized content is compacted rather than split into numbered posts. Conversation media URLs stay inline instead of creating separate attachment posts.
- All conversation message timestamps now parse explicit offsets, UTC timestamps without an offset, and Unix timestamps consistently, then display Jalali date/time labeled `تهران`.
- Standard and manually resent chat notifications now use the same formatter and timezone handling.

## scraper4 10.734

- Messenger notification timestamps now use the Jalali calendar and the `Asia/Tehran` timezone, including chat-history times, cron/test pings, daily digests, reconciliation and sync reports, and retirement notices.
- Added a dependency-free Gregorian-to-Jalali date converter and routed the existing readable-date helper through it.

## scraper4 10.733

- Quoted-product chat notifications are now consolidated into a single integrated messenger message with the quoted product link and available eligibility result; separate media posts and the earlier duplicate notice are suppressed for these conversations.
- Recent unprocessed orders are eligible for a check on the first scan and can be retried if their eligibility result was not delivered. Delivery state now reflects successful messenger delivery, and queued order checks run after initial chat notifications but before slower quoted-product inquiries.

## scraper4 10.732

- Non-admin workspaces now have a fixed footer for order eligibility and popular products; supervisors also get a daily attendance-hours tab with per-account records.
- Suffix/profile-first procurement matching avoids unrelated profile fallback when product codes are supplied. Order Lane 3 research is restricted to newly created orders and runs only after customer chat notifications.
- Quoted-product conversations send an initial notice before slow inquiry work, then an updated notice with a separate eligibility result. Product names are no longer shortened in order eligibility notices.
- Added optional shop-originated quoted-product customer replies and per-shop auto-reply selection.

## scraper4 10.731

- Manual bulk chat summaries now explicitly target the shared conversations destination instead of the generic reminder route; this fixes delivery when a separate conversation Chat ID is configured.
- Bulk-send responses now aggregate actual per-messenger delivery results, report successful sends separately from attempts, and retain channel errors instead of letting the last conversation overwrite earlier results.
- `?notif_health=1` now reports whether each active messenger resolves both its ping and conversation destination. The manual ping button intentionally bypasses the configured interval; automatic pings default to every 360 minutes.

## scraper4 10.730

- Adopted the latest project snapshot from `arena/ae9391a9-new` onto the active chat branch.
- Group sent and received chat messages by unique vendor-customer conversation, preventing cross-customer mixing.
- Documented the existing notification/cron health endpoint (`?notif_health=1`) in the project overview.

## Notification delivery diagnosis (already present in 10.730)

- The external cron is only a trigger. On shared hosting, it invokes `cron_run`; with `server.sh`, the persistent worker runs the internal cron tick (default 60 seconds) without a system cron.
- Notification polling and auto-replies run near the beginning of `cron_run`, before long sync/extraction tasks, to avoid host request timeouts preventing notifications from being checked.
- Cron heartbeat and final ping delivery are independent from Basalam shop credentials. Messenger readiness still requires an enabled channel with valid credentials and recipient/chat ID.
- `?notif_health=1` distinguishes a missing cron run, an incomplete run/lock, disabled ping, missing messenger setup, and notification polling errors. `?notif_test_send=1` tests delivery (and checks Basalam prerequisites).
