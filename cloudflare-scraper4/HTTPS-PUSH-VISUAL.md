# HTTPS, background notifications, and browser-rendered visual selection

Release branch: `arena/01a0aa17-new`. The current version is in `package.json`.
These features are implemented in the repository; generating files does not change
DNS, install certificates, alter firewall rules, or restart a remote VPS.

## 1. Before exposing the VPS

Use a dedicated hostname, for example **your own** `scraper.example.com` (the name
below is a placeholder, not a configured domain). Back up the database, exported
settings, `.env.local`, and `data/vault.key` privately. Preserve the application
checkout and database location. Use Node 22.13+ or Node 24 for built-in SQLite.

The public application **must have ADMIN_TOKEN enabled**. Otherwise its APIs are
public. Do not expose the standalone deployer port 8790 or the app port 3000 to the
internet. The main app's authenticated deployer menu remains available over HTTPS.
Do not put tokens in public URLs or send them in chat.

### Preserve existing encrypted credentials when enabling authentication

From `cloudflare-scraper4/`, with the existing environment available:

```bash
npm run https:env
```

This creates owner-only `data/https.env` without overwriting any existing file:

- An existing `ADMIN_TOKEN` from the process environment or `.env.local` is kept.
- If the app previously ran without a token, the existing local vault key is reused
  as the admin token, so the encryption password stays identical and saved
  WooCommerce/Basalam/AI credentials remain readable.
- If neither secret exists, the tool stops. `-- --new-install` generates a secret
  only when you explicitly confirm this is a new/empty installation.
- `SCRAPER_BIND_HOST=127.0.0.1` prevents direct public access to the app port.

The token is not printed. Read/manage the private file on your own server and use
the existing dashboard token input to authenticate. Treat this token as full
administrative access. Do not delete the old vault key or rotate tokens casually.

Load `data/https.env` **after** the existing environment in the current web and
queue services. Do not replace existing database settings. If a service manager
already supplies ADMIN_TOKEN separately, keep that value consistent.

## 2. Cloudflare DNS + Caddy (selected deployment option)

1. Create an **A record** for your selected subdomain pointing to the VPS's public
   IPv4 address. Add AAAA only if the server's IPv6 routing/firewall is working.
2. Initially use **DNS only** while Caddy obtains a public certificate. Allow
   inbound TCP 80 and 443; preserve SSH access and review existing firewall rules
   rather than replacing them blindly.
3. Install Caddy from its official package repository for your operating system.
4. Generate configuration, substituting your real hostname:

   ```bash
   npm run https:prepare -- --domain scraper.example.com --port 3000
   ```

   The result is `.deploy/https/Caddyfile`. Existing output is never overwritten.
   It points only to `127.0.0.1:3000`, enables HSTS for this hostname, and disables
   reverse-proxy buffering so the extraction-diagnosis stream stays live.
