# cloudflare-scraper4

Imported from `fazilatma/code` because no exact directory named `cloudflare-scraper4` was found there; the closest matching project/file is `scraper4.php`.

Source repository: https://github.com/fazilatma/code
Source commit: `0bfbf7cb2ae316772e05f9e901f66df5bcd2b1ea`
Source path: `scraper4.php`

## What it is

`scraper4.php` is a monolithic Persian PHP tool for scraping/synchronizing products and managing WooCommerce/Basalam workflows. It also includes Cloudflare-related AI/DoH integration code.

## Run

Place `scraper4.php` on a PHP-enabled host or run from CLI, for example:

```bash
php scraper4.php whoami
php scraper4.php cron_run
php scraper4.php cron_run detail
php scraper4.php backup
```

Runtime configuration, queues, logs, backups, and uploaded images are intentionally ignored by Git in this folder.
