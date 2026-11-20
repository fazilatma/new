# Diagnosing missing messenger chat notifications

## Confirmed code defects fixed in 10.731

1. **State was saved before delivery, without retry work.** A failed send or worker timeout could leave a chat signature marked as processed indefinitely, especially when reminders were off.
2. **One messenger's success could suppress another's retry.** The old shared content fingerprint did not distinguish destinations. The automatic chat outbox now uses independent destination/chunk acknowledgements instead.
3. **HTTP 200 was mistaken for successful delivery.** API error JSON and intermediary HTML could be logged as successful sends. The response body must now confirm success.
4. **The chat test used the wrong destination.** A configuration with only a conversation-specific Chat ID could send real chat notifications but fail the test. The test now exercises that route and reports failures.

These are source-code findings, not confirmation of the production server's current failure. Invalid/expired tokens, missing permissions, an unreachable messenger API, disabled routes, an inactive cron, or a killed worker may also prevent delivery.

## Deploy and verify

1. Install `scraper4.php` **10.731** from **`arena/821be8f1-new`** using the existing deployment panel. Update `deploy.php` to **3.8** if using its self-updater. An installation still running the source branch needs this initial branch selection/deployment; pushing Git alone does not deploy the host. Once installed, the new code targets this session's branch.
2. Preserve `connections.json`, `last_notification_check.json` and other live state. Do **not** delete notification state to force a retry: the first scan is deliberately silent and deleting it loses queued work.
3. Check the messenger's enabled switch, bot token, and the **conversation Chat ID**, or the common Chat ID when “all same” is enabled. Check the customer/admin notification route for the relevant shop.
4. In the authenticated application, inspect **`?notif_health=1`**. It reports cron health, `queued_chats`, and `last_notif_errors`. Queue entries themselves, text, tokens and destination IDs are not exposed by this health response.
5. Use **`?notif_test=1&kind=chats`** (the UI's chat test). **This sends a test message**; it does not consume scan state. Inspect `ok`, `error`, `errors` and per-messenger `sent` results. For transport attempts, inspect **`?msgr_log=1`**.
6. Send a new customer message after the initial baseline and allow the existing cron/scanner to run. A failed automatic send should remain queued. After repairing connectivity/configuration, a later scan retries it without resending acknowledged chunks to successful destinations.

### Interpret errors

- **401 / 403:** check bot credentials, permissions, bot membership and whether the recipient started/blocked the bot. The Basalam API may independently reject a shop token.
- **429:** rate limiting; the queue retries on later scans, not an immediate tight loop.
- **Network / DNS / timeout:** check outbound connectivity from the actual hosting server. Development-machine access is not proof of server connectivity.
- **Missing conversation Chat ID:** an orders-only or visits-only destination does not configure the chat route.
- **State write failure:** check free space and PHP's write/rename permissions on the script directory. The scanner will not send newly prepared work before a successful checkpoint.
- **No new notification on the first scan:** expected. Existing chats form the baseline; test with a later message.

## Persistence and security

Prepared text and media references are stored under `chat_outbox` in `last_notification_check.json`, with hashed destination identifiers (not raw messenger tokens). Completed jobs are deleted; failed jobs remain for retry. Back up this file privately. It now contains conversation content: deny direct HTTP access to runtime JSON, lock and temporary state files. The supplied Nginx configuration denies `.json`, `.lock` and notification-state temporary files; reload your Nginx configuration if updating these rules. On Apache/LiteSpeed, add an equivalent rule to the host's existing `.htaccess` (without replacing other rules):

```apache
<FilesMatch "^last_notification_check\.json($|\.)">
    Require all denied
</FilesMatch>
```

The existing Deploy workspace-backup feature excludes the notification state and temporary files by default. Never commit live tokens, state or conversation payloads.

## Offline tests

Run from the repository root with PHP 8.1+ and mbstring:

```sh
php -l scraper4.php
php -l deploy.php
php -d memory_limit=512M tests/notification_delivery_test.php
```

Tests extract the real delivery, routing, state and scanner functions without bootstrapping the application. Network and formatting dependencies are mocked; no customer messages or live API calls are made. Coverage includes partial failure, per-chunk retry after state reload, pagination, disabled reminders/channels, missing destinations, routing, read-only previews, silent first-scan behavior, API-response validation, atomic write failure and updater migration. It is not an end-to-end hosting/network test.