5. Back up the existing Caddy configuration. Add this site without replacing other
   sites. For an installation that already imports `/etc/caddy/conf.d/*.caddy`:

   ```bash
   sudo install -d -m 755 /etc/caddy/conf.d
   sudo install -m 644 .deploy/https/Caddyfile /etc/caddy/conf.d/scraper4.caddy
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

   If that import is absent, add it to the existing Caddyfile first. If validation
   fails, do not reload. Caddy automatically obtains and renews its certificate;
   check `journalctl -u caddy` locally if issuance fails.
6. Confirm HTTPS and `/health` work, then enable the Cloudflare proxy (orange cloud)
   and select **SSL/TLS → Full (strict)**. Do **not** use Flexible SSL.
7. Load the private environment files in the app's existing process manager,
   rebuild and restart that existing service. Do not launch a second app process
   on the same port. Ensure 3000/8790 are not publicly reachable.

For systemd, add EnvironmentFile entries to your **existing service's** override,
using real absolute paths (do not paste these placeholders literally):

```ini
[Service]
EnvironmentFile=-/ABSOLUTE/PROJECT/cloudflare-scraper4/.env.local
EnvironmentFile=/ABSOLUTE/PROJECT/cloudflare-scraper4/data/https.env
EnvironmentFile=/ABSOLUTE/PROJECT/cloudflare-scraper4/data/web-push.env
```

Create the push file in the next section before enabling its non-optional entry.
Apply the same environment to an independently managed queue worker. Run
`systemctl daemon-reload` after changing units, then restart the existing service
names. A deployer-managed installation must start the deployer with these same
environment files available so it passes them to its app process.

## 3. Persistent Web Push on the VPS

```bash
npm ci
npm run push:keys -- --subject mailto:YOUR-REAL-CONTACT-EMAIL
npm run render:build
```

The key generator writes owner-only `data/web-push.env` containing VAPID public and
private keys and the contact subject. It never prints keys or overwrites a file.
Load this file in both web and queue services and restart them. Keep the private
key private and stable: changing it requires devices to unsubscribe and subscribe
again. Subscriptions are encrypted in the application database using the admin
secret. Changing that secret also affects access to saved subscriptions.

Open the application at its HTTPS hostname. Under **Notifications**, use:

- Enable this device: grants permission and registers the device's push subscription.
- Server test: sends through the push service, not a simulated browser popup.
- HTTPS/notification status: checks secure context, browser permission and server configuration.
- Disable this device: revokes this subscription on the server and in the browser.

The service worker does **not** cache dashboard pages, tokens or API responses.
It can display notifications without an open dashboard tab. Notification clicks
open only this application's own scope, never an arbitrary payload URL.

### Events currently sent

- Completion, failure or stopping at the normal completion path of a Node queue job.
- New-version/new-commit/restart-needed notices from the existing local deployer.
  The VPS web process checks the deployer's notification log about once a minute,
  using its existing private handshake. The deployer must be running and scanning
  branches for these version notices; job notifications do not depend on it.

Subscriptions persist across app restarts. Expired endpoints (404/410) are removed;
transient failures are retained for future events. Delivery is best effort, not a
durable guaranteed-delivery queue. Push service acceptance is not proof that the
OS displayed the notification (permission, focus modes and power policies apply).
The existing deployer's `arm notifications` button remains its foreground/local
notification feature; enable persistent device push from the **main app** menu.

Desktop browsers generally support this. On iPhone/iPad use iOS/iPadOS 16.4+,
**Add to Home Screen**, then open the installed web app and grant permission.
Closing a tab is different from force-stopping the browser or disabling its
background activity. The VPS needs outbound HTTPS access to the browser's push
provider (FCM, Mozilla, Apple, or Windows); the scraping proxy is deliberately not
used for push credentials. The Cloudflare Worker runtime reports this new push
backend as unsupported in this release rather than claiming it is enabled.

## 4. Engine-aware visual selection

Choose the engine in the profile editor before opening the list/detail visual
selector. The current engine and indirect-connection setting are included in a
short-lived signed visual ticket.

| Profile engine | Visual page |
| --- | --- |
| Playwright | Chromium rendered DOM snapshot via Playwright |
| Puppeteer | Chromium rendered DOM snapshot via Puppeteer |
| Crawlee Playwright / Network API | Playwright DOM rendering (the visual view does not run Crawlee's queue or API-product parser) |
| Auto / HTML / Cheerio / JSON-LD / other non-browser parsers | HTML fetch; no hidden browser fallback |

Install the browser on the VPS:

```bash
npm run browsers:install
```

If using an installed Chromium, keep `BROWSER_EXECUTABLE_PATH` configured. Run the
app under a dedicated **non-root user** so Chromium's sandbox can work. The visual
renderer does not disable Chromium's sandbox by default. The explicit
`VISUAL_BROWSER_NO_SANDBOX=true` escape hatch is only for an already isolated
container/VM whose operator accepts that risk; it is not the recommended setup.

The browser shares the extraction browser-slot limiter. Navigation, resource count,
response sizes and overall render time are bounded. HTTP resources are fetched
through the guarded source transport (including configured indirect routing), not
through uncontrolled native Chromium networking. Private destinations and unsupported
resource methods are blocked. Native sockets/WebSockets are unavailable. Browser
cookies and authorization headers are not forwarded by the snapshot transport:
this feature is for public pages, not authenticated sessions or every interactive app.

The rendered DOM is sanitized, source scripts are removed, and only the hash-approved
picker script may run. The frame has an opaque sandbox origin, cannot access the
dashboard's storage, and its messages must match both its window and the ticket's
random channel. The engine is displayed inside the picker. If the browser cannot
launch or render, the UI reports the error; it does not silently claim a static
HTML fetch was browser-rendered.

**This is a DOM snapshot, not a screenshot and not a remotely controlled live browser.**
Rendered elements can be clicked to choose selectors. Source JavaScript menus,
login, infinite scrolling and "load more" buttons cannot be operated after the
snapshot is captured. Full remote-browser interaction is not part of this change.

## 5. Verification and deployment boundary

Repository tests cover generated configuration validation, private-key handling,
subscription encryption/deduplication/expiry, notification UI and service-worker
behavior, snapshot-driver routing/cleanup, sanitization, ticket tampering, and
parent/iframe message validation. Browser and push-service traffic are mocked in
these regression tests; they do not certify a live certificate, a real device's
OS notification delivery, or a particular site's Chromium rendering on your VPS.

The real hostname, DNS records, existing service names, certificate issuance,
firewall configuration and device permission must be verified on the actual VPS.
