# Project maintenance

- Work only on the active branch identified by Arena for the current conversation. Do not switch to source branches when importing another session's work.
- The owner requests English replies and automatic commit/push of completed, validated changes to the active branch. Never push another branch or publish runtime state/credentials.
- Continue versioning each release: increment `APP_VERSION` in `scraper4.php`, prepend its in-app `CHANGELOG` entry, update `CHANGELOG.md`, and add/update the relevant built-in selftest and offline regression coverage. Preserve historical changelog entries.
- When changing `deploy.php`, increment its separate `DEPLOY_VERSION` and document the change.
- Keep updater branch defaults aligned with the active session when transferring the project. Migrate old saved branch/pin settings without overwriting unrelated custom choices.
- Before finishing a notification change, run PHP lint and `php -d memory_limit=512M tests/notification_delivery_test.php`. This offline suite must not call live APIs or send customer messages.
- Pushing code is not deployment. Distinguish source-code findings, mocked test results, and verified production behavior. See `docs/notification-delivery.md` for operational checks.
