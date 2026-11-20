# Release notes

## scraper4 10.746

- **Selftest repair pass.** A full `?selftest=1&json=1&fast=1` run on Noviex reported 13 failures; all of them were stale or self-referential assertions, not broken features.
  - 10.502 / 10.627 / 10.629 counted their own needle text in the file (`substr_count(...)===1|3`, and two *negative* `=== false` needles). The needles are now built by concatenation so the assertion line itself is never matched.
  - 10.504 / 10.587 / 10.605 / 10.670 referenced code that has since been refactored (`syncPipelineMark()` gained parameter types, `bslShopMapKey()` lost its third argument, the matrix yield delay moved into `$retryDelay`, and the best-seller profile writes `'products'=>$rows,'productsOrder'=>array_keys($active)`). The needles now match the current source.
  - 10.700 compared the global first positions of `if($action==='status')` and `if(!s4AccessSameOrigin())`; the later `member_api` branch also calls the guard and sits earlier in the file, so the check always failed. The comparison is now scoped to the admin dispatch block.
  - 10.681 / 10.682 / 10.721 now report the real computed values in the `detail` column instead of a bare pass/fail, so a red clause identifies itself.

## scraper4 10.745

- `?selftest=1&json=1&fails=1` now returns only the failing assertions, plus separate `passed`/`total`/`failed` counters, so checking a production host no longer means reading several hundred rows of JSON.

## scraper4 10.744

- **Fixed a latent fatal in the Digikala API client.** `srcNetResolveViaDoh()` and `srcNetApplyProxy()` were called but never defined anywhere in the file, so the first Digikala request that fell back to DoH or proxy mode died with `Call to undefined function` — which also aborted the whole `?selftest=1` run on Noviex. Both helpers now exist and reuse the established `aiDohResolve()` resolver and the proxy type/auth settings.

## scraper4 10.743

- **Branch sync.** Applied the newest work from every branch listed in the code-version section. `arena/ae9391a9-new` (10.730) and `arena/be64d982-new` (10.735) were already contained in this branch; `arena/821be8f1-new` (its own 10.731) is ported here in full; the auxiliary `pythonanywhere/` port from `arena/e868e86a-new` and the delivery docs/tests from `arena/821be8f1-new` were imported as well. `arena/9c213522-new` carries the separate storefront site (`amphp/`); only its vendor calculator is adopted, as requested.
- **New role «غرفه داران» (shopkeepers)** with exactly two tabs: «استعلام قیمت و موجودی» and «محاسبه گر غرفه داران».
- **Price/availability inquiry tab** reuses the «بررسی واجد شرایط سفارش» form, but results show only price and availability — every supplier/marketplace name, shop name, profile name and source link is stripped server-side before the JSON reaches this role.
- **Shopkeeper calculator tab** ports the vendor payment calculator from `arena/9c213522-new` (sale price, base price, profit-share %, sample-product commission %, cash vs sample settlement) with the same validation and rounding rules.
- **Vendor role is locked down server-side.** The eligibility endpoint only accepts `research`, `deep_basalam`, `deep_digikala` and `capabilities` for this role; anything else (price pushes, shop updates) is rejected with HTTP 403.
- **Noviex queue stall fixed — manual syncs no longer die on a busy marker.** A `busy` answer from the manual-sync guard («یک همگام‌سازی دستی همین حالا در حال اجراست») was returned without `retryable`, so the worker broke out of its segment loop and `s4WebWorkerRunSlice()` finished the job as `failed`. Every queued profile therefore ended as a permanently failed `manual_sync` that never reached the sending stage. A busy answer is now explicitly retryable: the job is requeued through `s4WorkerRequeueForRetry()` with a ≥20s delay and its attempt counter is not consumed.
- **Dead owners release the manual-sync marker immediately.** The progress marker now records `owner_pid`, and the busy guard treats a marker whose owner process no longer exists as stale instead of waiting out `stall_after` (up to 300s) — which is what made the stall self-sustaining on a host where worker slices end at the request boundary.
- **Bounded parallel web extraction lanes for hosts without `exec`.** The CLI pool (`s4DispatchParallelExtractJobs`) needs `exec`, so on Noviex every extraction had to run inside the single web-worker slice: one 60-page profile held the only lane while the rest of the queue looked «queued but never starting». Extraction jobs are now claimed atomically and each runs in its own detached loopback request (`?web_extract_lane=1`), respecting the same `extract_task_concurrency` limit, with the pool refilled as each lane finishes.
- **Lane health is self-correcting.** The main slice hands extraction to the lanes only while a loopback kick has demonstrably succeeded in the last 5 minutes; if loopback breaks, the slice takes extraction back automatically. A lane row is protected from orphan recovery for 60s while its request adopts it. `?worker_status=1` now reports `extract_lanes` (`supported`, `healthy`, `limit`, `running`, `pending`).

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

### Ported from `arena/821be8f1-new` (its 10.731 / Deploy 3.8)

- Updater defaults (scraper4 + deploy.php) now point at this session's branch `arena/01a0ebf7-new`; saved selections/pins of the already-merged session branches migrate to it while keeping other configured branches (within the existing 20-branch limit).
- Fixed automatic chat notifications being consumed before delivery: persist prepared message payloads together with scan signatures in `last_notification_check.json` (`chat_outbox`). Retry pending work before fetching the next chat page, even with reminders disabled.
- Acknowledge each destination and text chunk separately. A failed destination no longer gets suppressed by another destination's successful send. Retain failed work and expose errors and queue depth in notification health/cron output.
- Treat HTTP-200 API rejections, malformed JSON and HTML proxy responses as failures, not delivered messages. Preserve Rubika-style message IDs from `data.message_id`.
- Use the conversation destination for the chat notification test. Report missing destination/token and disabled-channel errors instead of silently claiming success.
- Keep `send=false` previews read-only and preserve the existing silent first-scan baseline.
- Make notification-state writes atomic and return write failures. Exclude the private notification state/outbox from Deploy's workspace-to-repository backup.
- Added an offline PHP regression suite and [notification troubleshooting guide](docs/notification-delivery.md).

### Delivery guarantees and limitations

The chat outbox provides **at-least-once text delivery**, not exactly-once delivery. If a process dies after the remote API accepts a chunk but before its acknowledgement is saved, that chunk may be sent again. Attachments remain best-effort; attachment failure does not replay successfully delivered text. Retries require the notification scanner/cron to run, an enabled shop route, and an enabled messenger with valid credentials and a destination. Missing destinations or having no enabled messenger retain work; successfully completed jobs are removed. Disabled messengers are not delivery targets, so successful delivery to the remaining enabled destinations can complete a job.

This release does not replay messages already marked as processed by older versions. Order/product notification retry behavior is unchanged. Live site configuration, connectivity and delivery were not verified from the development sandbox.

### Validation

- PHP syntax checks passed for `scraper4.php`, `deploy.php` and the test suite.
- 53 offline regression checks passed on PHP 8.1 and 8.5 via PHP-WASM. No live network or messenger delivery test was performed.
