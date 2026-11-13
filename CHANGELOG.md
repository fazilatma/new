# Release notes

Earlier Scraper4 releases remain documented in the in-app `CHANGELOG` in `scraper4.php`.

## Scraper4 10.731 / Deploy 3.8 — 2026-11-13

- Imported `arena/ae9391a9-new` at `24c5a210ee6f58cc47dac1b347df5d9918ea6cfb` into `arena/821be8f1-new`, preserving its history.
- Changed both updater defaults to this session's branch; migrate the source branch's saved selection and pin while retaining configured branch choices (within the existing 20-branch limit).
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
